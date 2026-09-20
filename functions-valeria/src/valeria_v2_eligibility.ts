/**
 * valeria_v2_eligibility.ts — ValerIA 2.0, Fase B (fechamento, 2026-09-19).
 *
 * Correção conceitual pedida nesta etapa: `produtoElegivelValeria`
 * (vitre_eligibility.ts, espelho fiel de `functions/src/valeria_vitre.ts`)
 * foi desenhada para o papel da ValerIA LEGADO — que confirma preço,
 * mostra foto/descrição comercial completa, promete prazo. Isso não é o
 * papel da V2 (pré-atendimento/triagem: identifica produto, qualifica,
 * cria RASCUNHO, encaminha para revisão humana — nunca envia orçamento
 * final nem promete prazo sozinha). Exigir `fotos`/`prazoDias`/`embalagem`/
 * `pesoKg` para a V2 seria travar a homologação por dados que a V2 nem usa.
 *
 * Três conceitos deliberadamente SEPARADOS (nunca confundir):
 *   - CANÔNICO      = este é o SKU oficial que representa este produto/
 *                      tamanho no ERP (decisão comercial/cadastral, fora
 *                      de código — registrada em valeria_catalogos).
 *   - ELEGÍVEL V2    = evaluateValeriaV2ProductEligibility() abaixo —
 *                      dados mínimos que a V2 realmente precisa.
 *   - ATIVO PARA V1   = produtoElegivelValeria() (vitre_eligibility.ts) —
 *                       gate do fluxo legado, intocado, continua exigindo
 *                       ficha comercial completa.
 *
 * `ativoValeria` NÃO é lido aqui de propósito (seção 7/8 do plano
 * aprovado): a fonte de aprovação da V2 é `valeria_catalogos` (o produto
 * está referenciado num grupo homologado) — nunca o flag do fluxo legado,
 * para poder homologar a V2 sem mexer no legado.
 */

export interface V2EligibilityProductInput {
  id: string | null;
  sku?: string | null;
  nome?: string | null;
  status?: string | null;
  precoVenda?: number | null;
  larguraCm?: number | null;
  alturaCm?: number | null;
  profundidadeCm?: number | null;
}

export interface V2EligibilityContext {
  /** true quando o productId está referenciado no(s) tamanho(s) de um grupo ATIVO de valeria_catalogos. */
  homologadoNoGrupoV2: boolean;
  catalogGroupId: string | null;
  /** Só exigidos quando o produto/receita realmente depende disso (ex.: personalização de material). */
  requiresMaterial?: boolean;
  requiresEspessura?: boolean;
  material?: string | null;
  espessuraMm?: number | null;
}

export interface V2EligibilityResult {
  eligible: boolean;
  missingRequiredFields: string[];
  warnings: string[];
}

/**
 * evaluateValeriaV2ProductEligibility — única função que decide se a V2
 * pode oferecer/usar automaticamente este produto AGORA. Não lê
 * `ativoValeria`; não exige fotos/prazoDias/embalagem/pesoKg/categoria —
 * só os campos que o papel atual da V2 realmente consome (identificar,
 * qualificar, criar rascunho).
 */
export function evaluateValeriaV2ProductEligibility(
  product: V2EligibilityProductInput | null,
  ctx: V2EligibilityContext
): V2EligibilityResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!product) {
    return { eligible: false, missingRequiredFields: ["product"], warnings };
  }
  if (!product.id) missing.push("productId");
  if (!product.sku) missing.push("sku");
  if (!product.nome) missing.push("nome");
  if (product.status !== "ativo") missing.push("status_ativo");
  if (product.precoVenda == null || product.precoVenda <= 0) missing.push("precoVenda");
  if (product.larguraCm == null || product.alturaCm == null) missing.push("dimensoes"); // mínimo pra identificar o tamanho
  if (!ctx.homologadoNoGrupoV2) missing.push("homologadoNaConfigV2");
  if (ctx.requiresMaterial && !ctx.material) missing.push("material");
  if (ctx.requiresEspessura && ctx.espessuraMm == null) missing.push("espessura");

  if (product.status && product.status !== "ativo") {
    warnings.push(`status_nao_ativo:${product.status}`);
  }

  return { eligible: missing.length === 0, missingRequiredFields: missing, warnings };
}
