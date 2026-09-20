/**
 * http_field_parsers.ts — ValerIA 2.0, Fase E.2 (borda HTTP, 2026-09-20).
 *
 * A inspeção real e somente-leitura do ChatVolt (Tools `atualizar_briefing_tecnico`
 * e `buscar_contexto_da_conversa`, modo JSON) confirmou que o único tipo de
 * campo comprovado no schema de Tools HTTP do ChatVolt hoje é `"type":"string"`
 * — não há nenhuma Tool real e ativa usando `number`/`boolean`/`object`/`array`
 * nesse schema. Como o ChatVolt pode serializar `quantity`, booleans,
 * `exactDimensionsCm`, `personalization` etc. como STRING (ex.: `"10"`,
 * `"true"`, `'{"largura":35,...}'`), estes parsers aceitam tanto o tipo
 * nativo (JSON real, testes HTTP diretos) quanto a string equivalente, e
 * sempre devolvem o tipo nativo — o resto do pipeline (resolveProductMatch,
 * mergeSignalsIntoDraft, qualification_engine, etc.) nunca vê string onde
 * espera number/boolean/object/array.
 *
 * Deliberadamente SEM coerção JS ingênua: `Boolean("false") === true`, então
 * nunca usamos `Boolean(x)` para strings. Cada parser rejeita explicitamente
 * o que não reconhece, lançando `FieldParseError` (a borda HTTP decide o
 * status/mensagem — ver catalog_tools.ts).
 */

export class FieldParseError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "FieldParseError";
  }
}

/** string | null → string trimada ou null (nunca converte number/boolean em string às cegas). */
export function parseOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * number | "10" | "10.5" → number. Rejeita "dez", "10 unidades", NaN,
 * Infinity, string vazia como número (string vazia vira null, não 0).
 */
export function parseOptionalNumber(field: string, value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new FieldParseError(field, `${field}: número inválido (NaN/Infinity).`);
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new FieldParseError(field, `${field}: string não representa um número válido: "${value}".`);
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) throw new FieldParseError(field, `${field}: número inválido: "${value}".`);
    return n;
  }
  throw new FieldParseError(field, `${field}: tipo inesperado para número (${typeof value}).`);
}

/**
 * boolean | "true" | "false" → boolean. Qualquer outra string é rejeitada
 * explicitamente — nunca vira `true` por coerção acidental (a razão de ser
 * deste parser: `Boolean("false") === true` no JS puro).
 */
export function parseOptionalBoolean(field: string, value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    throw new FieldParseError(field, `${field}: string não representa um booleano válido: "${value}" (aceito apenas "true"/"false").`);
  }
  throw new FieldParseError(field, `${field}: tipo inesperado para booleano (${typeof value}).`);
}

/** Faz JSON.parse só quando o valor é string; devolve o valor como está caso já seja objeto/array/null nativo. */
function parseJsonIfString(field: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new FieldParseError(field, `${field}: JSON inválido: "${value}".`);
  }
}

/** Shape de ResolutionSignals.exactDimensionsCm: { largura, altura, profundidade? }. */
export function parseOptionalExactDimensions(
  field: string,
  value: unknown
): { largura: number; altura: number; profundidade?: number | null } | null {
  if (value === undefined || value === null) return null;
  const parsed = parseJsonIfString(field, value);
  if (parsed === null) return null;
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FieldParseError(field, `${field}: esperado objeto com largura/altura.`);
  }
  const obj = parsed as Record<string, unknown>;
  const largura = parseOptionalNumber(`${field}.largura`, obj["largura"]);
  const altura = parseOptionalNumber(`${field}.altura`, obj["altura"]);
  if (largura === null || altura === null) {
    throw new FieldParseError(field, `${field}: largura e altura são obrigatórias.`);
  }
  const profundidade = parseOptionalNumber(`${field}.profundidade`, obj["profundidade"]);
  return { largura, altura, profundidade: profundidade ?? null };
}

/** Shape de FieldUpdate.customDimensions: { larguraCm, alturaCm, profundidadeCm? }. */
export function parseOptionalCustomDimensions(
  field: string,
  value: unknown
): { larguraCm: number; alturaCm: number; profundidadeCm?: number | null } | null {
  if (value === undefined || value === null) return null;
  const parsed = parseJsonIfString(field, value);
  if (parsed === null) return null;
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FieldParseError(field, `${field}: esperado objeto com larguraCm/alturaCm.`);
  }
  const obj = parsed as Record<string, unknown>;
  const larguraCm = parseOptionalNumber(`${field}.larguraCm`, obj["larguraCm"]);
  const alturaCm = parseOptionalNumber(`${field}.alturaCm`, obj["alturaCm"]);
  if (larguraCm === null || alturaCm === null) {
    throw new FieldParseError(field, `${field}: larguraCm e alturaCm são obrigatórias.`);
  }
  const profundidadeCm = parseOptionalNumber(`${field}.profundidadeCm`, obj["profundidadeCm"]);
  return { larguraCm, alturaCm, profundidadeCm: profundidadeCm ?? null };
}

/** Shape de FieldUpdate.deliveryData: { cidade?, observacoes? } — ambos opcionais, sem exigir presença de nenhum. */
export function parseOptionalDeliveryData(
  field: string,
  value: unknown
): { cidade?: string | null; observacoes?: string | null } | null {
  if (value === undefined || value === null) return null;
  const parsed = parseJsonIfString(field, value);
  if (parsed === null) return null;
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FieldParseError(field, `${field}: esperado objeto com cidade/observacoes.`);
  }
  const obj = parsed as Record<string, unknown>;
  return { cidade: parseOptionalString(obj["cidade"]), observacoes: parseOptionalString(obj["observacoes"]) };
}

/**
 * string[] | '["a","b"]' → string[]. Rejeita qualquer item que não seja
 * string (nunca aceita objetos dentro do array). `undefined` quando o
 * campo não veio — distinto de `[]`, que é "cliente confirmou zero itens".
 */
export function parseOptionalStringArray(field: string, value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = parseJsonIfString(field, value);
  if (parsed === undefined || parsed === null) return undefined;
  if (!Array.isArray(parsed)) throw new FieldParseError(field, `${field}: esperado array.`);
  if (!parsed.every((item) => typeof item === "string")) {
    throw new FieldParseError(field, `${field}: todos os itens do array devem ser string.`);
  }
  return parsed as string[];
}
