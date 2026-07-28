"use strict";
/**
 * briefing.ts — valeriaAtualizarBriefing (B2)
 *
 * Atualização parcial progressiva do briefing de demanda.
 *
 * Regras de merge:
 *  - Só atualiza campos explicitamente presentes no payload
 *  - NUNCA sobrescreve dado válido com: null, undefined, "", string genérica
 *    ("não informado", "sem informação", "nenhum", "n/a", "na", "-")
 *  - Mantém histórico de cada alteração com ts + camposAlterados + agentId
 *  - Calcula % de completude (0–100) dos campos essenciais
 *  - Classifica a demanda: catálogo / semi_personalizada / personalizada
 *  - Informa quais campos ainda estão faltando
 *
 * Persistência: Firestore "valeria_briefings/{conversationId}"
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
exports.valeriaAtualizarBriefing = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const pipeline_1 = require("./pipeline");
const idempotency_1 = require("./idempotency");
const response_1 = require("./response");
const SECRET_NAMES = ["VALERIA_BEARER_SECRET", "VALERIA_BEARER_SECRET_PREV"];
const RUN_OPTS = functions.runWith({
    secrets: SECRET_NAMES,
    timeoutSeconds: 30,
    memory: "256MB",
});
const BRIEFING_COL = "valeria_briefings";
// Campos essenciais para cálculo de completude
const CAMPOS_ESSENCIAIS = [
    "produto",
    "larguraMm",
    "alturaMm",
    "quantidade",
    "material",
    "acabamento",
    "prazo",
    "referencia",
    "observacoes",
];
// Strings que representam "ausência de informação" — não sobrescrever com elas
const VALORES_GENERICOS = new Set([
    "",
    "não informado",
    "nao informado",
    "sem informação",
    "sem informacao",
    "nenhum",
    "nenhuma",
    "n/a",
    "na",
    "-",
    "--",
    "indefinido",
    "a definir",
]);
function isValorValido(v) {
    if (v === null || v === undefined)
        return false;
    if (typeof v === "string" && VALORES_GENERICOS.has(v.trim().toLowerCase()))
        return false;
    if (typeof v === "number" && (isNaN(v) || v <= 0))
        return false;
    return true;
}
function classificarDemanda(briefing) {
    const prod = (briefing.produto ?? "").toLowerCase();
    const mat = (briefing.material ?? "").toLowerCase();
    const acab = (briefing.acabamento ?? "").toLowerCase();
    // Personalizada: sem produto definido OU produto claramente custom
    const produtosCustom = ["personalizado", "especial", "sob medida", "custom"];
    if (!briefing.produto || produtosCustom.some((p) => prod.includes(p))) {
        return "personalizada";
    }
    // Semi-personalizada: produto catalogo com material ou acabamento especial
    const matsEspeciais = ["inox", "mdf", "madeira", "espelho", "vidro", "mika", "poliestireno"];
    const acabEspeciais = ["dourado", "escovado", "espelhado", "led", "iluminado", "3d"];
    if (matsEspeciais.some((m) => mat.includes(m)) ||
        acabEspeciais.some((a) => acab.includes(a))) {
        return "semi_personalizada";
    }
    return "catalogo";
}
function calcularCompletude(briefing) {
    const preenchidos = [];
    const faltando = [];
    for (const campo of CAMPOS_ESSENCIAIS) {
        if (isValorValido(briefing[campo])) {
            preenchidos.push(campo);
        }
        else {
            faltando.push(campo);
        }
    }
    const completude = Math.round((preenchidos.length / CAMPOS_ESSENCIAIS.length) * 100);
    return { completude, camposFaltando: faltando };
}
// ── Handler ───────────────────────────────────────────────────────────────────
exports.valeriaAtualizarBriefing = RUN_OPTS.https.onRequest(async (req, res) => {
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaAtualizarBriefing");
    if (!ppl)
        return;
    const { ctx } = ppl;
    if (req.method !== "POST") {
        res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST."));
        return;
    }
    const body = req.body;
    // Pelo menos 1 campo de briefing deve ser enviado
    const CAMPOS_BRIEFING = [
        "produto", "familia", "larguraMm", "alturaMm", "quantidade",
        "material", "acabamento", "prazo", "referencia", "observacoes",
    ];
    const algumCampo = CAMPOS_BRIEFING.some((c) => body[c] !== undefined);
    if (!algumCampo) {
        res.status(400).json((0, response_1.err)("VALIDATION_ERROR", "Nenhum campo de briefing foi informado. Envie pelo menos um dos campos: produto, familia, larguraMm, alturaMm, quantidade, material, acabamento, prazo, referencia, observacoes.", { missingFields: CAMPOS_BRIEFING }));
        return;
    }
    const idempKey = (0, idempotency_1.extractIdempotencyKey)(req);
    const result = await (0, idempotency_1.withIdempotency)({ idempotencyKey: idempKey, conversationId: ctx.conversationId, functionName: "valeriaAtualizarBriefing" }, async () => {
        const db = admin.firestore();
        const ref = db.collection(BRIEFING_COL).doc(ctx.conversationId);
        const snap = await ref.get();
        const nowIso = new Date().toISOString();
        const existing = snap.exists
            ? snap.data()
            : {
                conversationId: ctx.conversationId,
                historico: [],
            };
        // Merge inteligente: só aplica campos válidos presentes no payload
        const camposAlterados = [];
        const mergeField = (campo, valor) => {
            if (!isValorValido(valor))
                return; // ignora vazio/genérico
            const anterior = existing[campo];
            if (anterior === valor)
                return; // sem mudança real
            existing[campo] = valor;
            camposAlterados.push(campo);
        };
        // Campos string
        mergeField("produto", body["produto"]);
        mergeField("familia", body["familia"]);
        mergeField("material", body["material"]);
        mergeField("acabamento", body["acabamento"]);
        mergeField("prazo", body["prazo"]);
        mergeField("referencia", body["referencia"]);
        mergeField("observacoes", body["observacoes"]);
        // Campos numéricos (validação extra: > 0)
        const largura = Number(body["larguraMm"]);
        const altura = Number(body["alturaMm"]);
        const qtd = Number(body["quantidade"]);
        if (!isNaN(largura) && largura > 0)
            mergeField("larguraMm", largura);
        if (!isNaN(altura) && altura > 0)
            mergeField("alturaMm", altura);
        if (!isNaN(qtd) && qtd > 0)
            mergeField("quantidade", qtd);
        // Vínculo (sempre atualiza se vieram)
        if (ctx.conversationId)
            existing.conversationId = ctx.conversationId;
        // Recalcular completude e classificação
        const { completude, camposFaltando } = calcularCompletude(existing);
        existing.completude = completude;
        existing.camposFaltando = camposFaltando;
        existing.classificacao = classificarDemanda(existing);
        existing.updatedAt = nowIso;
        // Histórico (append-only)
        if (camposAlterados.length > 0) {
            const entry = {
                ts: nowIso,
                camposAlterados,
                agentId: ctx.agentId,
            };
            existing.historico = [...(existing.historico ?? []), entry];
        }
        // Persiste
        await ref.set(existing, { merge: true });
        // Vincula ao valeria_conversations
        await db.collection("valeria_conversations")
            .doc(ctx.conversationId)
            .set({ briefingId: ctx.conversationId, updatedAt: Date.now() }, { merge: true });
        return (0, response_1.ok)({
            briefingId: ctx.conversationId,
            completude: existing.completude,
            classificacao: existing.classificacao,
            camposFaltando: existing.camposFaltando,
            camposAlterados,
            briefing: existing,
        }, {
            communicableToCustomer: false,
            verified: true,
            warnings: camposFaltando.length > 0
                ? [`Campos ainda faltando: ${camposFaltando.join(", ")}.`]
                : undefined,
        });
    });
    res.status(result.success ? 200 : 500).json(result);
});
//# sourceMappingURL=briefing.js.map