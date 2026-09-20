/**
 * catalog_validity.ts — ValerIA 2.0, Fase D.4.1 (2026-09-19).
 *
 * Regra genérica (primeiro catálogo vencido real: Urnas, validUntil
 * 2026-04-30): CATÁLOGO CONHECIDO ≠ CATÁLOGO ENVIÁVEL. Um catálogo pode
 * existir em `valeria_catalogos` como fonte documental (a ValerIA
 * reconhece modelos/medidas/atributos) mesmo vencido — só não pode ser
 * tratado como vigente para 3 coisas: enviar o PDF/URL ao cliente,
 * apresentar o preço publicado como preço atual, ou afirmar que os
 * valores continuam válidos. Proteção de BACKEND, não só de prompt —
 * `isCatalogSendable` é o único ponto de decisão, nunca inferido ad hoc
 * em cada Tool.
 *
 * Módulo PURO: relógio sempre injetado (`now: Date`), nunca `new Date()`
 * direto aqui — testável sem depender do dia real.
 */

export interface CatalogValidityInput {
  ativo: boolean;
  urlCatalogo: string | null;
  validUntil: string | null; // "YYYY-MM-DD", mesmo formato já usado em CatalogConfig
}

/**
 * validUntil null → NUNCA inferimos vencimento (decisão explícita: sem
 * data de validade cadastrada, o catálogo é tratado como válido — a
 * ausência de dado não é evidência de que venceu). validUntil presente →
 * válido até o FIM do dia informado (23:59:59.999, mesma zona do `now`
 * recebido — o chamador decide a zona, este módulo só compara).
 */
export function isCatalogCurrentlyValid(catalog: Pick<CatalogValidityInput, "validUntil">, now: Date): boolean {
  if (!catalog.validUntil) return true; // sem validade cadastrada — nunca inferir vencimento
  const [ano, mes, dia] = catalog.validUntil.split("-").map(Number);
  if (!ano || !mes || !dia) return true; // formato inesperado — nunca travar o catálogo por dado malformado, mas nunca inventar também (ver nota abaixo)
  const fimDoDia = new Date(ano, mes - 1, dia, 23, 59, 59, 999);
  return now.getTime() <= fimDoDia.getTime();
}

/**
 * catalogSendable = ativo AND urlCatalogo != null AND catálogo não
 * vencido. Os 3 gates juntos — nunca um substituindo o outro. Este é o
 * ÚNICO ponto que decide "posso enviar/apresentar como vigente" — a
 * ValerIA nunca deve ter esse julgamento espalhado em mais de um lugar.
 */
export function isCatalogSendable(catalog: CatalogValidityInput, now: Date): boolean {
  return catalog.ativo && catalog.urlCatalogo != null && isCatalogCurrentlyValid(catalog, now);
}

/**
 * Nota de arquitetura: `ativo` continua sendo o gate de "V2 está
 * autorizada a usar esta categoria" (homologação controlada,
 * getActiveCatalogConfig já retorna null quando ativo:false — inalterado
 * nesta fase). `isCatalogSendable` é um check ADICIONAL, para uma decisão
 * diferente ("posso enviar a URL / apresentar o preço como vigente"),
 * relevante quando ativo:true mas o catálogo está documentalmente
 * vencido — os dois nunca se confundem: reconhecimento comercial
 * (matching) segue de `ativo`; "posso enviar/apresentar como atual"
 * segue de `isCatalogSendable`.
 */
