/**
 * response.ts — Construtor de respostas padronizadas
 * Nunca expõe stack trace, secrets, custos internos, margens ou fórmulas.
 */

import { randomUUID } from "crypto";
import type { ApiResponse, ApiMeta, ApiError } from "./types";

export const API_VERSION = "2.0.0";
export const API_SOURCE = "valeria-api";

function buildMeta(): ApiMeta {
  return {
    requestId: randomUUID(),
    source: API_SOURCE,
    apiVersion: API_VERSION,
    timestamp: new Date().toISOString(),
  };
}

export function ok<T>(
  data: T,
  opts: {
    meta?: Partial<ApiMeta>;
    verified?: boolean;
    communicableToCustomer?: boolean;
    humanValidationRequired?: boolean;
    warnings?: string[];
  } = {}
): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: { ...buildMeta(), ...opts.meta },
    verified: opts.verified ?? true,
    communicableToCustomer: opts.communicableToCustomer ?? false,
    humanValidationRequired: opts.humanValidationRequired ?? false,
    warnings: opts.warnings,
  };
}

export function err(
  code: string,
  message: string,
  opts: {
    details?: string;
    communicableToCustomer?: boolean;
    humanValidationRequired?: boolean;
    missingFields?: string[];
    warnings?: string[];
  } = {}
): ApiResponse<never> {
  const error: ApiError = { code, message };
  if (opts.details) error.details = opts.details;
  return {
    success: false,
    error,
    meta: buildMeta(),
    verified: false,
    communicableToCustomer: opts.communicableToCustomer ?? false,
    humanValidationRequired: opts.humanValidationRequired ?? false,
    missingFields: opts.missingFields,
    warnings: opts.warnings,
  };
}

// Respostas padronizadas de elegibilidade de orçamento
export const QUOTE_RESPONSES = {
  needsInformation: (missingFields: string[]) =>
    err("NEEDS_INFORMATION", "Dados insuficientes para calcular o orçamento.", {
      communicableToCustomer: true,
      missingFields,
    }),
  humanValidationRequired: (reason: string) =>
    err("HUMAN_VALIDATION_REQUIRED", reason, {
      communicableToCustomer: true,
      humanValidationRequired: true,
    }),
  unsupported: (productType: string) =>
    err(
      "UNSUPPORTED",
      `O produto "${productType}" não pode ser calculado automaticamente.`,
      { communicableToCustomer: true, humanValidationRequired: true }
    ),
  temporarilyUnavailable: () =>
    err("TEMPORARILY_UNAVAILABLE", "Motor de orçamento temporariamente indisponível.", {
      communicableToCustomer: true,
    }),
};
