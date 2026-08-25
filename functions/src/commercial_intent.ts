/**
 * commercial_intent.ts — detector determinístico de confirmação comercial
 * (sprint P0.7).
 *
 * ESPELHA functions-valeria/src/confirmation_detector.ts — mesma lógica,
 * duplicada aqui porque functions/ e functions-valeria/ são codebases de
 * deploy independentes (sem workspace/import cross-package). O módulo
 * canônico, testado (Jest), fica em functions-valeria; qualquer mudança
 * na classificação de texto deve ser replicada aqui manualmente. Se um
 * dia isso doer o suficiente, vale a pena investir num pacote npm
 * compartilhado — não fizemos isso agora para não arriscar o pipeline de
 * deploy de nenhum dos dois codebases.
 *
 * Achado real de E2E (sprint P0.6): o backend calculou e apresentou o
 * preço corretamente, mas quando o cliente respondeu "sim, confirmo" o
 * LLM nunca chamou a Tool que sinalizaria a confirmação — mesmo com o
 * parâmetro documentado. Este módulo é chamado ANTES de enviar a
 * mensagem ao Chatvolt (ver atdSimularMensagemCliente) — a confirmação é
 * detectada e persistida server-side, sem depender de nenhum Tool call.
 */

export interface CommercialIntentInput {
  texto: string;
  awaitingConfirmation: boolean;
}

export interface CommercialIntentResult {
  confirmQuote: boolean;
  rejectQuote: boolean;
  ambiguous: boolean;
  confidenceReason: string;
}

function normalize(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const REJECT_PATTERNS: RegExp[] = [
  /\bvou pensar\b/,
  /\bme manda depois\b/,
  /\bmanda depois\b/,
  /\bmais tarde\b/,
  /\bachei caro\b/,
  /\b(esta|tem|algum)\s+desconto\b/,
  /\bdesconto\b/,
  /\bpreciso mudar\b/,
];

const DATA_CHANGE_PATTERNS: RegExp[] = [
  /\bmuda(r)?\s+(a\s+)?(para|quantidade)\b/,
  /\btroca(r)?\s+para\b/,
  /\bfaz(er)?\s+\d+\s+unidades?\b/,
  /\baumenta(r)?\s+(a\s+)?quantidade\b/,
  /\bdiminui(r)?\s+(a\s+)?quantidade\b/,
  /\bmudar\s+(a\s+)?quantidade\b/,
];

const STRONG_CONFIRM_PATTERNS: RegExp[] = [
  /\bconfirmo\b/,
  /\bpode fechar\b/,
  /\bpode gerar\b/,
  /\bpode fazer\b/,
  /\bpode emitir\b/,
  /\bpode seguir\b/,
  /\bvamos fechar\b/,
  /\bfechado\b/,
  /\bquero fechar\b/,
  /\best[ae]\s+aprovado\b/,
  /\baprovado\b/,
];

const BARE_YES_PATTERN = /^(sim|s|ss|yes|ok|okay|beleza|blz|show|de acordo|fechado)[.!]?$/;

export function detectCommercialIntent(input: CommercialIntentInput): CommercialIntentResult {
  const { texto, awaitingConfirmation } = input;
  const norm = normalize(texto);

  if (!awaitingConfirmation) {
    return { confirmQuote: false, rejectQuote: false, ambiguous: false, confidenceReason: "NO_QUOTE_AWAITING_CONFIRMATION" };
  }

  for (const pattern of REJECT_PATTERNS) {
    if (pattern.test(norm)) {
      return { confirmQuote: false, rejectQuote: true, ambiguous: false, confidenceReason: `REJECT_MATCH:${pattern.source}` };
    }
  }

  for (const pattern of DATA_CHANGE_PATTERNS) {
    if (pattern.test(norm)) {
      return { confirmQuote: false, rejectQuote: false, ambiguous: true, confidenceReason: `DATA_CHANGE_DETECTED:${pattern.source}` };
    }
  }

  for (const pattern of STRONG_CONFIRM_PATTERNS) {
    if (pattern.test(norm)) {
      return { confirmQuote: true, rejectQuote: false, ambiguous: false, confidenceReason: `CONFIRM_MATCH:${pattern.source}` };
    }
  }

  if (BARE_YES_PATTERN.test(norm)) {
    return { confirmQuote: true, rejectQuote: false, ambiguous: false, confidenceReason: "BARE_YES" };
  }

  if (/^sim\b/.test(norm)) {
    return { confirmQuote: false, rejectQuote: false, ambiguous: true, confidenceReason: "SIM_WITH_UNRELATED_CONTENT" };
  }

  return { confirmQuote: false, rejectQuote: false, ambiguous: true, confidenceReason: "NO_MATCH" };
}
