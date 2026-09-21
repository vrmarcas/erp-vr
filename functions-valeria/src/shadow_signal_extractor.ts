/**
 * shadow_signal_extractor.ts — ValerIA 2.0, Fase E.2.8 (2026-09-20).
 *
 * Extração determinística de sinais de catálogo a partir do texto cru,
 * SEM LLM — placeholder explícito para esta fase de observação (o
 * objetivo desta fase é provar classificação+validação+zero-side-effect
 * sobre tráfego real, não a precisão de extração). Usa só correspondência
 * de alias/dimensão/quantidade contra o catálogo já carregado — nunca
 * decide intenção (isso é interaction_classifier.ts). Função PURA.
 */
import type { CatalogGroup, ResolutionSignals } from "./product_resolution";
import type { FieldUpdate } from "./catalog_draft";

function norm(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function findGroupAlias(text: string, groups: CatalogGroup[]): { categoria: string | null; groupNameOrAlias: string | null } {
  const t = norm(text);
  for (const g of groups) {
    const candidatos = [g.nome, ...g.aliases];
    for (const c of candidatos) {
      if (t.includes(norm(c))) {
        return { categoria: g.categoria, groupNameOrAlias: c };
      }
    }
  }
  return { categoria: null, groupNameOrAlias: null };
}

function extractDimensions(text: string): { largura: number; altura: number; profundidade?: number | null } | null {
  const m = text.match(/(\d+)\s*x\s*(\d+)(?:\s*x\s*(\d+))?/i);
  if (!m) return null;
  return {
    largura: Number(m[1]),
    altura: Number(m[2]),
    profundidade: m[3] ? Number(m[3]) : null,
  };
}

function extractQuantity(text: string): number | null {
  const patterns = [/\bpreciso\s+de\s+(\d+)\b/i, /\bquero\s+(\d+)\b/i, /\b(\d+)\s*(unidades?|pe[cç]as?|trof[eé]us?|caixas?|placas?)\b/i];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return Number(m[1]);
  }
  return null;
}

export function extractShadowSignals(text: string, catalogGroups: CatalogGroup[]): { signals: ResolutionSignals; fieldUpdate: FieldUpdate } {
  const { categoria, groupNameOrAlias } = findGroupAlias(text, catalogGroups);
  const exactDimensionsCm = extractDimensions(text);
  const quantity = extractQuantity(text);

  const signals: ResolutionSignals = {
    categoria,
    groupNameOrAlias,
    exactDimensionsCm: exactDimensionsCm ?? undefined,
  };
  const fieldUpdate: FieldUpdate = {
    category: categoria,
    quantity: quantity ?? undefined,
  };
  return { signals, fieldUpdate };
}
