/**
 * valeria_v2_istest_propagation.test.ts — ValerIA 2.0, Fase E.1.2 (2026-09-20).
 *
 * Achado real da bateria HTTP E.1: o rascunho `vitre_orcamentos` criado
 * pela V2 não carregava nenhuma marca de teste, mesmo quando o atendimento
 * de origem tinha `isTeste:true` — só o status "rascunho" (proteção
 * indireta) evitava contaminar receita/KPI, sem defesa em profundidade.
 *
 * MAPA DE PROPAGAÇÃO (auditado nesta fase):
 *   ARTEFATO                    | CAMPO          | HERDA isTest? | CORREÇÃO
 *   valeria_catalog_drafts      | isTest         | agora sim     | catalog_draft.ts (CatalogDraft.isTest, emptyCatalogDraft)
 *   vitre_orcamentos (V2)       | isTest         | agora sim     | vitre_draft_writer.ts (deriveIsTest + buildVitreDraftPayload)
 *   valeria_technical_briefings | isTest         | agora sim     | technical_briefing.ts/_store.ts/custom_briefing_patch.ts
 *   handoff (atdSolicitarHumanoValeria) | atendimentos.status="aguardando_humano" | já herda via isTeste do próprio atendimento | nenhuma — não cria doc próprio, só atualiza o atendimento real (isTeste já lá)
 *
 * Fonte da verdade ÚNICA: `atendimentos/{conversationId}.isTeste` — nunca
 * inferido de nome/padrão de texto, nunca vindo do LLM (mesma disciplina
 * já usada em action_executor.ts para orçamentos V1).
 */
type FakeDoc = Record<string, unknown>;
const _colecoes: Record<string, Record<string, FakeDoc>> = {};

jest.mock("firebase-admin", () => ({
  apps: [true],
  initializeApp: jest.fn(),
  firestore: jest.fn(() => ({
    collection: (col: string) => ({
      doc: (id: string) => ({
        get: jest.fn(async () => {
          const data = _colecoes[col]?.[id];
          return { exists: data !== undefined, data: () => data, id };
        }),
        set: jest.fn(async (data: FakeDoc) => {
          _colecoes[col] = _colecoes[col] || {};
          _colecoes[col][id] = data;
        }),
        create: jest.fn(async (data: FakeDoc) => {
          _colecoes[col] = _colecoes[col] || {};
          if (_colecoes[col][id] !== undefined) {
            const e = new Error("ALREADY_EXISTS") as Error & { code: number };
            e.code = 6;
            throw e;
          }
          _colecoes[col][id] = data;
        }),
      }),
    }),
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const catalogDraftModule = require("../catalog_draft") as typeof import("../catalog_draft");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const vitreDraftWriterModule = require("../vitre_draft_writer") as typeof import("../vitre_draft_writer");
const { emptyCatalogDraft } = catalogDraftModule;
const { deriveIsTest, createVitreDraftIfNotExists } = vitreDraftWriterModule;

function seedAtendimento(id: string, isTeste: boolean) {
  _colecoes["atendimentos"] = _colecoes["atendimentos"] || {};
  _colecoes["atendimentos"][id] = { id, isTeste, nome: "Cliente" };
}

beforeEach(() => {
  delete _colecoes["atendimentos"];
  delete _colecoes["vitre_orcamentos"];
});

describe("A. atendimento de teste → catalog draft isTest=true", () => {
  test("emptyCatalogDraft com isTest derivado do atendimento real", async () => {
    seedAtendimento("conv-a", true);
    const isTest = await deriveIsTest("conv-a");
    const draft = emptyCatalogDraft("conv-a", null, isTest);
    expect(draft.isTest).toBe(true);
  });
});

describe("B. atendimento de teste → vitre_orcamentos.isTest=true (derivado, nunca do caller)", () => {
  test("createVitreDraftIfNotExists deriva isTest do atendimento, não de nenhum parâmetro passado", async () => {
    seedAtendimento("conv-b", true);
    const result = await createVitreDraftIfNotExists({
      conversationId: "conv-b",
      organizationId: "org1",
      clienteNome: "Cliente Teste",
      produto: { id: "SKU1", sku: "SKU1", nome: "Produto", precoVenda: 100 },
      quantity: 1,
    });
    const doc = _colecoes["vitre_orcamentos"][result.id];
    expect(doc.isTest).toBe(true);
  });
});

describe("C. atendimento de teste custom → TechnicalBriefing conserva o estado de teste", () => {
  test("buildCustomTechnicalBriefingPatch propaga isTest quando informado pelo draft (derivado do atendimento, não do LLM)", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildCustomTechnicalBriefingPatch } = require("../custom_briefing_patch") as typeof import("../custom_briefing_patch");
    const patch = buildCustomTechnicalBriefingPatch({
      baseCatalogGroupId: "caixa_tampa_de_correr",
      baseProductId: "C4TC3M",
      baseProductSku: "C4TC3M",
      receitaProductId: "Caixa",
      quantity: null,
      customDimensions: null,
      espessuraPadraoMmDoGrupo: null,
      thicknessMmAtual: null,
      isTest: true,
    });
    expect(patch.isTest).toBe(true);
  });
});

describe("D. atendimento NORMAL → NÃO recebe isTest=true em nenhum artefato", () => {
  test("draft e rascunho Vitre para atendimento sem isTeste ficam isTest=false", async () => {
    seedAtendimento("conv-d", false);
    const isTest = await deriveIsTest("conv-d");
    const draft = emptyCatalogDraft("conv-d", null, isTest);
    expect(draft.isTest).toBe(false);

    const result = await createVitreDraftIfNotExists({
      conversationId: "conv-d",
      organizationId: "org1",
      clienteNome: "Cliente Real",
      produto: { id: "SKU2", sku: "SKU2", nome: "Produto", precoVenda: 200 },
      quantity: 1,
    });
    expect(_colecoes["vitre_orcamentos"][result.id].isTest).toBe(false);
  });

  test("atendimento inexistente (nenhum registro) → isTest=false, nunca trava a criação do rascunho", async () => {
    const isTest = await deriveIsTest("conv-inexistente");
    expect(isTest).toBe(false);
  });
});

describe("E. Chamada repetida não perde a marca de teste (idempotência preserva isTest)", () => {
  test("2a chamada de createVitreDraftIfNotExists para a mesma conversa continua isTest=true", async () => {
    seedAtendimento("conv-e", true);
    const input = {
      conversationId: "conv-e",
      organizationId: "org1",
      clienteNome: "Cliente Teste",
      produto: { id: "SKU3", sku: "SKU3", nome: "Produto", precoVenda: 50 },
      quantity: 1,
    };
    const r1 = await createVitreDraftIfNotExists(input);
    expect(r1.jaProcessado).toBe(false);
    const r2 = await createVitreDraftIfNotExists(input);
    expect(r2.jaProcessado).toBe(true);
    expect(_colecoes["vitre_orcamentos"][r1.id].isTest).toBe(true); // continua true, nunca reescrito para false na 2a chamada
  });
});

describe("F. KPI continua ignorando artefatos de teste — defesa em profundidade (status + isTest, não só um dos dois)", () => {
  test("rascunho de teste tem status='rascunho' E isTest=true simultaneamente (2 camadas independentes)", async () => {
    seedAtendimento("conv-f", true);
    const result = await createVitreDraftIfNotExists({
      conversationId: "conv-f",
      organizationId: "org1",
      clienteNome: "Cliente Teste",
      produto: { id: "SKU4", sku: "SKU4", nome: "Produto", precoVenda: 10 },
      quantity: 1,
    });
    const doc = _colecoes["vitre_orcamentos"][result.id];
    expect(doc.status).toBe("rascunho"); // camada 1 (já existia)
    expect(doc.isTest).toBe(true); // camada 2 (nova) — qualquer consumidor futuro que pare de filtrar por status ainda tem isTest
  });
});
