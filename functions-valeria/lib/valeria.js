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
const types_1 = require("./types");
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
        if (leadId) {
            const leads = await fsRead("valeria_leads");
            lead = leads?.find((l) => l.id === leadId) ?? null;
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
    const idempKey = (0, idempotency_1.extractIdempotencyKey)(req);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaUpsertCliente" }, async () => {
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
    res.status(result.success ? 200 : 500).json(result);
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
            const nome      = typeof p === "string" ? p : (p["nome"] ?? p["tipo"] ?? "Produto");
            const categoria = typeof p === "string" ? ""  : (p["categoria"] ?? "");
            const unidade   = typeof p === "string" ? "m²" : (p["unidade"] ?? "m²");
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
    const idempKey = (0, idempotency_1.extractIdempotencyKey)(req);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaCalcularOrcamento" }, async () => {
        const pricing = await (0, pricing_1.evaluateQuoteEligibility)(itens, {
            extras: body["extras"],
            descPct: body["descPct"],
            descRS: body["descRS"],
            acresPct: body["acresPct"],
            acresRS: body["acresRS"],
        });
        switch (pricing.eligibility) {
            case "NEEDS_INFORMATION":
                return response_1.QUOTE_RESPONSES.needsInformation(pricing.missingFields ?? []);
            case "HUMAN_VALIDATION_REQUIRED":
                return response_1.QUOTE_RESPONSES.humanValidationRequired(`Validação humana necessária: ${(pricing.missingFields ?? []).join(", ")}`);
            case "UNSUPPORTED":
                return response_1.QUOTE_RESPONSES.unsupported(String(body["descricao"] ?? "desconhecido"));
            case "TEMPORARILY_UNAVAILABLE":
                return response_1.QUOTE_RESPONSES.temporarilyUnavailable();
            case "ELIGIBLE":
                return (0, response_1.ok)({
                    simulationId: pricing.simulationId,
                    finalPrice: pricing.finalPrice,
                    pricingVersion: pricing.pricingVersion,
                    itensCount: itens.length,
                    conversationId: ctx.conversationId,
                }, { communicableToCustomer: true, verified: true });
        }
    });
    res.status(result.success ? 200 : 422).json(result);
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
    const idempKey = (0, idempotency_1.extractIdempotencyKey)(req);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaCriarOrcamento" }, async () => {
        // Recalcula pelo motor oficial — simulationId é referência de sessão, não cheque em branco
        const pricing = await (0, pricing_1.evaluateQuoteEligibility)(itens, {
            extras: body["extras"],
            descPct: body["descPct"],
            descRS: body["descRS"],
            acresPct: body["acresPct"],
            acresRS: body["acresRS"],
        });
        if (pricing.eligibility !== "ELIGIBLE") {
            switch (pricing.eligibility) {
                case "NEEDS_INFORMATION":
                    return response_1.QUOTE_RESPONSES.needsInformation(pricing.missingFields ?? []);
                case "HUMAN_VALIDATION_REQUIRED":
                    return response_1.QUOTE_RESPONSES.humanValidationRequired("Cálculo requer validação humana.");
                case "UNSUPPORTED":
                    return response_1.QUOTE_RESPONSES.unsupported(String(body["descricao"] ?? "desconhecido"));
                default:
                    return response_1.QUOTE_RESPONSES.temporarilyUnavailable();
            }
        }
        const orcamentos = (await fsRead("orcamentos")) ?? [];
        const maxN = orcamentos.reduce((m, o) => Math.max(m, parseInt(String(o.n ?? 0), 10) || 0), 0);
        const orc = {
            id: uid("orc"),
            n: maxN + 1,
            nomeCliente: nomeCliente,
            telCliente: telCliente,
            emailCliente: body["emailCliente"] ?? "",
            descricao: body["descricao"] ?? "",
            itens: itens,
            total: pricing.finalPrice,
            totalCost: pricing.totalCost,
            pricingVersion: pricing.pricingVersion,
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
        orcamentos.unshift(orc);
        await fsWrite("orcamentos", orcamentos);
        await admin.firestore().collection("valeria_conversations")
            .doc(ctx.conversationId)
            .set({ orcamentoId: orc.id, updatedAt: Date.now() }, { merge: true });
        return (0, response_1.ok)({ orcamentoId: orc.id, n: orc.n, total: orc.total, pricingVersion: orc.pricingVersion }, { communicableToCustomer: true, verified: true });
    });
    res.status(result.success ? 201 : 422).json(result);
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
    const idempKey = (0, idempotency_1.extractIdempotencyKey)(req);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaCriarOportunidade" }, async () => {
        const leads = (await fsRead("valeria_leads")) ?? [];
        const now = new Date().toISOString();
        // Vínculo primário: conversationId. Fallback: channelPhone
        let idx = leads.findIndex((l) => l.conversationId === ctx.conversationId);
        if (idx < 0)
            idx = leads.findIndex((l) => normTel(l.tel ?? "") === normTel(tel));
        let lead;
        let acao;
        if (idx >= 0) {
            Object.assign(leads[idx], {
                nome, conversationId: ctx.conversationId,
                agentId: ctx.agentId, organizationId: ctx.organizationId,
                ...(body["email"] !== undefined && { email: body["email"] }),
                ...(body["observacoes"] !== undefined && { observacoes: body["observacoes"] }),
                ...(body["proximaAcao"] !== undefined && { proximaAcao: body["proximaAcao"] }),
                ...(body["dataProximaAcao"] !== undefined && { dataProximaAcao: body["dataProximaAcao"] }),
            });
            leads[idx].historico = [...(leads[idx].historico ?? []),
                { ts: now, acao: "atualizado", agentId: ctx.agentId }];
            lead = leads[idx];
            acao = "atualizado";
        }
        else {
            lead = {
                id: uid("lead"), nome, tel,
                email: body["email"] ?? "",
                status: "novo",
                origem: body["origem"] ?? "valeria",
                observacoes: body["observacoes"] ?? "",
                dataEntrada: now,
                proximaAcao: body["proximaAcao"] ?? "",
                dataProximaAcao: body["dataProximaAcao"] ?? "",
                conversationId: ctx.conversationId,
                agentId: ctx.agentId,
                organizationId: ctx.organizationId,
                historico: [{ ts: now, acao: "criado", agentId: ctx.agentId }],
            };
            leads.unshift(lead);
            acao = "criado";
        }
        await fsWrite("valeria_leads", leads);
        await admin.firestore().collection("valeria_conversations")
            .doc(ctx.conversationId)
            .set({ leadId: lead.id, updatedAt: Date.now() }, { merge: true });
        return (0, response_1.ok)({ acao, leadId: lead.id }, { communicableToCustomer: false, verified: true });
    });
    res.status(result.success ? 200 : 500).json(result);
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
    // B4 — campos ampliados (backward-compatible: todos opcionais)
    const tipo = body["tipo"] ?? "texto";
    const direcao = body["direcao"] ?? "entrada";
    const origem = body["origem"] ?? "manual";
    const statusProc = body["statusProcessamento"] ?? "processado";
    // Anexos: somente metadados (nunca conteúdo binário)
    const anexosRaw = body["anexos"] ?? body["attachments"];
    const anexosMeta = Array.isArray(anexosRaw)
        ? anexosRaw.map((a) => ({
            url: a["url"],
            mimeType: (a["mimeType"] ?? a["mime_type"] ?? a["type"]),
            tamanho: (a["tamanho"] ?? a["size"]),
            nome: (a["nome"] ?? a["name"] ?? a["filename"]),
            transcricao: a["transcricao"],
        }))
        : undefined;
    const bloqueioInfo = tipo === "bloqueio"
        ? {
            motivo: body["bloqueioMotivo"],
            tipo: body["bloqueioTipo"],
            detalhes: body["bloqueioDetalhes"],
        }
        : undefined;
    const transcricao = body["transcricao"];
    const eventType = body["eventType"];
    const idempKey = messageId ?? (0, idempotency_1.extractIdempotencyKey)(req);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaRegistrarMensagem" }, async () => {
        const doc = {
            conversationId: ctx.conversationId,
            agentId: ctx.agentId,
            organizationId: ctx.organizationId,
            messageId: messageId ?? uid("msg"),
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
    });
    res.status(result.success ? 200 : 500).json(result);
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
    const idempKey = (0, idempotency_1.extractIdempotencyKey)(req);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaTransferirHumano" }, async () => {
        const leads = (await fsRead("valeria_leads")) ?? [];
        const now = new Date().toISOString();
        const idx = leads.findIndex((l) => l.conversationId === ctx.conversationId);
        if (idx >= 0) {
            leads[idx].status = "aguardando_humano";
            leads[idx].historico = [...(leads[idx].historico ?? []),
                { ts: now, acao: "transferido_humano", agentId: ctx.agentId, detalhe: motivo }];
            await fsWrite("valeria_leads", leads);
        }
        await admin.firestore().collection("valeria_alertas").add({
            tipo: "transferir_humano", conversationId: ctx.conversationId,
            agentId: ctx.agentId, motivo,
            ts: Date.now(), createdAt: now, lido: false,
        });
        return (0, response_1.ok)({ transferido: true }, { communicableToCustomer: true, humanValidationRequired: true });
    });
    res.status(result.success ? 200 : 500).json(result);
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
    const idempKey = (0, idempotency_1.extractIdempotencyKey)(req);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaProximaAcao" }, async () => {
        const leads = (await fsRead("valeria_leads")) ?? [];
        const idx = leads.findIndex((l) => l.conversationId === ctx.conversationId);
        if (idx < 0) {
            return (0, response_1.ok)({ warning: "Lead não encontrado para esta conversa." }, { warnings: ["Lead não encontrado — use valeriaCriarOportunidade primeiro."] });
        }
        leads[idx].proximaAcao = acao;
        leads[idx].dataProximaAcao = body["data"] ?? new Date().toISOString();
        leads[idx].historico = [...(leads[idx].historico ?? []),
            { ts: new Date().toISOString(), acao: `proxima_acao: ${acao}`, agentId: ctx.agentId }];
        await fsWrite("valeria_leads", leads);
        return (0, response_1.ok)({ agendado: true, acao }, { communicableToCustomer: false });
    });
    res.status(result.success ? 200 : 500).json(result);
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
// ── B1: valeriaWebhookChatvolt — helpers ─────────────────────────────────────
function _b1_buildIdempKey(eventType, conversationId, agentId, dataRef) {
    const raw = `${eventType}:${conversationId}:${agentId}:${dataRef}`;
    return "wh_" + (0, crypto_1.createHash)("sha256").update(raw).digest("hex").slice(0, 40);
}
function _b1_mapEvent(eventType) {
    switch (eventType) {
        case "USER_MESSAGE_RECEIVED": return { direcao: "entrada", tipo: "texto" };
        case "AGENT_USER_MESSAGE": return { direcao: "saida", tipo: "texto" };
        case "AGENT_MESSAGE_SENDED": return { direcao: "saida", tipo: "texto" };
        case "AGENT_MESSAGE_FOLLOW_UP": return { direcao: "saida", tipo: "follow_up" };
        case "AGENT_MESSAGE_BLOCKED": return { direcao: "saida", tipo: "bloqueio" };
        case "AGENT_MESSAGE_NOTED": return { direcao: "saida", tipo: "nota" };
        default: return { direcao: "entrada", tipo: "texto" };
    }
}
function _b1_extractAnexos(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((a) => ({ url: a["url"], mimeType: (a["mimeType"] ?? a["mime_type"] ?? a["type"]), tamanho: (a["tamanho"] ?? a["size"]), nome: (a["nome"] ?? a["name"] ?? a["filename"]), transcricao: a["transcricao"] }));
}
exports.valeriaWebhookChatvolt = RUN_OPTS.https.onRequest(async (req, res) => {
    if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Origin", "https://app.chatvolt.ai");
        res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Idempotency-Key");
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.status(204).send("");
        return;
    }
    if (req.method !== "POST") { res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST.")); return; }
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaWebhookChatvolt");
    if (!ppl) return;
    const { ctx } = ppl;
    const body = req.body;
    const eventType = (body["eventType"] ?? body["event_type"] ?? body["type"]);
    if (!eventType) {
        res.json((0, response_1.ok)({ pong: true, supportedEvents: types_1.SUPPORTED_WEBHOOK_EVENTS, version: "2.0.0" }, { communicableToCustomer: false, verified: true }));
        return;
    }
    if (!types_1.SUPPORTED_WEBHOOK_EVENTS.includes(eventType)) {
        res.json((0, response_1.ok)({ received: true, eventType, processed: false }, { communicableToCustomer: false, verified: false, warnings: [`Evento '${eventType}' não suportado. Suportados: ${types_1.SUPPORTED_WEBHOOK_EVENTS.join(", ")}.`] }));
        return;
    }
    const explicitMsgId = ctx.messageId ?? (body["messageId"] ?? body["message_id"]);
    const dataRef = (body["data"] ?? body["date"] ?? body["ts"]) ?? new Date().toISOString();
    const idempKey = explicitMsgId ?? _b1_buildIdempKey(eventType, ctx.conversationId, ctx.agentId, dataRef);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaWebhookChatvolt" }, async () => {
        const db = admin.firestore();
        const now = Date.now();
        const nowIso = new Date().toISOString();
        const { direcao, tipo } = _b1_mapEvent(eventType);
        const mensagemCliente = (body["mensagemCliente"] ?? body["userMessage"] ?? body["message"] ?? body["text"]);
        const respostaAgente = (body["respostaAgente"] ?? body["agentMessage"] ?? body["response"]);
        const mensagemLog = direcao === "entrada" ? mensagemCliente : respostaAgente;
        const anexos = _b1_extractAnexos(body["anexos"] ?? body["attachments"]);
        const bloqueioInfo = tipo === "bloqueio" ? { motivo: (body["bloqueioMotivo"] ?? body["blockReason"]), tipo: (body["bloqueioTipo"] ?? body["blockType"]), detalhes: body["bloqueioDetalhes"] } : undefined;
        await db.collection("valeria_webhook_events").add({ eventType, conversationId: ctx.conversationId, messageId: explicitMsgId ?? idempKey, agentId: ctx.agentId, organizationId: ctx.organizationId, channel: body["channel"] ?? body["canal"] ?? null, channelPhone: ctx.channelPhone ?? body["channelPhone"] ?? body["phone"] ?? null, mensagemCliente: mensagemCliente ?? null, respostaAgente: respostaAgente ?? null, status: body["status"] ?? null, prioridade: (body["prioridade"] ?? body["priority"]) ?? null, responsavel: (body["responsavel"] ?? body["assignee"]) ?? null, data: dataRef, variaveis: (body["variaveis"] ?? body["variables"]) ?? null, anexosMeta: anexos.length > 0 ? anexos : null, bloqueioInfo: bloqueioInfo ?? null, ts: now, createdAt: nowIso, processado: false });
        await db.collection("valeria_msgs").add({ conversationId: ctx.conversationId, agentId: ctx.agentId, organizationId: ctx.organizationId, messageId: explicitMsgId ?? idempKey, mensagem: mensagemLog ?? `[${eventType}]`, direcao, tipo, origem: "chatvolt", statusProcessamento: "pendente", eventType, anexosMeta: anexos.length > 0 ? anexos : undefined, bloqueioInfo, ts: now, createdAt: nowIso });
        return (0, response_1.ok)({ received: true, eventType, conversationId: ctx.conversationId, messageId: explicitMsgId ?? idempKey, idempotente: !explicitMsgId }, { communicableToCustomer: false, verified: true });
    });
    res.status(result.success ? 200 : 500).json(result);
});
// ── B2: valeriaAtualizarBriefing — helpers ────────────────────────────────────
const _b2_BRIEFING_COL = "valeria_briefings";
const _b2_CAMPOS_ESSENCIAIS = ["produto", "larguraMm", "alturaMm", "quantidade", "material", "acabamento", "prazo", "referencia", "observacoes"];
const _b2_VALORES_GENERICOS = new Set(["", "não informado", "nao informado", "sem informação", "sem informacao", "nenhum", "nenhuma", "n/a", "na", "-", "--", "indefinido", "a definir"]);
function _b2_isValido(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === "string" && _b2_VALORES_GENERICOS.has(v.trim().toLowerCase())) return false;
    if (typeof v === "number" && (isNaN(v) || v <= 0)) return false;
    return true;
}
function _b2_classificar(briefing) {
    const prod = (briefing.produto ?? "").toLowerCase();
    const mat = (briefing.material ?? "").toLowerCase();
    const acab = (briefing.acabamento ?? "").toLowerCase();
    if (!briefing.produto || ["personalizado", "especial", "sob medida", "custom"].some((p) => prod.includes(p))) return "personalizada";
    if (["inox", "mdf", "madeira", "espelho", "vidro", "mika", "poliestireno"].some((m) => mat.includes(m)) || ["dourado", "escovado", "espelhado", "led", "iluminado", "3d"].some((a) => acab.includes(a))) return "semi_personalizada";
    return "catalogo";
}
function _b2_completude(briefing) {
    const faltando = _b2_CAMPOS_ESSENCIAIS.filter((c) => !_b2_isValido(briefing[c]));
    return { completude: Math.round((((_b2_CAMPOS_ESSENCIAIS.length - faltando.length)) / _b2_CAMPOS_ESSENCIAIS.length) * 100), camposFaltando: faltando };
}
exports.valeriaAtualizarBriefing = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaAtualizarBriefing");
    if (!ppl) return;
    const { ctx } = ppl;
    if (req.method !== "POST") { res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST.")); return; }
    const body = req.body;
    const CAMPOS_BRIEFING = ["produto", "familia", "larguraMm", "alturaMm", "quantidade", "material", "acabamento", "prazo", "referencia", "observacoes"];
    if (!CAMPOS_BRIEFING.some((c) => body[c] !== undefined)) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "Nenhum campo de briefing foi informado. Envie pelo menos um dos campos: produto, familia, larguraMm, alturaMm, quantidade, material, acabamento, prazo, referencia, observacoes.", { missingFields: CAMPOS_BRIEFING }));
        return;
    }
    const idempKey = (0, idempotency_1.extractIdempotencyKey)(req);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaAtualizarBriefing" }, async () => {
        const db = admin.firestore();
        const ref = db.collection(_b2_BRIEFING_COL).doc(ctx.conversationId);
        const snap = await ref.get();
        const nowIso = new Date().toISOString();
        const existing = snap.exists ? snap.data() : { conversationId: ctx.conversationId, historico: [] };
        const camposAlterados = [];
        const merge = (campo, valor) => { if (!_b2_isValido(valor) || existing[campo] === valor) return; existing[campo] = valor; camposAlterados.push(campo); };
        merge("produto", body["produto"]); merge("familia", body["familia"]); merge("material", body["material"]);
        merge("acabamento", body["acabamento"]); merge("prazo", body["prazo"]); merge("referencia", body["referencia"]); merge("observacoes", body["observacoes"]);
        const larg = Number(body["larguraMm"]); const alt = Number(body["alturaMm"]); const qtd = Number(body["quantidade"]);
        if (!isNaN(larg) && larg > 0) merge("larguraMm", larg);
        if (!isNaN(alt) && alt > 0) merge("alturaMm", alt);
        if (!isNaN(qtd) && qtd > 0) merge("quantidade", qtd);
        existing.conversationId = ctx.conversationId;
        const { completude, camposFaltando } = _b2_completude(existing);
        existing.completude = completude; existing.camposFaltando = camposFaltando; existing.classificacao = _b2_classificar(existing); existing.updatedAt = nowIso;
        if (camposAlterados.length > 0) existing.historico = [...(existing.historico ?? []), { ts: nowIso, camposAlterados, agentId: ctx.agentId }];
        await ref.set(existing, { merge: true });
        await db.collection("valeria_conversations").doc(ctx.conversationId).set({ briefingId: ctx.conversationId, updatedAt: Date.now() }, { merge: true });
        return (0, response_1.ok)({ briefingId: ctx.conversationId, completude: existing.completude, classificacao: existing.classificacao, camposFaltando: existing.camposFaltando, camposAlterados, briefing: existing }, { communicableToCustomer: false, verified: true, warnings: camposFaltando.length > 0 ? [`Campos ainda faltando: ${camposFaltando.join(", ")}.`] : undefined });
    });
    res.status(result.success ? 200 : 500).json(result);
});
// ── B3: valeriaMudarEtapa + valeriaFechamento — helpers ───────────────────────
const _b3_ETAPAS_VALIDAS = new Set(Object.keys(types_1.CRM_TRANSICOES));
function _b3_validarTransicao(atual, destino) {
    const etapaAtual = (atual?.toUpperCase() ?? "NOVO_LEAD");
    if (!_b3_ETAPAS_VALIDAS.has(etapaAtual)) return null;
    const permitidas = types_1.CRM_TRANSICOES[etapaAtual];
    if (permitidas.length === 0) return `Etapa '${etapaAtual}' é terminal — use valeriaFechamento para reabrir.`;
    if (!permitidas.includes(destino)) return `Transição '${etapaAtual}' → '${destino}' não é permitida. Destinos válidos: [${permitidas.join(", ")}].`;
    return null;
}
function _b3_findLead(leads, conversationId) {
    const idx = leads.findIndex((l) => l.conversationId === conversationId);
    if (idx < 0) return null;
    return { idx, lead: leads[idx] };
}
exports.valeriaMudarEtapa = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaMudarEtapa");
    if (!ppl) return;
    const { ctx } = ppl;
    if (req.method !== "POST") { res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST.")); return; }
    const body = req.body;
    const destino = body["etapa"]?.toUpperCase();
    const responsavel = body["responsavel"];
    const observacao = body["observacao"];
    if (!destino) { res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "Campo 'etapa' é obrigatório.", { missingFields: ["etapa"] })); return; }
    if (!_b3_ETAPAS_VALIDAS.has(destino)) { res.status(400).json((0, response_1.err)("VALIDATION_ERROR", `Etapa '${destino}' não existe. Válidas: [${[..._b3_ETAPAS_VALIDAS].join(", ")}].`)); return; }
    if (destino === "GANHO" || destino === "PERDIDO" || destino === "REABERTO") { res.status(400).json((0, response_1.err)("VALIDATION_ERROR", `Para marcar como ${destino}, use valeriaFechamento (exige evidência ou motivo obrigatório).`)); return; }
    const idempKey = (0, idempotency_1.extractIdempotencyKey)(req);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaMudarEtapa" }, async () => {
        const leads = (await fsRead("valeria_leads")) ?? [];
        const found = _b3_findLead(leads, ctx.conversationId);
        if (!found) return (0, response_1.err)("NOT_FOUND", "Lead não encontrado para esta conversa. Use valeriaCriarOportunidade primeiro.", { communicableToCustomer: false });
        const { idx, lead } = found;
        const etapaAtual = (lead.status ?? "NOVO_LEAD").toUpperCase();
        const errTransicao = _b3_validarTransicao(etapaAtual, destino);
        if (errTransicao) return (0, response_1.err)("INVALID_TRANSITION", errTransicao, { communicableToCustomer: false });
        const now = new Date().toISOString();
        const entry = { ts: now, acao: `etapa: ${etapaAtual} → ${destino}`, agentId: ctx.agentId, detalhe: [responsavel && `responsavel: ${responsavel}`, observacao].filter(Boolean).join("; ") || undefined };
        leads[idx].status = destino;
        if (responsavel) leads[idx].responsavel = responsavel;
        leads[idx].historico = [...(lead.historico ?? []), entry];
        leads[idx].updatedAt = now;
        await fsWrite("valeria_leads", leads);
        return (0, response_1.ok)({ leadId: lead.id, etapaAnterior: etapaAtual, etapaAtual: destino }, { communicableToCustomer: false, verified: true });
    });
    res.status(result.success ? 200 : (result.error?.code === "NOT_FOUND" ? 404 : 422)).json(result);
});
exports.valeriaFechamento = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaFechamento");
    if (!ppl) return;
    const { ctx } = ppl;
    if (req.method !== "POST") { res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST.")); return; }
    const body = req.body;
    const resultado = body["resultado"]?.toLowerCase();
    const motivo = body["motivo"]?.trim();
    const justif = body["justificativa"]?.trim();
    const orcId = body["orcamentoId"];
    if (!resultado || !["ganho", "perda", "reaberto"].includes(resultado)) { res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "Campo 'resultado' é obrigatório e deve ser: ganho | perda | reaberto.", { missingFields: ["resultado"] })); return; }
    if (resultado === "perda" && (!motivo || motivo.length < 3)) { res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "Marcar como PERDIDO exige campo 'motivo' com descrição (mínimo 3 caracteres).", { missingFields: ["motivo"] })); return; }
    if (resultado === "ganho" && !orcId) { res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "Marcar como GANHO exige campo 'orcamentoId' como evidência do orçamento aceito.", { missingFields: ["orcamentoId"] })); return; }
    if (resultado === "reaberto" && (!justif || justif.length < 3)) { res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "Reabrir oportunidade exige campo 'justificativa' (mínimo 3 caracteres).", { missingFields: ["justificativa"] })); return; }
    const idempKey = (0, idempotency_1.extractIdempotencyKey)(req);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaFechamento" }, async () => {
        const leads = (await fsRead("valeria_leads")) ?? [];
        const found = _b3_findLead(leads, ctx.conversationId);
        if (!found) return (0, response_1.err)("NOT_FOUND", "Lead não encontrado para esta conversa. Use valeriaCriarOportunidade primeiro.", { communicableToCustomer: false });
        const { idx, lead } = found;
        const etapaAtual = (lead.status ?? "NOVO_LEAD").toUpperCase();
        const now = new Date().toISOString();
        const ETAPA_DESTINO = { ganho: "GANHO", perda: "PERDIDO", reaberto: "REABERTO" };
        const destino = ETAPA_DESTINO[resultado];
        if (destino !== "REABERTO") {
            const errTrans = _b3_validarTransicao(etapaAtual, destino);
            if (errTrans) return (0, response_1.err)("INVALID_TRANSITION", errTrans, { communicableToCustomer: false });
        }
        else {
            if (!["GANHO", "PERDIDO"].includes(etapaAtual)) return (0, response_1.err)("INVALID_TRANSITION", `Só é possível reabrir um lead GANHO ou PERDIDO. Etapa atual: ${etapaAtual}.`, { communicableToCustomer: false });
        }
        const detalhe = [resultado === "perda" && `motivo: ${motivo}`, resultado === "ganho" && `orcamentoId: ${orcId}`, resultado === "reaberto" && `justificativa: ${justif}`].filter(Boolean).join("; ");
        const entry = { ts: now, acao: `fechamento_${resultado}: ${etapaAtual} → ${destino}`, agentId: ctx.agentId, detalhe: detalhe || undefined };
        leads[idx].status = destino;
        leads[idx].historico = [...(lead.historico ?? []), entry];
        leads[idx].updatedAt = now;
        if (resultado === "ganho" && orcId) leads[idx].orcamentoGanhoId = orcId;
        if (resultado === "perda" && motivo) leads[idx].motivoPerda = motivo;
        if (resultado === "reaberto") { delete leads[idx].motivoPerda; delete leads[idx].orcamentoGanhoId; leads[idx].reaberturaJustificativa = justif; leads[idx].proximaAcao = body["proximaAcao"] ?? "Contato de reabertura"; }
        await fsWrite("valeria_leads", leads);
        if (resultado !== "reaberto") {
            await admin.firestore().collection("valeria_alertas").add({ tipo: `crm_${resultado}`, conversationId: ctx.conversationId, leadId: lead.id, agentId: ctx.agentId, detalhe, ts: Date.now(), createdAt: now, lido: false });
        }
        return (0, response_1.ok)({ leadId: lead.id, resultado, etapaAnterior: etapaAtual, etapaAtual: destino, ...(resultado === "ganho" && { orcamentoId: orcId }), ...(resultado === "perda" && { motivo }), ...(resultado === "reaberto" && { justificativa: justif }) }, { communicableToCustomer: resultado === "ganho", humanValidationRequired: resultado === "ganho", verified: true });
    });
    res.status(result.success ? 200 : (result.error?.code === "NOT_FOUND" ? 404 : 422)).json(result);
});
//# sourceMappingURL=valeria.js.map