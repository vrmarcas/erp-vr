"use strict";
/**
 * types.ts — Interfaces e tipos compartilhados da integração Valéria
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRM_TRANSICOES = exports.SUPPORTED_WEBHOOK_EVENTS = void 0;
exports.SUPPORTED_WEBHOOK_EVENTS = [
    "USER_MESSAGE_RECEIVED",
    "AGENT_USER_MESSAGE",
    "AGENT_MESSAGE_SENDED",
    "AGENT_MESSAGE_FOLLOW_UP",
    "AGENT_MESSAGE_BLOCKED",
    "AGENT_MESSAGE_NOTED",
];
// Transições válidas entre etapas
exports.CRM_TRANSICOES = {
    NOVO_LEAD: ["CONTATO_FEITO", "PERDIDO"],
    CONTATO_FEITO: ["BRIEFING_COLETADO", "PERDIDO"],
    BRIEFING_COLETADO: ["ORCAMENTO_ENVIADO", "PERDIDO"],
    ORCAMENTO_ENVIADO: ["NEGOCIACAO", "GANHO", "PERDIDO"],
    NEGOCIACAO: ["GANHO", "PERDIDO"],
    GANHO: [],
    PERDIDO: ["REABERTO"],
    REABERTO: ["CONTATO_FEITO", "BRIEFING_COLETADO", "ORCAMENTO_ENVIADO"],
};
//# sourceMappingURL=types.js.map