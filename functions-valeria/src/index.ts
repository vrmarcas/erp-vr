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
 *
 * ValerIA 2.0 — Fase E (2026-09-19, homologação controlada):
 *   valeriaGetCatalog                 — catálogo comercial por categoria (catalog_tools.ts)
 *   valeriaUpdateCatalogQualification — qualificação catalog-first + transições determinísticas
 *   Ambas gated por valeriaV2EnabledForPhone (feature_flags.ts) — nenhuma
 *   lógica V2 roda fora de erp_config.valeriaV2Enabled===true E
 *   valeria_test_phone_numbers, mesmo com catalog.ativo=true. O agente V2
 *   no Chatvolt usa exatamente 4 Tools: valeriaGetContexto (já exportada
 *   acima, reuso do V1), valeriaGetCatalog, valeriaUpdateCatalogQualification,
 *   valeriaTransferirHumano (já exportada acima, reuso do V1) — nenhuma
 *   Tool de pagamento/produção/fechamento/desconto é registrada no agente V2.
 */

// ── Funções originais (v2.0.0) ────────────────────────────────────────────────
export {
  valeriaGetContexto,
  valeriaUpsertCliente,
  valeriaCatalogo,
  valeriaListarMateriais,
  valeriaAtualizarBriefingTecnico,
  valeriaPrepararProdutoPersonalizado,
  valeriaCalcularProdutoPersonalizado,
  valeriaConsultarPrazoProducao,
  valeriaVerificarEncaixeProducao,
  valeriaCalcularOrcamento,
  valeriaCriarOrcamento,
  valeriaCriarOportunidade,
  valeriaRegistrarMensagem,
  valeriaTransferirHumano,
  valeriaProximaAcao,
  valeriaConsultarStatus,
  valeriaStatus,
} from "./valeria";

// ── B1: Webhook Chatvolt ──────────────────────────────────────────────────────
export { valeriaWebhookChatvolt } from "./webhook";

// ── B2: Briefing progressivo ──────────────────────────────────────────────────
export { valeriaAtualizarBriefing } from "./briefing";

// ── B3: Etapas e Fechamento CRM ───────────────────────────────────────────────
export { valeriaMudarEtapa, valeriaFechamento } from "./crm_etapas";

// ── Fase E: Tools de catálogo ValerIA 2.0 (gated por feature flag + allowlist) ─
export { valeriaGetCatalog, valeriaUpdateCatalogQualification } from "./catalog_tools";
