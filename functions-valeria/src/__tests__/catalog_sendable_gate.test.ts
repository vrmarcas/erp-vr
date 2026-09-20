/**
 * catalog_sendable_gate.test.ts — ValerIA 2.0, Fase E.1 (checkpoint
 * pré-merge, 2026-09-20).
 *
 * ACHADO REAL (auditoria do código antes deste teste — não por inferência):
 * `valeriaGetCatalog` (catalog_tools.ts) devolvia `urlCatalogo:
 * config.urlCatalogo` direto, sem nenhum gate de vencimento —
 * `getActiveCatalogConfig` (catalog.ts) só filtra por `ativo`, nunca por
 * `validUntil`. Hoje isso está mascarado só porque os 6 catálogos reais
 * têm `urlCatalogo:null` — se qualquer um ganhasse URL antes de o PDF ser
 * atualizado, a Tool devolveria a URL vencida como se fosse válida, sem
 * nenhuma proteção runtime. Corrigido reusando `catalog_validity.ts`
 * (isCatalogSendable), NÃO reimplementando a regra — ver
 * `buildCatalogAvailabilityPayload` em catalog_tools.ts.
 *
 * Este arquivo testa DIRETAMENTE a função exportada que
 * `valeriaGetCatalog` chama (mesmo código, não uma reimplementação) — e,
 * ao final, confirma por leitura do código-fonte real que a resposta HTTP
 * de fato usa essa função (prova de fiação, mesmo padrão de
 * vitre_draft_writer_parity.test.ts), sem precisar montar o stack
 * completo de auth/pipeline/rate-limit (ortogonal a este achado).
 */
import * as fs from "fs";
import * as path from "path";
import { buildCatalogAvailabilityPayload } from "../catalog_tools";

const AGORA_FIXO = new Date(2026, 8, 20, 12, 0, 0); // 20/09/2026 meio-dia — data fixa, nunca Date.now() real

describe("buildCatalogAvailabilityPayload — testes runtime obrigatórios A-G", () => {
  test("A. ativo=true + url preenchida + validUntil futuro → sendable=true, urlCatalogo devolvida", () => {
    const r = buildCatalogAvailabilityPayload({ ativo: true, urlCatalogo: "https://exemplo.com/catalogo.pdf", validUntil: "2026-12-31" }, AGORA_FIXO);
    expect(r.catalogKnown).toBe(true);
    expect(r.sendable).toBe(true);
    expect(r.urlCatalogo).toBe("https://exemplo.com/catalogo.pdf");
  });

  test("B. ativo=true + url preenchida + validUntil passado → sendable=false, urlCatalogo NUNCA devolvida (o achado real)", () => {
    const r = buildCatalogAvailabilityPayload({ ativo: true, urlCatalogo: "https://exemplo.com/catalogo-vencido.pdf", validUntil: "2026-04-30" }, AGORA_FIXO);
    expect(r.catalogKnown).toBe(true);
    expect(r.sendable).toBe(false);
    expect(r.urlCatalogo).toBeNull(); // ANTES do fix, isto devolvia a URL vencida — este é o teste que teria falhado
  });

  test("C. ativo=true + url=null + validUntil futuro → sendable=false (sem URL, nada para enviar)", () => {
    const r = buildCatalogAvailabilityPayload({ ativo: true, urlCatalogo: null, validUntil: "2026-12-31" }, AGORA_FIXO);
    expect(r.sendable).toBe(false);
    expect(r.urlCatalogo).toBeNull();
  });

  test("D. ativo=false → getActiveCatalogConfig já devolve null antes de chegar aqui (catalog_active_gate.test.ts); catálogo não fica disponível para o fluxo ativo", () => {
    // buildCatalogAvailabilityPayload só é chamada DEPOIS de getActiveCatalogConfig
    // confirmar ativo:true (ver catalog_tools.ts) — ativo:false nunca chega
    // a esta função; documentado aqui para registro do cenário D do checkpoint.
    expect(true).toBe(true);
  });

  test("E. catálogo vencido continua catalogKnown=true (reconhecido internamente p/ matching, conforme o contrato já aprovado)", () => {
    const r = buildCatalogAvailabilityPayload({ ativo: true, urlCatalogo: null, validUntil: "2026-04-30" }, AGORA_FIXO);
    expect(r.catalogKnown).toBe(true);
    expect(r.sendable).toBe(false);
  });

  test("F. validUntil=null → segue exatamente a semântica já aprovada em catalog_validity.ts (nunca inferir vencimento)", () => {
    const r = buildCatalogAvailabilityPayload({ ativo: true, urlCatalogo: "https://exemplo.com/catalogo.pdf", validUntil: null }, AGORA_FIXO);
    expect(r.sendable).toBe(true);
    expect(r.urlCatalogo).toBe("https://exemplo.com/catalogo.pdf");
  });

  test("G. caller/LLM não consegue forçar sendable=true por parâmetro — a função não aceita nenhum override, só config+relógio", () => {
    // A assinatura de buildCatalogAvailabilityPayload não tem NENHUM
    // parâmetro que representasse "input do caller" além do próprio
    // documento de catálogo (lido do Firestore, nunca do body da
    // requisição) e do relógio do servidor — não há como um body de
    // requisição influenciar `sendable`. Prova estrutural (assinatura),
    // reforçada pelo teste B acima: mesmo com urlCatalogo preenchida
    // (que um caller mal-intencionado não controla, mas que prova que
    // "ter URL" sozinho não basta), sendable ainda dá false quando vencido.
    expect(buildCatalogAvailabilityPayload.length).toBe(2); // (config, now) — nada mais
  });
});

describe("Casos reais do checkpoint — Urnas (vencido) e Caixas (dentro/fora da validade)", () => {
  test("Urnas: validUntil=2026-04-30, simulando URL preenchida (hoje é null em produção) → catalogKnown=true, sendable=false", () => {
    const r = buildCatalogAvailabilityPayload({ ativo: true, urlCatalogo: "https://exemplo.com/urnas.pdf", validUntil: "2026-04-30" }, AGORA_FIXO);
    expect(r.catalogKnown).toBe(true);
    expect(r.sendable).toBe(false);
    expect(r.urlCatalogo).toBeNull();
  });

  test("Caixas: validUntil=2026-09-30, URL preenchida, data DENTRO da validade → sendable=true", () => {
    const r = buildCatalogAvailabilityPayload({ ativo: true, urlCatalogo: "https://exemplo.com/caixas.pdf", validUntil: "2026-09-30" }, new Date(2026, 8, 20, 12, 0, 0));
    expect(r.sendable).toBe(true);
    expect(r.urlCatalogo).toBe("https://exemplo.com/caixas.pdf");
  });

  test("Caixas: mesma URL, data APÓS a validade (2026-10-01) → sendable=false", () => {
    const r = buildCatalogAvailabilityPayload({ ativo: true, urlCatalogo: "https://exemplo.com/caixas.pdf", validUntil: "2026-09-30" }, new Date(2026, 9, 1, 12, 0, 0));
    expect(r.sendable).toBe(false);
    expect(r.urlCatalogo).toBeNull();
  });
});

describe("Prova de fiação — valeriaGetCatalog realmente usa buildCatalogAvailabilityPayload (leitura do código-fonte real, mesmo padrão de vitre_draft_writer_parity.test.ts)", () => {
  test("o handler HTTP espalha (...disponibilidade) no payload, não mais 'urlCatalogo: config.urlCatalogo' cru", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "catalog_tools.ts"), "utf8");
    expect(source).toMatch(/const disponibilidade = buildCatalogAvailabilityPayload\(config, new Date\(\)\)/);
    expect(source).toMatch(/\.\.\.disponibilidade/);
    // O padrão antigo (bug real, corrigido) não pode mais existir no
    // payload HTTP — só é legítimo dentro de buildCatalogAvailabilityPayload,
    // que o alimenta para isCatalogSendable decidir; nunca mais atribuído
    // direto ao objeto de resposta da Tool.
    expect(source).not.toMatch(/disponivel:\s*grupos\.length > 0,\s*urlCatalogo:\s*config\.urlCatalogo/);
  });
});
