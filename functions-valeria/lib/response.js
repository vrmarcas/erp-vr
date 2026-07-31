"use strict";
/**
 * response.ts — Construtor de respostas padronizadas
 * Nunca expõe stack trace, secrets, custos internos, margens ou fórmulas.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUOTE_RESPONSES = exports.API_SOURCE = exports.API_VERSION = void 0;
exports.ok = ok;
exports.err = err;
const crypto_1 = require("crypto");
exports.API_VERSION = "2.0.0";
exports.API_SOURCE = "valeria-api";
function buildMeta() {
    return {
        requestId: (0, crypto_1.randomUUID)(),
        source: exports.API_SOURCE,
        apiVersion: exports.API_VERSION,
        timestamp: new Date().toISOString(),
    };
}
function ok(data, opts = {}) {
    return {
        success: true,
        data,
        meta: { ...buildMeta(), ...opts.meta },
        verified: opts.verified ?? true,
        communicableToCustomer: opts.communicableToCustomer ?? false,
        humanValidationRequired: opts.humanValidationRequired ?? false,
        warnings: opts.warnings,
    };
}
function err(code, message, opts = {}) {
    const error = { code, message };
    if (opts.details)
        error.details = opts.details;
    return {
        success: false,
        error,
        meta: buildMeta(),
        verified: false,
        communicableToCustomer: opts.communicableToCustomer ?? false,
        humanValidationRequired: opts.humanValidationRequired ?? false,
        missingFields: opts.missingFields,
        warnings: opts.warnings,
    };
}
// Respostas padronizadas de elegibilidade de orçamento
exports.QUOTE_RESPONSES = {
    needsInformation: (missingFields) => err("NEEDS_INFORMATION", "Dados insuficientes para calcular o orçamento.", {
        communicableToCustomer: true,
        missingFields,
    }),
    humanValidationRequired: (reason) => err("HUMAN_VALIDATION_REQUIRED", reason, {
        communicableToCustomer: true,
        humanValidationRequired: true,
    }),
    unsupported: (productType) => err("UNSUPPORTED", `O produto "${productType}" não pode ser calculado automaticamente.`, { communicableToCustomer: true, humanValidationRequired: true }),
    temporarilyUnavailable: () => err("TEMPORARILY_UNAVAILABLE", "Motor de orçamento temporariamente indisponível.", {
        communicableToCustomer: true,
    }),
};
//# sourceMappingURL=response.js.map