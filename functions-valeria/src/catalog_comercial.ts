/**
 * catalog_comercial.ts — ValerIA 2.0, rodada "qualificação comercial"
 * (2026-10-21).
 *
 * `catalog.ts` (`valeria_catalogos`) é estritamente SKU Vitre — todo
 * tamanho de todo grupo resolve, obrigatoriamente, para um documento
 * `vitre_produtos` (produto pronto, preço fixo). Troféus, modelos de
 * tampa de caixa e placas NÃO são produtos de catálogo Vitre — são só
 * REFERÊNCIAS VISUAIS (PDF/imagem de modelos) para ajudar o cliente a
 * escolher, sem preço/SKU fixo associado. Forçar isso em `catalog.ts`
 * exigiria inventar um `vitreProductId` fictício para cada modelo — nunca
 * aceitável (nenhum dado inventado).
 *
 * Collection nova e separada: `valeria_catalogos_comerciais`, 1 doc por
 * categoria (id = categoria, ex.: "trofeus", "tampas_caixa", "placas").
 * Mesma disciplina de `catalog.ts`: `urlCatalogo` nullable, nunca
 * inventado — só preenchido quando um link real existir. Reusa
 * `catalog_validity.ts::isCatalogSendable` (mesmo gate de vencimento, sem
 * reimplementar a regra).
 */
import * as admin from "firebase-admin";

const COL = "valeria_catalogos_comerciais";

export interface CatalogComercialConfig {
  categoria: string;
  titulo: string;
  /** Link oficial (PDF/imagem) para enviar como texto ao cliente. null = ainda não fornecido. */
  urlCatalogo: string | null;
  ativo: boolean;
  version: number;
  validUntil: string | null; // ISO "YYYY-MM-DD", opcional
  /** Frase pronta opcional para acompanhar o link (nunca inventada pelo LLM). */
  mensagemPadrao?: string | null;
  updatedAt?: number;
}

/** Lê a config ativa de uma categoria. Retorna null se não existir ou `ativo:false`. */
export async function getActiveCatalogComercialConfig(categoria: string): Promise<CatalogComercialConfig | null> {
  const snap = await admin.firestore().collection(COL).doc(categoria).get();
  if (!snap.exists) return null;
  const data = snap.data() as CatalogComercialConfig;
  if (!data.ativo) return null;
  return data;
}
