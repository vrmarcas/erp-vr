/**
 * confirmation_detector.ts — detector determinístico de confirmação
 * comercial (sprint P0.7).
 *
 * Achado real de E2E (sprint P0.6): o backend calculou o preço
 * automaticamente e apresentou corretamente, mas quando o cliente
 * respondeu "sim, confirmo" o LLM (GPT-4.1 Mini) nunca chamou
 * atualizar_briefing_tecnico com clienteConfirmouOrcamento=true — mesmo
 * com o parâmetro documentado na Tool e no prompt. A última decisão
 * crítica ("esta mensagem confirma o orçamento?") ainda dependia do LLM
 * escolher agir. Este módulo remove essa dependência: classifica o TEXTO
 * da mensagem do cliente de forma pura e determinística, sem precisar de
 * nenhuma Tool call — o resultado é persistido diretamente pelo
 * caminho de entrada da mensagem (ver functions/src/atendimentos.ts),
 * antes mesmo do Chatvolt ser chamado.
 *
 * `clienteConfirmouOrcamento` continua existindo no schema da Tool
 * (compatibilidade/fallback), mas deixa de ser a fonte autoritativa —
 * este detector + o estado comercial real (existe uma simulação elegível
 * aguardando confirmação?) é que decide.
 *
 * Função PURA e testável: não lê nem escreve Firestore. O chamador é
 * responsável por determinar `awaitingConfirmation` (existe uma
 * lastEligibleSimulation para esta conversa agora?) e por persistir o
 * resultado.
 */

export interface CommercialIntentInput {
  /** Texto bruto da mensagem do cliente nesta rodada. */
  texto: string;
  /**
   * true quando já existe uma simulação elegível aguardando confirmação
   * nesta conversa (equivalente a nextAction=confirm_quote/create_quote
   * no orchestrator, ou simplesmente: lastEligibleSimulation existe).
   * Sem isso, NENHUM texto confirma um orçamento — "sim" sozinho não tem
   * conteúdo comercial sem um preço já apresentado esperando resposta.
   */
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
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .toLowerCase()
    .trim();
}

// Item 4 — hesitação/negociação: nunca confirma, mas também não é uma
// "rejeição" no sentido de recusar o produto — é sinal de que o cliente
// ainda não decidiu. Verificado ANTES dos padrões de confirmação para
// que "confirmo, mas tem desconto?" nunca vire confirmação.
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

// Item 5 — alteração de dado comercial/técnico na mesma mensagem invalida
// a simulação atual (fingerprint muda) — nunca confirmar com base num
// preço que está prestes a ficar desatualizado. Verificado ANTES dos
// padrões de confirmação para que "sim, mas faz 20 unidades" nunca
// confirme com a simulação antiga.
const DATA_CHANGE_PATTERNS: RegExp[] = [
  /\bmuda(r)?\s+(a\s+)?(para|quantidade)\b/,
  /\btroca(r)?\s+para\b/,
  /\bfaz(er)?\s+\d+\s+unidades?\b/,
  /\baumenta(r)?\s+(a\s+)?quantidade\b/,
  /\bdiminui(r)?\s+(a\s+)?quantidade\b/,
  /\bmudar\s+(a\s+)?quantidade\b/,
];

// Item 3 — expressões de confirmação decisivas, checadas por frase/
// palavra-chave forte (não dependem de "sim" isolado). Cobre com folga
// os 15 exemplos do pedido original.
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

// Item 3/4 — "sim"/"ok" e variações BEM curtas (sem conteúdo adicional
// substantivo) só confirmam quando já existe algo para confirmar
// (awaitingConfirmation). "ok" sozinho é ambíguo em qualquer OUTRO
// contexto, mas decisivo aqui porque é resposta direta a um preço já
// mostrado.
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

  // "sim" seguido de conteúdo NÃO relacionado a confirmar preço (ex.:
  // "sim, é acrílico", "sim, meu nome é Ana") — não é bare yes (tem mais
  // texto) e não bateu em nenhum padrão forte de confirmação — nunca
  // confirma, mas também não é claramente uma rejeição.
  if (/^sim\b/.test(norm)) {
    return { confirmQuote: false, rejectQuote: false, ambiguous: true, confidenceReason: "SIM_WITH_UNRELATED_CONTENT" };
  }

  return { confirmQuote: false, rejectQuote: false, ambiguous: true, confidenceReason: "NO_MATCH" };
}
