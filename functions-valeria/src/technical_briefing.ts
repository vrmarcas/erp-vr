/**
 * technical_briefing.ts — schema técnico canônico (sprint P0.3, Bloco A).
 *
 * Resolve o bloqueio real identificado na sprint anterior: `orchestrator.ts`
 * usava nomes/unidades do briefing CONVERSACIONAL genérico (larguraMm,
 * material como texto livre — pensado para catálogo/Vitre, onde não há
 * cálculo geométrico) enquanto `quote_core.ts` (motor real) espera nomes
 * técnicos exatos (`larg`/`alt`/`prof` em cm, `matKey`, `esp` em mm).
 * `missingFields` do orchestrator não batia com o que as Tools de produto
 * personalizado realmente exigiam.
 *
 * TechnicalBriefing é o schema ÚNICO que tanto o orchestrator quanto o
 * quote_core consomem para produto VR personalizado — elimina a
 * duplicidade, não cria uma terceira representação.
 *
 * Unidade canônica interna: MILÍMETROS (mm) — decisão do sprint (Bloco A2).
 * A conversão cm/m→mm acontece UMA vez, na borda (parseFlexibleLength),
 * nunca espalhada pelas Functions. `quote_core.ts`/`recipes.ts` continuam
 * trabalhando em CENTÍMETROS internamente (é a unidade das fórmulas
 * PLAN_RECIPES portadas fielmente do frontend — mudar isso reabriria risco
 * de quebrar a paridade geométrica já comprovada) — a conversão mm→cm
 * acontece explicitamente em UM ÚNICO ponto (toQuoteCoreInput), documentado
 * abaixo, não em cada Function.
 */

import { PLAN_BUILTIN_NAMES, resolveRecipe } from "./recipes";
import type { MaterialConfig } from "./types";

export interface TechnicalDimensions {
  larguraMm: number | null;   // L
  alturaMm: number | null;    // A
  profundidadeMm: number | null; // P — só produtos dim3d
}

export interface TechnicalBriefing {
  productId: string | null; // = nome da receita (PLAN_RECIPES) hoje — ver nota em recipes.ts sobre não usar erp_plan_produtos
  recipeVersion: number;    // fixo em 1 enquanto não houver versionamento de receita embutida
  dimensions: TechnicalDimensions;
  quantity: number | null;
  materialId: string | null;  // = matKey (cfg_N)
  thicknessMm: number | null; // esp
  /**
   * Sprint P0.4 — consumíveis que afetam preço (Bloco C), rastreados aqui
   * para que technicalBriefingFingerprint() detecte mudança neles também
   * (nunca só geometria/material). null/undefined = nunca informado
   * nesta conversa (equivalente a false para fins de preço).
   */
  adesivo?: boolean | null;
  adesivoBranco?: boolean | null;
  confirmedFields: string[];
  missingRequiredFields: string[];
}

const CAMPO_ORDEM = ["productId", "larguraMm", "alturaMm", "profundidadeMm", "quantity", "materialId", "thicknessMm"] as const;

export function emptyTechnicalBriefing(): TechnicalBriefing {
  return {
    productId: null,
    recipeVersion: 1,
    dimensions: { larguraMm: null, alturaMm: null, profundidadeMm: null },
    quantity: null,
    materialId: null,
    thicknessMm: null,
    confirmedFields: [],
    missingRequiredFields: [...CAMPO_ORDEM],
  };
}

/**
 * Bloco A2 — conversão de unidade na borda, uma única vez.
 * Aceita number (assume mm) ou string com unidade explícita
 * ("15cm", "150mm", "0,15m", "15 cm"). Nunca adivinha unidade por
 * heurística de magnitude — se a Tool não informar unidade e o valor for
 * ambíguo, o chamador deve passar string explícita.
 */
export function parseFlexibleLength(input: number | string | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;

  const s = String(input).trim().toLowerCase().replace(",", ".");
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m)?$/);
  if (!m) return null;
  const valor = parseFloat(m[1]);
  const unidade = m[2] || "mm";
  if (unidade === "mm") return valor;
  if (unidade === "cm") return valor * 10;
  if (unidade === "m") return valor * 1000;
  return null;
}

/**
 * P0.4 (achado real de E2E) — largura/altura/profundidade: quando o
 * cliente fala "40x30x25cm" e o LLM manda um número puro sem unidade, é
 * CENTÍMETRO (convenção do motor de cálculo, calcular_produto_
 * personalizado's larg/alt/prof) — nunca milímetro. parseFlexibleLength()
 * sozinho assume mm num número puro, o que é certo para espessura (ex.
 * "5" = 5mm) mas errado para dimensão (faria "40" virar 40mm em vez de
 * 400mm, encolhendo a peça 10x). Use esta função só para largura/altura/
 * profundidade; espessura continua em parseFlexibleLength() direto.
 */
export function parseDimensionLengthMm(input: number | string | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;

  const s = String(input).trim();
  if (/[a-zA-Z]/.test(s)) return parseFlexibleLength(s); // unidade explícita, ex. "40cm"/"400mm"
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n * 10 : null; // número puro = cm
}

/**
 * Bloco A3 — material canônico. Nunca aceita "acrílico cristal 3mm" como
 * identificador técnico — resolve para o matKey real (cfg_N) comparando
 * com a lista de materiais REAL do ERP (mesma fonte de
 * valeriaListarMateriais). Retorna null se não conseguir resolver com
 * confiança (nunca aproxima "chute").
 *
 * Bloco H (sprint P0.3, achado real de E2E conversacional) — famílias de
 * material real são nomeadas por linha + espessura ("Acrílico Cristal
 * 2mm".."20mm", 11 variantes) — "acrílico cristal" sozinho é
 * genuinamente ambíguo (11 candidatos parciais). Quando o chamador já
 * informou `espMm` NA MESMA chamada (dado real, não inventado), usa isso
 * para desempatar ENTRE os candidatos já filtrados pelo nome — nunca
 * para ampliar a busca, só para escolher entre opções que já bateram no
 * texto. Se não restar exatamente 1 depois do desempate, continua
 * retornando null (mesma disciplina de nunca aproximar).
 *
 * Bloco H (achado real de E2E conversacional via Chatvolt) — o LLM
 * reescreve o texto do material de formas imprevisíveis mesmo quando o
 * cliente disse o nome exato: sem acento ("acrilico cristal"), com
 * underscore no lugar de espaço ("acrilico_cristal"), etc. Comparação
 * por substring exato quebrava a cada variação nova. `tokenizar` reduz
 * tanto o texto recebido quanto o nome real a um conjunto de palavras
 * (remove acento, minúsculo, quebra em qualquer separador não
 * alfanumérico) — o match exige que TODAS as palavras do texto recebido
 * apareçam no nome real, nunca aproxima palavra nenhuma. Ainda é um
 * match exato de conteúdo, só tolerante a formatação/pontuação.
 */
function tokenizar(s: string): string[] {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function resolveMaterialId(
  textoOuMatKey: string,
  materiaisReais: Array<{ matKey: string; nome: string }>,
  espMm?: number | null
): string | null {
  const alvo = textoOuMatKey.trim();
  if (!alvo) return null;
  // Já é um matKey válido (veio de uma Tool anterior, ex.: consultar_materiais_vr)
  if (materiaisReais.some((m) => m.matKey === alvo)) return alvo;
  const alvoTokens = tokenizar(alvo);
  if (alvoTokens.length === 0) return null;
  // Match exato — mesmo conjunto de palavras, em qualquer ordem/separador
  const porNomeExato = materiaisReais.find((m) => {
    const nomeTokens = tokenizar(m.nome);
    return nomeTokens.length === alvoTokens.length && alvoTokens.every((t) => nomeTokens.includes(t));
  });
  if (porNomeExato) return porNomeExato.matKey;
  // Match parcial (todas as palavras do texto aparecem no nome real, nome pode ter mais) — só aceita se INEQUÍVOCO
  const porNomeParcial = materiaisReais.filter((m) => {
    const nomeTokens = tokenizar(m.nome);
    return alvoTokens.every((t) => nomeTokens.includes(t));
  });
  if (porNomeParcial.length === 1) return porNomeParcial[0].matKey;
  if (porNomeParcial.length > 1 && espMm != null && espMm > 0) {
    const porEspessura = porNomeParcial.filter((m) => {
      const mm = m.nome.match(/(\d+(?:\.\d+)?)\s*mm/i);
      return mm && parseFloat(mm[1]) === espMm;
    });
    if (porEspessura.length === 1) return porEspessura[0].matKey;
  }
  return null;
}

/**
 * Bloco A5 — quoteReadiness técnico: os MESMOS campos que quote_core
 * exige, nunca uma lista paralela. `productId` reconhecido determina se
 * `profundidadeMm` é obrigatório (dim3d).
 */
export function computeTechnicalReadiness(b: TechnicalBriefing): {
  ready: boolean;
  missingRequiredFields: string[];
  reconhecido: boolean;
} {
  const reconhecido = !!b.productId && PLAN_BUILTIN_NAMES.includes(b.productId);
  const rec = b.productId ? resolveRecipe(b.productId) : null;

  const missing: string[] = [];
  if (!b.productId) missing.push("productId");
  if (!(b.dimensions.larguraMm && b.dimensions.larguraMm > 0)) missing.push("larguraMm");
  if (!(b.dimensions.alturaMm && b.dimensions.alturaMm > 0)) missing.push("alturaMm");
  if (rec?.dim3d && !(b.dimensions.profundidadeMm && b.dimensions.profundidadeMm > 0)) missing.push("profundidadeMm");
  if (!(b.thicknessMm && b.thicknessMm > 0)) missing.push("thicknessMm");
  if (!b.materialId) missing.push("materialId");
  if (!(b.quantity && b.quantity > 0)) missing.push("quantity");

  return { ready: missing.length === 0, missingRequiredFields: missing, reconhecido };
}

/**
 * Bloco A4 — adaptador technicalBriefing → quote_core (a ÚNICA conversão
 * mm→cm do sistema). `larg`/`alt`/`prof` de quote_core são em CENTÍMETROS
 * (fórmulas PLAN_RECIPES originais do frontend); `esp` é em MILÍMETROS
 * (mesma unidade que o frontend sempre usou para espessura).
 */
export function toQuoteCoreInput(b: TechnicalBriefing): {
  produto: string; larg: number; alt: number; prof?: number; esp: number; matKey: string; qty: number;
} | null {
  const readiness = computeTechnicalReadiness(b);
  if (!readiness.ready) return null;
  return {
    produto: b.productId!,
    larg: b.dimensions.larguraMm! / 10,
    alt: b.dimensions.alturaMm! / 10,
    prof: b.dimensions.profundidadeMm ? b.dimensions.profundidadeMm / 10 : undefined,
    esp: b.thicknessMm!,
    matKey: b.materialId!,
    qty: b.quantity!,
  };
}

export function materiaisParaResolucao(materiais: MaterialConfig[]): Array<{ matKey: string; nome: string }> {
  return materiais.map((m, i) => ({ matKey: `cfg_${i}`, nome: m.nome || `Material ${i + 1}` }));
}

/**
 * Sprint P0.4 (P0.2) — fingerprint determinístico dos campos que afetam
 * PREÇO, nunca dos campos derivados (confirmedFields/missingRequiredFields/
 * recipeVersion). Usado para detectar se uma simulação já calculada ainda
 * corresponde ao briefing ATUAL da conversa — se qualquer campo aqui
 * mudar (quantidade, material, espessura, largura, altura, profundidade,
 * adesivo, adesivoBranco), o fingerprint muda e a simulação anterior é
 * tratada como desatualizada. Não é um hash criptográfico — só precisa
 * ser determinístico e sensível a qualquer mudança real, uma string JSON
 * normalizada já cumpre isso e fica auditável em log.
 */
export function technicalBriefingFingerprint(b: TechnicalBriefing): string {
  return JSON.stringify({
    productId: b.productId,
    larguraMm: b.dimensions.larguraMm,
    alturaMm: b.dimensions.alturaMm,
    profundidadeMm: b.dimensions.profundidadeMm,
    quantity: b.quantity,
    materialId: b.materialId,
    thicknessMm: b.thicknessMm,
    adesivo: !!b.adesivo,
    adesivoBranco: !!b.adesivoBranco,
  });
}
