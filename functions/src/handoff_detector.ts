/**
 * handoff_detector.ts — ESPELHA functions-valeria/src/handoff_detector.ts
 * (sprint P1.0) — mesma lógica, duplicada aqui porque functions/ e
 * functions-valeria/ são codebases de deploy independentes (sem
 * workspace/import cross-package). O módulo canônico, testado (Jest),
 * fica em functions-valeria; qualquer mudança na classificação deve ser
 * replicada aqui manualmente.
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

const CUSTOMER_REQUEST_PATTERNS: RegExp[] = [
  /\bfalar com (um[a]?|uma) (pessoa|atendente|humano|alguem)\b/,
  /\bquero (um[a]?|uma) (pessoa|atendente|humano)\b/,
  /\bpreciso falar com alguem\b/,
  /\batendimento humano\b/,
  /\bnao quero falar com (robo|ia|bot|assistente)\b/,
  /\bposso falar com alguem\b/,
];

const COMPLAINT_PATTERNS: RegExp[] = [
  /\breclama(cao|r)\b/,
  /\bpessimo atendimento\b/,
  /\bmuito insatisfeit[oa]\b/,
  /\bnao (funcionou|chegou|recebi)\b/,
  /\bveio (errado|quebrado|com defeito)\b/,
  /\bquero (meu dinheiro de volta|cancelar (o|meu) pedido)\b/,
];

const PAYMENT_PATTERNS: RegExp[] = [
  /\bpix\b.*\b(nao (caiu|confirmou)|problema)\b/,
  /\bproblema (com|no) pagamento\b/,
  /\bboleto\b/,
  /\bcart[aã]o (recusado|negado)\b/,
  /\breembolso\b/,
];

const DISCOUNT_PATTERNS: RegExp[] = [
  /\bdesconto\b/,
  /\bmais barato\b/,
  /\bcondi[cç][aã]o especial\b/,
  /\bnegociar\b/,
  /\bfechar por menos\b/,
];

export function detectHumanHandoff(input: {
  texto: string;
  pricingUnsupported?: boolean;
  produtoComplexoSemReceita?: boolean;
  erroSistemaReal?: boolean;
}): HandoffResult {
  const norm = normalize(input.texto);

  if (input.erroSistemaReal) {
    return { requiresHuman: true, humanReason: "SYSTEM_ERROR", priority: "HIGH" };
  }
  for (const p of CUSTOMER_REQUEST_PATTERNS) {
    if (p.test(norm)) return { requiresHuman: true, humanReason: "CUSTOMER_REQUEST", priority: "HIGH" };
  }
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
