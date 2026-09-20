/**
 * qualification_body_parser.ts — ValerIA 2.0, Fase E.2 (2026-09-20).
 *
 * Único ponto de entrada para interpretar o body HTTP de
 * `valeriaUpdateCatalogQualification` — separa "o que veio na requisição"
 * (aceita tipos nativos OU as mesmas strings que o ChatVolt manda, ver
 * http_field_parsers.ts) de "o que o motor de decisão recebe" (sempre
 * tipado nativo, contrato de ResolutionSignals/FieldUpdate nunca muda).
 * Pura — não lê Firestore, não decide nada de negócio; só parsing +
 * validação de shape. `categoria` aqui devolve só o que veio no body —
 * o fallback para `draftAtual.category` continua no handler
 * (catalog_tools.ts), porque depende do draft carregado.
 *
 * SEGURANÇA: nunca lê `contextCatalogGroupId`, `contextMatchedProductId`,
 * `contextMatchedProductSku`, `matchedProductId`, `matchedProductSku`,
 * `resolutionType`, `qualificationStatus`, `sendable`, `isTest`, preço ou
 * `nextAction` do body — esses sinais são sempre derivados server-side
 * (draftAtual/atendimento real), nunca aceitos do caller.
 */
import {
  parseOptionalString,
  parseOptionalNumber,
  parseOptionalBoolean,
  parseOptionalExactDimensions,
  parseOptionalCustomDimensions,
  parseOptionalDeliveryData,
  parseOptionalStringArray,
} from "./http_field_parsers";

export interface ParsedQualificationBody {
  categoria: string | null;
  explicitSkuOrProductId: string | null;
  groupNameOrAlias: string | null;
  catalogSizeLabel: string | null;
  exactDimensionsCm: { largura: number; altura: number; profundidade?: number | null } | null;
  vagueSizeHintCm: number | null;
  customerExplicitlyRequestsCustom: boolean;
  clientConfirmedSuggestedOption: boolean;
  quantity: number | null;
  customDimensions: { larguraCm: number; alturaCm: number; profundidadeCm?: number | null } | null;
  personalization: string[] | undefined;
  desiredDeadline: string | null;
  deliveryData: { cidade?: string | null; observacoes?: string | null } | null;
}

/** Pode lançar FieldParseError (http_field_parsers.ts) — o handler converte em resposta 400. */
export function parseUpdateQualificationBody(body: Record<string, unknown>): ParsedQualificationBody {
  return {
    categoria: parseOptionalString(body["categoria"]),
    explicitSkuOrProductId: parseOptionalString(body["explicitSkuOrProductId"]),
    groupNameOrAlias: parseOptionalString(body["groupNameOrAlias"]),
    catalogSizeLabel: parseOptionalString(body["catalogSizeLabel"]),
    exactDimensionsCm: parseOptionalExactDimensions("exactDimensionsCm", body["exactDimensionsCm"]),
    vagueSizeHintCm: parseOptionalNumber("vagueSizeHintCm", body["vagueSizeHintCm"]),
    customerExplicitlyRequestsCustom: parseOptionalBoolean("customerExplicitlyRequestsCustom", body["customerExplicitlyRequestsCustom"]) === true,
    clientConfirmedSuggestedOption: parseOptionalBoolean("clientConfirmedSuggestedOption", body["clientConfirmedSuggestedOption"]) === true,
    quantity: parseOptionalNumber("quantity", body["quantity"]),
    customDimensions: parseOptionalCustomDimensions("customDimensions", body["customDimensions"]),
    personalization: parseOptionalStringArray("personalization", body["personalization"]),
    desiredDeadline: parseOptionalString(body["desiredDeadline"]),
    deliveryData: parseOptionalDeliveryData("deliveryData", body["deliveryData"]),
  };
}
