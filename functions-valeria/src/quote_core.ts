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
}

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
  if (!PLAN_BUILTIN_NAMES.includes(input.produto)) {
    warnings.push(
      `Produto "${input.produto}" não é uma receita embutida conhecida — calculado como peça plana simples (largura×altura). Se o produto real tem múltiplas peças, este resultado está incompleto.`
    );
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
  const pricing = await evaluateQuoteEligibility(itens, {});

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
