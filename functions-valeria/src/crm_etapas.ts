/**
 * crm_etapas.ts — B3: Etapas e Resultados do CRM
 *
 * valeriaMudarEtapa  — transição controlada de etapa com validação de fluxo
 * valeriaFechamento  — ganho (com evidência) / perda (com motivo) / reabertura
 *
 * Regras de negócio:
 *  - Só transições previstas na matriz CRM_TRANSICOES são permitidas
 *  - GANHO exige orcamentoId (evidência de orçamento criado)
 *  - PERDIDO exige motivo (string não vazia)
 *  - REABERTO exige justificativa
 *  - Não é possível alterar lead de outra conversa (isolamento por conversationId)
 *  - Impossível marcar GANHO como "pagamento recebido" — isso é exclusivo do ERP
 *  - Histórico de movimentações append-only com ts + agentId + etapaAnterior
 *
 * Etapas válidas:
 *  NOVO_LEAD → CONTATO_FEITO → BRIEFING_COLETADO → ORCAMENTO_ENVIADO
 *  → NEGOCIACAO → GANHO | PERDIDO → REABERTO
 */

import * as functions from "firebase-functions";
import * as admin      from "firebase-admin";

import { pipeline }          from "./pipeline";
import {
  withIdempotency,
  extractIdempotencyKey,
  validateIdempotencyKey,
  buildPayloadHash,
  idempotencyHttpStatus,
} from "./idempotency";
import { ok, err }           from "./response";
import type {
  CrmLead,
  CrmLeadDict,
  CrmEtapa,
  FechamentoResultado,
  LeadHistoricoEntry,
} from "./types";
import { CRM_TRANSICOES } from "./types";

/** Mapeamento: status Valéria → coluna Kanban ERP */
const VALERIA_TO_ERP_ETAPA: Record<string, string> = {
  NOVO_LEAD: "ia_novo", CONTATO_FEITO: "qualificando",
  BRIEFING_COLETADO: "qualificando", ORCAMENTO_ENVIADO: "orc_emitido",
  NEGOCIACAO: "negociacao", GANHO: "fechado", PERDIDO: "fechado",
  REABERTO: "qualificando", aguardando_humano: "qualificando",
};

const SECRET_NAMES = ["VALERIA_BEARER_SECRET", "VALERIA_BEARER_SECRET_PREV"];
const RUN_OPTS = functions.runWith({
  secrets:        SECRET_NAMES,
  timeoutSeconds: 30,
  memory:         "256MB",
});

const COL = "erp_vr";

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
  await db.collection(COL).doc(key).set({ data: JSON.stringify(data), ts: Date.now() });
}

const ETAPAS_VALIDAS = new Set<string>(Object.keys(CRM_TRANSICOES));

// ── Helpers ───────────────────────────────────────────────────────────────────

function validarTransicao(atual: string | undefined, destino: CrmEtapa): string | null {
  const etapaAtual = (atual?.toUpperCase() ?? "NOVO_LEAD") as CrmEtapa;
  if (!ETAPAS_VALIDAS.has(etapaAtual)) return null; // aceita etapa desconhecida → permite mover

  const permitidas = CRM_TRANSICOES[etapaAtual];
  if (permitidas.length === 0) {
    return `Etapa '${etapaAtual}' é terminal — use valeriaFechamento para reabrir.`;
  }
  if (!permitidas.includes(destino)) {
    return `Transição '${etapaAtual}' → '${destino}' não é permitida. Destinos válidos: [${permitidas.join(", ")}].`;
  }
  return null;
}

/** Busca lead no dict unificado crm_leads por conversationId */
function findLead(dict: CrmLeadDict, conversationId: string): { id: string; lead: CrmLead } | null {
  for (const [id, lead] of Object.entries(dict)) {
    if (lead.valeria?.conversationId === conversationId) return { id, lead };
  }
  return null;
}

// ── valeriaMudarEtapa ────────────────────────────────────────────────────────

export const valeriaMudarEtapa = RUN_OPTS.https.onRequest(async (req, res) => {
  const ppl = await pipeline(req, res, "valeriaMudarEtapa");
  if (!ppl) return;
  const { ctx } = ppl;
  if (req.method !== "POST") {
    res.status(405).json(err("METHOD_NOT_ALLOWED", "Use POST."));
    return;
  }

  const body    = req.body as Record<string, unknown>;
  const destino = (body["etapa"] as string | undefined)?.toUpperCase() as CrmEtapa | undefined;
  const responsavel = body["responsavel"] as string | undefined;
  const observacao  = body["observacao"]  as string | undefined;

  if (!destino) {
    res.status(400).json(err("VALIDATION_ERROR", "Campo 'etapa' é obrigatório.", {
      missingFields: ["etapa"],
    }));
    return;
  }
  if (!ETAPAS_VALIDAS.has(destino)) {
    res.status(400).json(err("VALIDATION_ERROR",
      `Etapa '${destino}' não existe. Válidas: [${[...ETAPAS_VALIDAS].join(", ")}].`
    ));
    return;
  }
  // GANHO e PERDIDO só via valeriaFechamento
  if (destino === "GANHO" || destino === "PERDIDO" || destino === "REABERTO") {
    res.status(400).json(err("VALIDATION_ERROR",
      `Para marcar como ${destino}, use valeriaFechamento (exige evidência ou motivo obrigatório).`
    ));
    return;
  }

  const rawKeyM = extractIdempotencyKey(req);
  const keyVM = validateIdempotencyKey(rawKeyM);
  if (!keyVM.ok) { res.status(400).json(err("VALIDATION_ERROR", keyVM.error)); return; }
  const payloadHashM = buildPayloadHash(body as Record<string, unknown>);
  const result = await withIdempotency(
    { idempotencyKey: keyVM.key, conversationId: ctx.conversationId, functionName: "valeriaMudarEtapa", payloadHash: payloadHashM },
    async () => {
      const dict  = (await fsRead<CrmLeadDict>("crm_leads")) ?? {};
      const found = findLead(dict, ctx.conversationId);

      if (!found) {
        return err("NOT_FOUND",
          "Lead não encontrado para esta conversa. Use valeriaCriarOportunidade primeiro.",
          { communicableToCustomer: false }
        );
      }

      const { id, lead } = found;
      const valeriaStatus = (lead.valeria?.status ?? "NOVO_LEAD").toUpperCase();

      const errTransicao = validarTransicao(valeriaStatus, destino);
      if (errTransicao) {
        return err("INVALID_TRANSITION", errTransicao, { communicableToCustomer: false });
      }

      const now  = new Date().toISOString();
      const entry: LeadHistoricoEntry = {
        ts:      now,
        acao:    `etapa: ${valeriaStatus} → ${destino}`,
        agentId: ctx.agentId,
        detalhe: [responsavel && `responsavel: ${responsavel}`, observacao].filter(Boolean).join("; ") || undefined,
      };

      // Atualizar sub-objeto valeria (status interno)
      lead.valeria = {
        ...lead.valeria!,
        status:    destino,
        updatedAt: now,
        historico: [...(lead.valeria?.historico ?? []), entry],
        ...(responsavel && { responsavel }),
      };
      // Sincronizar coluna do Kanban ERP
      lead.etapa = VALERIA_TO_ERP_ETAPA[destino] ?? "qualificando";
      dict[id]   = lead;

      await fsWrite("crm_leads", dict);

      return ok(
        { leadId: lead.id, etapaAnterior: valeriaStatus, etapaAtual: destino },
        { communicableToCustomer: false, verified: true }
      );
    },
    res
  );

  const statusM = result.success ? 200 : (
    result.error?.code === "NOT_FOUND" ? 404 : idempotencyHttpStatus(result, 422)
  );
  res.status(statusM).json(result);
});

// ── valeriaFechamento ────────────────────────────────────────────────────────

export const valeriaFechamento = RUN_OPTS.https.onRequest(async (req, res) => {
  const ppl = await pipeline(req, res, "valeriaFechamento");
  if (!ppl) return;
  const { ctx } = ppl;
  if (req.method !== "POST") {
    res.status(405).json(err("METHOD_NOT_ALLOWED", "Use POST."));
    return;
  }

  const body      = req.body as Record<string, unknown>;
  const resultado = (body["resultado"] as string | undefined)?.toLowerCase() as FechamentoResultado | undefined;
  const motivo    = (body["motivo"]        as string | undefined)?.trim();
  const justif    = (body["justificativa"] as string | undefined)?.trim();
  const orcId     = body["orcamentoId"]    as string | undefined;

  if (!resultado || !["ganho", "perda", "reaberto"].includes(resultado)) {
    res.status(400).json(err("VALIDATION_ERROR",
      "Campo 'resultado' é obrigatório e deve ser: ganho | perda | reaberto.",
      { missingFields: ["resultado"] }
    ));
    return;
  }

  // Validações específicas por resultado
  if (resultado === "perda" && (!motivo || motivo.length < 3)) {
    res.status(400).json(err("VALIDATION_ERROR",
      "Marcar como PERDIDO exige campo 'motivo' com descrição (mínimo 3 caracteres).",
      { missingFields: ["motivo"] }
    ));
    return;
  }
  if (resultado === "ganho" && !orcId) {
    res.status(400).json(err("VALIDATION_ERROR",
      "Marcar como GANHO exige campo 'orcamentoId' como evidência do orçamento aceito.",
      { missingFields: ["orcamentoId"] }
    ));
    return;
  }
  if (resultado === "reaberto" && (!justif || justif.length < 3)) {
    res.status(400).json(err("VALIDATION_ERROR",
      "Reabrir oportunidade exige campo 'justificativa' (mínimo 3 caracteres).",
      { missingFields: ["justificativa"] }
    ));
    return;
  }

  const rawKeyF = extractIdempotencyKey(req);
  const keyVF = validateIdempotencyKey(rawKeyF);
  if (!keyVF.ok) { res.status(400).json(err("VALIDATION_ERROR", keyVF.error)); return; }
  const payloadHashF = buildPayloadHash(body as Record<string, unknown>);
  const result = await withIdempotency(
    { idempotencyKey: keyVF.key, conversationId: ctx.conversationId, functionName: "valeriaFechamento", payloadHash: payloadHashF },
    async () => {
      const dict  = (await fsRead<CrmLeadDict>("crm_leads")) ?? {};
      const found = findLead(dict, ctx.conversationId);

      if (!found) {
        return err("NOT_FOUND",
          "Lead não encontrado para esta conversa. Use valeriaCriarOportunidade primeiro.",
          { communicableToCustomer: false }
        );
      }

      const { id, lead } = found;
      const etapaAtual   = (lead.valeria?.status ?? "NOVO_LEAD").toUpperCase();
      const now           = new Date().toISOString();

      // Mapear resultado para etapa
      const ETAPA_DESTINO: Record<FechamentoResultado, CrmEtapa> = {
        ganho:    "GANHO",
        perda:    "PERDIDO",
        reaberto: "REABERTO",
      };
      const destino = ETAPA_DESTINO[resultado];

      // Validar transição (exceto REABERTO que pode vir de GANHO também)
      if (destino !== "REABERTO") {
        const errTrans = validarTransicao(etapaAtual, destino);
        if (errTrans) {
          return err("INVALID_TRANSITION", errTrans, { communicableToCustomer: false });
        }
      } else {
        // REABERTO só pode vir de GANHO ou PERDIDO
        if (!["GANHO", "PERDIDO"].includes(etapaAtual)) {
          return err("INVALID_TRANSITION",
            `Só é possível reabrir um lead GANHO ou PERDIDO. Etapa atual: ${etapaAtual}.`,
            { communicableToCustomer: false }
          );
        }
      }

      // Construir histórico
      const detalhe = [
        resultado === "perda"    && `motivo: ${motivo}`,
        resultado === "ganho"    && `orcamentoId: ${orcId}`,
        resultado === "reaberto" && `justificativa: ${justif}`,
      ].filter(Boolean).join("; ");

      const entry: LeadHistoricoEntry = {
        ts:      now,
        acao:    `fechamento_${resultado}: ${etapaAtual} → ${destino}`,
        agentId: ctx.agentId,
        detalhe: detalhe || undefined,
      };

      // Atualizar sub-objeto valeria
      lead.valeria = {
        ...lead.valeria!,
        status:    destino,
        updatedAt: now,
        historico: [...(lead.valeria?.historico ?? []), entry],
        ...(resultado === "ganho"    && orcId   && { orcamentoGanhoId: orcId }),
        ...(resultado === "perda"    && motivo  && { motivoPerda: motivo }),
        ...(resultado === "reaberto" && justif  && { reaberturaJustificativa: justif,
          orcamentoGanhoId: undefined, motivoPerda: undefined,
          proximaAcao: (body["proximaAcao"] as string) ?? "Contato de reabertura" }),
      };
      // Sincronizar coluna Kanban ERP
      lead.etapa = VALERIA_TO_ERP_ETAPA[destino] ?? "qualificando";
      dict[id]   = lead;

      await fsWrite("crm_leads", dict);

      // Alerta para equipe nos casos de GANHO e PERDIDO
      if (resultado !== "reaberto") {
        await admin.firestore().collection("valeria_alertas").add({
          tipo:           `crm_${resultado}`,
          conversationId: ctx.conversationId,
          leadId:         lead.id,
          agentId:        ctx.agentId,
          detalhe,
          ts:             Date.now(),
          createdAt:      now,
          lido:           false,
        });
      }

      return ok(
        {
          leadId:       lead.id,
          resultado,
          etapaAnterior: etapaAtual,
          etapaAtual:   destino,
          ...(resultado === "ganho"    && { orcamentoId: orcId }),
          ...(resultado === "perda"    && { motivo }),
          ...(resultado === "reaberto" && { justificativa: justif }),
        },
        {
          communicableToCustomer: resultado === "ganho",
          humanValidationRequired: resultado === "ganho",
          verified: true,
        }
      );
    },
    res
  );

  const statusF = result.success ? 200 : (
    result.error?.code === "NOT_FOUND" ? 404 : idempotencyHttpStatus(result, 422)
  );
  res.status(statusF).json(result);
});
