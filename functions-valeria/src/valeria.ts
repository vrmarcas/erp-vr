/**
 * valeria.ts — Cloud Functions de integração Valéria / Chatvolt
 * Versão 2.0.0 — Reescrita com segurança, idempotência e contrato padronizado.
 *
 * Todas as funções:
 *   1. Validam Bearer token (Secret Manager, timing-safe, rotação CURRENT+PREV)
 *   2. Validam agentId + organizationId
 *   3. Exigem conversationId como identificador primário
 *   4. Verificam rate limiting (global e por conversa)
 *   5. Suportam idempotência via Idempotency-Key header
 *   6. Retornam contrato padronizado ApiResponse
 *   7. Nunca expõem stack trace, secrets, margens ou fórmulas
 *
 * Secrets obrigatórios (Firebase Secret Manager):
 *   VALERIA_BEARER_SECRET      — chave atual
 *   VALERIA_BEARER_SECRET_PREV — chave anterior (rotação)
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { randomUUID } from "crypto";

import { pipeline } from "./pipeline";
import { withIdempotency, extractIdempotencyKey } from "./idempotency";
import { evaluateQuoteEligibility } from "./pricing";
import { ok, err, QUOTE_RESPONSES } from "./response";

import type {
  Cliente,
  CrmLead,
  CrmLeadDict,
  KbOs,
  OrcamentoEnviado,
  PricingSimulation,
  QuoteItem,
} from "./types";

// ── Inicialização do Firebase Admin (idempotente) ─────────────────────────────

if (!admin.apps.length) admin.initializeApp();

// ── Constantes ────────────────────────────────────────────────────────────────

const COL          = "erp_vr";
const SECRET_NAMES = ["VALERIA_BEARER_SECRET", "VALERIA_BEARER_SECRET_PREV"];
// Gen 1 com Secret Manager — secrets injetados como process.env.NOME_DO_SECRET
const RUN_OPTS = functions.runWith({
  secrets:        SECRET_NAMES,
  timeoutSeconds: 30,
  memory:         "256MB",
});

// ── Helpers Firestore ─────────────────────────────────────────────────────────

async function fsRead<T>(key: string): Promise<T | null> {
  const db  = admin.firestore();
  const doc = await db.collection(COL).doc(key).get();
  if (!doc.exists) return null;
  const raw = doc.data()?.data;
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

async function fsWrite(key: string, data: unknown): Promise<void> {
  const db = admin.firestore();
  await db.collection(COL).doc(key).set({
    data: JSON.stringify(data),
    ts: Date.now(),
  });
}

// ── Helpers CRM (dict unificado ERP + Valéria) ───────────────────────────────

const SIM_COL     = "valeria_simulations";
const SIM_TTL_MS  = 60 * 60 * 1000; // 1 hora

/**
 * Mapeamento: etapa interna Valéria → coluna Kanban ERP.
 * O ERP usa strings minúsculas com underline; a Valéria usa CAPS.
 */
const VALERIA_TO_ERP_ETAPA: Record<string, string> = {
  NOVO_LEAD:          "ia_novo",
  CONTATO_FEITO:      "qualificando",
  BRIEFING_COLETADO:  "qualificando",
  ORCAMENTO_ENVIADO:  "orc_emitido",
  NEGOCIACAO:         "negociacao",
  GANHO:              "fechado",
  PERDIDO:            "fechado",
  REABERTO:           "qualificando",
  aguardando_humano:  "qualificando",
};

/** Temperatura padrão por etapa Valéria */
const ETAPA_TO_TEMP: Record<string, string> = {
  NOVO_LEAD: "frio", CONTATO_FEITO: "frio",
  BRIEFING_COLETADO: "morno", ORCAMENTO_ENVIADO: "morno",
  NEGOCIACAO: "quente", GANHO: "quente",
};

/** Cor padrão por temperatura */
const TEMP_TO_COR: Record<string, string> = {
  quente: "#FCA5A5", morno: "#FCD34D", frio: "#93C5FD",
};

/** Procura um lead no dict por conversationId */
function findLeadByConv(dict: CrmLeadDict, conversationId: string): { id: string; lead: CrmLead } | null {
  for (const [id, lead] of Object.entries(dict)) {
    if (lead.valeria?.conversationId === conversationId) return { id, lead };
  }
  return null;
}

/** Monta / atualiza campos ERP a partir da etapa Valéria */
function erpFieldsFromEtapa(valeriaStatus: string): Partial<CrmLead> {
  const etapa = VALERIA_TO_ERP_ETAPA[valeriaStatus] ?? "qualificando";
  const temp  = ETAPA_TO_TEMP[valeriaStatus] ?? "frio";
  return { etapa, temp, cor: TEMP_TO_COR[temp] };
}

// ── Helpers simulação de preço ───────────────────────────────────────────────

async function saveSimulation(sim: PricingSimulation): Promise<void> {
  const db = admin.firestore();
  await db.collection(SIM_COL).doc(sim.simulationId).set(sim);
}

async function getSimulation(simulationId: string): Promise<PricingSimulation | null> {
  const db  = admin.firestore();
  const doc = await db.collection(SIM_COL).doc(simulationId).get();
  if (!doc.exists) return null;
  return doc.data() as PricingSimulation;
}

function normTel(tel: string): string {
  return (tel ?? "").replace(/\D/g, "");
}

function uid(prefix = "v"): string {
  return `${prefix}_${randomUUID()}`;
}

// pipeline() importado de ./pipeline (shared middleware)

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET CONTEXTO DA CONVERSA
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaGetContexto = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaGetContexto");
    if (!ppl) return;
    const { ctx } = ppl;

    try {
      const db      = admin.firestore();
      const convDoc = await db.collection("valeria_conversations").doc(ctx.conversationId).get();

      let clienteId: string | null = null;
      let leadId: string | null    = null;
      if (convDoc.exists) {
        const d  = convDoc.data()!;
        clienteId = d["clienteId"] ?? null;
        leadId    = d["leadId"]    ?? null;
      }

      // Fallback por channelPhone (telefone do canal — confiável)
      let cliente: Cliente | null = null;
      if (!clienteId && ctx.channelPhone) {
        const clientes = await fsRead<Cliente[]>("clientes");
        const t        = normTel(ctx.channelPhone);
        cliente        = clientes?.find((c) => normTel(c.tel ?? "") === t) ?? null;
        if (cliente) clienteId = cliente.id;
      }
      if (clienteId && !cliente) {
        const clientes = await fsRead<Cliente[]>("clientes");
        cliente = clientes?.find((c) => c.id === clienteId) ?? null;
      }

      let lead: CrmLead | null = null;
      // Busca no dict unificado crm_leads (mesmo que o ERP Kanban lê)
      const leadsDict = await fsRead<CrmLeadDict>("crm_leads");
      if (leadId && leadsDict?.[leadId]) {
        lead = leadsDict[leadId];
      } else if (!leadId) {
        // Fallback: buscar por conversationId no dict
        const found = leadsDict ? findLeadByConv(leadsDict, ctx.conversationId) : null;
        if (found) lead = found.lead;
      }

      res.json(ok(
        { conversationId: ctx.conversationId, cliente, lead },
        { communicableToCustomer: false, verified: !!cliente }
      ));
    } catch (e) {
      console.error("[valeriaGetContexto]", (e as Error).message);
      res.status(500).json(err("INTERNAL_ERROR", "Erro ao buscar contexto."));
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. UPSERT CLIENTE
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaUpsertCliente = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaUpsertCliente");
    if (!ppl) return;
    const { ctx } = ppl;
    if (req.method !== "POST") { res.status(405).json(err("METHOD_NOT_ALLOWED", "Use POST.")); return; }

    const body = req.body as Record<string, unknown>;
    const nome = body["nome"] as string | undefined;
    const tel  = ctx.channelPhone ?? (body["tel"] as string | undefined);

    if (!nome) { res.status(400).json(err("VALIDATION_ERROR", "nome é obrigatório.", { missingFields: ["nome"] })); return; }
    if (!tel)  { res.status(400).json(err("VALIDATION_ERROR", "channelPhone ou tel é obrigatório.", { missingFields: ["channelPhone"] })); return; }

    const idempKey = extractIdempotencyKey(req);
    const result = await withIdempotency(
      { idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaUpsertCliente" },
      async () => {
        const clientes = (await fsRead<Cliente[]>("clientes")) ?? [];
        const t        = normTel(tel);
        const idx      = clientes.findIndex((c) => normTel(c.tel ?? "") === t);

        let cliente: Cliente;
        let acao: string;

        if (idx >= 0) {
          Object.assign(clientes[idx], {
            nome,
            ...(body["email"]   !== undefined && { email:   body["email"]   }),
            ...(body["cidade"]  !== undefined && { cidade:  body["cidade"]  }),
            ...(body["tipo"]    !== undefined && { tipo:    body["tipo"]    }),
            ...(body["doc"]     !== undefined && { doc:     body["doc"]     }),
            ...(body["contato"] !== undefined && { contato: body["contato"] }),
            ...(body["marca"]   !== undefined && { marca:   body["marca"]   }),
          });
          const ids = new Set(clientes[idx].conversationIds ?? []);
          ids.add(ctx.conversationId);
          clientes[idx].conversationIds = [...ids];
          cliente = clientes[idx];
          acao    = "atualizado";
        } else {
          cliente = {
            id:              uid("c"),
            nome,
            tipo:            (body["tipo"]    as string) ?? "PF",
            cidade:          (body["cidade"]  as string) ?? "—",
            marca:           (body["marca"]   as string) ?? "vr",
            tel,
            email:           (body["email"]   as string) ?? "",
            doc:             (body["doc"]     as string) ?? "",
            contato:         (body["contato"] as string) ?? "",
            ultimoPedido:    new Date().toISOString(),
            os:              [],
            conversationIds: [ctx.conversationId],
          };
          clientes.unshift(cliente);
          acao = "criado";
        }

        await fsWrite("clientes", clientes);
        await admin.firestore().collection("valeria_conversations")
          .doc(ctx.conversationId)
          .set({ clienteId: cliente.id, agentId: ctx.agentId, updatedAt: Date.now() }, { merge: true });

        return ok(
          { acao, clienteId: cliente.id, cliente },
          { communicableToCustomer: false, verified: true }
        );
      }
    );

    res.status(result.success ? 200 : 500).json(result);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. CATÁLOGO (sem preços)
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaCatalogo = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaCatalogo");
    if (!ppl) return;

    try {
      // erp_orc_produtos: array de strings ou objetos {nome,...}
      const produtosRaw = (await fsRead<unknown[]>("erp_orc_produtos")) ?? [];
      const catalogo = produtosRaw.map((p) => {
        const nome      = typeof p === "string" ? p : ((p as Record<string,unknown>)["nome"] ?? (p as Record<string,unknown>)["tipo"] ?? "Produto");
        const categoria = typeof p === "string" ? ""  : ((p as Record<string,unknown>)["categoria"] ?? "");
        const unidade   = typeof p === "string" ? "m²" : ((p as Record<string,unknown>)["unidade"] ?? "m²");
        return { nome, categoria, unidade, observacao: "Solicitar orçamento formal para valores." };
      });
      res.json(ok({ catalogo, total: catalogo.length }, { communicableToCustomer: true, verified: true }));
    } catch (e) {
      console.error("[valeriaCatalogo]", (e as Error).message);
      res.status(500).json(QUOTE_RESPONSES.temporarilyUnavailable());
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. CALCULAR ORÇAMENTO (motor oficial — retorna simulationId, não total exposto)
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaCalcularOrcamento = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaCalcularOrcamento");
    if (!ppl) return;
    const { ctx } = ppl;
    if (req.method !== "POST") { res.status(405).json(err("METHOD_NOT_ALLOWED", "Use POST.")); return; }

    const body  = req.body as Record<string, unknown>;
    const itens = body["itens"] as QuoteItem[] | undefined;

    if (!itens || !Array.isArray(itens) || itens.length === 0) {
      res.status(400).json(err("VALIDATION_ERROR", "itens[] é obrigatório.", { missingFields: ["itens"] }));
      return;
    }

    const idempKey = extractIdempotencyKey(req);
    const result = await withIdempotency(
      { idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaCalcularOrcamento" },
      async () => {
        // Campos de preço bloqueados: o motor calcula exclusivamente server-side.
        // rsm2 nos itens também é ignorado — preço vem do catálogo (matKey).
        const sanitizedItens = itens.map((it) => { const { rsm2: _r, ...rest } = it as unknown as Record<string,unknown>; return rest as unknown as QuoteItem; });
        const pricing = await evaluateQuoteEligibility(sanitizedItens, {});

        switch (pricing.eligibility) {
          case "NEEDS_INFORMATION":
            return QUOTE_RESPONSES.needsInformation(pricing.missingFields ?? []);
          case "HUMAN_VALIDATION_REQUIRED":
            return QUOTE_RESPONSES.humanValidationRequired(
              `Validação humana necessária: ${(pricing.missingFields ?? []).join(", ")}`
            );
          case "UNSUPPORTED":
            return QUOTE_RESPONSES.unsupported(String(body["descricao"] ?? "desconhecido"));
          case "TEMPORARILY_UNAVAILABLE":
            return QUOTE_RESPONSES.temporarilyUnavailable();
          case "ELIGIBLE": {
            // Persistir simulação no servidor — criarOrcamento vai recuperar por ID
            const simId  = pricing.simulationId ?? uid("sim");
            const simNow = Date.now();
            const sim: PricingSimulation = {
              simulationId:      simId,
              conversationId:    ctx.conversationId,
              itensNormalizados: sanitizedItens,
              finalPrice:        pricing.finalPrice!,
              pricingVersion:    pricing.pricingVersion!,
              createdAt:         simNow,
              expiresAt:         simNow + SIM_TTL_MS,
              origem:            "valeria",
              usado:             false,
            };
            await saveSimulation(sim);

            return ok(
              {
                simulationId:   simId,
                finalPrice:     pricing.finalPrice,
                pricingVersion: pricing.pricingVersion,
                itensCount:     sanitizedItens.length,
                conversationId: ctx.conversationId,
              },
              { communicableToCustomer: true, verified: true }
            );
          }
        }
      }
    );

    res.status(result.success ? 200 : 422).json(result);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. CRIAR ORÇAMENTO FORMAL (somente com simulationId + recálculo pelo motor)
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaCriarOrcamento = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaCriarOrcamento");
    if (!ppl) return;
    const { ctx } = ppl;
    if (req.method !== "POST") { res.status(405).json(err("METHOD_NOT_ALLOWED", "Use POST.")); return; }

    const body = req.body as Record<string, unknown>;

    // Rejeitar campos proibidos explicitamente
    const forbidden = ["total", "valor", "preco", "price", "amount", "finalPrice"];
    const found = forbidden.filter((f) => body[f] !== undefined);
    if (found.length > 0) {
      res.status(400).json(err(
        "FORBIDDEN_FIELD",
        `Campos não permitidos: [${found.join(", ")}]. O valor é calculado exclusivamente pelo motor do ERP.`,
        { communicableToCustomer: false }
      ));
      return;
    }

    const simulationId = body["simulationId"] as string | undefined;
    const nomeCliente  = body["nomeCliente"]  as string | undefined;
    const itens        = body["itens"]        as QuoteItem[] | undefined;
    const telCliente   = ctx.channelPhone ?? (body["telCliente"] as string | undefined);

    const missing: string[] = [];
    if (!simulationId) missing.push("simulationId");
    if (!nomeCliente)  missing.push("nomeCliente");
    if (!telCliente)   missing.push("channelPhone");
    if (!itens || !Array.isArray(itens) || itens.length === 0) missing.push("itens");
    if (missing.length > 0) {
      res.status(400).json(err("VALIDATION_ERROR", "Campos obrigatórios ausentes.", { missingFields: missing }));
      return;
    }

    const idempKey = extractIdempotencyKey(req);
    const result = await withIdempotency(
      { idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaCriarOrcamento" },
      async () => {
        // Recuperar simulação e marcar como usada em transação atômica (anti double-spend)
        let sim!: PricingSimulation;
        try {
          const db = admin.firestore();
          await db.runTransaction(async (tx) => {
            const simRef = db.collection(SIM_COL).doc(simulationId!);
            const simDoc = await tx.get(simRef);
            if (!simDoc.exists) throw Object.assign(new Error(), { _code: "SIMULATION_NOT_FOUND" });
            const simData = simDoc.data() as PricingSimulation;
            if (simData.conversationId !== ctx.conversationId)
              throw Object.assign(new Error(), { _code: "SIMULATION_MISMATCH" });
            if (simData.expiresAt < Date.now())
              throw Object.assign(new Error(), { _code: "SIMULATION_EXPIRED" });
            if (simData.usado)
              throw Object.assign(new Error(), { _code: "SIMULATION_ALREADY_USED" });
            tx.update(simRef, { usado: true });
            sim = simData;
          });
        } catch (e: unknown) {
          const code = (e as { _code?: string })._code;
          if (code === "SIMULATION_NOT_FOUND")
            return err("SIMULATION_NOT_FOUND", "simulationId não encontrado. Execute valeriaCalcularOrcamento primeiro.", { communicableToCustomer: false });
          if (code === "SIMULATION_MISMATCH")
            return err("SIMULATION_MISMATCH", "simulationId pertence a outra conversa.", { communicableToCustomer: false });
          if (code === "SIMULATION_EXPIRED")
            return err("SIMULATION_EXPIRED", "Simulação expirada (válida por 1h). Execute valeriaCalcularOrcamento novamente.", { communicableToCustomer: true });
          if (code === "SIMULATION_ALREADY_USED")
            return err("SIMULATION_ALREADY_USED", "Esta simulação já foi usada para criar um orçamento.", { communicableToCustomer: false });
          throw e; // erro inesperado do Firestore
        }

        const orcamentos = (await fsRead<OrcamentoEnviado[]>("orcamentos")) ?? [];
        const maxN = orcamentos.reduce((m, o) => Math.max(m, parseInt(String(o.n ?? 0), 10) || 0), 0);

        const orc: OrcamentoEnviado = {
          id:                    uid("orc"),
          n:                     maxN + 1,
          nomeCliente:           nomeCliente!,
          telCliente:            telCliente!,
          emailCliente:          (body["emailCliente"] as string) ?? "",
          descricao:             (body["descricao"]    as string) ?? "",
          itens:                 sim.itensNormalizados,   // itens do servidor, não da IA
          total:                 sim.finalPrice,           // preço do servidor
          totalCost:             sim.finalPrice,
          pricingVersion:        sim.pricingVersion,
          quoteEngine:           "erp_official",
          simulationId:          simulationId!,
          communicableToCustomer: true,
          status:                "pre_orc_valeria",
          data:                  new Date().toISOString(),
          marca:                 (body["marca"] as string) ?? "vr",
          origem:                "valeria",
          conversationId:        ctx.conversationId,
          agentId:               ctx.agentId,
          organizationId:        ctx.organizationId,
        };

        orcamentos.unshift(orc);
        await fsWrite("orcamentos", orcamentos);
        await admin.firestore().collection("valeria_conversations")
          .doc(ctx.conversationId)
          .set({ orcamentoId: orc.id, updatedAt: Date.now() }, { merge: true });

        return ok(
          { orcamentoId: orc.id, n: orc.n, total: orc.total, pricingVersion: orc.pricingVersion },
          { communicableToCustomer: true, verified: true }
        );
      }
    );

    res.status(result.success ? 201 : 422).json(result);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. CRIAR / ATUALIZAR OPORTUNIDADE CRM
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaCriarOportunidade = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaCriarOportunidade");
    if (!ppl) return;
    const { ctx } = ppl;
    if (req.method !== "POST") { res.status(405).json(err("METHOD_NOT_ALLOWED", "Use POST.")); return; }

    const body = req.body as Record<string, unknown>;
    const nome = body["nome"] as string | undefined;
    const tel  = ctx.channelPhone ?? (body["tel"] as string | undefined);

    if (!nome) { res.status(400).json(err("VALIDATION_ERROR", "nome é obrigatório.", { missingFields: ["nome"] })); return; }
    if (!tel)  { res.status(400).json(err("VALIDATION_ERROR", "channelPhone é obrigatório.", { missingFields: ["channelPhone"] })); return; }

    const idempKey = extractIdempotencyKey(req);
    const result = await withIdempotency(
      { idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaCriarOportunidade" },
      async () => {
        // Lê o dict unificado crm_leads (mesmo documento que o Kanban do ERP usa)
        const dict: CrmLeadDict = (await fsRead<CrmLeadDict>("crm_leads")) ?? {};
        const now  = new Date().toISOString();

        // Busca por conversationId no dict; fallback por telefone normalizado
        let found = findLeadByConv(dict, ctx.conversationId);
        if (!found) {
          const normT = normTel(tel);
          const entry = Object.entries(dict).find(([, l]) => normTel(l.tel ?? "") === normT);
          if (entry) found = { id: entry[0], lead: entry[1] };
        }

        let lead: CrmLead;
        let acao: string;

        if (found) {
          // Atualizar lead existente (mantém campos ERP; atualiza sub-objeto valeria)
          const existing = found.lead;
          existing.nome  = nome;
          existing.tel   = tel;
          if (body["email"]) existing.email = body["email"] as string;
          existing.valeria = {
            ...existing.valeria,
            status:         existing.valeria?.status ?? "NOVO_LEAD",
            conversationId: ctx.conversationId,
            agentId:        ctx.agentId,
            organizationId: ctx.organizationId,
            ...(body["observacoes"]     !== undefined && { observacoes:     body["observacoes"] as string }),
            ...(body["proximaAcao"]     !== undefined && { proximaAcao:     body["proximaAcao"] as string }),
            ...(body["dataProximaAcao"] !== undefined && { dataProximaAcao: body["dataProximaAcao"] as string }),
            dataEntrada:    existing.valeria?.dataEntrada ?? now,
            updatedAt:      now,
            historico:      [...(existing.valeria?.historico ?? []),
              { ts: now, acao: "atualizado", agentId: ctx.agentId }],
          };
          dict[found.id] = existing;
          lead = existing;
          acao = "atualizado";
        } else {
          // Criar novo lead em formato compatível com o Kanban ERP
          const id = uid("lead");
          lead = {
            id,
            nome,
            tel,
            email:    (body["email"] as string) ?? "",
            etapa:    "ia_novo",           // primeira coluna do Kanban
            marca:    "vr",                // padrão; pode ser overridden via briefing
            sub:      tel,
            temp:     "frio",
            score:    Math.floor(Math.random() * 30) + 10,
            cor:      TEMP_TO_COR["frio"],
            origem:   (body["origem"] as string) ?? "valeria",
            contato:  nome,
            cidade:   (body["cidade"] as string) ?? "",
            segmento: (body["segmento"] as string) ?? "",
            dores:    [],
            resumo_ia: (body["observacoes"] as string) ?? "Lead criado pela Valéria.",
            valor:    "A definir",
            valeria: {
              status:         "NOVO_LEAD",
              conversationId: ctx.conversationId,
              agentId:        ctx.agentId,
              organizationId: ctx.organizationId,
              observacoes:    (body["observacoes"] as string) ?? "",
              proximaAcao:    (body["proximaAcao"] as string) ?? "",
              dataProximaAcao:(body["dataProximaAcao"] as string) ?? "",
              dataEntrada:    now,
              historico:      [{ ts: now, acao: "criado", agentId: ctx.agentId }],
            },
          };
          dict[id] = lead;
          acao = "criado";
        }

        await fsWrite("crm_leads", dict);
        await admin.firestore().collection("valeria_conversations")
          .doc(ctx.conversationId)
          .set({ leadId: lead.id, updatedAt: Date.now() }, { merge: true });

        return ok({ acao, leadId: lead.id }, { communicableToCustomer: false, verified: true });
      }
    );

    res.status(result.success ? 200 : 500).json(result);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. REGISTRAR MENSAGEM / INTERAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaRegistrarMensagem = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaRegistrarMensagem");
    if (!ppl) return;
    const { ctx } = ppl;
    if (req.method !== "POST") { res.status(405).json(err("METHOD_NOT_ALLOWED", "Use POST.")); return; }

    const body      = req.body as Record<string, unknown>;
    const mensagem  = body["mensagem"] as string | undefined;
    const messageId = ctx.messageId ?? (body["messageId"] as string | undefined);

    if (!mensagem) { res.status(400).json(err("VALIDATION_ERROR", "mensagem é obrigatória.", { missingFields: ["mensagem"] })); return; }

    // B4 — campos ampliados (backward-compatible: todos opcionais)
    const tipo      = (body["tipo"]    as string) ?? "texto";
    const direcao   = (body["direcao"] as string) ?? "entrada";
    const origem    = (body["origem"]  as string) ?? "manual";
    const statusProc = (body["statusProcessamento"] as string) ?? "processado";

    // Anexos: somente metadados (nunca conteúdo binário)
    const anexosRaw = body["anexos"] ?? body["attachments"];
    const anexosMeta = Array.isArray(anexosRaw)
      ? (anexosRaw as Record<string, unknown>[]).map((a) => ({
          url:         a["url"]                                     as string | undefined,
          mimeType:   (a["mimeType"] ?? a["mime_type"] ?? a["type"]) as string | undefined,
          tamanho:    (a["tamanho"]  ?? a["size"])                   as number | undefined,
          nome:       (a["nome"]     ?? a["name"] ?? a["filename"])  as string | undefined,
          transcricao: a["transcricao"]                              as string | undefined,
        }))
      : undefined;

    const bloqueioInfo = tipo === "bloqueio"
      ? {
          motivo:  (body["bloqueioMotivo"] as string | undefined),
          tipo:    (body["bloqueioTipo"]   as string | undefined),
          detalhes:(body["bloqueioDetalhes"] as string | undefined),
        }
      : undefined;

    const transcricao  = body["transcricao"] as string | undefined;
    const eventType    = body["eventType"]   as string | undefined;

    const idempKey = messageId ?? extractIdempotencyKey(req);
    const result = await withIdempotency(
      { idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaRegistrarMensagem" },
      async () => {
        const doc: Record<string, unknown> = {
          conversationId: ctx.conversationId,
          agentId:        ctx.agentId,
          organizationId: ctx.organizationId,
          messageId:      messageId ?? uid("msg"),
          mensagem,
          direcao,
          tipo,
          origem,
          statusProcessamento: statusProc,
          ts:        Date.now(),
          createdAt: new Date().toISOString(),
        };
        if (anexosMeta)  doc["anexosMeta"]  = anexosMeta;
        if (bloqueioInfo) doc["bloqueioInfo"] = bloqueioInfo;
        if (transcricao)  doc["transcricao"]  = transcricao;
        if (eventType)    doc["eventType"]    = eventType;

        await admin.firestore().collection("valeria_msgs").add(doc);
        return ok(
          { registrado: true, tipo, direcao, origem },
          { communicableToCustomer: false }
        );
      }
    );

    res.status(result.success ? 200 : 500).json(result);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. TRANSFERIR PARA HUMANO
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaTransferirHumano = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaTransferirHumano");
    if (!ppl) return;
    const { ctx } = ppl;
    if (req.method !== "POST") { res.status(405).json(err("METHOD_NOT_ALLOWED", "Use POST.")); return; }

    const body   = req.body as Record<string, unknown>;
    const motivo = (body["motivo"] as string) ?? "sem motivo";

    const idempKey = extractIdempotencyKey(req);
    const result = await withIdempotency(
      { idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaTransferirHumano" },
      async () => {
        const dict = (await fsRead<CrmLeadDict>("crm_leads")) ?? {};
        const now  = new Date().toISOString();
        const found = findLeadByConv(dict, ctx.conversationId);

        if (found) {
          const { id, lead } = found;
          lead.valeria = {
            ...lead.valeria!,
            status:   "aguardando_humano",
            updatedAt: now,
            historico: [...(lead.valeria?.historico ?? []),
              { ts: now, acao: "transferido_humano", agentId: ctx.agentId, detalhe: motivo }],
          };
          // Etapa ERP fica em qualificando (aguardando triagem humana)
          lead.etapa = "qualificando";
          dict[id]   = lead;
          await fsWrite("crm_leads", dict);
        }

        await admin.firestore().collection("valeria_alertas").add({
          tipo: "transferir_humano", conversationId: ctx.conversationId,
          agentId: ctx.agentId, motivo,
          ts: Date.now(), createdAt: now, lido: false,
        });

        return ok({ transferido: true }, { communicableToCustomer: true, humanValidationRequired: true });
      }
    );

    res.status(result.success ? 200 : 500).json(result);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 9. PRÓXIMA AÇÃO
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaProximaAcao = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaProximaAcao");
    if (!ppl) return;
    const { ctx } = ppl;
    if (req.method !== "POST") { res.status(405).json(err("METHOD_NOT_ALLOWED", "Use POST.")); return; }

    const body = req.body as Record<string, unknown>;
    const acao = body["acao"] as string | undefined;
    if (!acao) { res.status(400).json(err("VALIDATION_ERROR", "acao é obrigatória.", { missingFields: ["acao"] })); return; }

    const idempKey = extractIdempotencyKey(req);
    const result = await withIdempotency<{ warning?: string; agendado?: boolean; acao?: string }>(
      { idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaProximaAcao" },
      async () => {
        const dict  = (await fsRead<CrmLeadDict>("crm_leads")) ?? {};
        const found = findLeadByConv(dict, ctx.conversationId);

        if (!found) {
          return ok(
            { warning: "Lead não encontrado para esta conversa." },
            { warnings: ["Lead não encontrado — use valeriaCriarOportunidade primeiro."] }
          );
        }

        const now = new Date().toISOString();
        const { id, lead } = found;
        lead.valeria = {
          ...lead.valeria!,
          proximaAcao:     acao,
          dataProximaAcao: (body["data"] as string) ?? now,
          updatedAt:       now,
          historico:       [...(lead.valeria?.historico ?? []),
            { ts: now, acao: `proxima_acao: ${acao}`, agentId: ctx.agentId }],
        };
        dict[id] = lead;
        await fsWrite("crm_leads", dict);

        return ok({ agendado: true, acao }, { communicableToCustomer: false });
      }
    );

    res.status(result.success ? 200 : 500).json(result);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 10. CONSULTAR STATUS (por conversationId — sem telefone livre)
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaConsultarStatus = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaConsultarStatus");
    if (!ppl) return;
    const { ctx } = ppl;

    try {
      const db      = admin.firestore();
      const convDoc = await db.collection("valeria_conversations").doc(ctx.conversationId).get();

      if (!convDoc.exists) {
        res.json(ok({ os: [], orcamentos: [], vinculo: "nenhum" }, {
          communicableToCustomer: true, verified: false,
          warnings: ["Nenhum vínculo encontrado para esta conversa."],
        }));
        return;
      }

      const clienteId = convDoc.data()!["clienteId"] as string | undefined;
      if (!clienteId) {
        res.json(ok({ os: [], orcamentos: [], vinculo: "sem_cliente" }, {
          communicableToCustomer: true, verified: false,
        }));
        return;
      }

      const clientes = await fsRead<Cliente[]>("clientes");
      const cliente  = clientes?.find((c) => c.id === clienteId);
      if (!cliente) {
        res.json(ok({ os: [], orcamentos: [], vinculo: "cliente_nao_encontrado" }, {
          communicableToCustomer: false, verified: false,
        }));
        return;
      }

      const kbOs   = await fsRead<Record<string, KbOs>>("kb_os");
      const STATUS = { iniciada:"Iniciada", producao:"Em Produção", aguardando_saldo:"Aguardando Saldo", pronta:"Pronta ✅", entregue:"Entregue 🎉" } as Record<string, string>;
      const osList = (cliente.os ?? [])
        .map((id) => kbOs?.[String(id)])
        .filter(Boolean)
        .map((os) => ({ id: os!.id, descricao: os!.descricao, status: STATUS[os!.status ?? ""] ?? os!.status, data: os!.data }));

      const orcamentos = await fsRead<OrcamentoEnviado[]>("orcamentos");
      const orcList    = (orcamentos ?? [])
        .filter((o) => o.conversationId === ctx.conversationId)
        .map((o) => ({ id: o.id, n: o.n, status: o.status, data: o.data }));

      res.json(ok(
        { clienteNome: cliente.nome, os: osList, orcamentos: orcList },
        { communicableToCustomer: true, verified: true }
      ));
    } catch (e) {
      console.error("[valeriaConsultarStatus]", (e as Error).message);
      res.status(500).json(err("INTERNAL_ERROR", "Erro ao consultar status."));
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 11. HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaStatus = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaStatus");
    if (!ppl) return;
    res.json(ok(
      { status: "ok", projeto: "ERP VR Marcas" },
      { communicableToCustomer: false, verified: true }
    ));
  }
);
