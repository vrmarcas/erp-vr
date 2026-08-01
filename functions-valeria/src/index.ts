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

// ── Funções originais (v2.0.0) ────────────────────────────────────────────────
export {
  valeriaGetContexto,
  valeriaUpsertCliente,
  valeriaCatalogo,
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
