/**
 * quote_core.ts — núcleo determinístico de orçamento VR personalizado
 * multi-peça (sprint P0.2 2026-08-23).
 *
 * Combina a geometria pura (recipes.ts, porta fiel de PLAN_RECIPES) com o
 * motor de preço JÁ EXISTENTE E JÁ CORRIGIDO (pricing.ts,
 * evaluateQuoteEligibility) — NUNCA reimplementa matemática de preço, só
 * gera a lista de peças reais e delega o cálculo ao motor oficial.
 *
 * Escopo (ver aviso completo em recipes.ts): cobre as 13 receitas
 * embutidas + fallback de peça plana, 1 material por item (sem override
 * por peça), sem consumíveis por peça (adesivo/gravação/spray/extra) —
 * esses continuam exclusivos do wizard humano (orcRecalc).
 */

import { resolveRecipe, PLAN_BUILTIN_NAMES, RecipePiece } from "./recipes";
import { evaluateQuoteEligibility } from "./pricing";
import type { QuoteItem, PricingResult } from "./types";

export interface PersonalizedProductInput {
  produto: string;
  larg: number;   // L — comprimento, cm
  alt: number;    // A — altura, cm
  prof?: number;  // P — profundidade, cm (só produtos dim3d)
  esp: number;    // e — espessura do material, mm
  matKey: string;
  qty: number;    // quantidade do produto (não de cada peça)
  /**
   * Adesivo/Adesivo branco (Bloco C, sprint P0.3) — aplicado sobre a área
   * TOTAL do produto (todas as peças), nunca peça a peça: o cliente pede
   * "com adesivo" para o produto inteiro, não escolhe peça por peça numa
   * conversa (essa granularidade só existe no wizard humano). Os dois
   * flags são independentes (Rodada 8 do wizard, portado fielmente).
   * Gravação/Spray/Extra NÃO entram aqui: exigem custo operacional
   * informado por humano (sem preço/cm² configurável) — a IA nunca deve
   * inventar esse valor, então esses pedidos caem em HUMAN_VALIDATION.
   */
  adesivo?: boolean;
  adesivoBranco?: boolean;
  /**
   * Chaves de itens que o cliente pediu mas que o ERP não tem fonte
   * canônica de preço/regra para calcular automaticamente hoje (sprint
   * P0.3, Bloco C — ver UNSUPPORTED_COMMERCIAL_FIELDS). Nunca inventa
   * valor: bloqueia esta simulação com HUMAN_VALIDATION_REQUIRED e
   * reasonCode explícito por item, só quando o item foi de fato
   * mencionado pela Tool (não um bloqueio proativo/permanente).
   */
  solicitacoesNaoSuportadas?: string[];
  /**
   * Sprint P1.2 — sinal já persistido pelo detector determinístico
   * (complexity_detector.ts): quando não-vazio, bloqueia ANTES de calcular
   * qualquer preço, mesmo que o produto não bata em nenhuma receita
   * embutida (nunca deixa o fallback de peça plana calcular um preço
   * "válido" tecnicamente mas fisicamente errado para LED/motor/madeira).
   */
  unsupportedComplexityReasonCodes?: string[] | null;
}

/**
 * Bloco C — itens do orçamento sem fonte canônica de preço/regra HOJE no
 * ERP. Cada entrada documenta O QUE falta (não "está fora de escopo para
 * sempre") — quando o ERP ganhar a fonte canônica correspondente (tabela
 * de preço de gravação, regra de desconto automático, etc.), o campo sai
 * desta lista e passa a ser calculado normalmente.
 */
export const UNSUPPORTED_COMMERCIAL_FIELDS: Record<string, { reasonCode: string; motivo: string }> = {
  gravacao: {
    reasonCode: "NO_CANONICAL_PRICE_SOURCE",
    motivo: "Gravação a laser não tem tabela de preço cadastrada no ERP — custo hoje é informado manualmente pelo vendedor por orçamento (orcRecalc, campo peça.gravacao).",
  },
  spray: {
    reasonCode: "NO_CANONICAL_PRICE_SOURCE",
    motivo: "Spray/pintura não tem tabela de preço cadastrada no ERP — custo hoje é informado manualmente pelo vendedor por orçamento (orcRecalc, campo peça.spray).",
  },
  extra: {
    reasonCode: "NO_CANONICAL_PRICE_SOURCE",
    motivo: "Acabamento extra não tem tabela de preço cadastrada no ERP — custo hoje é informado manualmente pelo vendedor por orçamento (orcRecalc, campo peça.extra).",
  },
  maquinas: {
    reasonCode: "INTERNAL_OPERATIONAL_COST",
    motivo: "Custo de máquina (laser/dobra/polimento/UV/lixa/tupia) é operacional interno, calculado pelo vendedor — não é determinado pelo cliente.",
  },
  montagem: {
    reasonCode: "REQUIRES_HUMAN_LOGISTICS_DECISION",
    motivo: "Montagem depende de avaliação logística humana (local, acesso, complexidade) sem regra automática hoje.",
  },
  deslocamento: {
    reasonCode: "REQUIRES_HUMAN_LOGISTICS_DECISION",
    motivo: "Deslocamento/frete depende de avaliação logística humana (distância, urgência) sem regra automática hoje.",
  },
  desconto: {
    reasonCode: "REQUIRES_HUMAN_COMMERCIAL_DECISION",
    motivo: "Desconto é decisão comercial que exige aprovação humana — a Valéria nunca aplica desconto sozinha.",
  },
  acrescimo: {
    reasonCode: "REQUIRES_HUMAN_COMMERCIAL_DECISION",
    motivo: "Acréscimo/ajuste comercial exige aprovação humana — a Valéria nunca aplica acréscimo sozinha.",
  },
};

export interface PersonalizedProductResult {
  ok: boolean;
  produto: string;
  dim3d: boolean;
  desc: string;
  /** Peças reais geradas pela receita, já multiplicadas pela quantidade do produto */
  pieces: Array<{ nome: string; larg: number; alt: number; qtyTotal: number }>;
  pricing: PricingResult;
  warnings: string[];
}

/**
 * Descoberta de campos — usada pela Tool `preparar_produto_personalizado`
 * para a Valéria saber, ANTES de perguntar, o que é obrigatório para este
 * produto específico (nunca perguntar o que a receita não usa).
 */
export interface ProductFieldsInfo {
  produto: string;
  reconhecido: boolean;
  dim3d: boolean;
  desc: string;
  requiredFields: string[];
  optionalFields: string[];
}

export function describeProductFields(produto: string): ProductFieldsInfo {
  const reconhecido = PLAN_BUILTIN_NAMES.includes(produto);
  const rec = resolveRecipe(produto);
  const required = ["larg", "alt", "esp", "matKey", "qty"];
  if (rec.dim3d) required.splice(2, 0, "prof");
  return {
    produto,
    reconhecido,
    dim3d: rec.dim3d,
    desc: rec.desc,
    requiredFields: required,
    optionalFields: [],
  };
}

function piecesToQuoteItens(pieces: RecipePiece[], matKey: string, itemQty: number): QuoteItem[] {
  return pieces.map((p) => ({
    larg: p.larg,
    alt: p.alt,
    qty: p.qty * itemQty,
    matKey,
    descricao: p.nome,
  }));
}

export async function calculatePersonalizedProduct(
  input: PersonalizedProductInput
): Promise<PersonalizedProductResult> {
  const warnings: string[] = [];
  const rec = resolveRecipe(input.produto);

  // Sprint P1.2 (Bloco 5 — guard explícito no fallback de peça plana) —
  // bloqueia ANTES de qualquer geometria/preço quando o detector
  // determinístico já sinalizou elementos que nenhuma receita conhecida
  // representa (LED/motor/madeira/etc.). Roda antes até do warning de
  // "não é receita embutida" porque aqui nem o fallback deve calcular.
  if (input.unsupportedComplexityReasonCodes && input.unsupportedComplexityReasonCodes.length > 0) {
    return {
      ok: false,
      produto: input.produto,
      dim3d: rec.dim3d,
      desc: rec.desc,
      pieces: [],
      pricing: {
        eligibility: "HUMAN_VALIDATION_REQUIRED",
        missingFields: [
          `Produto com elementos fora da receita conhecida (${input.unsupportedComplexityReasonCodes.join(", ")}) — precisa de validação humana antes de calcular preço.`,
        ],
        blockedItems: input.unsupportedComplexityReasonCodes.map((code) => ({
          campo: code,
          reasonCode: "UNSUPPORTED_COMPLEXITY",
          motivo: "Elemento não representável pela receita/geometria conhecida — preço não pode ser calculado automaticamente.",
        })),
      },
      warnings,
    };
  }

  if (!PLAN_BUILTIN_NAMES.includes(input.produto)) {
    warnings.push(
      `Produto "${input.produto}" não é uma receita embutida conhecida — calculado como peça plana simples (largura×altura). Se o produto real tem múltiplas peças, este resultado está incompleto.`
    );
  }

  // Bloco C — bloqueia ANTES de calcular qualquer preço se o cliente pediu
  // algo sem fonte canônica (nunca inventa valor, nunca calcula "parcial"
  // silenciosamente ignorando o pedido).
  const chavesNaoSuportadas = (input.solicitacoesNaoSuportadas ?? []).filter(
    (k) => UNSUPPORTED_COMMERCIAL_FIELDS[k]
  );
  if (chavesNaoSuportadas.length > 0) {
    const blockedItems = chavesNaoSuportadas.map((campo) => ({ campo, ...UNSUPPORTED_COMMERCIAL_FIELDS[campo] }));
    return {
      ok: false,
      produto: input.produto,
      dim3d: rec.dim3d,
      desc: rec.desc,
      pieces: [],
      pricing: {
        eligibility: "HUMAN_VALIDATION_REQUIRED",
        missingFields: blockedItems.map((b) => `${b.campo}: ${b.motivo}`),
        blockedItems,
      },
      warnings,
    };
  }

  const L = input.larg;
  const A = input.alt;
  const P = input.prof ?? 0;
  const e = input.esp;

  if (rec.dim3d && !(P > 0)) {
    return {
      ok: false,
      produto: input.produto,
      dim3d: rec.dim3d,
      desc: rec.desc,
      pieces: [],
      pricing: { eligibility: "NEEDS_INFORMATION", missingFields: ["prof"] },
      warnings,
    };
  }

  const pecasBrutas = rec.pieces(L, A, P, e);
  const pecasInvalidas = pecasBrutas.filter((p) => !(p.larg > 0) || !(p.alt > 0));
  if (pecasInvalidas.length > 0) {
    return {
      ok: false,
      produto: input.produto,
      dim3d: rec.dim3d,
      desc: rec.desc,
      pieces: [],
      pricing: {
        eligibility: "NEEDS_INFORMATION",
        missingFields: ["dimensões insuficientes para gerar peças válidas — confira largura/altura/profundidade/espessura"],
      },
      warnings,
    };
  }

  const itens = piecesToQuoteItens(pecasBrutas, input.matKey, input.qty);
  const areaTotalCm2 = pecasBrutas.reduce((acc, p) => acc + p.larg * p.alt * p.qty, 0) * input.qty;
  const pricing = await evaluateQuoteEligibility(itens, {
    adesivo: (input.adesivo || input.adesivoBranco)
      ? { normal: !!input.adesivo, branco: !!input.adesivoBranco, areaTotalCm2 }
      : undefined,
  });

  return {
    ok: pricing.eligibility === "ELIGIBLE",
    produto: input.produto,
    dim3d: rec.dim3d,
    desc: rec.desc,
    pieces: pecasBrutas.map((p) => ({
      nome: p.nome,
      larg: Math.round(p.larg * 100) / 100,
      alt: Math.round(p.alt * 100) / 100,
      qtyTotal: p.qty * input.qty,
    })),
    pricing,
    warnings,
  };
}
