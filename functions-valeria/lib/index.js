"use strict";
/**
 * index.ts — Valéria Cloud Functions v2.1.0
 * Gen 1 com Secret Manager (Firebase Secret Manager).
 * NÃO fazer deploy sem autorização explícita.
 *
 * Funções originais (v2.0.0):
 *   valeriaStatus, valeriaGetContexto, valeriaUpsertCliente, valeriaCatalogo,
 *   valeriaCalcularOrcamento, valeriaCriarOrcamento, valeriaCriarOportunidade,
 *   valeriaRegistrarMensagem, valeriaTransferirHumano, valeriaProximaAcao,
 *   valeriaConsultarStatus
 *
 * Novas funções (v2.1.0 — B1–B4):
 *   valeriaWebhookChatvolt  — B1: recebe eventos push do Chatvolt
 *   valeriaAtualizarBriefing — B2: briefing progressivo com merge inteligente
 *   valeriaMudarEtapa        — B3: transição controlada de etapa CRM
 *   valeriaFechamento        — B3: ganho / perda / reabertura com validações
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.valeriaStatus = exports.valeriaConsultarStatus = exports.valeriaProximaAcao = exports.valeriaTransferirHumano = exports.valeriaRegistrarMensagem = exports.valeriaCriarOportunidade = exports.valeriaCriarOrcamento = exports.valeriaCalcularOrcamento = exports.valeriaCatalogo = exports.valeriaUpsertCliente = exports.valeriaGetContexto = exports.valeriaFechamento = exports.valeriaMudarEtapa = exports.valeriaAtualizarBriefing = exports.valeriaWebhookChatvolt = void 0;
// ── Funções originais (v2.0.0) ────────────────────────────────────────────────
var valeria_1 = require("./valeria");
Object.defineProperty(exports, "valeriaGetContexto", { enumerable: true, get: function () { return valeria_1.valeriaGetContexto; } });
Object.defineProperty(exports, "valeriaUpsertCliente", { enumerable: true, get: function () { return valeria_1.valeriaUpsertCliente; } });
Object.defineProperty(exports, "valeriaCatalogo", { enumerable: true, get: function () { return valeria_1.valeriaCatalogo; } });
Object.defineProperty(exports, "valeriaCalcularOrcamento", { enumerable: true, get: function () { return valeria_1.valeriaCalcularOrcamento; } });
Object.defineProperty(exports, "valeriaCriarOrcamento", { enumerable: true, get: function () { return valeria_1.valeriaCriarOrcamento; } });
Object.defineProperty(exports, "valeriaCriarOportunidade", { enumerable: true, get: function () { return valeria_1.valeriaCriarOportunidade; } });
Object.defineProperty(exports, "valeriaRegistrarMensagem", { enumerable: true, get: function () { return valeria_1.valeriaRegistrarMensagem; } });
Object.defineProperty(exports, "valeriaTransferirHumano", { enumerable: true, get: function () { return valeria_1.valeriaTransferirHumano; } });
Object.defineProperty(exports, "valeriaProximaAcao", { enumerable: true, get: function () { return valeria_1.valeriaProximaAcao; } });
Object.defineProperty(exports, "valeriaConsultarStatus", { enumerable: true, get: function () { return valeria_1.valeriaConsultarStatus; } });
Object.defineProperty(exports, "valeriaStatus", { enumerable: true, get: function () { return valeria_1.valeriaStatus; } });
// ── B1: Webhook Chatvolt ──────────────────────────────────────────────────────
Object.defineProperty(exports, "valeriaWebhookChatvolt", { enumerable: true, get: function () { return valeria_1.valeriaWebhookChatvolt; } });
// ── B2: Briefing progressivo ──────────────────────────────────────────────────
Object.defineProperty(exports, "valeriaAtualizarBriefing", { enumerable: true, get: function () { return valeria_1.valeriaAtualizarBriefing; } });
// ── B3: Etapas e Fechamento CRM ───────────────────────────────────────────────
Object.defineProperty(exports, "valeriaMudarEtapa", { enumerable: true, get: function () { return valeria_1.valeriaMudarEtapa; } });
Object.defineProperty(exports, "valeriaFechamento", { enumerable: true, get: function () { return valeria_1.valeriaFechamento; } });
//# sourceMappingURL=index.js.map