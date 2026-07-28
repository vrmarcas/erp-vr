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
  KbOs,
  OrcamentoEnviado,
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
      if (leadId) {
        const leads = await fsRead<CrmLead[]>("crm_leads");
        lead = leads?.find((l) => l.id === leadId) ?? null;
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
      const produtos = (await fsRead<Record<string, unknown>[]>("produtos")) ?? [];
      const catalogo = produtos.map((p) => ({
        nome:       p["nome"]      ?? p["tipo"]  ?? "Produto",
        categoria:  p["categoria"] ?? p["tipo"]  ?? "",
        unidade:    p["unidade"]   ?? "m²",
        observacao: "Solicitar orçamento formal para valores.",
        // nunca expõe preco, custo, markup, fórmulas
      }));
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
        const pricing = await evaluateQuoteEligibility(itens, {
          extras:   body["extras"]   as number | undefined,
          descPct:  body["descPct"]  as number | undefined,
          descRS:   body["descRS"]   as number | undefined,
          acresPct: body["acresPct"] as number | undefined,
          acresRS:  body["acresRS"]  as number | undefined,
        });

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
          case "ELIGIBLE":
            return ok(
              {
                simulationId:   pricing.simulationId,
                finalPrice:     pricing.finalPrice,
                pricingVersion: pricing.pricingVersion,
                itensCount:     itens.length,
                conversationId: ctx.conversationId,
              },
              { communicableToCustomer: true, verified: true }
            );
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
        // Recalcula pelo motor oficial — simulationId é referência de sessão, não cheque em branco
        const pricing = await evaluateQuoteEligibility(itens!, {
          extras:   body["extras"]   as number | undefined,
          descPct:  body["descPct"]  as number | undefined,
          descRS:   body["descRS"]   as number | undefined,
          acresPct: body["acresPct"] as number | undefined,
          acresRS:  body["acresRS"]  as number | undefined,
        });

        if (pricing.eligibility !== "ELIGIBLE") {
          switch (pricing.eligibility) {
            case "NEEDS_INFORMATION":
              return QUOTE_RESPONSES.needsInformation(pricing.missingFields ?? []);
            case "HUMAN_VALIDATION_REQUIRED":
              return QUOTE_RESPONSES.humanValidationRequired("Cálculo requer validação humana.");
            case "UNSUPPORTED":
              return QUOTE_RESPONSES.unsupported(String(body["descricao"] ?? "desconhecido"));
            default:
              return QUOTE_RESPONSES.temporarilyUnavailable();
          }
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
          itens:                 itens!,
          total:                 pricing.finalPrice!,
          totalCost:             pricing.totalCost!,
          pricingVersion:        pricing.pricingVersion!,
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
        const leads = (await fsRead<CrmLead[]>("crm_leads")) ?? [];
        const now   = new Date().toISOString();
        // Vínculo primário: conversationId. Fallback: channelPhone
        let idx = leads.findIndex((l) => l.conversationId === ctx.conversationId);
        if (idx < 0) idx = leads.findIndex((l) => normTel(l.tel ?? "") === normTel(tel));

        let lead: CrmLead;
        let acao: string;

        if (idx >= 0) {
          Object.assign(leads[idx], {
            nome, conversationId: ctx.conversationId,
            agentId: ctx.agentId, organizationId: ctx.organizationId,
            ...(body["email"]          !== undefined && { email:          body["email"]          }),
            ...(body["observacoes"]    !== undefined && { observacoes:    body["observacoes"]    }),
            ...(body["proximaAcao"]    !== undefined && { proximaAcao:    body["proximaAcao"]    }),
            ...(body["dataProximaAcao"] !== undefined && { dataProximaAcao: body["dataProximaAcao"] }),
          });
          leads[idx].historico = [...(leads[idx].historico ?? []),
            { ts: now, acao: "atualizado", agentId: ctx.agentId }];
          lead = leads[idx];
          acao = "atualizado";
        } else {
          lead = {
            id: uid("lead"), nome, tel,
            email:           (body["email"] as string) ?? "",
            status:          "novo",
            origem:          (body["origem"] as string) ?? "valeria",
            observacoes:     (body["observacoes"] as string) ?? "",
            dataEntrada:     now,
            proximaAcao:     (body["proximaAcao"] as string) ?? "",
            dataProximaAcao: (body["dataProximaAcao"] as string) ?? "",
            conversationId:  ctx.conversationId,
            agentId:         ctx.agentId,
            organizationId:  ctx.organizationId,
            historico:       [{ ts: now, acao: "criado", agentId: ctx.agentId }],
          };
          leads.unshift(lead);
          acao = "criado";
        }

        await fsWrite("crm_leads", leads);
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
        const leads = (await fsRead<CrmLead[]>("crm_leads")) ?? [];
        const now   = new Date().toISOString();
        const idx   = leads.findIndex((l) => l.conversationId === ctx.conversationId);

        if (idx >= 0) {
          leads[idx].status    = "aguardando_humano";
          leads[idx].historico = [...(leads[idx].historico ?? []),
            { ts: now, acao: "transferido_humano", agentId: ctx.agentId, detalhe: motivo }];
          await fsWrite("crm_leads", leads);
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
        const leads = (await fsRead<CrmLead[]>("crm_leads")) ?? [];
        const idx   = leads.findIndex((l) => l.conversationId === ctx.conversationId);

        if (idx < 0) {
          return ok(
            { warning: "Lead não encontrado para esta conversa." },
            { warnings: ["Lead não encontrado — use valeriaCriarOportunidade primeiro."] }
          );
        }

        leads[idx].proximaAcao     = acao;
        leads[idx].dataProximaAcao = (body["data"] as string) ?? new Date().toISOString();
        leads[idx].historico       = [...(leads[idx].historico ?? []),
          { ts: new Date().toISOString(), acao: `proxima_acao: ${acao}`, agentId: ctx.agentId }];
        await fsWrite("crm_leads", leads);

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
