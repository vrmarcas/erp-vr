"use strict";
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
exports.valeriaStatus = exports.valeriaConsultarStatus = exports.valeriaProximaAcao = exports.valeriaTransferirHumano = exports.valeriaRegistrarMensagem = exports.valeriaCriarOportunidade = exports.valeriaCriarOrcamento = exports.valeriaCalcularOrcamento = exports.valeriaCatalogo = exports.valeriaUpsertCliente = exports.valeriaGetContexto = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const crypto_1 = require("crypto");
const pipeline_1 = require("./pipeline");
const idempotency_1 = require("./idempotency");
const pricing_1 = require("./pricing");
const response_1 = require("./response");
// ── Inicialização do Firebase Admin (idempotente) ─────────────────────────────
if (!admin.apps.length)
    admin.initializeApp();
// ── Constantes ────────────────────────────────────────────────────────────────
const COL = "erp_vr";
const SECRET_NAMES = ["VALERIA_BEARER_SECRET", "VALERIA_BEARER_SECRET_PREV"];
// Gen 1 com Secret Manager — secrets injetados como process.env.NOME_DO_SECRET
const RUN_OPTS = functions.runWith({
    secrets: SECRET_NAMES,
    timeoutSeconds: 30,
    memory: "256MB",
});
// ── Helpers Firestore ─────────────────────────────────────────────────────────
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
    await db.collection(COL).doc(key).set({
        data: JSON.stringify(data),
        ts: Date.now(),
    });
}
// ── Helpers CRM (dict unificado ERP + Valéria) ───────────────────────────────
const SIM_COL = "valeria_simulations";
const SIM_TTL_MS = 60 * 60 * 1000; // 1 hora
/**
 * Mapeamento: etapa interna Valéria → coluna Kanban ERP.
 * O ERP usa strings minúsculas com underline; a Valéria usa CAPS.
 */
const VALERIA_TO_ERP_ETAPA = {
    NOVO_LEAD: "ia_novo",
    CONTATO_FEITO: "qualificando",
    BRIEFING_COLETADO: "qualificando",
    ORCAMENTO_ENVIADO: "orc_emitido",
    NEGOCIACAO: "negociacao",
    GANHO: "fechado",
    PERDIDO: "fechado",
    REABERTO: "qualificando",
    aguardando_humano: "qualificando",
};
/** Temperatura padrão por etapa Valéria */
const ETAPA_TO_TEMP = {
    NOVO_LEAD: "frio", CONTATO_FEITO: "frio",
    BRIEFING_COLETADO: "morno", ORCAMENTO_ENVIADO: "morno",
    NEGOCIACAO: "quente", GANHO: "quente",
};
/** Cor padrão por temperatura */
const TEMP_TO_COR = {
    quente: "#FCA5A5", morno: "#FCD34D", frio: "#93C5FD",
};
/** Procura um lead no dict por conversationId */
function findLeadByConv(dict, conversationId) {
    for (const [id, lead] of Object.entries(dict)) {
        if (lead.valeria?.conversationId === conversationId)
            return { id, lead };
    }
    return null;
}
/** Monta / atualiza campos ERP a partir da etapa Valéria */
function erpFieldsFromEtapa(valeriaStatus) {
    const etapa = VALERIA_TO_ERP_ETAPA[valeriaStatus] ?? "qualificando";
    const temp = ETAPA_TO_TEMP[valeriaStatus] ?? "frio";
    return { etapa, temp, cor: TEMP_TO_COR[temp] };
}
// ── Helpers simulação de preço ───────────────────────────────────────────────
async function saveSimulation(sim) {
    const db = admin.firestore();
    await db.collection(SIM_COL).doc(sim.simulationId).set(sim);
}
async function getSimulation(simulationId) {
    const db = admin.firestore();
    const doc = await db.collection(SIM_COL).doc(simulationId).get();
    if (!doc.exists)
        return null;
    return doc.data();
}
function normTel(tel) {
    return (tel ?? "").replace(/\D/g, "");
}
function uid(prefix = "v") {
    return `${prefix}_${(0, crypto_1.randomUUID)()}`;
}
// pipeline() importado de ./pipeline (shared middleware)
// ─────────────────────────────────────────────────────────────────────────────
// 1. GET CONTEXTO DA CONVERSA
// ─────────────────────────────────────────────────────────────────────────────
exports.valeriaGetContexto = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaGetContexto");
    if (!ppl)
        return;
    const { ctx } = ppl;
    try {
        const db = admin.firestore();
        const convDoc = await db.collection("valeria_conversations").doc(ctx.conversationId).get();
        let clienteId = null;
        let leadId = null;
        if (convDoc.exists) {
            const d = convDoc.data();
            clienteId = d["clienteId"] ?? null;
            leadId = d["leadId"] ?? null;
        }
        // Fallback por channelPhone (telefone do canal — confiável)
        let cliente = null;
        if (!clienteId && ctx.channelPhone) {
            const clientes = await fsRead("clientes");
            const t = normTel(ctx.channelPhone);
            cliente = clientes?.find((c) => normTel(c.tel ?? "") === t) ?? null;
            if (cliente)
                clienteId = cliente.id;
        }
        if (clienteId && !cliente) {
            const clientes = await fsRead("clientes");
            cliente = clientes?.find((c) => c.id === clienteId) ?? null;
        }
        let lead = null;
        // Busca no dict unificado crm_leads (mesmo que o ERP Kanban lê)
        const leadsDict = await fsRead("crm_leads");
        if (leadId && leadsDict?.[leadId]) {
            lead = leadsDict[leadId];
        }
        else if (!leadId) {
            // Fallback: buscar por conversationId no dict
            const found = leadsDict ? findLeadByConv(leadsDict, ctx.conversationId) : null;
            if (found)
                lead = found.lead;
        }
        res.json((0, response_1.ok)({ conversationId: ctx.conversationId, cliente, lead }, { communicableToCustomer: false, verified: !!cliente }));
    }
    catch (e) {
        console.error("[valeriaGetContexto]", e.message);
        res.status(500).json((0, response_1.err)("INTERNAL_ERROR", "Erro ao buscar contexto."));
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// 2. UPSERT CLIENTE
// ─────────────────────────────────────────────────────────────────────────────
exports.valeriaUpsertCliente = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaUpsertCliente");
    if (!ppl)
        return;
    const { ctx } = ppl;
    if (req.method !== "POST") {
        res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST."));
        return;
    }
    const body = req.body;
    const nome = body["nome"];
    const tel = ctx.channelPhone ?? body["tel"];
    if (!nome) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "nome é obrigatório.", { missingFields: ["nome"] }));
        return;
    }
    if (!tel) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "channelPhone ou tel é obrigatório.", { missingFields: ["channelPhone"] }));
        return;
    }
    const rawKey0 = (0, idempotency_1.extractIdempotencyKey)(req);
    const keyV0 = (0, idempotency_1.validateIdempotencyKey)(rawKey0);
    if (!keyV0.ok) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", keyV0.error));
        return;
    }
    const payloadHash0 = (0, idempotency_1.buildPayloadHash)(body);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: keyV0.key, conversationId: ctx.conversationId, functionName: "valeriaUpsertCliente", payloadHash: payloadHash0 }, async () => {
        const clientes = (await fsRead("clientes")) ?? [];
        const t = normTel(tel);
        const idx = clientes.findIndex((c) => normTel(c.tel ?? "") === t);
        let cliente;
        let acao;
        if (idx >= 0) {
            Object.assign(clientes[idx], {
                nome,
                ...(body["email"] !== undefined && { email: body["email"] }),
                ...(body["cidade"] !== undefined && { cidade: body["cidade"] }),
                ...(body["tipo"] !== undefined && { tipo: body["tipo"] }),
                ...(body["doc"] !== undefined && { doc: body["doc"] }),
                ...(body["contato"] !== undefined && { contato: body["contato"] }),
                ...(body["marca"] !== undefined && { marca: body["marca"] }),
            });
            const ids = new Set(clientes[idx].conversationIds ?? []);
            ids.add(ctx.conversationId);
            clientes[idx].conversationIds = [...ids];
            cliente = clientes[idx];
            acao = "atualizado";
        }
        else {
            cliente = {
                id: uid("c"),
                nome,
                tipo: body["tipo"] ?? "PF",
                cidade: body["cidade"] ?? "—",
                marca: body["marca"] ?? "vr",
                tel,
                email: body["email"] ?? "",
                doc: body["doc"] ?? "",
                contato: body["contato"] ?? "",
                ultimoPedido: new Date().toISOString(),
                os: [],
                conversationIds: [ctx.conversationId],
            };
            clientes.unshift(cliente);
            acao = "criado";
        }
        await fsWrite("clientes", clientes);
        await admin.firestore().collection("valeria_conversations")
            .doc(ctx.conversationId)
            .set({ clienteId: cliente.id, agentId: ctx.agentId, updatedAt: Date.now() }, { merge: true });
        return (0, response_1.ok)({ acao, clienteId: cliente.id, cliente }, { communicableToCustomer: false, verified: true });
    });
    res.status(result.success ? 200 : (0, idempotency_1.idempotencyHttpStatus)(result, 500)).json(result);
});
// ─────────────────────────────────────────────────────────────────────────────
// 3. CATÁLOGO (sem preços)
// ─────────────────────────────────────────────────────────────────────────────
exports.valeriaCatalogo = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaCatalogo");
    if (!ppl)
        return;
    try {
        // erp_orc_produtos: array de strings ou objetos {nome,...}
        const produtosRaw = (await fsRead("erp_orc_produtos")) ?? [];
        const catalogo = produtosRaw.map((p) => {
            const nome = typeof p === "string" ? p : (p["nome"] ?? p["tipo"] ?? "Produto");
            const categoria = typeof p === "string" ? "" : (p["categoria"] ?? "");
            const unidade = typeof p === "string" ? "m²" : (p["unidade"] ?? "m²");
            return { nome, categoria, unidade, observacao: "Solicitar orçamento formal para valores." };
        });
        res.json((0, response_1.ok)({ catalogo, total: catalogo.length }, { communicableToCustomer: true, verified: true }));
    }
    catch (e) {
        console.error("[valeriaCatalogo]", e.message);
        res.status(500).json(response_1.QUOTE_RESPONSES.temporarilyUnavailable());
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// 4. CALCULAR ORÇAMENTO (motor oficial — retorna simulationId, não total exposto)
// ─────────────────────────────────────────────────────────────────────────────
exports.valeriaCalcularOrcamento = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaCalcularOrcamento");
    if (!ppl)
        return;
    const { ctx } = ppl;
    if (req.method !== "POST") {
        res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST."));
        return;
    }
    const body = req.body;
    const itens = body["itens"];
    if (!itens || !Array.isArray(itens) || itens.length === 0) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "itens[] é obrigatório.", { missingFields: ["itens"] }));
        return;
    }
    const rawKey1 = (0, idempotency_1.extractIdempotencyKey)(req);
    const keyV1 = (0, idempotency_1.validateIdempotencyKey)(rawKey1);
    if (!keyV1.ok) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", keyV1.error));
        return;
    }
    const payloadHash1 = (0, idempotency_1.buildPayloadHash)(body);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: keyV1.key, conversationId: ctx.conversationId, functionName: "valeriaCalcularOrcamento", payloadHash: payloadHash1 }, async () => {
        // Campos de preço bloqueados: o motor calcula exclusivamente server-side.
        // rsm2 nos itens também é ignorado — preço vem do catálogo (matKey).
        const sanitizedItens = itens.map((it) => { const { rsm2: _r, ...rest } = it; return rest; });
        const pricing = await (0, pricing_1.evaluateQuoteEligibility)(sanitizedItens, {});
        switch (pricing.eligibility) {
            case "NEEDS_INFORMATION":
                return response_1.QUOTE_RESPONSES.needsInformation(pricing.missingFields ?? []);
            case "HUMAN_VALIDATION_REQUIRED":
                return response_1.QUOTE_RESPONSES.humanValidationRequired(`Validação humana necessária: ${(pricing.missingFields ?? []).join(", ")}`);
            case "UNSUPPORTED":
                return response_1.QUOTE_RESPONSES.unsupported(String(body["descricao"] ?? "desconhecido"));
            case "TEMPORARILY_UNAVAILABLE":
                return response_1.QUOTE_RESPONSES.temporarilyUnavailable();
            case "ELIGIBLE": {
                // Persistir simulação no servidor — criarOrcamento vai recuperar por ID
                const simId = pricing.simulationId ?? uid("sim");
                const simNow = Date.now();
                const sim = {
                    simulationId: simId,
                    conversationId: ctx.conversationId,
                    itensNormalizados: sanitizedItens,
                    finalPrice: pricing.finalPrice,
                    pricingVersion: pricing.pricingVersion,
                    createdAt: simNow,
                    expiresAt: simNow + SIM_TTL_MS,
                    origem: "valeria",
                    usado: false,
                };
                await saveSimulation(sim);
                return (0, response_1.ok)({
                    simulationId: simId,
                    finalPrice: pricing.finalPrice,
                    pricingVersion: pricing.pricingVersion,
                    itensCount: sanitizedItens.length,
                    conversationId: ctx.conversationId,
                }, { communicableToCustomer: true, verified: true });
            }
        }
    });
    res.status(result.success ? 200 : (0, idempotency_1.idempotencyHttpStatus)(result, 422)).json(result);
});
// ─────────────────────────────────────────────────────────────────────────────
// 5. CRIAR ORÇAMENTO FORMAL (somente com simulationId + recálculo pelo motor)
// ─────────────────────────────────────────────────────────────────────────────
exports.valeriaCriarOrcamento = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaCriarOrcamento");
    if (!ppl)
        return;
    const { ctx } = ppl;
    if (req.method !== "POST") {
        res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST."));
        return;
    }
    const body = req.body;
    // Rejeitar campos proibidos explicitamente
    const forbidden = ["total", "valor", "preco", "price", "amount", "finalPrice"];
    const found = forbidden.filter((f) => body[f] !== undefined);
    if (found.length > 0) {
        res.status(400).json((0, response_1.err)("FORBIDDEN_FIELD", `Campos não permitidos: [${found.join(", ")}]. O valor é calculado exclusivamente pelo motor do ERP.`, { communicableToCustomer: false }));
        return;
    }
    const simulationId = body["simulationId"];
    const nomeCliente = body["nomeCliente"];
    const itens = body["itens"];
    const telCliente = ctx.channelPhone ?? body["telCliente"];
    const missing = [];
    if (!simulationId)
        missing.push("simulationId");
    if (!nomeCliente)
        missing.push("nomeCliente");
    if (!telCliente)
        missing.push("channelPhone");
    if (!itens || !Array.isArray(itens) || itens.length === 0)
        missing.push("itens");
    if (missing.length > 0) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "Campos obrigatórios ausentes.", { missingFields: missing }));
        return;
    }
    const rawKey2 = (0, idempotency_1.extractIdempotencyKey)(req);
    const keyV2 = (0, idempotency_1.validateIdempotencyKey)(rawKey2);
    if (!keyV2.ok) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", keyV2.error));
        return;
    }
    const payloadHash2 = (0, idempotency_1.buildPayloadHash)(body);
    // ID estável gerado antes da transação — garante idempotência da escrita
    const orcId = uid("orc");
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: keyV2.key, conversationId: ctx.conversationId, functionName: "valeriaCriarOrcamento", payloadHash: payloadHash2 }, async () => {
        // Referências definidas fora da callback para uso no tx
        const db = admin.firestore();
        const simRef = db.collection(SIM_COL).doc(simulationId);
        const orcRef = db.collection(COL).doc("orcamentos");
        const convRef = db.collection("valeria_conversations").doc(ctx.conversationId);
        // Transação única: lê sim + orcamentos, valida, escreve tudo atomicamente.
        // Garante: simulação não pode ser consumida sem que o orçamento seja criado.
        let sim;
        let orc;
        try {
            await db.runTransaction(async (tx) => {
                const [simDoc, orcDoc] = await Promise.all([tx.get(simRef), tx.get(orcRef)]);
                if (!simDoc.exists)
                    throw Object.assign(new Error(), { _code: "SIMULATION_NOT_FOUND" });
                const simData = simDoc.data();
                if (simData.conversationId !== ctx.conversationId)
                    throw Object.assign(new Error(), { _code: "SIMULATION_MISMATCH" });
                if (simData.expiresAt < Date.now())
                    throw Object.assign(new Error(), { _code: "SIMULATION_EXPIRED" });
                if (simData.usado)
                    throw Object.assign(new Error(), { _code: "SIMULATION_ALREADY_USED" });
                const orcRaw = orcDoc.exists
                    ? orcDoc.data()
                    : null;
                const existingOrcs = (() => {
                    try {
                        return orcRaw?.data ? JSON.parse(orcRaw.data) : [];
                    }
                    catch {
                        return [];
                    }
                })();
                const maxN = existingOrcs.reduce((m, o) => Math.max(m, parseInt(String(o.n ?? 0), 10) || 0), 0);
                const newOrc = {
                    id: orcId,
                    n: maxN + 1,
                    nomeCliente: nomeCliente,
                    telCliente: telCliente,
                    emailCliente: body["emailCliente"] ?? "",
                    descricao: body["descricao"] ?? "",
                    itens: simData.itensNormalizados,
                    total: simData.finalPrice,
                    totalCost: simData.finalPrice,
                    pricingVersion: simData.pricingVersion,
                    quoteEngine: "erp_official",
                    simulationId: simulationId,
                    communicableToCustomer: true,
                    status: "pre_orc_valeria",
                    data: new Date().toISOString(),
                    marca: body["marca"] ?? "vr",
                    origem: "valeria",
                    conversationId: ctx.conversationId,
                    agentId: ctx.agentId,
                    organizationId: ctx.organizationId,
                };
                existingOrcs.unshift(newOrc);
                tx.update(simRef, { usado: true });
                tx.set(orcRef, { data: JSON.stringify(existingOrcs), ts: Date.now() });
                tx.set(convRef, { orcamentoId: orcId, updatedAt: Date.now() }, { merge: true });
                sim = simData;
                orc = newOrc;
            });
        }
        catch (e) {
            const code = e._code;
            if (code === "SIMULATION_NOT_FOUND")
                return (0, response_1.err)("SIMULATION_NOT_FOUND", "simulationId não encontrado. Execute valeriaCalcularOrcamento primeiro.", { communicableToCustomer: false });
            if (code === "SIMULATION_MISMATCH")
                return (0, response_1.err)("SIMULATION_MISMATCH", "simulationId pertence a outra conversa.", { communicableToCustomer: false });
            if (code === "SIMULATION_EXPIRED")
                return (0, response_1.err)("SIMULATION_EXPIRED", "Simulação expirada (válida por 1h). Execute valeriaCalcularOrcamento novamente.", { communicableToCustomer: true });
            if (code === "SIMULATION_ALREADY_USED")
                return (0, response_1.err)("SIMULATION_ALREADY_USED", "Esta simulação já foi usada para criar um orçamento.", { communicableToCustomer: false });
            throw e;
        }
        void sim; // usado internamente pela transação
        return (0, response_1.ok)({ orcamentoId: orc.id, n: orc.n, total: orc.total, pricingVersion: orc.pricingVersion }, { communicableToCustomer: true, verified: true });
    }, res);
    res.status(result.success ? 201 : (0, idempotency_1.idempotencyHttpStatus)(result, 422)).json(result);
});
// ─────────────────────────────────────────────────────────────────────────────
// 6. CRIAR / ATUALIZAR OPORTUNIDADE CRM
// ─────────────────────────────────────────────────────────────────────────────
exports.valeriaCriarOportunidade = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaCriarOportunidade");
    if (!ppl)
        return;
    const { ctx } = ppl;
    if (req.method !== "POST") {
        res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST."));
        return;
    }
    const body = req.body;
    const nome = body["nome"];
    const tel = ctx.channelPhone ?? body["tel"];
    if (!nome) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "nome é obrigatório.", { missingFields: ["nome"] }));
        return;
    }
    if (!tel) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "channelPhone é obrigatório.", { missingFields: ["channelPhone"] }));
        return;
    }
    const rawKey3 = (0, idempotency_1.extractIdempotencyKey)(req);
    const keyV3 = (0, idempotency_1.validateIdempotencyKey)(rawKey3);
    if (!keyV3.ok) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", keyV3.error));
        return;
    }
    const payloadHash3 = (0, idempotency_1.buildPayloadHash)(body);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: keyV3.key, conversationId: ctx.conversationId, functionName: "valeriaCriarOportunidade", payloadHash: payloadHash3 }, async () => {
        // Lê o dict unificado crm_leads (mesmo documento que o Kanban do ERP usa)
        const dict = (await fsRead("crm_leads")) ?? {};
        const now = new Date().toISOString();
        // Busca por conversationId no dict; fallback por telefone normalizado
        let found = findLeadByConv(dict, ctx.conversationId);
        if (!found) {
            const normT = normTel(tel);
            const entry = Object.entries(dict).find(([, l]) => normTel(l.tel ?? "") === normT);
            if (entry)
                found = { id: entry[0], lead: entry[1] };
        }
        let lead;
        let acao;
        if (found) {
            // Atualizar lead existente (mantém campos ERP; atualiza sub-objeto valeria)
            const existing = found.lead;
            existing.nome = nome;
            existing.tel = tel;
            if (body["email"])
                existing.email = body["email"];
            existing.valeria = {
                ...existing.valeria,
                status: existing.valeria?.status ?? "NOVO_LEAD",
                conversationId: ctx.conversationId,
                agentId: ctx.agentId,
                organizationId: ctx.organizationId,
                ...(body["observacoes"] !== undefined && { observacoes: body["observacoes"] }),
                ...(body["proximaAcao"] !== undefined && { proximaAcao: body["proximaAcao"] }),
                ...(body["dataProximaAcao"] !== undefined && { dataProximaAcao: body["dataProximaAcao"] }),
                dataEntrada: existing.valeria?.dataEntrada ?? now,
                updatedAt: now,
                historico: [...(existing.valeria?.historico ?? []),
                    { ts: now, acao: "atualizado", agentId: ctx.agentId }],
            };
            dict[found.id] = existing;
            lead = existing;
            acao = "atualizado";
        }
        else {
            // Criar novo lead em formato compatível com o Kanban ERP
            const id = uid("lead");
            lead = {
                id,
                nome,
                tel,
                email: body["email"] ?? "",
                etapa: "ia_novo", // primeira coluna do Kanban
                marca: "vr", // padrão; pode ser overridden via briefing
                sub: tel,
                temp: "frio",
                score: Math.floor(Math.random() * 30) + 10,
                cor: TEMP_TO_COR["frio"],
                origem: body["origem"] ?? "valeria",
                contato: nome,
                cidade: body["cidade"] ?? "",
                segmento: body["segmento"] ?? "",
                dores: [],
                resumo_ia: body["observacoes"] ?? "Lead criado pela Valéria.",
                valor: "A definir",
                valeria: {
                    status: "NOVO_LEAD",
                    conversationId: ctx.conversationId,
                    agentId: ctx.agentId,
                    organizationId: ctx.organizationId,
                    observacoes: body["observacoes"] ?? "",
                    proximaAcao: body["proximaAcao"] ?? "",
                    dataProximaAcao: body["dataProximaAcao"] ?? "",
                    dataEntrada: now,
                    historico: [{ ts: now, acao: "criado", agentId: ctx.agentId }],
                },
            };
            dict[id] = lead;
            acao = "criado";
        }
        await fsWrite("crm_leads", dict);
        await admin.firestore().collection("valeria_conversations")
            .doc(ctx.conversationId)
            .set({ leadId: lead.id, updatedAt: Date.now() }, { merge: true });
        return (0, response_1.ok)({ acao, leadId: lead.id }, { communicableToCustomer: false, verified: true });
    }, res);
    res.status(result.success ? 200 : (0, idempotency_1.idempotencyHttpStatus)(result, 500)).json(result);
});
// ─────────────────────────────────────────────────────────────────────────────
// 7. REGISTRAR MENSAGEM / INTERAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
exports.valeriaRegistrarMensagem = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaRegistrarMensagem");
    if (!ppl)
        return;
    const { ctx } = ppl;
    if (req.method !== "POST") {
        res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST."));
        return;
    }
    const body = req.body;
    const mensagem = body["mensagem"];
    const messageId = ctx.messageId ?? body["messageId"];
    if (!mensagem) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "mensagem é obrigatória.", { missingFields: ["mensagem"] }));
        return;
    }
    if (!messageId) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "messageId é obrigatório.", { missingFields: ["messageId"] }));
        return;
    }
    // Chave de idempotência: header tem precedência, senão usa messageId
    const rawKey4 = (0, idempotency_1.extractIdempotencyKey)(req) ?? messageId;
    const keyV4 = (0, idempotency_1.validateIdempotencyKey)(rawKey4);
    if (!keyV4.ok) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", keyV4.error));
        return;
    }
    const payloadHash4 = (0, idempotency_1.buildPayloadHash)(body);
    // B4 — campos ampliados (backward-compatible: todos opcionais)
    const tipo = body["tipo"] ?? "texto";
    const direcao = body["direcao"] ?? "entrada";
    const origem = body["origem"] ?? "manual";
    const statusProc = body["statusProcessamento"] ?? "processado";
    // Anexos: somente metadados; omite campos ausentes para evitar undefined no Firestore
    const anexosRaw = body["anexos"] ?? body["attachments"];
    const anexosMeta = Array.isArray(anexosRaw)
        ? anexosRaw.map((a) => {
            const url = a["url"];
            const mimeType = (a["mimeType"] ?? a["mime_type"] ?? a["type"]);
            const tamanho = (a["tamanho"] ?? a["size"]);
            const nome = (a["nome"] ?? a["name"] ?? a["filename"]);
            const transcricao = a["transcricao"];
            return {
                ...(url !== undefined && { url }),
                ...(mimeType !== undefined && { mimeType }),
                ...(tamanho !== undefined && { tamanho }),
                ...(nome !== undefined && { nome }),
                ...(transcricao !== undefined && { transcricao }),
            };
        })
        : undefined;
    // bloqueioInfo: omite campos ausentes para evitar undefined no Firestore
    const bloqueioMotivo = body["bloqueioMotivo"];
    const bloqueioTipo = body["bloqueioTipo"];
    const bloqueioDetalhes = body["bloqueioDetalhes"];
    const bloqueioInfo = tipo === "bloqueio"
        ? {
            ...(bloqueioMotivo !== undefined && { motivo: bloqueioMotivo }),
            ...(bloqueioTipo !== undefined && { tipo: bloqueioTipo }),
            ...(bloqueioDetalhes !== undefined && { detalhes: bloqueioDetalhes }),
        }
        : undefined;
    const transcricao = body["transcricao"];
    const eventType = body["eventType"];
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: keyV4.key, conversationId: ctx.conversationId, functionName: "valeriaRegistrarMensagem", payloadHash: payloadHash4 }, async () => {
        const doc = {
            conversationId: ctx.conversationId,
            agentId: ctx.agentId,
            organizationId: ctx.organizationId,
            messageId,
            mensagem,
            direcao,
            tipo,
            origem,
            statusProcessamento: statusProc,
            ts: Date.now(),
            createdAt: new Date().toISOString(),
        };
        if (anexosMeta)
            doc["anexosMeta"] = anexosMeta;
        if (bloqueioInfo)
            doc["bloqueioInfo"] = bloqueioInfo;
        if (transcricao)
            doc["transcricao"] = transcricao;
        if (eventType)
            doc["eventType"] = eventType;
        await admin.firestore().collection("valeria_msgs").add(doc);
        return (0, response_1.ok)({ registrado: true, tipo, direcao, origem }, { communicableToCustomer: false });
    }, res);
    res.status(result.success ? 200 : (0, idempotency_1.idempotencyHttpStatus)(result, 500)).json(result);
});
// ─────────────────────────────────────────────────────────────────────────────
// 8. TRANSFERIR PARA HUMANO
// ─────────────────────────────────────────────────────────────────────────────
exports.valeriaTransferirHumano = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaTransferirHumano");
    if (!ppl)
        return;
    const { ctx } = ppl;
    if (req.method !== "POST") {
        res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST."));
        return;
    }
    const body = req.body;
    const motivo = body["motivo"] ?? "sem motivo";
    const rawKey5 = (0, idempotency_1.extractIdempotencyKey)(req);
    const keyV5 = (0, idempotency_1.validateIdempotencyKey)(rawKey5);
    if (!keyV5.ok) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", keyV5.error));
        return;
    }
    const payloadHash5 = (0, idempotency_1.buildPayloadHash)(body);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: keyV5.key, conversationId: ctx.conversationId, functionName: "valeriaTransferirHumano", payloadHash: payloadHash5 }, async () => {
        const dict = (await fsRead("crm_leads")) ?? {};
        const now = new Date().toISOString();
        const found = findLeadByConv(dict, ctx.conversationId);
        if (found) {
            const { id, lead } = found;
            lead.valeria = {
                ...lead.valeria,
                status: "aguardando_humano",
                updatedAt: now,
                historico: [...(lead.valeria?.historico ?? []),
                    { ts: now, acao: "transferido_humano", agentId: ctx.agentId, detalhe: motivo }],
            };
            // Etapa ERP fica em qualificando (aguardando triagem humana)
            lead.etapa = "qualificando";
            dict[id] = lead;
            await fsWrite("crm_leads", dict);
        }
        await admin.firestore().collection("valeria_alertas").add({
            tipo: "transferir_humano", conversationId: ctx.conversationId,
            agentId: ctx.agentId, motivo,
            ts: Date.now(), createdAt: now, lido: false,
        });
        return (0, response_1.ok)({ transferido: true }, { communicableToCustomer: true, humanValidationRequired: true });
    }, res);
    res.status(result.success ? 200 : (0, idempotency_1.idempotencyHttpStatus)(result, 500)).json(result);
});
// ─────────────────────────────────────────────────────────────────────────────
// 9. PRÓXIMA AÇÃO
// ─────────────────────────────────────────────────────────────────────────────
exports.valeriaProximaAcao = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaProximaAcao");
    if (!ppl)
        return;
    const { ctx } = ppl;
    if (req.method !== "POST") {
        res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST."));
        return;
    }
    const body = req.body;
    const acao = body["acao"];
    if (!acao) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "acao é obrigatória.", { missingFields: ["acao"] }));
        return;
    }
    const rawKey6 = (0, idempotency_1.extractIdempotencyKey)(req);
    const keyV6 = (0, idempotency_1.validateIdempotencyKey)(rawKey6);
    if (!keyV6.ok) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", keyV6.error));
        return;
    }
    const payloadHash6 = (0, idempotency_1.buildPayloadHash)(body);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: keyV6.key, conversationId: ctx.conversationId, functionName: "valeriaProximaAcao", payloadHash: payloadHash6 }, async () => {
        const dict = (await fsRead("crm_leads")) ?? {};
        const found = findLeadByConv(dict, ctx.conversationId);
        if (!found) {
            return (0, response_1.ok)({ warning: "Lead não encontrado para esta conversa." }, { warnings: ["Lead não encontrado — use valeriaCriarOportunidade primeiro."] });
        }
        const now = new Date().toISOString();
        const { id, lead } = found;
        lead.valeria = {
            ...lead.valeria,
            proximaAcao: acao,
            dataProximaAcao: body["data"] ?? now,
            updatedAt: now,
            historico: [...(lead.valeria?.historico ?? []),
                { ts: now, acao: `proxima_acao: ${acao}`, agentId: ctx.agentId }],
        };
        dict[id] = lead;
        await fsWrite("crm_leads", dict);
        return (0, response_1.ok)({ agendado: true, acao }, { communicableToCustomer: false });
    });
    res.status(result.success ? 200 : (0, idempotency_1.idempotencyHttpStatus)(result, 500)).json(result);
});
// ─────────────────────────────────────────────────────────────────────────────
// 10. CONSULTAR STATUS (por conversationId — sem telefone livre)
// ─────────────────────────────────────────────────────────────────────────────
exports.valeriaConsultarStatus = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaConsultarStatus");
    if (!ppl)
        return;
    const { ctx } = ppl;
    try {
        const db = admin.firestore();
        const convDoc = await db.collection("valeria_conversations").doc(ctx.conversationId).get();
        if (!convDoc.exists) {
            res.json((0, response_1.ok)({ os: [], orcamentos: [], vinculo: "nenhum" }, {
                communicableToCustomer: true, verified: false,
                warnings: ["Nenhum vínculo encontrado para esta conversa."],
            }));
            return;
        }
        const clienteId = convDoc.data()["clienteId"];
        if (!clienteId) {
            res.json((0, response_1.ok)({ os: [], orcamentos: [], vinculo: "sem_cliente" }, {
                communicableToCustomer: true, verified: false,
            }));
            return;
        }
        const clientes = await fsRead("clientes");
        const cliente = clientes?.find((c) => c.id === clienteId);
        if (!cliente) {
            res.json((0, response_1.ok)({ os: [], orcamentos: [], vinculo: "cliente_nao_encontrado" }, {
                communicableToCustomer: false, verified: false,
            }));
            return;
        }
        const kbOs = await fsRead("kb_os");
        const STATUS = { iniciada: "Iniciada", producao: "Em Produção", aguardando_saldo: "Aguardando Saldo", pronta: "Pronta ✅", entregue: "Entregue 🎉" };
        const osList = (cliente.os ?? [])
            .map((id) => kbOs?.[String(id)])
            .filter(Boolean)
            .map((os) => ({ id: os.id, descricao: os.descricao, status: STATUS[os.status ?? ""] ?? os.status, data: os.data }));
        const orcamentos = await fsRead("orcamentos");
        const orcList = (orcamentos ?? [])
            .filter((o) => o.conversationId === ctx.conversationId)
            .map((o) => ({ id: o.id, n: o.n, status: o.status, data: o.data }));
        res.json((0, response_1.ok)({ clienteNome: cliente.nome, os: osList, orcamentos: orcList }, { communicableToCustomer: true, verified: true }));
    }
    catch (e) {
        console.error("[valeriaConsultarStatus]", e.message);
        res.status(500).json((0, response_1.err)("INTERNAL_ERROR", "Erro ao consultar status."));
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// 11. HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────
exports.valeriaStatus = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaStatus");
    if (!ppl)
        return;
    res.json((0, response_1.ok)({ status: "ok", projeto: "ERP VR Marcas" }, { communicableToCustomer: false, verified: true }));
});
//# sourceMappingURL=valeria.js.map