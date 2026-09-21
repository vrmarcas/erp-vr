/**
 * shadow_signal_extractor.ts — ValerIA 2.0, Fase E.2.8 (2026-09-20),
 * estendido na Fase E.2.22 (2026-09-21) com extração de tamanho P/M/G e
 * sinais de contexto (continuidade multi-turno).
 *
 * Extração determinística de sinais de catálogo a partir do texto cru,
 * SEM LLM — placeholder explícito para esta fase de observação (o
 * objetivo desta fase é provar classificação+validação+zero-side-effect
 * sobre tráfego real, não a precisão de extração). Usa só correspondência
 * de alias/dimensão/quantidade/tamanho contra o catálogo já carregado —
 * nunca decide intenção (isso é interaction_classifier.ts). Função PURA
 * (só recebe `priorDraft` já carregado pelo chamador — nunca lê
 * Firestore aqui, `import type` não traz o SDK do Firestore em runtime).
 *
 * Tamanho (P/M/G): formas explícitas ("tamanho M", "modelo G", "quero o
 * P", "tamanho médio", "pequeno", "grande") são sempre reconhecidas,
 * independente de contexto — são específicas o bastante para não gerar
 * falso positivo (ver testes negativos: "me manda", "modelo" sozinho,
 * "material" nunca disparam). Uma LETRA ISOLADA sem nenhuma palavra-âncora
 * (mensagem é só "G", por exemplo) só é interpretada como tamanho quando
 * `priorDraft` indica um campo de tamanho pendente (grupo já resolvido,
 * produto ainda não) — nunca assumida às cegas.
 */
import type { CatalogGroup, ResolutionSignals } from "./product_resolution";
import type { FieldUpdate } from "./catalog_draft";
import type { CatalogDraft } from "./catalog_draft";

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

const SIZE_WORD_TO_LABEL: Record<string, string> = {
  pequeno: "P",
  pequena: "P",
  medio: "M",
  media: "M",
  grande: "G",
};

/** true quando o draft anterior já tem grupo resolvido mas nenhum produto/tamanho ainda — "tamanho" é o campo pendente. */
function hasPendingSizeContext(priorDraft: CatalogDraft | null | undefined): boolean {
  return !!(priorDraft && priorDraft.catalogGroupId && !priorDraft.matchedProductId);
}

function extractCatalogSizeLabel(text: string, priorDraft: CatalogDraft | null | undefined): string | null {
  const t = norm(text);

  // Formas explícitas com âncora — sempre reconhecidas, independente de contexto.
  let m = t.match(/\btamanho\s+([pmg])\b/);
  if (m) return m[1].toUpperCase();
  m = t.match(/\btamanho\s+(pequeno|pequena|medio|media|grande)\b/);
  if (m) return SIZE_WORD_TO_LABEL[m[1]];

  m = t.match(/\bmodelo\s+([pmg])\b/);
  if (m) return m[1].toUpperCase();

  m = t.match(/\b(?:quero|prefiro|vou querer)\s+o\s+([pmg])\b/);
  if (m) return m[1].toUpperCase();

  m = t.match(/\bpode\s+ser\s+(?:o\s+)?([pmg])\b/);
  if (m) return m[1].toUpperCase();

  // Palavra explícita isolada (pequeno/pequena/medio/media/grande) — específica o
  // bastante para não precisar de contexto ("o grande", "quero o pequeno", "pequeno" sozinho).
  m = t.match(/\b(pequeno|pequena|medio|media|grande)\b/);
  if (m) return SIZE_WORD_TO_LABEL[m[1]];

  // Letra isolada, SEM nenhuma âncora — só interpretada como tamanho quando a
  // mensagem inteira é só essa letra E existe um campo de tamanho pendente no
  // draft anterior (nunca assumida às cegas — ver cabeçalho do arquivo).
  if (hasPendingSizeContext(priorDraft)) {
    m = t.match(/^([pmg])[.!]?$/);
    if (m) return m[1].toUpperCase();
  }

  return null;
}

export function extractShadowSignals(
  text: string,
  catalogGroups: CatalogGroup[],
  priorDraft?: CatalogDraft | null
): { signals: ResolutionSignals; fieldUpdate: FieldUpdate } {
  const { categoria, groupNameOrAlias } = findGroupAlias(text, catalogGroups);
  const exactDimensionsCm = extractDimensions(text);
  const quantity = extractQuantity(text);
  const catalogSizeLabel = extractCatalogSizeLabel(text, priorDraft);

  const signals: ResolutionSignals = {
    categoria,
    groupNameOrAlias,
    exactDimensionsCm: exactDimensionsCm ?? undefined,
    catalogSizeLabel: catalogSizeLabel ?? undefined,
    // Sinais de contexto (Fase E.2.22) — SEMPRE derivados do draft já
    // persistido pelo chamador, NUNCA do LLM/texto — mesma disciplina de
    // isTeste/isTest em todo o projeto.
    contextCatalogGroupId: priorDraft?.catalogGroupId ?? undefined,
    contextMatchedProductId: priorDraft?.matchedProductId ?? undefined,
    contextMatchedProductSku: priorDraft?.matchedProductSku ?? undefined,
  };
  const fieldUpdate: FieldUpdate = {
    category: categoria,
    quantity: quantity ?? undefined,
  };
  return { signals, fieldUpdate };
}
