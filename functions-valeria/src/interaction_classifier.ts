/**
 * interaction_classifier.ts — ValerIA 2.0, Fase E.2.7 (PoC shadow, 2026-09-20).
 *
 * Classificador determinístico EXPLORATORY × COMMERCIAL_INTENT × AMBIGUOUS,
 * puro (sem I/O, sem chamada de LLM), pensado para rodar ANTES de qualquer
 * qualificação/Tool ser considerada — decisão de código, não de prompt.
 *
 * Não usa correspondência de palavra-chave isolada (ex.: "caixa" sozinha
 * não decide nada) — usa padrões estruturais de intenção comunicativa:
 * pergunta genérica sobre capacidade/política da empresa (interrogativa
 * com "vocês"/"qual"/"que"/"como") vs. pedido em primeira pessoa com verbo
 * de desejo/posse ligado a um objeto concreto (quantidade, dimensão, prazo
 * amarrado). Ambíguo nunca vira comercial por padrão — é seu próprio modo.
 *
 * `HUMAN` e `SYSTEM_IGNORE` NÃO são decididos aqui — são gates de pipeline
 * anteriores a esta função (estado do atendimento / origem da mensagem),
 * ver shadow_pipeline.ts.
 */

export type IntentClassification = "EXPLORATORY" | "COMMERCIAL_INTENT" | "AMBIGUOUS";

export interface ClassificationResult {
  classification: IntentClassification;
  reasonCode: string;
  matchedRule: string | null;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

const GREETING_ONLY = /^(oi|ol[aá]|bom dia|boa tarde|boa noite|e a[ií]|opa)[\s,!.]*(bom dia|boa tarde|boa noite)?[\s,!.]*$/i;

// Padrões fortes de intenção comercial (pedido concreto em 1ª pessoa).
const COMMERCIAL_PATTERNS: Array<{ re: RegExp; reasonCode: string }> = [
  { re: /\bquero\b/i, reasonCode: "QUERO_DECISIVO" },
  { re: /\bpreciso\s+de\s+\d+\b/i, reasonCode: "PRECISO_DE_QUANTIDADE" },
  { re: /\d+\s*x\s*\d+(\s*x\s*\d+)?/i, reasonCode: "DIMENSAO_EXPLICITA" },
  { re: /\bquanto\s+(fica|custa|é)\b.*\d+/i, reasonCode: "QUANTO_FICA_COM_QUANTIDADE" },
  { re: /\bpreciso\b.*\b(pronto|dispon[ií]vel)\b.*\b(at[ée]|para)\b/i, reasonCode: "PRECISO_PRONTO_PRAZO" },
  { re: /\b(at[ée]|para)\s+(dia\s+\d+|sexta|segunda|ter[cç]a|quarta|quinta|s[aá]bado|domingo|amanh[aã]|hoje)\b/i, reasonCode: "PRAZO_AMARRADO" },
];

// Padrões de dúvida ambígua — desejo/interesse vago, sem objeto concreto
// nem pergunta de capacidade. Nunca viram comercial automaticamente.
const AMBIGUOUS_PATTERNS: Array<{ re: RegExp; reasonCode: string }> = [
  { re: /\bpreciso\s+de\s+um[a]?\s+(pe[cç]a|coisa)\b(?!\s*\d)/i, reasonCode: "PRECISO_DE_GENERICO" },
  { re: /\bestou\s+vendo\b/i, reasonCode: "ESTOU_VENDO" },
  { re: /\bqueria\s+saber\b/i, reasonCode: "QUERIA_SABER" },
  { re: /\btenho\s+interesse\b/i, reasonCode: "TENHO_INTERESSE" },
];

// Padrões de pergunta exploratória (capacidade/política geral da empresa).
const EXPLORATORY_PATTERNS: Array<{ re: RegExp; reasonCode: string }> = [
  { re: /^voc[eê]s\s+(fazem|trabalham|entregam|t[eê]m|tem|fazem\s+entrega)\b.*\?\s*$/i, reasonCode: "VOCES_CAPACIDADE" },
  { re: /^(qual|que|como|quando)\b.*\?\s*$/i, reasonCode: "PERGUNTA_GENERICA" },
];

/**
 * classifyIntent — função pura. Ordem de avaliação (decisiva para casos
 * ambíguos com múltiplos sinais, ex.: "Quanto fica 20 unidades de
 * plaquinha?" tem "?" mas é comercial):
 *   1. saudação isolada → EXPLORATORY (nunca inicia briefing)
 *   2. padrão comercial forte → COMMERCIAL_INTENT
 *   3. padrão ambíguo conhecido → AMBIGUOUS
 *   4. padrão de pergunta exploratória → EXPLORATORY
 *   5. fallback: contém "?" → EXPLORATORY (assume informacional);
 *      caso contrário → AMBIGUOUS (nunca assume comercial por default).
 */
export function classifyIntent(rawText: string): ClassificationResult {
  const text = norm(rawText);

  if (text.length === 0) {
    return { classification: "AMBIGUOUS", reasonCode: "EMPTY_TEXT", matchedRule: null };
  }

  if (GREETING_ONLY.test(text)) {
    return { classification: "EXPLORATORY", reasonCode: "GREETING_ONLY", matchedRule: "GREETING_ONLY" };
  }

  for (const p of COMMERCIAL_PATTERNS) {
    if (p.re.test(text)) {
      return { classification: "COMMERCIAL_INTENT", reasonCode: p.reasonCode, matchedRule: p.re.source };
    }
  }

  for (const p of AMBIGUOUS_PATTERNS) {
    if (p.re.test(text)) {
      return { classification: "AMBIGUOUS", reasonCode: p.reasonCode, matchedRule: p.re.source };
    }
  }

  for (const p of EXPLORATORY_PATTERNS) {
    if (p.re.test(text)) {
      return { classification: "EXPLORATORY", reasonCode: p.reasonCode, matchedRule: p.re.source };
    }
  }

  if (text.includes("?")) {
    return { classification: "EXPLORATORY", reasonCode: "FALLBACK_HAS_QUESTION_MARK", matchedRule: null };
  }

  return { classification: "AMBIGUOUS", reasonCode: "FALLBACK_NO_SIGNAL", matchedRule: null };
}
