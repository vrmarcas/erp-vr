/**
 * catalog_validity.test.ts — ValerIA 2.0, Fase D.4.1 (2026-09-19).
 * G. Relógio SEMPRE injetado (new Date(ano,mes,dia,...)) — nunca depende
 * do dia real do sistema.
 */
import { isCatalogCurrentlyValid, isCatalogSendable, CatalogValidityInput } from "../catalog_validity";

const AGORA_FIXO = new Date(2026, 8, 19, 12, 0, 0); // 19/09/2026 meio-dia — data fixa, nunca Date.now() real

function catalogo(overrides: Partial<CatalogValidityInput> = {}): CatalogValidityInput {
  return { ativo: true, urlCatalogo: "https://exemplo.com/catalogo.pdf", validUntil: "2026-12-31", ...overrides };
}

describe("isCatalogCurrentlyValid", () => {
  test("validUntil futuro → válido", () => {
    expect(isCatalogCurrentlyValid({ validUntil: "2026-12-31" }, AGORA_FIXO)).toBe(true);
  });

  test("validUntil = hoje → válido até o fim do dia", () => {
    expect(isCatalogCurrentlyValid({ validUntil: "2026-09-19" }, AGORA_FIXO)).toBe(true);
    const finalDoDia = new Date(2026, 8, 19, 23, 59, 59, 999);
    expect(isCatalogCurrentlyValid({ validUntil: "2026-09-19" }, finalDoDia)).toBe(true);
    const proximoDia = new Date(2026, 8, 20, 0, 0, 0, 1);
    expect(isCatalogCurrentlyValid({ validUntil: "2026-09-19" }, proximoDia)).toBe(false);
  });

  test("validUntil passado → vencido (caso real: Urnas, 2026-04-30)", () => {
    expect(isCatalogCurrentlyValid({ validUntil: "2026-04-30" }, AGORA_FIXO)).toBe(false);
  });

  test("validUntil null → NUNCA inferimos vencimento, tratado como válido", () => {
    expect(isCatalogCurrentlyValid({ validUntil: null }, AGORA_FIXO)).toBe(true);
  });
});

describe("isCatalogSendable", () => {
  test("A. ativo + URL + validUntil futuro → sendable", () => {
    expect(isCatalogSendable(catalogo({ validUntil: "2026-12-31" }), AGORA_FIXO)).toBe(true);
  });

  test("B. ativo + URL + validUntil passado → NÃO sendable (caso real: Urnas)", () => {
    expect(isCatalogSendable(catalogo({ validUntil: "2026-04-30" }), AGORA_FIXO)).toBe(false);
  });

  test("C. catálogo inativo → NÃO sendable, mesmo com URL e validade futura", () => {
    expect(isCatalogSendable(catalogo({ ativo: false, validUntil: "2026-12-31" }), AGORA_FIXO)).toBe(false);
  });

  test("D. urlCatalogo null → NÃO sendable, mesmo ativo e válido", () => {
    expect(isCatalogSendable(catalogo({ urlCatalogo: null, validUntil: "2026-12-31" }), AGORA_FIXO)).toBe(false);
  });

  test("E. catálogo vencido continua carregável como conhecimento documental — isCatalogSendable não impede leitura/matching, só a decisão de enviar", () => {
    // isCatalogSendable é usado só para a decisão de ENVIO/apresentação de
    // preço como atual — nunca para decidir se o catálogo existe/é
    // reconhecido (isso continua em getActiveCatalogConfig, baseado em
    // `ativo`, inalterado). Aqui só confirmamos que a função em si não
    // lança/bloqueia nada — é seguro chamar mesmo com dado vencido.
    const vencido = catalogo({ validUntil: "2026-04-30" });
    expect(() => isCatalogSendable(vencido, AGORA_FIXO)).not.toThrow();
    expect(isCatalogSendable(vencido, AGORA_FIXO)).toBe(false);
  });

  test("F. preço publicado de catálogo vencido nunca é tratado como operacional — isCatalogSendable é o único gate, nada infere preço vigente a partir dele", () => {
    // Não há um "getOperationalPrice" aqui de propósito: a fonte
    // operacional de preço é SEMPRE vitre_produtos.precoVenda (contrato já
    // testado em vitre_draft_writer_parity.test.ts e nos testes de cada
    // categoria) — catalogPublishedPrice nunca alimenta esse caminho,
    // vencido ou não. isCatalogSendable=false é só o sinalizador que a
    // camada de conversa usaria para nunca apresentar o valor como atual.
    const vencido = catalogo({ validUntil: "2026-04-30" });
    expect(isCatalogSendable(vencido, AGORA_FIXO)).toBe(false);
  });
});
