/**
 * trofeu_gojovem.ts — suporte determinístico ao Troféu GoJovem (sprint P0.9).
 *
 * Auditoria real (2026-08-25, confirmada com Gabriel): o único modelo de
 * troféu com geometria real no ERP é o SKU `TFMOD10` (vitre_produtos/TFMOD10,
 * nome de exibição editado manualmente para "TROFÉU MODELO 11", mas SKU
 * literal "TF-MOD-10" bate com a receita geométrica interna "Troféu Modelo
 * 10" em erp_plan_produtos/pp_1787580661988 — mesmo produto físico).
 *
 * A receita real tem 5 peças em DOIS materiais/espessuras diferentes
 * (Corpo 8mm + Peças sobrepostas 2mm) — o motor genérico de
 * calculatePersonalizedProduct (quote_core.ts) só suporta 1 material por
 * produto (ver docstring de quote_core.ts), então este módulo NÃO tenta
 * generalizar o motor — é uma receita hardcoded, específica, só para este
 * SKU (instrução explícita: não construir motor universal de troféu hoje).
 *
 * Preço: o motor de área/material (pricing.ts) não sabe precificar
 * gravação a laser nem montagem/base adesivada (mencionados na
 * descricaoCurta cadastrada do SKU) — por isso o preço final usado é o
 * preço comercial FIXO já cadastrado em vitre_produtos/TFMOD10.precoVenda
 * (decisão de Gabriel, 2026-08-25, dado real do ERP, nunca hardcoded aqui)
 * × quantidade. As peças reais ainda são geradas para rastreabilidade de
 * produção/planificação — só não alimentam o preço.
 */
import * as admin from "firebase-admin";
import { randomUUID } from "crypto";

export const TROFEU_GOJOVEM_PRODUCT_ID = "Troféu GoJovem";

/** SKU real no catálogo — fonte do preço comercial fixo. */
export const TROFEU_GOJOVEM_SKU = "TFMOD10";

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Reconhece qualquer variação textual que mencione tanto "troféu" quanto
 * "gojovem"/"go jovem", em qualquer ordem — cobre "Troféu GoJovem",
 * "troféu do GoJovem", "troféu da premiação GoJovem", "trofeu gojovem",
 * etc. Nunca aproxima: exige AMBOS os termos presentes.
 */
export function isTrofeuGoJovemAlias(raw: string): boolean {
  const n = normalize(raw);
  return /trofeu/.test(n) && /go\s*jovem/.test(n);
}

/**
 * Envelope técnico cadastrado (vitre_produtos/TFMOD10) — usado SÓ para
 * satisfazer os campos "obrigatórios" do TechnicalBriefing genérico
 * (larguraMm/alturaMm/thicknessMm/materialId), que não sabe de produto
 * multi-material. A peça/preço REAIS vêm de TROFEU_GOJOVEM_PIECES e do
 * preço fixo — nunca destes valores de envelope.
 */
export const TROFEU_GOJOVEM_ENVELOPE = {
  larguraMm: 160, // 16cm cadastrado (comprimentoCm/larguraCm de vitre_produtos/TFMOD10)
  alturaMm: 220,  // 22cm cadastrado
  thicknessMm: 8, // espessura principal cadastrada
  materialId: "cfg_5", // Acrílico Cristal 8mm — material do Corpo
};

export interface TrofeuGoJovemPiece {
  nome: string;
  larg: number; // cm
  alt: number;  // cm
  qty: number;  // por troféu
  matKey: string;
  espessuraMm: number;
}

/**
 * Geometria real, fiel a erp_plan_produtos/pp_1787580661988 ("Troféu
 * Modelo 10"), planificações "Corpo" (8mm) e "Peças sobrepostas" (2mm).
 * Fixa — este modelo não varia por medida informada pelo cliente (o
 * cliente só escolhe quantidade).
 */
export const TROFEU_GOJOVEM_PIECES: TrofeuGoJovemPiece[] = [
  { nome: "Corpo A", larg: 13.4, alt: 6.5, qty: 1, matKey: "cfg_5", espessuraMm: 8 },
  { nome: "Corpo B", larg: 12.9, alt: 6.0, qty: 1, matKey: "cfg_5", espessuraMm: 8 },
  { nome: "Corpo C", larg: 5.86, alt: 0.8, qty: 1, matKey: "cfg_5", espessuraMm: 8 },
  { nome: "Sobreposta A", larg: 4.99, alt: 13.62, qty: 1, matKey: "cfg_0", espessuraMm: 2 },
  { nome: "Sobreposta B", larg: 3.82, alt: 5.46, qty: 1, matKey: "cfg_0", espessuraMm: 2 },
];

/**
 * Lê o preço comercial fixo direto do ERP (nunca hardcoded, nunca vindo
 * do LLM/prompt) — se o cadastro mudar, o preço usado aqui muda junto.
 */
export async function getTrofeuGoJovemPrecoUnitario(): Promise<number | null> {
  const snap = await admin.firestore().collection("vitre_produtos").doc(TROFEU_GOJOVEM_SKU).get();
  if (!snap.exists) return null;
  const preco = snap.data()?.precoVenda;
  return typeof preco === "number" && preco > 0 ? preco : null;
}

export interface TrofeuGoJovemPricing {
  eligibility: "ELIGIBLE" | "NEEDS_INFORMATION" | "HUMAN_VALIDATION_REQUIRED";
  finalPrice?: number;
  precoUnitario?: number;
  pricingVersion?: string;
  simulationId?: string;
  missingFields?: string[];
}

export interface TrofeuGoJovemResult {
  produto: string;
  pieces: Array<{ nome: string; larg: number; alt: number; qtyTotal: number; matKey: string }>;
  pricing: TrofeuGoJovemPricing;
}

export async function calculateTrofeuGoJovem(qty: number): Promise<TrofeuGoJovemResult> {
  if (!(qty > 0)) {
    return {
      produto: TROFEU_GOJOVEM_PRODUCT_ID,
      pieces: [],
      pricing: { eligibility: "NEEDS_INFORMATION", missingFields: ["quantity"] },
    };
  }

  const precoUnitario = await getTrofeuGoJovemPrecoUnitario();
  if (precoUnitario == null) {
    return {
      produto: TROFEU_GOJOVEM_PRODUCT_ID,
      pieces: [],
      pricing: {
        eligibility: "HUMAN_VALIDATION_REQUIRED",
        missingFields: [`vitre_produtos/${TROFEU_GOJOVEM_SKU}.precoVenda não encontrado ou inválido`],
      },
    };
  }

  const finalPrice = Math.round(precoUnitario * qty * 100) / 100;
  return {
    produto: TROFEU_GOJOVEM_PRODUCT_ID,
    pieces: TROFEU_GOJOVEM_PIECES.map((p) => ({
      nome: p.nome, larg: p.larg, alt: p.alt, qtyTotal: p.qty * qty, matKey: p.matKey,
    })),
    pricing: {
      eligibility: "ELIGIBLE",
      finalPrice,
      precoUnitario,
      pricingVersion: `trofeu_gojovem_fixed_${TROFEU_GOJOVEM_SKU}_${precoUnitario}`,
      simulationId: `sim_${randomUUID()}`,
    },
  };
}
