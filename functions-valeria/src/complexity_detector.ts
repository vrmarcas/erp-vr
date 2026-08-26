/**
 * complexity_detector.ts — bloqueio determinístico de produto complexo sem
 * receita compatível (sprint P1.2).
 *
 * Achado real (P1.1, item 9): "troféu com LED, madeira e mecanismo
 * giratório" não disparava handoff — a Valéria seguia pedindo medidas como
 * se fosse peça plana simples, e se o cliente desse dimensões depois, o
 * fallback de peça plana (recipes.ts/resolveRecipe) calcularia um preço
 * "válido" tecnicamente mas fisicamente errado (nenhuma receita conhecida
 * sabe representar LED/motor/madeira). Esta função roda ANTES de qualquer
 * pedido de medida/cálculo — nunca decide sozinha "é complexo demais", só
 * reconhece sinais explícitos de elementos que NENHUMA receita hoje
 * (PLAN_RECIPES nem Troféu GoJovem) sabe representar.
 *
 * Produto conhecido/homologado nunca é bloqueado só por ter várias peças —
 * a única exceção hardcoded é o Troféu GoJovem (receita multi-material já
 * homologada, preço comercial fixo — ver trofeu_gojovem.ts). Fora essa
 * exceção, mesmo um produto com nome de receita conhecida (ex.: "Caixa") é
 * bloqueado se o texto pedir algo que a receita não cobre (ex.: "caixa com
 * iluminação LED") — o nome do produto não garante que o PEDIDO INTEIRO
 * seja representável pela geometria/preço conhecidos.
 */
import { TROFEU_GOJOVEM_PRODUCT_ID } from "./trofeu_gojovem";

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

// Cada grupo cobre um elemento que nenhuma receita embutida (recipes.ts)
// sabe representar hoje — geometria de área simples, sem eletrônica, sem
// material além de acrílico, sem partes móveis.
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
  /** productId JÁ resolvido do technicalBriefing (não o texto solto). */
  productId?: string | null;
}): UnsupportedComplexityResult {
  // Única exceção conhecida: Troféu GoJovem é uma receita multi-material
  // já homologada com preço comercial fixo — nunca bloquear mesmo que o
  // texto contenha um dos sinais (decidido pelo productId JÁ RESOLVIDO,
  // nunca por adivinhar a partir do texto solto).
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
