/**
 * complexity_detector.ts — ESPELHA functions-valeria/src/complexity_detector.ts
 * (sprint P1.2) — mesma lógica, duplicada aqui porque functions/ e
 * functions-valeria/ são codebases de deploy independentes (sem
 * workspace/import cross-package). O módulo canônico, testado (Jest),
 * fica em functions-valeria; qualquer mudança na classificação deve ser
 * replicada aqui manualmente.
 */

// Mesmo valor de functions-valeria/src/trofeu_gojovem.ts::TROFEU_GOJOVEM_PRODUCT_ID
// — este codebase não tem esse módulo, então o literal é duplicado aqui.
const TROFEU_GOJOVEM_PRODUCT_ID = "Troféu GoJovem";

export type ComplexityReasonCode =
  | "LED_ILUMINACAO"
  | "ELETRONICA_MOTOR_MECANISMO"
  | "MATERIAL_NAO_ACRILICO"
  | "PECA_ARTICULADA"
  | "COMPONENTE_ELETRICO_EXTERNO"
  | "MONTAGEM_MECANICA";

export interface UnsupportedComplexityResult {
  unsupportedComplexity: boolean;
  reasonCodes: ComplexityReasonCode[];
  requiresHuman: boolean;
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const SIGNAL_GROUPS: Array<{ code: ComplexityReasonCode; patterns: RegExp[] }> = [
  {
    code: "LED_ILUMINACAO",
    patterns: [/\bled\b/, /\bfita\s+de?\s*led\b/, /\bilumina(cao|do|da)\b/, /\blampada\b/],
  },
  {
    code: "ELETRONICA_MOTOR_MECANISMO",
    patterns: [
      /\beletronic[oa]\b/,
      /\bmotor\b/,
      /\bmotorizad[oa]\b/,
      /\bmecanismo\b/,
      /\bgirator(io|ia)\b/,
      /\bcom movimento\b/,
      /\bpeca(s)? (em|com) movimento\b/,
    ],
  },
  {
    code: "MATERIAL_NAO_ACRILICO",
    patterns: [/\bmadeira\b/, /\bmdf\b/, /\bmetal\b/, /\baco\b/, /\baluminio\b/],
  },
  {
    code: "PECA_ARTICULADA",
    patterns: [/\bdobradica\b/, /\barticulad[oa]\b/, /\bpeca(s)? articulada(s)?\b/, /\bbase especial\b/],
  },
  {
    code: "COMPONENTE_ELETRICO_EXTERNO",
    patterns: [
      /\bfonte (eletrica|de energia)\b/,
      /\bbateria\b/,
      /\busb\b/,
      /\bcomponente(s)? (comprado|externo)/,
      /\bpeca(s)? comprada(s)?\b/,
    ],
  },
  {
    code: "MONTAGEM_MECANICA",
    patterns: [/\bmontagem mecanica\b/, /\bmecanismo de montagem\b/],
  },
];

export function detectUnsupportedComplexity(input: {
  texto: string;
  productId?: string | null;
}): UnsupportedComplexityResult {
  if (input.productId === TROFEU_GOJOVEM_PRODUCT_ID) {
    return { unsupportedComplexity: false, reasonCodes: [], requiresHuman: false };
  }

  const norm = normalize(input.texto || "");
  const reasonCodes: ComplexityReasonCode[] = [];
  for (const group of SIGNAL_GROUPS) {
    if (group.patterns.some((p) => p.test(norm))) reasonCodes.push(group.code);
  }
  if (reasonCodes.length === 0) {
    return { unsupportedComplexity: false, reasonCodes: [], requiresHuman: false };
  }
  return { unsupportedComplexity: true, reasonCodes, requiresHuman: true };
}
