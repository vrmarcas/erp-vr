/**
 * index.ts — Entry point das Cloud Functions
 * Exporta todas as functions para o Firebase deploy
 */

import * as admin from "firebase-admin";

// Inicializar Admin SDK (executado uma única vez por instância cold-start)
if (!admin.apps.length) {
  admin.initializeApp();
}

// ── Meta Ads ──────────────────────────────────────────────────────────────────
export { getMetaAuthUrl, handleMetaCallback } from "./metaAds";

// ── Google Ads ────────────────────────────────────────────────────────────────
export { getGoogleAuthUrl, handleGoogleCallback } from "./googleAds";

// ── Sync automático + Manual ──────────────────────────────────────────────────
export { syncMarketingMetricsData, forceMarketingSync } from "./syncMetrics";

// ── Admin User Management (FASE 5) ───────────────────────────────────────────
export {
  adminCreateUser,
  adminUpdateUserRole,
  adminToggleStatus,
  adminResendInvite,
  adminRevokeSessions,
  adminListUsers,
} from "./adminUsers";

// ── Compras (documento-por-registro, transições críticas mediadas) ───────────
export {
  comprasCriarSolicitacao,
  comprasAprovar,
  comprasRegistrarRecebimento,
  comprasAdicionarDocumento,
  comprasRegistrarPagamento,
  comprasCancelar,
} from "./compras";

// ── Produção (fronteira server-side de autorização de estoque) ──────────────
export { producaoIniciarOuEditar } from "./producao";

// ── Estoque (fronteira server-side para o restante da superfície de
//    escrita de stock/retalhos/erp_stock_log — auditoria Fase F, FASE 2-8) ──
export {
  estoqueRegistrarEntrada,
  estoqueRegistrarSaidaManual,
  estoqueConsumoAutoOrcamento,
  estoqueCriarOuEditarItem,
  estoqueExcluirItem,
  estoqueRestaurarItem,
  estoqueExcluirItemDefinitivo,
  estoqueLimparHistorico,
  estoqueCriarRetalho,
  estoqueEditarRetalho,
  estoqueConsumirRetalho,
  estoqueExcluirRetalho,
} from "./estoque";

// ── Catálogo Vitre + Orçamento de Catálogo (Fase G, 2026-08-06) ─────────────
export {
  vitreImportarProdutos,
  vitreCriarOuEditarProduto,
  vitreAtivarDesativarProduto,
  vitreDuplicarProduto,
  vitreCriarOrcamento,
  vitreAtualizarOrcamento,
} from "./vitre";

// ── Valéria (Chatvolt chatbot) ────────────────────────────────────────────────
export {
  valeriaGetCliente,
  valeriaUpsertCliente,
  valeriaCatalogo,
  valeriaCriarOrcamento,
  valeriaCriarOportunidade,
  valeriaRegistrarMensagem,
  valeriaTransferirHumano,
  valeriaProximaAcao,
  valeriaConsultarOS,
  valeriaStatus,
} from "./valeria";

// ── Valéria × Catálogo Vitre (Fase G, Parte C, 2026-08-06) — PREPARAÇÃO
//    apenas: nenhum destes endpoints foi configurado no Chatvolt ou
//    conectado a um agente real nesta rodada. Ver relatório final. ──────
export {
  valeriaVitreBuscarCatalogo,
  valeriaVitreConsultarProduto,
  valeriaVitreSimularOrcamento,
  valeriaVitreCriarRascunho,
  valeriaVitreEncaminharVR,
} from "./valeria_vitre";
