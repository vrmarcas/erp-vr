/**
 * handoff_detector.ts — decisão determinística de handoff humano (P1.0).
 *
 * Achado real de auditoria: orchestrator.ts já tem NextCommercialAction=
 * "handoff" e HandoffReasonCode, mas NADA no sistema populava
 * handoffReasonCode — o parâmetro nunca era passado por nenhum chamador.
 * Na prática, handoff só acontecia se o LLM decidisse sozinho chamar
 * transferir_humano/encaminhar_para_vr_personalizado — exatamente o
 * padrão que este projeto inteiro existe para eliminar.
 *
 * Função PURA: classifica o texto do cliente + sinais já calculados
 * (pricing HUMAN_VALIDATION_REQUIRED, rejeição/negociação do confirmation
 * detector) — nunca decide sozinha "isso é complexo demais", só reconhece
 * padrões explícitos e sinais que o próprio backend já computou.
 */

export type HumanReason =
  | "CUSTOMER_REQUEST"
  | "CUSTOM_COMPLEX"
  | "PRICING_UNSUPPORTED"
  | "NEGOTIATION"
  | "DISCOUNT_REQUEST"
  | "COMPLAINT"
  | "PAYMENT_ISSUE"
  | "SYSTEM_ERROR"
  | "OTHER";

export type Priority = "NORMAL" | "HIGH" | "URGENT";

export interface HandoffResult {
  requiresHuman: boolean;
  humanReason: HumanReason | null;
  priority: Priority;
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Pedido explícito de humano — sempre o motivo mais forte, nunca tenta
// convencer o cliente a continuar com a IA.
const CUSTOMER_REQUEST_PATTERNS: RegExp[] = [
  /\bfalar com (um[a]?|uma) (pessoa|atendente|humano|alguem)\b/,
  /\bquero (um[a]?|uma) (pessoa|atendente|humano)\b/,
  /\bpreciso falar com alguem\b/,
  /\batendimento humano\b/,
  /\bnao quero falar com (robo|ia|bot|assistente)\b/,
  /\bposso falar com alguem\b/,
];

// Reclamação — HIGH, tom de insatisfação real.
const COMPLAINT_PATTERNS: RegExp[] = [
  /\breclama(cao|r)\b/,
  /\bpessimo atendimento\b/,
  /\bmuito insatisfeit[oa]\b/,
  /\bnao (funcionou|chegou|recebi)\b/,
  /\bveio (errado|quebrado|com defeito)\b/,
  /\bquero (meu dinheiro de volta|cancelar (o|meu) pedido)\b/,
];

// Pagamento — sempre humano (nunca a IA decide sobre pagamento).
const PAYMENT_PATTERNS: RegExp[] = [
  /\bpix\b.*\b(nao (caiu|confirmou)|problema)\b/,
  /\bproblema (com|no) pagamento\b/,
  /\bboleto\b/,
  /\bcart[aã]o (recusado|negado)\b/,
  /\breembolso\b/,
];

// Negociação/desconto — mesmo espírito de REJECT_PATTERNS do
// confirmation_detector, mas aqui vira sinal de handoff (não só "não
// confirma") quando o cliente insiste em condição comercial especial.
const DISCOUNT_PATTERNS: RegExp[] = [
  /\bdesconto\b/,
  /\bmais barato\b/,
  /\bcondi[cç][aã]o especial\b/,
  /\bnegociar\b/,
  /\bfechar por menos\b/,
];

export function detectHumanHandoff(input: {
  texto: string;
  /** true quando o motor de preço bloqueou por item sem fonte canônica (Bloco C). */
  pricingUnsupported?: boolean;
  /** true quando o produto não corresponde a receita conhecida nem a Troféu GoJovem. */
  produtoComplexoSemReceita?: boolean;
  /** true quando uma ação server-side falhou de forma persistente (após retry). */
  erroSistemaReal?: boolean;
}): HandoffResult {
  const norm = normalize(input.texto);

  if (input.erroSistemaReal) {
    return { requiresHuman: true, humanReason: "SYSTEM_ERROR", priority: "HIGH" };
  }

  for (const p of CUSTOMER_REQUEST_PATTERNS) {
    if (p.test(norm)) return { requiresHuman: true, humanReason: "CUSTOMER_REQUEST", priority: "HIGH" };
  }
  // Pagamento antes de reclamação genérica: "boleto não chegou" é mais
  // específico e acionável como PAYMENT_ISSUE do que COMPLAINT genérico.
  for (const p of PAYMENT_PATTERNS) {
    if (p.test(norm)) return { requiresHuman: true, humanReason: "PAYMENT_ISSUE", priority: "HIGH" };
  }
  for (const p of COMPLAINT_PATTERNS) {
    if (p.test(norm)) return { requiresHuman: true, humanReason: "COMPLAINT", priority: "HIGH" };
  }
  if (input.pricingUnsupported) {
    return { requiresHuman: true, humanReason: "PRICING_UNSUPPORTED", priority: "NORMAL" };
  }
  if (input.produtoComplexoSemReceita) {
    return { requiresHuman: true, humanReason: "CUSTOM_COMPLEX", priority: "NORMAL" };
  }
  for (const p of DISCOUNT_PATTERNS) {
    if (p.test(norm)) return { requiresHuman: true, humanReason: "DISCOUNT_REQUEST", priority: "NORMAL" };
  }

  return { requiresHuman: false, humanReason: null, priority: "NORMAL" };
}
