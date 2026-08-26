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

import { pipeline } from "./pipeline";
import { withIdempotency, extractIdempotencyKey } from "./idempotency";
import { evaluateQuoteEligibility } from "./pricing";
import { calculatePersonalizedProduct, describeProductFields } from "./quote_core";
import { nextCommercialAction, computeQuoteReadiness } from "./orchestrator";
import { estimateProductionDeadline, checkUrgentFit } from "./deadline";
import { parseFlexibleLength, parseDimensionLengthMm, resolveMaterialId, materiaisParaResolucao, computeTechnicalReadiness, technicalBriefingFingerprint } from "./technical_briefing";
import { loadTechnicalBriefing, saveTechnicalBriefing, mergeTechnicalBriefing, saveLastEligibleSimulation, loadLastEligibleSimulation, clearLastEligibleSimulation } from "./technical_briefing_store";
import { executeCommercialAction, EXECUTABLE_ACTIONS } from "./action_executor";
import { ok, err, QUOTE_RESPONSES } from "./response";
import { paraE164BR, encontrarPorTelefone } from "./telefone";
import { fsRead, fsWrite } from "./kv_store";
import { saveSimulation, SIM_COL, SIM_TTL_MS } from "./simulation_store";
import { uid } from "./ids";

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

// fsRead/fsWrite (padrão KV erp_vr) e saveSimulation/SIM_COL/SIM_TTL_MS
// (valeria_simulations) agora vêm de kv_store.ts/simulation_store.ts —
// sprint P0.6, compartilhados com action_executor.ts.

// ── Helpers CRM (dict unificado ERP + Valéria) ───────────────────────────────

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

/**
 * Sprint P1.2 — o orchestrator precisa enxergar o technicalBriefing mesmo
 * antes de productId ser definido quando já existe um bloqueio de
 * complexidade persistido (o cliente pode mencionar LED/madeira/motor
 * antes de escolher formalmente o produto) — nunca só quando productId
 * já está setado, senão o gate de P1.2 nunca roda na primeira mensagem.
 */
function precisaOrchestratorTecnico(tb: import("./technical_briefing").TechnicalBriefing): boolean {
  return !!tb.productId || !!(tb.unsupportedComplexityReasonCodes && tb.unsupportedComplexityReasonCodes.length > 0);
}

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

function normTel(tel: string): string {
  return (tel ?? "").replace(/\D/g, "");
}

// Matching robusto de identidade (Fase 0/1 Valéria×ChatVolt): E.164 canônico,
// tolerante a legado com/sem +55, 0 de operadora e 9º dígito — ver telefone.ts.
// A ordem exigida: telefone exato → normalizado → cliente → lead.

/** Procura um lead no dict por telefone (exato → chave canônica BR). */
function findLeadByTelefone(dict: CrmLeadDict, tel: string): { id: string; lead: CrmLead } | null {
  const entries = Object.entries(dict);
  const found = encontrarPorTelefone(tel, entries, ([, l]) => l.tel);
  return found ? { id: found[0], lead: found[1] } : null;
}

// uid() importado de ./ids (sprint P0.6). pipeline() importado de
// ./pipeline (shared middleware).

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

      // Fallback por channelPhone (telefone do cliente vindo do WhatsApp) —
      // matching robusto: exato → chave canônica E.164 BR (com/sem +55,
      // com/sem 9º dígito), nunca aproximação além disso.
      let cliente: Cliente | null = null;
      if (!clienteId && ctx.channelPhone) {
        const clientes = await fsRead<Cliente[]>("clientes");
        cliente        = clientes ? encontrarPorTelefone(ctx.channelPhone, clientes, (c) => c.tel) : null;
        if (cliente) clienteId = cliente.id;
      }
      if (clienteId && !cliente) {
        const clientes = await fsRead<Cliente[]>("clientes");
        cliente = clientes?.find((c) => c.id === clienteId) ?? null;
      }

      let lead: CrmLead | null = null;
      // Busca no dict unificado crm_leads (mesmo que o ERP Kanban lê):
      // 1º vínculo salvo (leadId), 2º conversationId, 3º telefone — assim um
      // cliente que retorna pelo mesmo número em conversa nova é reconhecido
      // e NUNCA vira lead duplicado.
      const leadsDict = await fsRead<CrmLeadDict>("crm_leads");
      if (leadId && leadsDict?.[leadId]) {
        lead = leadsDict[leadId];
      } else if (leadsDict) {
        const porConv = findLeadByConv(leadsDict, ctx.conversationId);
        if (porConv) lead = porConv.lead;
        else if (ctx.channelPhone) {
          const porTel = findLeadByTelefone(leadsDict, ctx.channelPhone);
          if (porTel) lead = porTel.lead;
        }
      }

      // Memória estruturada da conversa: briefing progressivo + estágio do
      // funil numa única chamada — a agente recupera TODO o estado sem
      // depender da memória do LLM entre sessões.
      const briefingDoc = await db.collection("valeria_briefings").doc(ctx.conversationId).get();
      const briefing = briefingDoc.exists ? briefingDoc.data() : null;

      const etapaValeria = lead?.valeria?.status ?? null;
      const etapaKanban  = lead?.etapa ?? null;

      // Sprint P0.2 — orquestração determinística (orchestrator.ts): o
      // atendimento (functions/ default codebase, MESMO projeto Firestore)
      // é lido aqui só para saber se já existe orçamento vinculado — nunca
      // retroceder para discovery depois disso. ctx.conversationId ==
      // atendimentoId desde o hotfix do marcador [ID_ATENDIMENTO: X].
      let orcamentoJaCriado = false;
      // Sprint P0.7 — mesma leitura já usada para orcamentoJaCriado, também
      // captura isTeste para propagar até a simulação/orçamento (P0 real:
      // testes de homologação estavam poluindo métricas comerciais reais
      // porque nada gravava essa flag além do atendimento).
      let isTesteConversa = false;
      try {
        const atdDoc = await db.collection("atendimentos").doc(ctx.conversationId).get();
        if (atdDoc.exists) {
          const atdData = atdDoc.data();
          orcamentoJaCriado = !!atdData?.orcamentoId;
          isTesteConversa = atdData?.isTeste === true;
        }
      } catch { /* atendimento pode não existir (canal fora do módulo Atendimentos) — não bloqueia */ }

      const briefingTyped = briefing as import("./types").BriefingData | null;
      // Bloco F — carrega o MESMO schema técnico que quote_core.ts usa
      // (nunca a checagem genérica de BriefingData quando já existe um
      // produto VR personalizado em andamento nesta conversa).
      const technicalBriefing = await loadTechnicalBriefing(ctx.conversationId);
      const technicalBriefingParaOrchestrator = precisaOrchestratorTecnico(technicalBriefing) ? technicalBriefing : null;
      // Sprint P0.4 (achado real de E2E, Bloco H2) — carrega a simulação
      // canônica para o orchestrator saber se já existe um cálculo
      // ELIGIBLE pronto para virar orçamento formal (nextAction
      // create_quote), sem o LLM precisar escolher entre
      // criar_orcamento_vr e criar_rascunho_vitre sozinho.
      let lastEligibleSim = technicalBriefingParaOrchestrator
        ? await loadLastEligibleSimulation(ctx.conversationId)
        : null;
      let nextAction = nextCommercialAction({
        briefing: briefingTyped,
        cliente,
        lead,
        channelPhone: ctx.channelPhone ?? null,
        temHistoricoConversa: !!briefing || !!cliente || !!lead,
        orcamentoJaCriado,
        technicalBriefing: technicalBriefingParaOrchestrator,
        lastEligibleSimulation: lastEligibleSim,
      });

      // Sprint P0.6 — achado real de E2E: toolToCall sozinho não impede o
      // LLM de ignorar a decisão do orchestrator (chegou a chamar Tools
      // do Vitre com calculate_quote já decidido). Ações determinísticas
      // e seguras (calculate_quote/create_quote/check_production_deadline/
      // check_urgent_fit) são executadas AQUI, sem depender de nenhuma
      // Tool call — o LLM só recebe o resultado já pronto para verbalizar.
      const executedAction = await executeCommercialAction({
        conversationId: ctx.conversationId,
        agentId: ctx.agentId,
        organizationId: ctx.organizationId,
        cliente, lead, channelPhone: ctx.channelPhone ?? null,
        nextAction: nextAction.nextAction,
        technicalBriefing: technicalBriefingParaOrchestrator,
        lastEligibleSimulation: lastEligibleSim,
        isTest: isTesteConversa,
      });

      // A execução acima muda o estado persistido (nova simulação, novo
      // orçamento, sinal de prazo/urgência consumido) — recarrega e
      // recalcula nextAction para nunca devolver ao LLM uma decisão
      // desatualizada (ex.: ainda mandando calcular algo que o backend
      // já calculou neste mesmo turno).
      if (executedAction) {
        const technicalBriefingAtualizado = await loadTechnicalBriefing(ctx.conversationId);
        const technicalBriefingAtualizadoParaOrchestrator = precisaOrchestratorTecnico(technicalBriefingAtualizado) ? technicalBriefingAtualizado : null;
        lastEligibleSim = technicalBriefingAtualizadoParaOrchestrator
          ? await loadLastEligibleSimulation(ctx.conversationId)
          : null;
        let orcamentoJaCriadoAtualizado = orcamentoJaCriado;
        if (executedAction.action === "create_quote" && executedAction.result.success) {
          orcamentoJaCriadoAtualizado = true;
        }
        nextAction = nextCommercialAction({
          briefing: briefingTyped,
          cliente, lead, channelPhone: ctx.channelPhone ?? null,
          temHistoricoConversa: !!briefing || !!cliente || !!lead,
          orcamentoJaCriado: orcamentoJaCriadoAtualizado,
          technicalBriefing: technicalBriefingAtualizadoParaOrchestrator,
          lastEligibleSimulation: lastEligibleSim,
        });
      }

      const quoteReadiness = computeQuoteReadiness(
        briefingTyped, cliente, lead, ctx.channelPhone ?? null, technicalBriefingParaOrchestrator
      );

      res.json(ok(
        {
          conversationId: ctx.conversationId,
          telefoneE164:   ctx.channelPhone ? paraE164BR(ctx.channelPhone) : null,
          cliente,
          lead,
          briefing,
          etapaValeria,
          etapaKanban,
          // P0.5 (achado real de E2E) — camposFaltando/classificacao vêm do
          // briefing GENÉRICO (catálogo/Vitre) e ficam desatualizados assim
          // que o technicalBriefing (produto VR personalizado) assume como
          // fonte de verdade — a Valéria confundiu esse campo legado com
          // nextActionPayload.fields e voltou a pedir acabamento/prazo/
          // observação (campos opcionais) mesmo com a especificação técnica
          // 100% completa. Suprimido aqui pela mesma razão que
          // computeQuoteReadiness (Bloco F) já ignora BriefingData genérico
          // nesse caso — nunca duas fontes conflitantes de "o que falta".
          camposFaltando: technicalBriefingParaOrchestrator
            ? null
            : (briefing as { camposFaltando?: string[] } | null)?.camposFaltando ?? null,
          classificacao:  technicalBriefingParaOrchestrator
            ? null
            : (briefing as { classificacao?: string } | null)?.classificacao ?? null,
          // Sprint P0.6 — rota comercial travada (VR_CUSTOM) impede migração
          // espontânea para Vitre no mesmo turno — ver guard em
          // functions/src/valeria_vitre.ts.
          commercialRoute: technicalBriefingParaOrchestrator ? "VR_CUSTOM" : null,
          // Sprint P0.6 — quando presente, a ação já foi executada
          // server-side neste turno: o LLM só apresenta este resultado ao
          // cliente, nunca chama uma Tool para "fazer" de novo o que já
          // está feito.
          executedAction,
          // P0.24 — Tool Output orientado à ação: a Valéria segue
          // nextAction.nextAction, não decide sozinha o próximo passo.
          quoteReadiness,
          nextAction: nextAction.nextAction,
          nextActionReason: nextAction.reason,
          nextActionPayload: nextAction.actionPayload,
        },
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
    const result = await withIdempotency<{ acao: string; clienteId: string | null; cliente: Cliente | null; leadFirst?: boolean }>(
      { idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaUpsertCliente" },
      async () => {
        const clientes = (await fsRead<Cliente[]>("clientes")) ?? [];
        // Matching robusto: exato → chave canônica E.164 BR (nunca cria
        // duplicado por diferença de formato/9º dígito).
        const encontrado = encontrarPorTelefone(tel, clientes, (c) => c.tel);

        if (!encontrado) {
          // LEAD-FIRST (arquitetura Fase 0/1): a Valéria NUNCA cria um
          // cliente definitivo sozinha. Contato novo vira LEAD via
          // valeriaCriarOportunidade; a promoção lead → cliente é decisão
          // humana no ERP. Resposta ok (não erro) para o agente seguir o
          // fluxo correto sem retry.
          return ok(
            { acao: "nenhum_cliente_criado", clienteId: null, cliente: null, leadFirst: true },
            {
              communicableToCustomer: false,
              verified: false,
              warnings: [
                "Nenhum cliente cadastrado com este telefone. Política lead-first: use valeriaCriarOportunidade para registrar o LEAD — a promoção a cliente é feita por um humano no ERP.",
              ],
            }
          );
        }

        const idx = clientes.indexOf(encontrado);
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
        const cliente = clientes[idx];

        await fsWrite("clientes", clientes);
        await admin.firestore().collection("valeria_conversations")
          .doc(ctx.conversationId)
          .set({ clienteId: cliente.id, agentId: ctx.agentId, updatedAt: Date.now() }, { merge: true });

        return ok(
          { acao: "atualizado", clienteId: cliente.id, cliente },
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
// 3b. MATERIAIS DISPONÍVEIS (VR personalizado — read-only, nunca custo/margem)
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaListarMateriais = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaListarMateriais");
    if (!ppl) return;

    try {
      const doc = await admin.firestore().collection(COL).doc("erp_config").get();
      const raw = doc.exists ? doc.data()?.data : null;
      let cfg: { materiais?: Array<{ comp?: number; larg?: number; custo?: number; rsm2?: number; nome?: string }> } | null = null;
      try { cfg = raw ? JSON.parse(raw) : null; } catch { cfg = null; }

      // Mesma regra de pricing.ts:getMaterialPriceM2 — rsm2 pré-calculado é a
      // fonte preferencial; fallback custo/área (campo real é `custo`, não
      // `preco`, que nunca existiu nos dados reais do ERP).
      const materiais = (cfg?.materiais ?? [])
        .map((m, i) => {
          let precoM2: number | null = null;
          if (typeof m.rsm2 === "number" && m.rsm2 > 0) {
            precoM2 = m.rsm2;
          } else {
            const area = ((m.comp ?? 0) * (m.larg ?? 0)) / 10000; // cm² → m²
            if (area > 0 && typeof m.custo === "number" && m.custo > 0) precoM2 = m.custo / area;
          }
          if (precoM2 === null) return null;
          return {
            matKey: `cfg_${i}`,
            nome: m.nome || `Material ${i + 1}`,
            precoM2: Math.round(precoM2 * 100) / 100,
          };
        })
        .filter((m): m is { matKey: string; nome: string; precoM2: number } => m !== null);

      res.json(ok(
        { materiais, total: materiais.length },
        { communicableToCustomer: true, verified: true }
      ));
    } catch (e) {
      console.error("[valeriaListarMateriais]", (e as Error).message);
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
              // Tool legada sem uso legítimo confirmado em produção (já
              // removida do agente Chatvolt) — sem leitura de isTeste aqui
              // por não valer o custo, mas nunca teste real passa por este
              // caminho hoje.
              isTest:            false,
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
// 4a2. ATUALIZAR BRIEFING TÉCNICO (sprint P0.3, Bloco A) — schema canônico
// progressivo para produto VR personalizado. O LLM nunca calcula unidade/
// resolve material sozinho: manda valores em linguagem livre com unidade
// (ex.: "15cm", "150mm") e um texto de material — a Function normaliza
// (technical_briefing.ts) e devolve o estado técnico real + o que ainda
// falta, no MESMO vocabulário que quote_core exige (elimina o gap
// larguraMm/material-texto vs larg/matKey identificado na sprint anterior).
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaAtualizarBriefingTecnico = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaAtualizarBriefingTecnico");
    if (!ppl) return;
    const { ctx } = ppl;

    try {
      const body = req.body as Record<string, unknown>;
      const atual = await loadTechnicalBriefing(ctx.conversationId);

      let materialId: string | undefined;
      if (body["material"] != null && String(body["material"]).trim()) {
        const doc = await admin.firestore().collection(COL).doc("erp_config").get();
        const raw = doc.exists ? doc.data()?.data : null;
        let cfg: { materiais?: Array<{ nome?: string }> } | null = null;
        try { cfg = raw ? JSON.parse(raw) : null; } catch { cfg = null; }
        const materiaisReais = materiaisParaResolucao((cfg?.materiais ?? []) as never[]);
        // Bloco H — desempata famílias de material ambíguas ("Acrílico
        // Cristal" bate em 11 espessuras reais) usando a espessura JÁ
        // informada nesta mesma chamada, nunca um dado novo/inventado.
        const espDesambiguacao = body["espessura"] != null ? parseFlexibleLength(String(body["espessura"])) : null;
        const resolvido = resolveMaterialId(String(body["material"]), materiaisReais, espDesambiguacao);
        if (resolvido) materialId = resolvido;
      }

      // Sprint P0.6 — sinais de controle que o LLM só EXTRAI (linguagem
      // natural do cliente), nunca decide agir sobre: confirmação
      // explícita do preço já apresentado, pergunta sobre prazo, data-
      // limite informada, e itens sem fonte canônica de preço (Bloco C).
      // Quem decide o que fazer com esses sinais é sempre o orchestrator/
      // action_executor (nextCommercialAction + executeCommercialAction),
      // nunca o LLM escolhendo chamar uma Tool de prazo/cálculo.
      const parseBooleanFlexivel = (v: unknown): boolean | undefined =>
        v == null ? undefined : (v === true || String(v).toLowerCase() === "sim");

      const patch = {
        ...(body["produto"] != null ? { productId: String(body["produto"]).trim() } : {}),
        ...(body["quantidade"] != null ? { quantity: parseInt(String(body["quantidade"]), 10) || undefined } : {}),
        ...(materialId ? { materialId } : {}),
        ...(body["espessura"] != null ? { thicknessMm: parseFlexibleLength(String(body["espessura"])) ?? undefined } : {}),
        ...(body["adesivo"] != null ? { adesivo: parseBooleanFlexivel(body["adesivo"]) } : {}),
        ...(body["adesivoBranco"] != null ? { adesivoBranco: parseBooleanFlexivel(body["adesivoBranco"]) } : {}),
        ...(body["solicitacoesNaoSuportadas"] != null
          ? { solicitacoesNaoSuportadas: parseArrayFlexivel(body["solicitacoesNaoSuportadas"]).map((x) => String(x).trim().toLowerCase()) }
          : {}),
        // Sprint P0.7 (achado real de E2E) — clienteConfirmouOrcamento NÃO é
        // mais a fonte autoritativa: o backend já detecta a confirmação
        // deterministicamente a partir do texto real do cliente, ANTES do
        // Chatvolt ser chamado (ver functions/atendimentos.ts,
        // detectarEPersistirConfirmacao). O valor do LLM só é aceito para
        // REVOGAR (false) — nunca para CONCEDER (true) — assim um "sim"
        // mal-interpretado pelo modelo nunca cria um orçamento sozinho, mas
        // o modelo ainda pode sinalizar "na verdade não, deixa pra lá" se
        // perceber isso na conversa.
        ...(body["clienteConfirmouOrcamento"] === false || String(body["clienteConfirmouOrcamento"]).toLowerCase() === "nao" || String(body["clienteConfirmouOrcamento"]).toLowerCase() === "não"
          ? { clientConfirmedQuote: false }
          : {}),
        ...(body["perguntouPrazo"] != null ? { wantsDeadlineCheck: parseBooleanFlexivel(body["perguntouPrazo"]) } : {}),
        ...(body["dataNecessidadeCliente"] != null ? { dataNecessidadeCliente: String(body["dataNecessidadeCliente"]).trim() || null } : {}),
        dimensions: {
          larguraMm: body["largura"] != null ? (parseDimensionLengthMm(String(body["largura"])) ?? undefined) : undefined,
          alturaMm: body["altura"] != null ? (parseDimensionLengthMm(String(body["altura"])) ?? undefined) : undefined,
          profundidadeMm: body["profundidade"] != null ? (parseDimensionLengthMm(String(body["profundidade"])) ?? undefined) : undefined,
        },
      };

      const atualizado = mergeTechnicalBriefing(atual, patch as never);
      await saveTechnicalBriefing(ctx.conversationId, atualizado);

      const materialNaoResolvido = body["material"] != null && String(body["material"]).trim() && !materialId;

      res.json(ok(
        {
          technicalBriefing: atualizado,
          readiness: computeTechnicalReadiness(atualizado),
          avisoMaterialNaoResolvido: materialNaoResolvido
            ? "O material informado não bateu com nenhum cadastro real ou é ambíguo — chame consultar_materiais_vr e use o matKey exato retornado."
            : null,
        },
        { communicableToCustomer: false, verified: true }
      ));
    } catch (e) {
      console.error("[valeriaAtualizarBriefingTecnico]", (e as Error).message);
      res.status(500).json(QUOTE_RESPONSES.temporarilyUnavailable());
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4b. PREPARAR PRODUTO PERSONALIZADO (discovery — sprint P0.2 2026-08-23)
// Descobre dinamicamente quais campos são obrigatórios para um produto
// específico ANTES de perguntar ao cliente — nunca hardcoded no prompt.
// Read-only, sem custo/margem.
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaPrepararProdutoPersonalizado = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaPrepararProdutoPersonalizado");
    if (!ppl) return;
    const { ctx } = ppl;

    const body = req.body as Record<string, unknown>;
    const produto = String(body["produto"] || "").trim();
    if (!produto) {
      res.status(400).json(err("VALIDATION_ERROR", "produto é obrigatório.", { missingFields: ["produto"] }));
      return;
    }

    try {
      const info = describeProductFields(produto);
      // Bloco A — inicia/atualiza o briefing técnico canônico com o produto
      // escolhido, para que o orchestrator (mesmo schema) já enxergue o que
      // falta a partir daqui, sem esperar a Tool de cálculo.
      const atual = await loadTechnicalBriefing(ctx.conversationId);
      const atualizado = mergeTechnicalBriefing(atual, { productId: produto } as never);
      await saveTechnicalBriefing(ctx.conversationId, atualizado);

      res.json(ok({ ...info, technicalBriefing: atualizado }, { communicableToCustomer: true, verified: true }));
    } catch (e) {
      console.error("[valeriaPrepararProdutoPersonalizado]", (e as Error).message);
      res.status(500).json(QUOTE_RESPONSES.temporarilyUnavailable());
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4c. CALCULAR PRODUTO PERSONALIZADO MULTI-PEÇA (sprint P0.2 2026-08-23)
// Usa quote_core.ts (geometria PLAN_RECIPES pura + motor oficial de preço,
// nunca reimplementa matemática). Gera simulação no MESMO formato/coleção
// de valeriaCalcularOrcamento — valeriaCriarOrcamento (já existente, sem
// alteração) persiste o orçamento formal a partir do simulationId.
// ─────────────────────────────────────────────────────────────────────────────
// Bloco A — aceita número puro (comportamento legado, já testado em E2E:
// larg/alt/prof em cm, esp em mm) OU string com unidade explícita
// ("150mm", "15cm", "0.15m") via parseFlexibleLength. Só desvia do parseFloat
// legado quando a string contém letra (unidade explícita) — nunca reinterpreta
// um número puro que já funcionava, preservando 100% de compatibilidade com
// as chamadas já homologadas.
function parseCmFlexivel(v: unknown): number {
  if (typeof v === "string" && /[a-zA-Z]/.test(v)) {
    const mm = parseFlexibleLength(v);
    return mm != null ? mm / 10 : NaN;
  }
  return parseFloat(String(v));
}
function parseMmFlexivel(v: unknown): number {
  if (typeof v === "string" && /[a-zA-Z]/.test(v)) {
    const mm = parseFlexibleLength(v);
    return mm != null ? mm : NaN;
  }
  return parseFloat(String(v));
}

/**
 * Bloco H (achado real de E2E via Chatvolt) — parâmetros de Tool do tipo
 * array chegam serializados como STRING JSON no body do Chatvolt, mesmo
 * com o schema configurado como array (confirmado com `itens` de
 * valeriaCriarOrcamento e reaplicado aqui preventivamente). Faz o parse
 * defensivamente antes de checar Array.isArray — nunca inventa
 * conteúdo, só desfaz uma serialização que não é opcional do lado do
 * Chatvolt.
 */
function parseArrayFlexivel(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* não era JSON — trata como ausente */ }
  }
  return [];
}

export const valeriaCalcularProdutoPersonalizado = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaCalcularProdutoPersonalizado");
    if (!ppl) return;
    const { ctx } = ppl;
    if (req.method !== "POST") { res.status(405).json(err("METHOD_NOT_ALLOWED", "Use POST.")); return; }

    const body = req.body as Record<string, unknown>;
    const produto = String(body["produto"] || "").trim();
    const larg = parseCmFlexivel(body["larg"]);
    const alt = parseCmFlexivel(body["alt"]);
    const prof = body["prof"] != null ? parseCmFlexivel(body["prof"]) : undefined;
    const esp = parseMmFlexivel(body["esp"]);
    const matKeyBruto = String(body["matKey"] || "").trim();
    let matKey = matKeyBruto;
    if (matKeyBruto) {
      const doc = await admin.firestore().collection(COL).doc("erp_config").get();
      const raw = doc.exists ? doc.data()?.data : null;
      let cfg: { materiais?: Array<{ nome?: string }> } | null = null;
      try { cfg = raw ? JSON.parse(raw) : null; } catch { cfg = null; }
      const materiaisReais = materiaisParaResolucao((cfg?.materiais ?? []) as never[]);
      // Bloco H — mesma desambiguação por espessura já informada nesta chamada.
      const resolvido = resolveMaterialId(matKeyBruto, materiaisReais, Number.isFinite(esp) ? esp : null);
      if (resolvido) matKey = resolvido;
    }
    const qty = parseFloat(String(body["qty"])) || 1;
    const adesivo = body["adesivo"] === true || String(body["adesivo"]).toLowerCase() === "sim";
    const adesivoBranco = body["adesivoBranco"] === true || String(body["adesivoBranco"]).toLowerCase() === "sim";
    // Bloco C — a Tool aceita `solicitacoesNaoSuportadas` (array de chaves:
    // gravacao/spray/extra/maquinas/montagem/deslocamento/desconto/acrescimo)
    // para o LLM sinalizar explicitamente o que o cliente pediu além do
    // produto em si. Nunca calculado/ignorado silenciosamente — vira
    // HUMAN_VALIDATION_REQUIRED com reasonCode por item.
    const solicitacoesNaoSuportadas = parseArrayFlexivel(body["solicitacoesNaoSuportadas"])
      .map((x) => String(x).trim().toLowerCase());

    const missing: string[] = [];
    if (!produto) missing.push("produto");
    if (!(larg > 0)) missing.push("larg");
    if (!(alt > 0)) missing.push("alt");
    if (!(esp > 0)) missing.push("esp");
    if (!matKey) missing.push("matKey");
    if (missing.length > 0) {
      res.status(400).json(err("VALIDATION_ERROR", "Campos obrigatórios ausentes.", { missingFields: missing }));
      return;
    }

    // Sprint P0.7 — mesma leitura que action_executor.ts faz para o caminho
    // automático: fallback manual desta Tool precisa propagar isTeste do
    // mesmo jeito, nunca inferido de nome/padrão de texto.
    let isTesteFallback = false;
    try {
      const atdSnap = await admin.firestore().collection("atendimentos").doc(ctx.conversationId).get();
      isTesteFallback = atdSnap.exists && atdSnap.data()?.isTeste === true;
    } catch { /* atendimento pode não existir — não bloqueia */ }

    const idempKey = extractIdempotencyKey(req);
    const result = await withIdempotency(
      { idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaCalcularProdutoPersonalizado" },
      async () => {
        // Bloco A — sincroniza o briefing técnico canônico com os valores
        // efetivamente usados neste cálculo, para o orchestrator (mesmo
        // schema) enxergar o estado real independentemente de qual Tool
        // o modelo chamou por último.
        const atualBriefing = await loadTechnicalBriefing(ctx.conversationId);
        const briefingSincronizado = mergeTechnicalBriefing(atualBriefing, {
          productId: produto,
          dimensions: { larguraMm: larg * 10, alturaMm: alt * 10, profundidadeMm: prof != null ? prof * 10 : undefined },
          thicknessMm: esp,
          materialId: matKey,
          quantity: qty,
          adesivo,
          adesivoBranco,
        } as never);
        await saveTechnicalBriefing(ctx.conversationId, briefingSincronizado);

        // Sprint P1.2 — defesa em profundidade: mesmo que o LLM ignore
        // nextAction="handoff" e chame esta Tool diretamente, o bloqueio já
        // persistido (detectado a partir do texto real do cliente, ver
        // webhook.ts/atendimentos.ts) é reaplicado aqui antes de calcular.
        // Também roda o mesmo detector sobre o `produto` desta chamada como
        // última rede de segurança (o texto original pode ter sido
        // resumido pelo LLM ao preencher este parâmetro).
        const { detectUnsupportedComplexity } = await import("./complexity_detector");
        const complexidadeDoProduto = detectUnsupportedComplexity({ texto: produto, productId: produto });
        const unsupportedComplexityReasonCodes =
          (briefingSincronizado.unsupportedComplexityReasonCodes && briefingSincronizado.unsupportedComplexityReasonCodes.length > 0)
            ? briefingSincronizado.unsupportedComplexityReasonCodes
            : (complexidadeDoProduto.unsupportedComplexity ? complexidadeDoProduto.reasonCodes : null);

        const calc = await calculatePersonalizedProduct({
          produto, larg, alt, prof, esp, matKey, qty, adesivo, adesivoBranco, solicitacoesNaoSuportadas,
          unsupportedComplexityReasonCodes,
        });
        const pricing = calc.pricing;

        switch (pricing.eligibility) {
          case "NEEDS_INFORMATION":
            return QUOTE_RESPONSES.needsInformation(pricing.missingFields ?? []);
          case "HUMAN_VALIDATION_REQUIRED":
            return QUOTE_RESPONSES.humanValidationRequired(
              pricing.blockedItems && pricing.blockedItems.length > 0
                ? `Preciso de aprovação humana para: ${pricing.blockedItems.map((b) => b.campo).join(", ")}.`
                : `Validação humana necessária: ${(pricing.missingFields ?? []).join(", ")}`,
              pricing.blockedItems
            );
          case "UNSUPPORTED":
            return QUOTE_RESPONSES.unsupported(produto);
          case "TEMPORARILY_UNAVAILABLE":
            return QUOTE_RESPONSES.temporarilyUnavailable();
          case "ELIGIBLE": {
            const simId = pricing.simulationId ?? uid("sim");
            const simNow = Date.now();
            const itensNormalizados = calc.pieces.map((p) => ({
              larg: p.larg, alt: p.alt, qty: p.qtyTotal, matKey, descricao: p.nome,
            }));
            const sim: PricingSimulation = {
              simulationId: simId,
              conversationId: ctx.conversationId,
              itensNormalizados: itensNormalizados as unknown as QuoteItem[],
              finalPrice: pricing.finalPrice!,
              pricingVersion: pricing.pricingVersion!,
              createdAt: simNow,
              expiresAt: simNow + SIM_TTL_MS,
              origem: "valeria",
              usado: false,
              isTest: isTesteFallback,
              // Bloco D — congela o briefing técnico usado NESTE cálculo
              // específico (nunca o "ao vivo", que pode mudar depois).
              technicalBriefingSnapshot: briefingSincronizado as unknown as Record<string, unknown>,
            };
            await saveSimulation(sim);

            // Sprint P0.4 — fonte canônica de qual simulação vale para
            // criar_orcamento_vr. O LLM recebe simulationId na resposta só
            // para referência/depuração — valeriaCriarOrcamento NUNCA
            // confia nesse valor vindo do modelo, sempre lê daqui.
            await saveLastEligibleSimulation(ctx.conversationId, {
              simulationId: simId,
              createdAt: simNow,
              productId: produto,
              finalPrice: pricing.finalPrice!,
              fingerprint: technicalBriefingFingerprint(briefingSincronizado),
            });

            return ok(
              {
                simulationId: simId,
                produto,
                dim3d: calc.dim3d,
                pieces: calc.pieces,
                finalPrice: pricing.finalPrice,
                pricingVersion: pricing.pricingVersion,
                warnings: calc.warnings,
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
// 4d. CONSULTAR PRAZO DE PRODUÇÃO (sprint P0.2, P0.20 — read-only)
// Nunca expõe custo/margem/capacidade interna sensível. Hoje sempre
// canEstimate:false (ver deadline.ts) — comportamento correto, não um
// bug: não existe fonte real de capacidade no ERP ainda.
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaConsultarPrazoProducao = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaConsultarPrazoProducao");
    if (!ppl) return;

    const body = req.body as Record<string, unknown>;
    const produto = String(body["produto"] || "").trim();
    if (!produto) {
      res.status(400).json(err("VALIDATION_ERROR", "produto é obrigatório.", { missingFields: ["produto"] }));
      return;
    }
    const areaTotalM2 = body["areaTotalM2"] != null ? parseFloat(String(body["areaTotalM2"])) : undefined;
    const quantidade = body["quantidade"] != null ? parseFloat(String(body["quantidade"])) : undefined;

    const estimativa = await estimateProductionDeadline({ produto, areaTotalM2, quantidade });
    res.json(ok(estimativa, { communicableToCustomer: true, verified: true }));
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4e. VERIFICAR ENCAIXE DE URGÊNCIA (sprint P0.2, P0.21 — read-only)
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaVerificarEncaixeProducao = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await pipeline(req, res, "valeriaVerificarEncaixeProducao");
    if (!ppl) return;

    const body = req.body as Record<string, unknown>;
    const produto = String(body["produto"] || "").trim();
    const requestedDateISO = String(body["dataNecessidadeCliente"] || "").trim();
    if (!produto || !requestedDateISO) {
      res.status(400).json(err("VALIDATION_ERROR", "produto e dataNecessidadeCliente são obrigatórios.", {
        missingFields: [!produto ? "produto" : null, !requestedDateISO ? "dataNecessidadeCliente" : null].filter(Boolean) as string[],
      }));
      return;
    }
    const areaTotalM2 = body["areaTotalM2"] != null ? parseFloat(String(body["areaTotalM2"])) : undefined;
    const quantidade = body["quantidade"] != null ? parseFloat(String(body["quantidade"])) : undefined;

    const resultado = await checkUrgentFit({ produto, requestedDateISO, areaTotalM2, quantidade });
    res.json(ok(resultado, { communicableToCustomer: true, verified: true }));
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

    // Sprint P0.4 — simulationId NUNCA vem do LLM. `body["simulationId"]`
    // ainda é aceito (compatibilidade com a Tool já configurada no
    // Chatvolt) só para log de divergência — a fonte real é sempre
    // lastEligibleSimulation, escrita exclusivamente por
    // valeriaCalcularProdutoPersonalizado. O modelo não escolhe, não
    // gera, não transcreve ID nenhum aqui.
    const simulationIdDoModelo = body["simulationId"] as string | undefined;
    const nomeCliente  = body["nomeCliente"]  as string | undefined;
    // Bloco H — ver parseArrayFlexivel. O CONTEÚDO de `itens` nunca é
    // usado para preço (o orçamento persistido sempre vem de
    // sim.itensNormalizados, nunca deste campo) — isto só afeta a
    // checagem de presença, não abre brecha para o cliente influenciar preço.
    const itensParsed = parseArrayFlexivel(body["itens"]);
    const itens = (itensParsed.length > 0 ? itensParsed : undefined) as QuoteItem[] | undefined;
    const telCliente   = ctx.channelPhone ?? (body["telCliente"] as string | undefined);

    const missing: string[] = [];
    if (!nomeCliente)  missing.push("nomeCliente");
    if (!telCliente)   missing.push("channelPhone");
    if (!itens || !Array.isArray(itens) || itens.length === 0) missing.push("itens");
    if (missing.length > 0) {
      res.status(400).json(err("VALIDATION_ERROR", "Campos obrigatórios ausentes.", { missingFields: missing }));
      return;
    }

    // P0.4 — resolve o simulationId CANÔNICO server-side, valida que o
    // briefing atual ainda corresponde ao que foi calculado (nunca cria
    // orçamento com simulação desatualizada por mudança de qty/material/
    // medidas/adesivo depois do cálculo).
    const canonico = await loadLastEligibleSimulation(ctx.conversationId);
    if (!canonico) {
      res.status(422).json(QUOTE_RESPONSES.needsInformation(["Nenhum cálculo elegível encontrado para esta conversa — calcule o orçamento (calcular_produto_personalizado) antes de criar."]));
      return;
    }
    const briefingAtualParaValidacao = await loadTechnicalBriefing(ctx.conversationId);
    const fingerprintAtual = technicalBriefingFingerprint(briefingAtualParaValidacao);
    if (fingerprintAtual !== canonico.fingerprint) {
      res.status(422).json(QUOTE_RESPONSES.humanValidationRequired(
        "Os dados do produto mudaram desde o último cálculo — preciso recalcular o orçamento antes de criar."
      ));
      return;
    }
    if (simulationIdDoModelo && simulationIdDoModelo !== canonico.simulationId) {
      console.warn(`[valeriaCriarOrcamento] simulationId divergente do LLM ignorado — recebido=${simulationIdDoModelo} canonico=${canonico.simulationId} conversationId=${ctx.conversationId}`);
    }
    const simulationId = canonico.simulationId;

    const idempKey = extractIdempotencyKey(req);
    const result = await withIdempotency(
      { idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaCriarOrcamento" },
      async () => {
        const db = admin.firestore(); // fix: db nao estava declarado neste escopo
        // Recuperar simulação e marcar como usada em transação atômica (anti double-spend)
        let sim!: PricingSimulation;
        try {
          await db.runTransaction(async (tx) => {
            const simRef = db.collection(SIM_COL).doc(simulationId);
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

        // Bloco D — lê o atendimento real (cross-codebase, read-only) para
        // herdar leadId/clienteId/oportunidadeId já vinculados na conversa,
        // nunca inventados aqui. Best-effort: se o atendimento não existir
        // (ex.: chamada de teste direta fora do fluxo real), o orçamento
        // ainda é criado normalmente, só sem esses vínculos.
        let leadId: string | null = null, clienteId: string | null = null, oportunidadeId: string | null = null;
        // Sprint P0.7 — propaga isTeste do atendimento (nunca inferido de
        // nome/padrão de texto) até o orçamento, mesmo neste fallback manual.
        let isTesteFallback = false;
        let atdRef: FirebaseFirestore.DocumentReference | null = null;
        try {
          atdRef = admin.firestore().collection("atendimentos").doc(ctx.conversationId);
          const atdSnap = await atdRef.get();
          if (atdSnap.exists) {
            const atdData = atdSnap.data() ?? {};
            leadId = (atdData.leadId as string) ?? null;
            clienteId = (atdData.clienteId as string) ?? null;
            oportunidadeId = (atdData.oportunidadeId as string) ?? null;
            isTesteFallback = atdData.isTeste === true;
          } else {
            atdRef = null; // não cria atendimento novo por engano — link só se já existir
          }
        } catch (e) {
          console.error("[valeriaCriarOrcamento] falha ao ler atendimento para herdar vínculos:", (e as Error).message);
        }

        const briefingSnap = (sim.technicalBriefingSnapshot ?? null) as { productId?: string; recipeVersion?: number } | null;

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
          simulationId:          simulationId,
          communicableToCustomer: true,
          status:                "pre_orc_valeria",
          data:                  new Date().toISOString(),
          marca:                 (body["marca"] as string) ?? "vr",
          origem:                "valeria",
          conversationId:        ctx.conversationId,
          agentId:               ctx.agentId,
          organizationId:        ctx.organizationId,
          // Bloco D — linkage completa para rastreabilidade/reabertura no ERP
          atendimentoId:         ctx.conversationId,
          leadId,
          clienteId,
          oportunidadeId,
          isTest:                isTesteFallback || sim.isTest === true,
          recipeSnapshot:        briefingSnap ? { productId: briefingSnap.productId ?? null, recipeVersion: briefingSnap.recipeVersion ?? null } : null,
          technicalBriefingSnapshot: sim.technicalBriefingSnapshot ?? null,
        };

        orcamentos.unshift(orc);
        await fsWrite("orcamentos", orcamentos);
        await admin.firestore().collection("valeria_conversations")
          .doc(ctx.conversationId)
          .set({ orcamentoId: orc.id, updatedAt: Date.now() }, { merge: true });

        // Bloco D — vincula de volta no atendimento REAL (mesmo campo que a
        // UI do ERP lê para mostrar "📝 Abrir orçamento") para que um
        // orçamento criado autonomamente pela Valéria fique visível e
        // reabrível no ERP como qualquer outro — nunca cria atendimento novo
        // (atdRef só é não-nulo se já existia), nunca derruba a criação do
        // orçamento se este passo falhar (best-effort, mesma filosofia do
        // atdVincularOrcamentoAposSalvar humano).
        if (atdRef) {
          try {
            await atdRef.set({ orcamentoId: orc.id, updatedAt: Date.now() }, { merge: true });
            await admin.firestore().collection("atendimentos_audit_log").add({
              action: "vincular_orcamento", callerUid: "valeria", callerRole: "ai_agent",
              detail: { atendimentoId: ctx.conversationId, orcamentoId: orc.id, origem: "valeria_autonomous" },
              timestamp: Date.now(),
            });
          } catch (e) {
            console.error("[valeriaCriarOrcamento] orçamento criado, mas falhou ao vincular no atendimento:", (e as Error).message);
          }
        }

        // P0.4 — consome a referência canônica (a simulação em si já foi
        // marcada usado:true na transação acima; isto evita qualquer
        // reaproveitamento futuro do MESMO cálculo, mesmo que o
        // fingerprint ainda batesse por coincidência).
        await clearLastEligibleSimulation(ctx.conversationId);

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

        // Busca por conversationId no dict; fallback por telefone com
        // matching canônico E.164 (exato → com/sem +55/9º dígito) — cliente
        // que retorna pelo mesmo número NUNCA vira lead duplicado.
        let found = findLeadByConv(dict, ctx.conversationId);
        if (!found) found = findLeadByTelefone(dict, tel);

        // Sprint P0.9 — isTest propagado do atendimento (nunca inferido),
        // mesma disciplina de OrcamentoEnviado/PricingSimulation. O
        // frontend já filtra CRM_LEADS por isso (_isTestRecord(), hotfix
        // 2026-08-10) — só faltava o backend popular o campo.
        let isTestFromAtd = false;
        try {
          const atdSnap = await admin.firestore().collection("atendimentos").doc(ctx.conversationId).get();
          isTestFromAtd = atdSnap.exists && atdSnap.data()?.isTeste === true;
        } catch (e) {
          console.error("[valeriaCriarOportunidade] falha ao ler atendimento p/ isTest:", (e as Error).message);
        }

        let lead: CrmLead;
        let acao: string;

        if (found) {
          // Atualizar lead existente (mantém campos ERP; atualiza sub-objeto valeria)
          const existing = found.lead;
          existing.nome  = nome;
          existing.tel   = tel;
          if (isTestFromAtd) existing.isTest = true;
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
          existing.id = existing.id ?? found.id; // fix: 9db44b8 — garante que id seja preservado no upsert
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
            isTest:   isTestFromAtd,
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
