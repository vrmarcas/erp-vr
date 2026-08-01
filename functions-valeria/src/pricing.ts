/**
 * pricing.ts — Motor oficial de orçamento (portado do browser para o servidor)
 *
 * Lê configuração financeira e materiais do Firestore (erp_vr/cfg).
 * Nunca aceita valores de preço fornecidos externamente.
 *
 * Produtos que exigem validação humana:
 *   - Sem material cadastrado para o matKey informado
 *   - Área zerada ou negativa
 *   - Config financeira ausente no Firestore
 *   - fator de markup <= 0
 */

import * as admin from "firebase-admin";
import { randomUUID } from "crypto";
import type {
  ErpConfig,
  QuoteItem,
  PricingResult,
  PricingBreakdown,
} from "./types";

const COL = "erp_vr";

// ── Leitura de configuração ────────────────────────────────────────────────────

async function loadErpConfig(): Promise<ErpConfig | null> {
  const db  = admin.firestore();
  const doc = await db.collection(COL).doc("erp_config").get();
  if (!doc.exists) return null;
  const raw = doc.data()?.data;
  if (!raw) return null;
  try { return JSON.parse(raw) as ErpConfig; } catch { return null; }
}

// ── Cálculo de preço por m² de material ──────────────────────────────────────

function getMaterialPriceM2(matKey: string, mats: ErpConfig["materiais"]): number | null {
  if (!mats || !matKey) return null;
  if (matKey.startsWith("cfg_")) {
    const idx = parseInt(matKey.replace("cfg_", ""), 10);
    const m   = mats[idx];
    if (!m) return null;
    const area = ((m.comp ?? 0) * (m.larg ?? 0)) / 10000; // cm² → m²
    if (area <= 0) return null;
    return (m.preco ?? 0) / area;
  }
  return null; // matKey desconhecido → validação humana
}

// ── Motor principal ────────────────────────────────────────────────────────────

export async function evaluateQuoteEligibility(
  itens: QuoteItem[],
  opts: {
    extras?: number;
    descPct?: number;
    descRS?: number;
    acresPct?: number;
    acresRS?: number;
    descricao?: string;
  } = {}
): Promise<PricingResult> {
  // 1. Carregar configuração
  let cfg: ErpConfig | null;
  try {
    cfg = await loadErpConfig();
  } catch {
    return { eligibility: "TEMPORARILY_UNAVAILABLE" };
  }

  if (!cfg || !cfg.financeiro) {
    return {
      eligibility: "HUMAN_VALIDATION_REQUIRED",
      missingFields: ["cfg.financeiro"],
    };
  }

  const fin = cfg.financeiro;
  const overhead = ((fin.overhead ?? 41.16) / 100);
  const vrml     = ((fin.vrml     ?? 20)    / 100);
  const impostos = ((fin.impostos ?? 0)     / 100);
  const factor   = 1 - (overhead + vrml + impostos);

  if (factor <= 0) {
    return {
      eligibility: "HUMAN_VALIDATION_REQUIRED",
      missingFields: ["cfg.financeiro.overhead/vrml/impostos (fator ≤ 0)"],
    };
  }

  // 2. Validar itens
  if (!itens || itens.length === 0) {
    return {
      eligibility: "NEEDS_INFORMATION",
      missingFields: ["itens"],
    };
  }

  const missingFields: string[] = [];
  let matTotal  = 0;
  const mats    = cfg.materiais;

  for (let i = 0; i < itens.length; i++) {
    const it       = itens[i];
    const qty      = parseFloat(String(it.qty))  || 1;
    const larg     = parseFloat(String(it.larg)) || 0;
    const alt      = parseFloat(String(it.alt))  || 0;
    const planArea = parseFloat(String(it.planArea ?? 0));
    const useArea  = planArea > 0 ? planArea : larg * alt;

    if (useArea <= 0) {
      missingFields.push(`itens[${i}].larg+alt (área zerada)`);
      continue;
    }

    // rsm2 explícito (ex.: corte a laser sem material) — permitido se vier
    // de uma fonte oficial (não de texto livre do cliente)
    let priceM2 = parseFloat(String(it.rsm2 ?? 0));

    if (priceM2 <= 0 && it.matKey) {
      const mp = getMaterialPriceM2(it.matKey, mats);
      if (mp === null) {
        missingFields.push(`itens[${i}].matKey "${it.matKey}" não encontrado`);
        continue;
      }
      priceM2 = mp;
    }

    if (priceM2 <= 0) {
      missingFields.push(`itens[${i}].rsm2 ou matKey`);
      continue;
    }

    matTotal += (useArea / 10000) * priceM2 * qty;
  }

  // 3. Se há campos faltando — não podemos calcular
  if (missingFields.length > 0) {
    return { eligibility: "NEEDS_INFORMATION", missingFields };
  }

  // 4. Aplicar extras, descontos e acréscimos
  const extrasTotal = parseFloat(String(opts.extras ?? 0));
  const totalCost   = matTotal + extrasTotal;
  const descPct     = parseFloat(String(opts.descPct  ?? 0));
  const descRS      = parseFloat(String(opts.descRS   ?? 0));
  const acresPct    = parseFloat(String(opts.acresPct ?? 0));
  const acresRS     = parseFloat(String(opts.acresRS  ?? 0));

  let finalPrice = (totalCost / factor) * (1 - descPct / 100) - descRS;
  finalPrice = finalPrice * (1 + acresPct / 100) + acresRS;
  if (finalPrice < 0) finalPrice = 0;

  const breakdown: PricingBreakdown = {
    overhead: overhead * 100,
    vrml:     vrml     * 100,
    impostos: impostos * 100,
    factor:   Math.round(factor * 10000) / 100,
    extrasTotal,
    matTotal: Math.round(matTotal * 100) / 100,
  };

  // 5. Versão da regra (fingerprint da config financeira)
  const pricingVersion = [fin.overhead, fin.vrml, fin.impostos].join("_");

  return {
    eligibility:    "ELIGIBLE",
    finalPrice:     Math.round(finalPrice  * 100) / 100,
    totalCost:      Math.round(totalCost   * 100) / 100,
    matTotal:       Math.round(matTotal    * 100) / 100,
    breakdown,
    pricingVersion,
    simulationId:   `sim_${randomUUID()}`,
  };
}
