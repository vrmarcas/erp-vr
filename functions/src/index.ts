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
  vitreConverterOrcamentoParaOS,
  vitreIniciarNovaVersao,
  vitreRegistrarAprovacaoCliente,
  vitreConfirmarVenda,
  vitreClassificarItensPedidoUnificado,
} from "./vitre";

// ── Valéria (Chatvolt chatbot) ────────────────────────────────────────────────
// Fase 0/1 Valéria×ChatVolt (2026-08-09): das 10 Functions v1 deste módulo,
// 8 foram SUPERSEDIDAS em produção pelas versões v2 do codebase "valeria"
// (functions-valeria/, nodejs22 — auth Secret Manager timing-safe, allowlist
// fail-closed, idempotência, rate limit). Exportá-las aqui de novo faria um
// `firebase deploy` do codebase default COLIDIR com as funções do outro
// codebase. Ficam só as 2 que o default ainda possui de fato em produção
// (nodejs20). Não reintroduzir as demais — evoluções vão em
// functions-valeria/.
export {
  valeriaGetCliente,
  valeriaConsultarOS,
} from "./valeria";

// ── Valéria × Catálogo Vitre (Fase G, Parte C, 2026-08-06; conectadas ao
//    agente Valéria como HTTP Tools em 2026-08-21/22, sprint Atendimentos).
//    Auth via erp_vr/valeria_config.secret (Firestore) — checkAuth() em
//    valeria.ts. Redeployadas em 2026-08-22 sem binding de Secret Manager
//    (uma revisão órfã anterior estava presa em VALERIA_BEARER_SECRET@2,
//    quebrada quando esse secret foi rotacionado por incidente de
//    exposição — ver commit da rotação). ──────
export {
  valeriaVitreBuscarCatalogo,
  valeriaVitreConsultarProduto,
  valeriaVitreSimularOrcamento,
  valeriaVitreCriarRascunho,
  valeriaVitreEncaminharVR,
  // RODADA 9, FECHAMENTO (2026-08-23) — achado real: já registradas como
  // Tools no agente e documentadas no prompt ativo (V0.3), mas as Cloud
  // Functions nunca existiam (404 em produção). Implementadas agora.
  valeriaVitreAtualizarRascunho,
  valeriaVitreConsultarRascunho,
} from "./valeria_vitre";

// ── Admin ops (Rodada 3.1, 2026-08-08) — caminho administrativo temporário
//    e auditável para aplicar o seed de contas bancárias e o histórico
//    2018-2026 em produção sem GOOGLE_APPLICATION_CREDENTIALS local. Ver
//    admin_ops.ts para o racional completo. Remover após o uso desta rodada. ──
export { adminOneTimeOps } from "./admin_ops";

// ── Atendimentos (sprint 2026-08-21) — Inbox ERP × Valéria/Chatvolt.
//    ChatVolt é só um provider substituível (ai_provider.ts/chatvolt_provider.ts);
//    dados canônicos ficam em atendimentos/{id} + atendimentos/{id}/mensagens.
export {
  atdCriarConversaTeste,
  atdSimularMensagemCliente,
  atdRetentarMensagem,
  atdEnviarMensagemHumano,
  atdAssumirAtendimento,
  atdDevolverParaValeria,
  atdResolverAtendimento,
  atdLimparConversaTeste,
  // RODADA 9, Fechamento (2026-08-23) — Bloqueador 2: liga atendimento →
  // cliente/oportunidade/orçamento persistindo os IDs de volta (writes
  // diretos do client já são bloqueados pela Rule de atendimentos, de
  // propósito) + fecha o handoff (status='aguardando_humano').
  atdVincularCliente,
  atdVincularOportunidade,
  atdVincularOrcamento,
  atdSolicitarHumano,
  // Rodada curta pós-9 (fechamento do handoff automático) — Tool HTTP que a
  // própria ValerIA chama (Bearer auth), reaproveitando o mesmo núcleo de
  // atdSolicitarHumano acima.
  atdSolicitarHumanoValeria,
} from "./atendimentos";
