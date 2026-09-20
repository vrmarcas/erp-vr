/**
 * custom_briefing_patch.ts — ValerIA 2.0, Fase C.1 (endurecimento operacional, 2026-09-19).
 *
 * Função PURA extraída de catalog_tools.ts para ser testável sem
 * Firestore: monta o patch que semeia o TechnicalBriefing existente
 * quando a resolução vira CUSTOM_REQUESTED/CUSTOM_REQUIRED — nunca decide
 * SE deve rodar (isso é `computeQualificationState`), só monta O QUE
 * gravar a partir do estado já resolvido.
 *
 * dims.*Cm vêm em CENTÍMETROS (convenção do motor/CatalogDraft) — usa
 * `parseDimensionLengthMm`, não `parseFlexibleLength` direto, porque um
 * número puro sem unidade é CM aqui, não MM (mesmo cuidado documentado em
 * technical_briefing.ts:151-159 — um bug real de outra sprint).
 */
import { parseDimensionLengthMm } from "./technical_briefing";
import type { TechnicalBriefing } from "./technical_briefing";

export interface CustomBriefingPatchInput {
  baseCatalogGroupId: string | null;
  baseProductId: string | null;
  baseProductSku: string | null;
  receitaProductId: string | null; // ex.: "Caixa" — nome de receita PLAN_RECIPES, só quando a categoria for reconhecida
  quantity: number | null;
  customDimensions: { larguraCm: number; alturaCm: number; profundidadeCm?: number | null } | null;
  /** espessura padrão do grupo (mm), só aplicada quando o briefing atual ainda não tem nenhuma. */
  espessuraPadraoMmDoGrupo: number | null;
  thicknessMmAtual: number | null | undefined;
  /** Fase E.1.2 — derivado por catalog_tools.ts de atendimentos/{id}.isTeste, nunca inferido aqui. */
  isTest?: boolean | null;
}

export function buildCustomTechnicalBriefingPatch(input: CustomBriefingPatchInput): Partial<TechnicalBriefing> {
  const patch: Partial<TechnicalBriefing> = {
    baseCatalogGroupId: input.baseCatalogGroupId,
    baseProductId: input.baseProductId,
    baseProductSku: input.baseProductSku,
    ...(input.isTest !== undefined ? { isTest: input.isTest } : {}),
  };

  if (input.receitaProductId) patch.productId = input.receitaProductId;
  if (input.quantity) patch.quantity = input.quantity;

  if (input.customDimensions) {
    // IMPORTANTE: parseDimensionLengthMm só aplica a conversão cm→mm (×10)
    // quando recebe STRING — um `number` puro é devolvido como já sendo mm
    // (mesmo contrato usado em valeria.ts: sempre `String(valor)`). Nunca
    // passar o number direto aqui, senão a peça encolhe 10x silenciosamente.
    patch.dimensions = {
      larguraMm: parseDimensionLengthMm(String(input.customDimensions.larguraCm)) ?? 0,
      alturaMm: parseDimensionLengthMm(String(input.customDimensions.alturaCm)) ?? 0,
      profundidadeMm:
        input.customDimensions.profundidadeCm != null
          ? parseDimensionLengthMm(String(input.customDimensions.profundidadeCm))
          : null,
    };
  }

  // Default herdado do grupo — só quando o cliente ainda não informou
  // nenhuma espessura (nunca sobrescreve um valor já confirmado pelo
  // cliente: source=CUSTOMER sempre vence source=CATALOG_GROUP).
  if (input.espessuraPadraoMmDoGrupo && !input.thicknessMmAtual) {
    patch.thicknessMm = input.espessuraPadraoMmDoGrupo;
  }

  return patch;
}
