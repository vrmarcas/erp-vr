/**
 * catalog.ts — ValerIA 2.0, Fase B (2026-09-19).
 *
 * Fonte estruturada de catálogo comercial por categoria (`caixas` primeiro),
 * separada da ficha completa de produto (`vitre_produtos`, inalterado).
 * Este módulo só agrega: categoria → grupos de modelo → tamanhos → SKU
 * Vitre. Não duplica preço/descrição/foto — isso continua em
 * `vitre_produtos`, referenciado por `vitreProductId`.
 *
 * Collection nova: `valeria_catalogos`, 1 doc por categoria (id = categoria).
 * Justificativa (não dá para reusar `vitre_produtos` sozinho): um SKU Vitre
 * modela 1 produto vendável; não existe hoje nenhuma estrutura que agrupe
 * "modelo com 3 tamanhos" + "link do catálogo comercial da categoria" —
 * ver auditoria/plano arquitetural (Fase A/B).
 *
 * `urlCatalogo` fica deliberadamente nullable: só é preenchido quando o
 * link oficial for fornecido. NUNCA inventar/gerar uma URL aqui.
 */
import * as admin from "firebase-admin";
import type { CatalogGroup, CatalogSizeOption } from "./product_resolution";

const COL = "valeria_catalogos";

export interface CatalogConfigGroup {
  catalogGroupId: string;
  nome: string;
  aliases: string[];
  tamanhos: CatalogSizeOption[];
  materialPadrao?: string | null;
  espessuraPadraoMm?: number | null;
  /** null = sem tolerância automática (comportamento padrão — ver product_resolution.ts). */
  toleranciaCm?: number | null;
  /** Fase D — texto comercial curto (não confidencial), opcional. */
  descricaoComercial?: string | null;
  /** Fase D — ordem de exibição no catálogo/PDF de origem, opcional. */
  ordem?: number | null;
  /**
   * Fase D.2.2 — subtipo comercial dentro do mesmo catálogo, quando o
   * grupo não é semanticamente equivalente aos demais (ex.: "Caixa Veludo
   * p/ Homenagem" dentro do catálogo de troféus). Só informativo.
   */
  catalogSubtype?: string | null;
}

export interface CatalogConfig {
  categoria: string;
  titulo: string;
  /**
   * Link oficial do catálogo (PDF/imagem) para ENVIAR ao cliente. null =
   * ainda não fornecido — a ValerIA nunca promete enviar catálogo enquanto
   * for null (ver product_resolution.ts/prompt).
   */
  urlCatalogo: string | null;
  /**
   * Fase D (2026-09-19) — separado de `urlCatalogo` de propósito: o PDF
   * que fornece os DADOS de origem (usado na ingestão/auditoria) não é
   * necessariamente uma URL pública que possa ser mandada ao cliente. Um
   * PDF pode existir (`sourcePdf` preenchido) sem que ainda exista link
   * público (`urlCatalogo` continua null até ser fornecido explicitamente).
   */
  sourcePdf?: string | null;
  ativo: boolean;
  version: number;
  validUntil: string | null; // ISO-8601, opcional
  grupos: CatalogConfigGroup[];
  updatedAt?: number;
}

export interface CatalogValidationIssue {
  campo: string;
  motivo: string;
}

/**
 * Validação pura (sem I/O) — usada tanto por quem grava a config quanto
 * pelos testes. Não corrige nada, só reporta.
 */
export function validateCatalogConfig(config: CatalogConfig): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  if (!config.categoria) issues.push({ campo: "categoria", motivo: "obrigatório" });
  if (!config.titulo) issues.push({ campo: "titulo", motivo: "obrigatório" });
  if (!Array.isArray(config.grupos) || config.grupos.length === 0) {
    issues.push({ campo: "grupos", motivo: "catálogo precisa de pelo menos 1 grupo de modelo" });
  }

  const groupIds = new Set<string>();
  for (const g of config.grupos || []) {
    if (!g.catalogGroupId) issues.push({ campo: `grupos[].catalogGroupId`, motivo: `grupo "${g.nome}" sem id` });
    if (groupIds.has(g.catalogGroupId)) issues.push({ campo: "grupos[].catalogGroupId", motivo: `id duplicado: ${g.catalogGroupId}` });
    groupIds.add(g.catalogGroupId);

    // Fase D.2.2 — grupo com ZERO tamanhos agora é VÁLIDO de propósito:
    // representa um modelo comercial conhecido (do PDF/catálogo) ainda sem
    // productId operacional em vitre_produtos (CATALOG_KNOWN_NO_OPERATIONAL_MATCH,
    // ver product_resolution.ts). Só `tamanhos` não ser um array é erro.
    if (!Array.isArray(g.tamanhos)) {
      issues.push({ campo: `grupos.${g.catalogGroupId}.tamanhos`, motivo: "tamanhos precisa ser um array (pode ser vazio)" });
    }
    const sizeLabels = new Set<string>();
    for (const t of g.tamanhos || []) {
      if (!t.vitreProductId) {
        issues.push({ campo: `grupos.${g.catalogGroupId}.tamanhos`, motivo: `tamanho "${t.tamanho}" sem vitreProductId` });
      }
      if (!t.vitreProductSku) {
        issues.push({ campo: `grupos.${g.catalogGroupId}.tamanhos`, motivo: `tamanho "${t.tamanho}" sem vitreProductSku` });
      }
      if (sizeLabels.has(t.tamanho)) {
        issues.push({ campo: `grupos.${g.catalogGroupId}.tamanhos`, motivo: `tamanho duplicado: ${t.tamanho}` });
      }
      sizeLabels.add(t.tamanho);
    }
  }

  return issues;
}

/** Converte a config persistida no shape que product_resolution.ts consome — função pura, sem Firestore. */
export function catalogGroupsFromConfig(config: CatalogConfig): CatalogGroup[] {
  return config.grupos.map((g) => ({
    catalogGroupId: g.catalogGroupId,
    categoria: config.categoria,
    nome: g.nome,
    aliases: g.aliases || [],
    tamanhos: g.tamanhos,
    materialPadrao: g.materialPadrao ?? null,
    espessuraPadraoMm: g.espessuraPadraoMm ?? null,
    toleranciaCm: g.toleranciaCm ?? null,
    catalogSubtype: g.catalogSubtype ?? null,
  }));
}

/** Lê a config ativa de uma categoria. Retorna null se não existir ou `ativo:false`. */
export async function getActiveCatalogConfig(categoria: string): Promise<CatalogConfig | null> {
  const snap = await admin.firestore().collection(COL).doc(categoria).get();
  if (!snap.exists) return null;
  const data = snap.data() as CatalogConfig;
  if (!data.ativo) return null;
  return data;
}

/** Lê todas as categorias ativas (usado pela resolução quando a categoria ainda não foi identificada). */
export async function getAllActiveCatalogConfigs(): Promise<CatalogConfig[]> {
  const snap = await admin.firestore().collection(COL).where("ativo", "==", true).get();
  return snap.docs.map((d) => d.data() as CatalogConfig);
}
