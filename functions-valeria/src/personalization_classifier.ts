/**
 * personalization_classifier.ts — ValerIA 2.0, Fase E.2.42 (2026-09-22).
 *
 * Fecha o gap identificado na Fase E.2.41: `CatalogDraftFields.personalization`
 * era escrito no draft mas nunca consultado por nenhuma decisão — qualquer
 * sinal de personalização (cosmética ou estrutural) caía indistintamente em
 * CUSTOM_REQUIRED/CUSTOM_REQUESTED (product_resolution.ts). Este módulo é a
 * peça que falta: classificação determinística, pura (sem I/O, sem LLM),
 * puramente por padrão de texto em português — mesmo estilo de
 * interaction_classifier.ts.
 *
 * Conservador por padrão (Fase E.2.42, item 5/11 do pedido): um item que não
 * bate em nenhum padrão conhecido nunca vira "COSMETIC" silenciosamente —
 * fica "UNKNOWN", e o chamador (product_resolution.ts) trata UNKNOWN como
 * estrutural (mantém o comportamento custom já existente), nunca como
 * facilitador de orçamento automático.
 */

export type PersonalizationClassification = "COSMETIC" | "STRUCTURAL" | "UNKNOWN";

// Padrões estruturais têm prioridade sobre cosméticos quando o mesmo item
// cita os dois (ex.: "quero em outro material com o nome gravado" — a parte
// estrutural domina, nunca o contrário: nunca deixar uma menção cosmética
// mascarar um pedido estrutural).
const STRUCTURAL_PATTERNS: RegExp[] = [
  // "material" sozinho NUNCA é suficiente (ex.: "material enviado" — o
  // cliente mandou um arquivo de referência, não pediu outro material) —
  // só conta quando há um pedido explícito de TROCA/diferença de material.
  /\b(outro|outra|diferente|customizad[oa])\s+(tipo\s+de\s+)?material\b/i,
  /\bmaterial\s+(diferente|customizado|especial)\b/i,
  /\b(tamanho|dimens[aã]o|medida)s?\s+(diferente|fora\s+do\s+padr[aã]o|customizad[oa]|personalizad[oa])\b/i,
  /\bconstru[çc][aã]o\s+diferente\b/i,
  /\bformato\s+diferente\b/i,
  /\bdivis[oó]ria\b/i,
  /\bcompartimento\b/i,
  /\bacess[oó]rio\s+especial\b/i,
  /\bmudan[çc]a\s+f[ií]sica\b/i,
];

// Padrões cosméticos — nunca alteram a estrutura física do SKU.
const COSMETIC_PATTERNS: RegExp[] = [
  /\blogo\b/i,
  /\b(gravar|grava[çc][aã]o|grava(do|da))\b/i,
  /\b(estampa|estampar)\b/i,
  /\bidentifica[çc][aã]o\b/i,
  /\btexto\b/i,
  /\bnome\s+(gravado|na\s+tampa|no\s+produto|do\s+cliente|da\s+fazenda|da\s+empresa)\b/i,
  // "com o nome X" / "com nome X" — nome próprio depois de "nome", sem ser
  // "nome do modelo"/"nome do produto" (isso é metadado do catálogo, não
  // personalização — ver caso negativo explícito no pedido, item 11).
  /\bcom\s+(o\s+)?nome\s+(?!do\s+modelo\b|do\s+produto\b)[a-zà-ú]/i,
  /\bop[çc][aã]o\s+(visual\s+)?(suportada|j[aá]\s+dispon[ií]vel|do\s+cat[aá]logo)\b/i,
];

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function classifyOne(item: string): PersonalizationClassification {
  const text = normalize(item);
  if (!text) return "UNKNOWN";
  // Estrutural sempre vence — nunca deixar um sinal cosmético mascarar um
  // pedido estrutural presente no MESMO item de texto.
  if (STRUCTURAL_PATTERNS.some((re) => re.test(text))) return "STRUCTURAL";
  if (COSMETIC_PATTERNS.some((re) => re.test(text))) return "COSMETIC";
  return "UNKNOWN";
}

/**
 * classifyPersonalizationText — decide a classificação AGREGADA de uma
 * lista de itens de personalização. Regra de agregação (conservadora):
 *   - lista vazia → UNKNOWN (nada para classificar; nunca assume cosmético);
 *   - QUALQUER item STRUCTURAL → resultado STRUCTURAL (um único pedido
 *     estrutural entre vários itens já é suficiente para nunca manter o SKU);
 *   - sem STRUCTURAL e algum item UNKNOWN → UNKNOWN (nunca classifica como
 *     cosmético "por maioria" quando há ambiguidade — item 5/11 do pedido:
 *     "Quero personalizar" sem detalhe suficiente nunca vira cosmético);
 *   - todos os itens COSMETIC → COSMETIC.
 */
export function classifyPersonalizationText(items: string[] | null | undefined): PersonalizationClassification {
  if (!items || items.length === 0) return "UNKNOWN";
  const classifications = items.map(classifyOne);
  if (classifications.some((c) => c === "STRUCTURAL")) return "STRUCTURAL";
  if (classifications.some((c) => c === "UNKNOWN")) return "UNKNOWN";
  return "COSMETIC";
}
