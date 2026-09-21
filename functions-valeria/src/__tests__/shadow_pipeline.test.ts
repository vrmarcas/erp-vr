/**
 * shadow_pipeline.test.ts — ValerIA 2.0, Fase E.2.7 (2026-09-20).
 *
 * Cobre: EXPLORATORY/COMMERCIAL_INTENT/AMBIGUOUS/HUMAN/SYSTEM_IGNORE,
 * reaproveitamento das funções puras existentes (product_resolution.ts/
 * catalog_draft.ts/qualification_engine.ts), idempotência, prova estática
 * de zero I/O, e replay das 20 mensagens reais da bateria da Fase M.1.
 */
import * as fs from "fs";
import * as path from "path";
import { runShadowPipeline, type ShadowInput } from "../shadow_pipeline";
import type { CatalogGroup } from "../product_resolution";

const CAIXA_TAMPA_CORRER: CatalogGroup = {
  catalogGroupId: "caixa_tampa_de_correr",
  categoria: "caixas",
  nome: "Caixa com tampa de correr",
  aliases: ["tampa de correr", "caixa tampa de correr", "caixa"],
  materialPadrao: "Acrílico cristal 4mm",
  espessuraPadraoMm: 4,
  toleranciaCm: null,
  tamanhos: [
    { tamanho: "P", larguraCm: 20, alturaCm: 20, profundidadeCm: 4, vitreProductId: "C4TC3P", vitreProductSku: "C4TC3P" },
    { tamanho: "M", larguraCm: 30, alturaCm: 30, profundidadeCm: 4, vitreProductId: "C4TC3M", vitreProductSku: "C4TC3M" },
    { tamanho: "G", larguraCm: 40, alturaCm: 40, profundidadeCm: 4, vitreProductId: "C4TC3G", vitreProductSku: "C4TC3G" },
  ],
};
const CATALOG = [CAIXA_TAMPA_CORRER];

function baseInput(overrides: Partial<ShadowInput>): ShadowInput {
  return {
    conversationId: "conv-test",
    messageText: "",
    modoAtendimento: "valeria",
    isEchoOfOwnMessage: false,
    isTeste: true,
    catalogGroups: CATALOG,
    ...overrides,
  };
}

describe("runShadowPipeline — gates de pipeline (antes de qualquer classificação)", () => {
  test("eco da própria mensagem → SYSTEM_IGNORE, nada mais preenchido", () => {
    const r = runShadowPipeline(baseInput({ messageText: "Quero uma caixa", isEchoOfOwnMessage: true }));
    expect(r.mode).toBe("SYSTEM_IGNORE");
    expect(r.classification).toBeNull();
    expect(r.hypotheticalText).toBeNull();
    expect(r.sideEffectsExecuted).toBe(false);
  });

  test("modoAtendimento=humano → HUMAN, nenhuma geração de texto", () => {
    const r = runShadowPipeline(baseInput({ messageText: "Vocês fazem sob medida?", modoAtendimento: "humano" }));
    expect(r.mode).toBe("HUMAN");
    expect(r.hypotheticalText).toBeNull();
    expect(r.redactionInput).toBeNull();
  });
});

describe("runShadowPipeline — EXPLORATORY", () => {
  test("responde com fato e sem pergunta, passa no validator", () => {
    const r = runShadowPipeline(baseInput({ messageText: "Vocês fazem peças sob medida?" }));
    expect(r.mode).toBe("EXPLORATORY");
    expect(r.hypotheticalText).toBe("Sim, fazemos peças sob medida.");
    expect(r.outputValidation?.valid).toBe(true);
    expect(r.hypotheticalText).not.toContain("?");
    expect(r.resolution).toBeNull();
    expect(r.qualification).toBeNull();
    expect(r.sideEffectsExecuted).toBe(false);
  });
});

describe("runShadowPipeline — AMBIGUOUS (comportamento seguro, nunca vira comercial)", () => {
  test("'Preciso de uma peça.' não inicia qualificação, não pergunta", () => {
    const r = runShadowPipeline(baseInput({ messageText: "Preciso de uma peça." }));
    expect(r.mode).toBe("AMBIGUOUS");
    expect(r.resolution).toBeNull();
    expect(r.outputValidation?.valid).toBe(true);
    expect(r.hypotheticalText).not.toContain("?");
  });
});

describe("runShadowPipeline — COMMERCIAL_INTENT (reaproveita product_resolution/catalog_draft/qualification_engine reais)", () => {
  test("catálogo + tamanho em um turno só → EXACT_CATALOG_MATCH, falta quantidade, pergunta permitida", () => {
    const r = runShadowPipeline(
      baseInput({
        messageText: "Quero a caixa tampa de correr M",
        resolutionSignals: { categoria: "caixas", groupNameOrAlias: "tampa de correr", catalogSizeLabel: "M" },
      })
    );
    expect(r.mode).toBe("COMMERCIAL_INTENT");
    expect(r.resolution?.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r.qualification?.qualificationStatus).toBe("QUALIFYING_CATALOG");
    expect(r.nextAction).toBe("ASK_QUANTITY");
    expect(r.outputValidation?.valid).toBe(true);
    expect(r.hypotheticalText).toContain("?"); // pergunta é o comportamento CORRETO aqui
  });

  test("categoria sem grupo identificado → ASK_MODEL", () => {
    const r = runShadowPipeline(
      baseInput({ messageText: "Quero fazer uma caixa.", resolutionSignals: { categoria: "caixas" } })
    );
    expect(r.mode).toBe("COMMERCIAL_INTENT");
    expect(r.nextAction).toBe("ASK_MODEL");
  });

  test("draft anterior é reaproveitado (não recomeça a conversa do zero)", () => {
    const first = runShadowPipeline(
      baseInput({
        conversationId: "conv-persist",
        messageText: "Quero a caixa tampa de correr M",
        resolutionSignals: { categoria: "caixas", groupNameOrAlias: "tampa de correr", catalogSizeLabel: "M" },
      })
    );
    // simula persistência real acontecendo fora do shadow — aqui só passamos o draft de volta como snapshot.
    const draftSnapshot = require("../catalog_draft").mergeSignalsIntoDraft(
      require("../catalog_draft").emptyCatalogDraft("conv-persist", null, true),
      first.resolution,
      {},
      "CUSTOMER"
    );
    const second = runShadowPipeline(
      baseInput({
        conversationId: "conv-persist",
        messageText: "Preciso de 5 unidades",
        priorDraft: draftSnapshot,
        // Mesma disciplina da produção real (catalog_tools.ts): o contexto
        // da conversa vem do draft persistido, nunca de o LLM reenviar o id.
        resolutionSignals: {
          contextCatalogGroupId: draftSnapshot.baseCatalogGroupId || draftSnapshot.catalogGroupId,
          contextMatchedProductId: draftSnapshot.matchedProductId,
          contextMatchedProductSku: draftSnapshot.matchedProductSku,
        },
        fieldUpdate: { quantity: 5 },
      })
    );
    expect(second.qualification?.qualificationStatus).toBe("READY_CATALOG_DRAFT");
    expect(second.nextAction).toBe("REQUEST_QUOTE_REVIEW");
  });
});

describe("runShadowPipeline — idempotência", () => {
  test("mesmo evento reprocessado produz exatamente o mesmo resultado lógico", () => {
    const input = baseInput({
      messageText: "Quero uma placa 30x20",
      resolutionSignals: { categoria: "caixas", groupNameOrAlias: "caixa" },
    });
    const a = runShadowPipeline(input);
    const b = runShadowPipeline(input);
    expect(a).toEqual(b);
  });
});

describe("shadow_pipeline.ts — prova estática de zero I/O", () => {
  test("arquivo-fonte não importa nenhum módulo de escrita/rede", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "shadow_pipeline.ts"), "utf8");
    expect(src).not.toMatch(/firebase-admin/);
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/\baxios\b/);
    expect(src).not.toMatch(/admin\.firestore/);
  });
});

describe("runShadowPipeline — replay das 20 mensagens reais da bateria Fase M.1 (conversationId cmt95yjqa0dksuvqt63to9tbm)", () => {
  // Texto exato capturado via API real do ChatVolt (GET /conversation/{id}/messages), 2026-09-20.
  const TRANSCRIPT_REAL: Array<{ texto: string; cenarioEsperado: string }> = [
    { texto: "Oi", cenarioEsperado: "A" },
    { texto: "Vocês fazem sob medida?", cenarioEsperado: "B" },
    { texto: "Que tipos de acrílico vocês trabalham?", cenarioEsperado: "B" },
    { texto: "Vocês entregam em outras cidades?", cenarioEsperado: "B" },
    { texto: "Qual o prazo médio de vocês?", cenarioEsperado: "B" },
    { texto: "Vocês trabalham com acrílico preto?", cenarioEsperado: "B" },
    { texto: "Vocês fazem troféus?", cenarioEsperado: "B" },
    { texto: "Quero fazer uma caixa", cenarioEsperado: "C" },
    { texto: "Preciso de 10 troféus", cenarioEsperado: "C" },
    { texto: "Quero uma placa 30x20", cenarioEsperado: "C" },
    { texto: "Quanto fica 20 unidades de plaquinha?", cenarioEsperado: "C" },
    { texto: "Oi\n\nVocês fazem troféus?", cenarioEsperado: "D" },
    { texto: "Boa tarde\n\nQuero uma caixa", cenarioEsperado: "D" },
    { texto: "Olá\n\nQual o prazo de vocês?", cenarioEsperado: "D" },
    { texto: "Oi\n\nPreciso de uma peça\n\n35x25", cenarioEsperado: "E" },
    { texto: "Boa tarde", cenarioEsperado: "A" },
    { texto: "Boa tarde\n\nVocês fazem sob medida?\n\nEm acrílico", cenarioEsperado: "E" },
    { texto: "Olá\n\nQuero 5 troféus\n\nPra dia 10", cenarioEsperado: "E" },
    { texto: "Olá, tudo bem?", cenarioEsperado: "A" },
    { texto: "Oi, bom dia", cenarioEsperado: "A" },
  ];

  test("todas as 20 mensagens processam sem lançar exceção, zero side effect", () => {
    for (const { texto } of TRANSCRIPT_REAL) {
      const r = runShadowPipeline(baseInput({ messageText: texto }));
      expect(r.sideEffectsExecuted).toBe(false);
      expect(["EXPLORATORY", "COMMERCIAL_INTENT", "AMBIGUOUS"]).toContain(r.mode);
    }
  });

  test("nenhuma resposta EXPLORATORY/AMBIGUOUS da bateria real contém pergunta de acompanhamento", () => {
    for (const { texto } of TRANSCRIPT_REAL) {
      const r = runShadowPipeline(baseInput({ messageText: texto }));
      if (r.mode === "EXPLORATORY" || r.mode === "AMBIGUOUS") {
        expect(r.outputValidation?.valid).toBe(true);
        expect(r.hypotheticalText).not.toContain("?");
      }
    }
  });

  test("mensagens de saudação isolada (A) classificam como EXPLORATORY", () => {
    const saudacoes = TRANSCRIPT_REAL.filter((c) => c.cenarioEsperado === "A");
    for (const { texto } of saudacoes) {
      expect(runShadowPipeline(baseInput({ messageText: texto })).mode).toBe("EXPLORATORY");
    }
  });

  test("perguntas exploratórias (B) classificam como EXPLORATORY, nunca iniciam qualificação", () => {
    const perguntas = TRANSCRIPT_REAL.filter((c) => c.cenarioEsperado === "B");
    for (const { texto } of perguntas) {
      const r = runShadowPipeline(baseInput({ messageText: texto }));
      expect(r.mode).toBe("EXPLORATORY");
      expect(r.resolution).toBeNull();
    }
  });

  test("registro de distribuição observada (diagnóstico, não asserção rígida)", () => {
    const contagem: Record<string, number> = {};
    for (const { texto } of TRANSCRIPT_REAL) {
      const r = runShadowPipeline(baseInput({ messageText: texto }));
      contagem[r.mode] = (contagem[r.mode] ?? 0) + 1;
    }
    // eslint-disable-next-line no-console
    console.log("Distribuição shadow sobre a bateria real (Fase M.1):", contagem);
    expect(Object.values(contagem).reduce((a, b) => a + b, 0)).toBe(TRANSCRIPT_REAL.length);
  });
});
