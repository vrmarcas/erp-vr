/**
 * shadow_output_validator.ts — ValerIA 2.0, Fase E.2.7 (PoC shadow, 2026-09-20).
 *
 * Rede de segurança determinística sobre o TEXTO final (gerado pelo
 * redator, LLM ou não) — nunca decide comportamento, só barra saída que
 * viole a restrição vinda do backend (`questionAllowed`). Propósito
 * explícito (pedido do Gabriel): "o LLM pode errar, mas o erro não chega
 * ao cliente". Nunca usado para classificar intenção (isso é
 * interaction_classifier.ts) — aqui as mesmas palavras servem como
 * proteção de OUTPUT, papel diferente de heurística de ENTRADA.
 */

export interface OutputValidationResult {
  valid: boolean;
  violations: string[];
  sanitizedText: string;
}

// Cada padrão (exceto "?") exige uma MOLDURA DE PEDIDO direcionada ao
// cliente (verbo imperativo/interrogativo "quais/qual/me diga/pode
// enviar" + o tópico) — nunca a palavra-tópico isolada. Isso evita falso
// positivo em fatos legítimos que mencionam o mesmo tema (ex.: "fazemos
// peças sob medida" contém "medida", mas não é um PEDIDO de medida).
const BRIEFING_REQUEST_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\?/, label: "CONTAINS_QUESTION_MARK" },
  { re: /\bquais?\s+(s[aã]o\s+)?as?\s+medidas?\b/i, label: "ASKS_MEASUREMENTS" },
  { re: /\b(me\s+)?(diga|informe|confirme|passe|passar|informar)\s+(a\s+)?(as\s+)?medidas?\b/i, label: "ASKS_MEASUREMENTS" },
  { re: /\bqual\s+(a\s+)?quantidade\b/i, label: "ASKS_QUANTITY" },
  { re: /\b(me\s+)?(diga|informe|confirme|passe|passar|informar)\s+(a\s+)?quantidade\b/i, label: "ASKS_QUANTITY" },
  { re: /\bqual\s+o\s+prazo\b/i, label: "ASKS_DEADLINE" },
  { re: /\bqual\s+a\s+aplica[cç][aã]o\b/i, label: "ASKS_APPLICATION" },
  { re: /\bqual\s+o\s+material\b/i, label: "ASKS_MATERIAL" },
  { re: /\b(pode|poderia|consegue)\s+(me\s+)?(enviar|mandar)\s+(uma\s+)?(foto|arquivo)\b/i, label: "ASKS_FILE_OR_PHOTO" },
  { re: /\benvi(e|ar)\s+(mais\s+)?(detalhes|informa[cç][oõ]es)\b/i, label: "INVITES_DETAILS" },
  { re: /\bpode\s+me\s+(passar|informar|dizer)\b/i, label: "BRIEFING_PHRASING" },
  { re: /\bme\s+(conta|fala|diz)\b/i, label: "BRIEFING_PHRASING_INFORMAL" },
];

/**
 * validateOutput — pura. `questionAllowed=false` (modo EXPLORATORY/
 * AMBIGUOUS) rejeita qualquer traço de pergunta/pedido de briefing.
 * `questionAllowed=true` (COMMERCIAL_INTENT) não aplica essas restrições
 * — nesse modo uma pergunta é o comportamento correto.
 *
 * `sanitizedText`: quando inválido, cai para a recitação literal dos
 * `factsAllowed` (texto pré-aprovado pelo backend, garantidamente sem
 * pergunta) em vez de tentar "consertar" o texto do redator — mais
 * seguro que qualquer heurística de edição.
 */
export function validateOutput(
  text: string,
  opts: { questionAllowed: boolean; factsAllowed: string[] }
): OutputValidationResult {
  if (opts.questionAllowed) {
    return { valid: true, violations: [], sanitizedText: text };
  }

  const violations = BRIEFING_REQUEST_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);

  if (violations.length === 0) {
    return { valid: true, violations: [], sanitizedText: text };
  }

  const sanitizedText = opts.factsAllowed.length > 0
    ? opts.factsAllowed.join(" ")
    : "Posso ajudar com isso. Nossa equipe confirma os detalhes.";

  return { valid: false, violations, sanitizedText };
}
