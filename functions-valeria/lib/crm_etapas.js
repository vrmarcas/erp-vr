"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.valeriaFechamento = exports.valeriaMudarEtapa = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const pipeline_1 = require("./pipeline");
const idempotency_1 = require("./idempotency");
const response_1 = require("./response");
const types_1 = require("./types");
const SECRET_NAMES = ["VALERIA_BEARER_SECRET", "VALERIA_BEARER_SECRET_PREV"];
const RUN_OPTS = functions.runWith({
    secrets: SECRET_NAMES,
    timeoutSeconds: 30,
    memory: "256MB",
});
const COL = "erp_vr";
async function fsRead(key) {
    const db = admin.firestore();
    const doc = await db.collection(COL).doc(key).get();
    if (!doc.exists)
        return null;
    const raw = doc.data()?.data;
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function fsWrite(key, data) {
    const db = admin.firestore();
    await db.collection(COL).doc(key).set({ data: JSON.stringify(data), ts: Date.now() });
}
const ETAPAS_VALIDAS = new Set(Object.keys(types_1.CRM_TRANSICOES));
// ── Helpers ───────────────────────────────────────────────────────────────────
function validarTransicao(atual, destino) {
    const etapaAtual = (atual?.toUpperCase() ?? "NOVO_LEAD");
    if (!ETAPAS_VALIDAS.has(etapaAtual))
        return null; // aceita etapa desconhecida → permite mover
    const permitidas = types_1.CRM_TRANSICOES[etapaAtual];
    if (permitidas.length === 0) {
        return `Etapa '${etapaAtual}' é terminal — use valeriaFechamento para reabrir.`;
    }
    if (!permitidas.includes(destino)) {
        return `Transição '${etapaAtual}' → '${destino}' não é permitida. Destinos válidos: [${permitidas.join(", ")}].`;
    }
    return null;
}
function findLead(leads, conversationId) {
    const idx = leads.findIndex((l) => l.conversationId === conversationId);
    if (idx < 0)
        return null;
    return { idx, lead: leads[idx] };
}
// ── valeriaMudarEtapa ────────────────────────────────────────────────────────
const _mudarEtapaHandler = async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaMudarEtapa");
    if (!ppl)
        return;
    const { ctx } = ppl;
    if (req.method !== "POST") {
        res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST."));
        return;
    }
    const body = req.body;
    const destino = body["etapa"]?.toUpperCase();
    const responsavel = body["responsavel"];
    const observacao = body["observacao"];
    if (!destino) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "Campo 'etapa' é obrigatório.", {
            missingFields: ["etapa"],
        }));
        return;
    }
    if (!ETAPAS_VALIDAS.has(destino)) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", `Etapa '${destino}' não existe. Válidas: [${[...ETAPAS_VALIDAS].join(", ")}].`));
        return;
    }
    // GANHO e PERDIDO só via valeriaFechamento
    if (destino === "GANHO" || destino === "PERDIDO" || destino === "REABERTO") {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", `Para marcar como ${destino}, use valeriaFechamento (exige evidência ou motivo obrigatório).`));
        return;
    }
    const idempKey = (0, idempotency_1.extractIdempotencyKey)(req);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaMudarEtapa" }, async () => {
        const leads = (await fsRead("valeria_leads")) ?? [];
        const found = findLead(leads, ctx.conversationId);
        if (!found) {
            return (0, response_1.err)("NOT_FOUND", "Lead não encontrado para esta conversa. Use valeriaCriarOportunidade primeiro.", { communicableToCustomer: false });
        }
        const { idx, lead } = found;
        const etapaAtual = (lead.status ?? "NOVO_LEAD").toUpperCase();
        // Validar transição
        const errTransicao = validarTransicao(etapaAtual, destino);
        if (errTransicao) {
            return (0, response_1.err)("INVALID_TRANSITION", errTransicao, { communicableToCustomer: false });
        }
        const now = new Date().toISOString();
        const entry = {
            ts: now,
            acao: `etapa: ${etapaAtual} → ${destino}`,
            agentId: ctx.agentId,
            detalhe: [responsavel && `responsavel: ${responsavel}`, observacao].filter(Boolean).join("; ") || undefined,
        };
        leads[idx].status = destino;
        if (responsavel)
            leads[idx].responsavel = responsavel;
        leads[idx].historico = [...(lead.historico ?? []), entry];
        leads[idx].updatedAt = now;
        await fsWrite("valeria_leads", leads);
        return (0, response_1.ok)({ leadId: lead.id, etapaAnterior: etapaAtual, etapaAtual: destino }, { communicableToCustomer: false, verified: true });
    });
    res.status(result.success ? 200 : (result.error?.code === "NOT_FOUND" ? 404 : 422)).json(result);
};
exports._mudarEtapaHandler = _mudarEtapaHandler;
exports.valeriaMudarEtapa = RUN_OPTS.https.onRequest(_mudarEtapaHandler);
// ── valeriaFechamento ────────────────────────────────────────────────────────
const _fechamentoHandler = async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaFechamento");
    if (!ppl)
        return;
    const { ctx } = ppl;
    if (req.method !== "POST") {
        res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST."));
        return;
    }
    const body = req.body;
    const resultado = body["resultado"]?.toLowerCase();
    const motivo = body["motivo"]?.trim();
    const justif = body["justificativa"]?.trim();
    const orcId = body["orcamentoId"];
    if (!resultado || !["ganho", "perda", "reaberto"].includes(resultado)) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "Campo 'resultado' é obrigatório e deve ser: ganho | perda | reaberto.", { missingFields: ["resultado"] }));
        return;
    }
    // Validações específicas por resultado
    if (resultado === "perda" && (!motivo || motivo.length < 3)) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "Marcar como PERDIDO exige campo 'motivo' com descrição (mínimo 3 caracteres).", { missingFields: ["motivo"] }));
        return;
    }
    if (resultado === "ganho" && !orcId) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "Marcar como GANHO exige campo 'orcamentoId' como evidência do orçamento aceito.", { missingFields: ["orcamentoId"] }));
        return;
    }
    if (resultado === "reaberto" && (!justif || justif.length < 3)) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "Reabrir oportunidade exige campo 'justificativa' (mínimo 3 caracteres).", { missingFields: ["justificativa"] }));
        return;
    }
    const idempKey = (0, idempotency_1.extractIdempotencyKey)(req);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaFechamento" }, async () => {
        const leads = (await fsRead("valeria_leads")) ?? [];
        const found = findLead(leads, ctx.conversationId);
        if (!found) {
            return (0, response_1.err)("NOT_FOUND", "Lead não encontrado para esta conversa. Use valeriaCriarOportunidade primeiro.", { communicableToCustomer: false });
        }
        const { idx, lead } = found;
        const etapaAtual = (lead.status ?? "NOVO_LEAD").toUpperCase();
        const now = new Date().toISOString();
        // Mapear resultado para etapa
        const ETAPA_DESTINO = {
            ganho: "GANHO",
            perda: "PERDIDO",
            reaberto: "REABERTO",
        };
        const destino = ETAPA_DESTINO[resultado];
        // Validar transição (exceto REABERTO que pode vir de GANHO também)
        if (destino !== "REABERTO") {
            const errTrans = validarTransicao(etapaAtual, destino);
            if (errTrans) {
                return (0, response_1.err)("INVALID_TRANSITION", errTrans, { communicableToCustomer: false });
            }
        }
        else {
            // REABERTO só pode vir de GANHO ou PERDIDO
            if (!["GANHO", "PERDIDO"].includes(etapaAtual)) {
                return (0, response_1.err)("INVALID_TRANSITION", `Só é possível reabrir um lead GANHO ou PERDIDO. Etapa atual: ${etapaAtual}.`, { communicableToCustomer: false });
            }
        }
        // Construir histórico
        const detalhe = [
            resultado === "perda" && `motivo: ${motivo}`,
            resultado === "ganho" && `orcamentoId: ${orcId}`,
            resultado === "reaberto" && `justificativa: ${justif}`,
        ].filter(Boolean).join("; ");
        const entry = {
            ts: now,
            acao: `fechamento_${resultado}: ${etapaAtual} → ${destino}`,
            agentId: ctx.agentId,
            detalhe: detalhe || undefined,
        };
        leads[idx].status = destino;
        leads[idx].historico = [...(lead.historico ?? []), entry];
        leads[idx].updatedAt = now;
        // Campos adicionais por resultado
        if (resultado === "ganho" && orcId)
            leads[idx].orcamentoGanhoId = orcId;
        if (resultado === "perda" && motivo)
            leads[idx].motivoPerda = motivo;
        if (resultado === "reaberto") {
            delete leads[idx].motivoPerda;
            delete leads[idx].orcamentoGanhoId;
            leads[idx].reaberturaJustificativa = justif;
            // Retorna à fila ativa
            leads[idx].proximaAcao = body["proximaAcao"] ?? "Contato de reabertura";
        }
        await fsWrite("valeria_leads", leads);
        // Alerta para equipe nos casos de GANHO e PERDIDO
        if (resultado !== "reaberto") {
            await admin.firestore().collection("valeria_alertas").add({
                tipo: `crm_${resultado}`,
                conversationId: ctx.conversationId,
                leadId: lead.id,
                agentId: ctx.agentId,
                detalhe,
                ts: Date.now(),
                createdAt: now,
                lido: false,
            });
        }
        return (0, response_1.ok)({
            leadId: lead.id,
            resultado,
            etapaAnterior: etapaAtual,
            etapaAtual: destino,
            ...(resultado === "ganho" && { orcamentoId: orcId }),
            ...(resultado === "perda" && { motivo }),
            ...(resultado === "reaberto" && { justificativa: justif }),
        }, {
            communicableToCustomer: resultado === "ganho",
            humanValidationRequired: resultado === "ganho",
            verified: true,
        });
    });
    res.status(result.success ? 200 : (result.error?.code === "NOT_FOUND" ? 404 : 422)).json(result);
};
exports._fechamentoHandler = _fechamentoHandler;
exports.valeriaFechamento = RUN_OPTS.https.onRequest(_fechamentoHandler);
//# sourceMappingURL=crm_etapas.js.map