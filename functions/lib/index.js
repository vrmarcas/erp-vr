"use strict";
/**
 * index.ts — Entry point das Cloud Functions
 * Exporta todas as functions para o Firebase deploy
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
exports.valeriaStatus = exports.valeriaConsultarOS = exports.valeriaProximaAcao = exports.valeriaTransferirHumano = exports.valeriaRegistrarMensagem = exports.valeriaCriarOportunidade = exports.valeriaCriarOrcamento = exports.valeriaCatalogo = exports.valeriaUpsertCliente = exports.valeriaGetCliente = exports.forceMarketingSync = exports.syncMarketingMetricsData = exports.handleGoogleCallback = exports.getGoogleAuthUrl = exports.handleMetaCallback = exports.getMetaAuthUrl = void 0;
const admin = __importStar(require("firebase-admin"));
// Inicializar Admin SDK (executado uma única vez por instância cold-start)
if (!admin.apps.length) {
    admin.initializeApp();
}
// ── Meta Ads ──────────────────────────────────────────────────────────────────
var metaAds_1 = require("./metaAds");
Object.defineProperty(exports, "getMetaAuthUrl", { enumerable: true, get: function () { return metaAds_1.getMetaAuthUrl; } });
Object.defineProperty(exports, "handleMetaCallback", { enumerable: true, get: function () { return metaAds_1.handleMetaCallback; } });
// ── Google Ads ────────────────────────────────────────────────────────────────
var googleAds_1 = require("./googleAds");
Object.defineProperty(exports, "getGoogleAuthUrl", { enumerable: true, get: function () { return googleAds_1.getGoogleAuthUrl; } });
Object.defineProperty(exports, "handleGoogleCallback", { enumerable: true, get: function () { return googleAds_1.handleGoogleCallback; } });
// ── Sync automático + Manual ──────────────────────────────────────────────────
var syncMetrics_1 = require("./syncMetrics");
Object.defineProperty(exports, "syncMarketingMetricsData", { enumerable: true, get: function () { return syncMetrics_1.syncMarketingMetricsData; } });
Object.defineProperty(exports, "forceMarketingSync", { enumerable: true, get: function () { return syncMetrics_1.forceMarketingSync; } });
// ── Valéria (Chatvolt chatbot) ────────────────────────────────────────────────
var valeria_1 = require("./valeria");
Object.defineProperty(exports, "valeriaGetCliente", { enumerable: true, get: function () { return valeria_1.valeriaGetCliente; } });
Object.defineProperty(exports, "valeriaUpsertCliente", { enumerable: true, get: function () { return valeria_1.valeriaUpsertCliente; } });
Object.defineProperty(exports, "valeriaCatalogo", { enumerable: true, get: function () { return valeria_1.valeriaCatalogo; } });
Object.defineProperty(exports, "valeriaCriarOrcamento", { enumerable: true, get: function () { return valeria_1.valeriaCriarOrcamento; } });
Object.defineProperty(exports, "valeriaCriarOportunidade", { enumerable: true, get: function () { return valeria_1.valeriaCriarOportunidade; } });
Object.defineProperty(exports, "valeriaRegistrarMensagem", { enumerable: true, get: function () { return valeria_1.valeriaRegistrarMensagem; } });
Object.defineProperty(exports, "valeriaTransferirHumano", { enumerable: true, get: function () { return valeria_1.valeriaTransferirHumano; } });
Object.defineProperty(exports, "valeriaProximaAcao", { enumerable: true, get: function () { return valeria_1.valeriaProximaAcao; } });
Object.defineProperty(exports, "valeriaConsultarOS", { enumerable: true, get: function () { return valeria_1.valeriaConsultarOS; } });
Object.defineProperty(exports, "valeriaStatus", { enumerable: true, get: function () { return valeria_1.valeriaStatus; } });
//# sourceMappingURL=index.js.map