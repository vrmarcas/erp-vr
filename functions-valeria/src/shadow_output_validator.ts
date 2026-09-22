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
 * Fase E.2.27 — "mentira operacional": texto que afirma uma ação de
 * backend (rascunho criado, encaminhado para revisão, equipe acionada,
 * handoff executado) que na verdade não ocorreu. Aplicado só quando
 * `sideEffectsExecuted===false` (ver validateOutput) — quando for
 * verdadeiramente `true`, o mesmo texto é factual e permitido. Padrões
 * semânticos (não frases exatas) para cobrir variações razoáveis de
 * redação — deliberadamente amplos o bastante para pegar a classe de
 * frase, não só o exemplo literal que causou o achado (Piloto 4,
 * Fase E.2.26).
 */
const FALSE_ACTION_CLAIM_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bdeixei\s+tudo\s+pronto\b/i, label: "CLAIMS_ALREADY_READY" },
  { re: /\b(j[áa]\s+)?envi(ei|amos)\s+(para|pra)\s+(a\s+)?(revis[aã]o|nossa\s+equipe|equipe)\b/i, label: "CLAIMS_SENT_FOR_REVIEW" },
  { re: /\b(nossa\s+)?equipe\s+vai\s+(revisar|confirmar|entrar\s+em\s+contato|te\s+retornar)\b/i, label: "CLAIMS_TEAM_WILL_ACT" },
  { re: /\bor[cç]amento\s+(est[áa]\s+sendo|sendo)\s+prepara(do|ndo)\b/i, label: "CLAIMS_QUOTE_IN_PROGRESS" },
  { re: /\bj[áa]\s+encaminhei\b/i, label: "CLAIMS_ALREADY_FORWARDED" },
  { re: /\bvamos\s+confirmar\s+(o\s+)?(seu\s+)?or[cç]amento\b/i, label: "CLAIMS_QUOTE_CONFIRMATION_PROMISE" },
  { re: /\bj[áa]\s+registrei\s+(seu\s+)?pedido\b/i, label: "CLAIMS_ORDER_REGISTERED" },
  { re: /\b(rascunho|draft)\s+(foi\s+)?criado\b/i, label: "CLAIMS_DRAFT_CREATED" },
];

/**
 * validateOutput — pura. `questionAllowed=false` (modo EXPLORATORY/
 * AMBIGUOUS) rejeita qualquer traço de pergunta/pedido de briefing.
 * `questionAllowed=true` (COMMERCIAL_INTENT) não aplica essas restrições
 * — nesse modo uma pergunta é o comportamento correto.
 *
 * `sideEffectsExecuted=false` (Fase E.2.27) rejeita, em QUALQUER modo,
 * afirmações de ação de backend já executada (rascunho criado, enviado
 * para revisão, equipe acionada) — independe de `questionAllowed`.
 *
 * `sanitizedText`: quando inválido, cai para a recitação literal dos
 * `factsAllowed` (texto pré-aprovado pelo backend, garantidamente sem
 * pergunta) em vez de tentar "consertar" o texto do redator — mais
 * seguro que qualquer heurística de edição.
 */
export function validateOutput(
  text: string,
  opts: { questionAllowed: boolean; factsAllowed: string[]; sideEffectsExecuted?: boolean }
): OutputValidationResult {
  const violations: string[] = [];

  if (!opts.questionAllowed) {
    violations.push(...BRIEFING_REQUEST_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label));
  }

  // Fase E.2.27 — independe de questionAllowed: uma afirmação de ação já
  // executada é proibida sempre que sideEffectsExecuted===false, em
  // QUALQUER modo (EXPLORATORY/AMBIGUOUS/COMMERCIAL_INTENT). Omitido
  // (undefined) = não valida esta dimensão (compatibilidade retroativa
  // com chamadores que ainda não passam o campo).
  if (opts.sideEffectsExecuted === false) {
    violations.push(...FALSE_ACTION_CLAIM_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label));
  }

  if (violations.length === 0) {
    return { valid: true, violations: [], sanitizedText: text };
  }

  const sanitizedText = opts.factsAllowed.length > 0
    ? opts.factsAllowed.join(" ")
    : "Posso ajudar com isso. Nossa equipe confirma os detalhes.";

  return { valid: false, violations, sanitizedText };
}
