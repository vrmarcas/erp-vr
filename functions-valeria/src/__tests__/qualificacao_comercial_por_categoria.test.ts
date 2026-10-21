/**
 * qualificacao_comercial_por_categoria.test.ts — rodada "qualificação
 * comercial da Valéria" (2026-10-21).
 *
 * Bug relatado: Valéria qualifica caixa/troféu/placa de forma rasa —
 * pula etapas, sugere medida antes de perguntar o espaço disponível,
 * encaminha para humano cedo demais. Causa raiz real: o backend (que
 * decide tudo determinísticamente — o LLM só verbaliza) tratava
 * qualquer produto personalizado com o MESMO conjunto fixo de 7 campos
 * geométricos, sem nenhuma distinção por tipo de produto, e sem nenhuma
 * ORDEM — só uma lista não-priorizada de campos faltantes.
 *
 * Cobre: computeTechnicalReadiness (branch troféu — nunca bloqueia
 * preço com campos geométricos que não existem para ele),
 * computeQualificationGaps (ordem progressiva por categoria) e
 * mapTechnicalFieldToNextAction (tradução campo→nextAction).
 */
import { computeTechnicalReadiness, computeQualificationGaps, emptyTechnicalBriefing, TechnicalBriefing } from "../technical_briefing";
import { mapTechnicalFieldToNextAction } from "../qualification_engine";

function trofeu(overrides: Partial<TechnicalBriefing> = {}): TechnicalBriefing {
  return { ...emptyTechnicalBriefing(), categoriaComercial: "trofeu", ...overrides };
}
function placa(overrides: Partial<TechnicalBriefing> = {}): TechnicalBriefing {
  return { ...emptyTechnicalBriefing(), categoriaComercial: "placa", ...overrides };
}
function caixa(overrides: Partial<TechnicalBriefing> = {}): TechnicalBriefing {
  return { ...emptyTechnicalBriefing(), categoriaComercial: "caixa", ...overrides };
}

describe("computeTechnicalReadiness — troféu nunca exige campos geométricos para calcular preço", () => {
  test("troféu vazio: só falta quantity, nunca largura/espessura/material", () => {
    const r = computeTechnicalReadiness(trofeu());
    expect(r.ready).toBe(false);
    expect(r.missingRequiredFields).toEqual(["quantity"]);
  });

  test("troféu com quantidade: nunca fica 'ready' (preço de troféu é sempre humano/handoff)", () => {
    const r = computeTechnicalReadiness(trofeu({ quantity: 5 }));
    expect(r.ready).toBe(false);
    expect(r.missingRequiredFields).toEqual([]);
  });

  test("caixa/placa (categoriaComercial ausente = default) preservam o comportamento geométrico de sempre — zero regressão", () => {
    const semCategoria = { ...emptyTechnicalBriefing(), productId: "Caixa", dimensions: { larguraMm: 400, alturaMm: 300, profundidadeMm: 100 }, thicknessMm: 3, materialId: "cfg_0", quantity: 2 };
    const r = computeTechnicalReadiness(semCategoria);
    expect(r.ready).toBe(true);
    expect(r.missingRequiredFields).toEqual([]);
  });
});

describe("computeQualificationGaps — troféu: modelo/referência antes de tudo, catálogo só depois de 'sem modelo'", () => {
  test("troféu recém-criado: pergunta modeloReferencia primeiro, nunca quantidade antes", () => {
    const g = computeQualificationGaps(trofeu());
    expect(g.nextField).toBe("modeloReferencia");
  });

  test("cliente disse que tem modelo (texto livre): já não pergunta modelo nem catálogo — segue para quantidade", () => {
    const g = computeQualificationGaps(trofeu({ modeloReferencia: "troféu dourado com base de madeira" }));
    expect(g.missingQualificationFields).not.toContain("modeloReferencia");
    expect(g.missingQualificationFields).not.toContain("catalogoReferenciaOferecido");
    expect(g.nextField).toBe("quantity");
  });

  test("cliente disse que NÃO tem modelo: próximo passo é oferecer o catálogo, nunca perguntar modelo de novo", () => {
    const g = computeQualificationGaps(trofeu({ modeloReferencia: "sem_modelo" }));
    expect(g.nextField).toBe("catalogoReferenciaOferecido");
  });

  test("catálogo já oferecido depois de 'sem modelo': não insiste de novo, segue para quantidade", () => {
    const g = computeQualificationGaps(trofeu({ modeloReferencia: "sem_modelo", catalogoReferenciaOferecido: true }));
    expect(g.missingQualificationFields).not.toContain("catalogoReferenciaOferecido");
    expect(g.nextField).toBe("quantity");
  });

  test("cliente mandou arquivo de referência: pergunta se é produtivo antes de seguir", () => {
    const g = computeQualificationGaps(trofeu({ modeloReferencia: "mandei uma foto", arquivoRecebido: true }));
    expect(g.nextField).toBe("arquivoEhProdutivo");
  });

  test("troféu totalmente qualificado: nenhuma pergunta pendente", () => {
    const g = computeQualificationGaps(
      trofeu({ modeloReferencia: "mandei uma foto", arquivoRecebido: true, arquivoEhProdutivo: false, quantity: 10 })
    );
    expect(g.missingQualificationFields).toEqual([]);
    expect(g.nextField).toBeNull();
  });
});

describe("computeQualificationGaps — placa: espaço disponível e arte/conteúdo antes de acabamento", () => {
  test("placa sem nada: pergunta medida (espaço) antes de qualquer outra coisa", () => {
    const g = computeQualificationGaps(placa());
    expect(g.nextField).toBe("larguraMm");
  });

  test("placa com medida: próximo passo é perguntar se já tem arte — nunca pula direto para material/espessura", () => {
    const g = computeQualificationGaps(placa({ dimensions: { larguraMm: 500, alturaMm: 400, profundidadeMm: null } }));
    expect(g.nextField).toBe("temArte");
  });

  test("placa com arte confirmada mas arquivo ainda não enviado: pede o arquivo", () => {
    const g = computeQualificationGaps(
      placa({ dimensions: { larguraMm: 500, alturaMm: 400, profundidadeMm: null }, temArte: true })
    );
    expect(g.nextField).toBe("arquivoRecebido");
  });

  test("placa com arte e arquivo recebido: confirma se é produtivo", () => {
    const g = computeQualificationGaps(
      placa({ dimensions: { larguraMm: 500, alturaMm: 400, profundidadeMm: null }, temArte: true, arquivoRecebido: true })
    );
    expect(g.nextField).toBe("arquivoEhProdutivo");
  });

  test("placa SEM arte: pergunta o que o cliente quer colocar na peça, nunca pede arquivo", () => {
    const g = computeQualificationGaps(
      placa({ dimensions: { larguraMm: 500, alturaMm: 400, profundidadeMm: null }, temArte: false })
    );
    expect(g.nextField).toBe("conteudoDesejado");
  });

  test("placa 50x40 com conteúdo definido: continua pedindo espessura/material/quantidade — nunca para aqui (teste do Gabriel)", () => {
    const g = computeQualificationGaps(
      placa({ dimensions: { larguraMm: 500, alturaMm: 400, profundidadeMm: null }, temArte: false, conteudoDesejado: "logo + telefone + instagram" })
    );
    expect(g.missingQualificationFields).toEqual(["thicknessMm", "materialId", "quantity"]);
  });
});

describe("computeQualificationGaps — caixa: finalidade de uso antes de espessura, tampa antes de quantidade", () => {
  test("caixa com medidas já informadas: próximo passo é perguntar a finalidade de uso, nunca pular direto para espessura", () => {
    const g = computeQualificationGaps(
      caixa({ dimensions: { larguraMm: 150, alturaMm: 200, profundidadeMm: 100 } })
    );
    expect(g.nextField).toBe("finalidadeUso");
  });

  test("com finalidade e espessura/material resolvidos: pergunta se tem tampa", () => {
    const g = computeQualificationGaps(
      caixa({ dimensions: { larguraMm: 150, alturaMm: 200, profundidadeMm: 100 }, finalidadeUso: "guardar lembrancinhas", thicknessMm: 3, materialId: "cfg_0" })
    );
    expect(g.nextField).toBe("temTampa");
  });

  test("cliente quer tampa: pergunta o modelo da tampa antes de quantidade", () => {
    const g = computeQualificationGaps(
      caixa({ dimensions: { larguraMm: 150, alturaMm: 200, profundidadeMm: 100 }, finalidadeUso: "presente", thicknessMm: 3, materialId: "cfg_0", temTampa: true })
    );
    expect(g.nextField).toBe("tampaModelo");
  });

  test("cliente não quer tampa: pula direto para quantidade, nunca pergunta modelo de tampa", () => {
    const g = computeQualificationGaps(
      caixa({ dimensions: { larguraMm: 150, alturaMm: 200, profundidadeMm: 100 }, finalidadeUso: "presente", thicknessMm: 3, materialId: "cfg_0", temTampa: false })
    );
    expect(g.missingQualificationFields).not.toContain("tampaModelo");
    expect(g.nextField).toBe("quantity");
  });
});

describe("mapTechnicalFieldToNextAction — traduz campo+categoria em nextAction, nunca ambíguo", () => {
  test("medida: ASK_WALL_SPACE para placa (espaço disponível), ASK_SIZE para caixa", () => {
    expect(mapTechnicalFieldToNextAction("larguraMm", "placa").nextAction).toBe("ASK_WALL_SPACE");
    expect(mapTechnicalFieldToNextAction("larguraMm", "caixa").nextAction).toBe("ASK_SIZE");
  });
  test("troféu: modeloReferencia -> ASK_REFERENCE_MODEL, catalogoReferenciaOferecido -> OFFER_REFERENCE_CATALOG", () => {
    expect(mapTechnicalFieldToNextAction("modeloReferencia", "trofeu").nextAction).toBe("ASK_REFERENCE_MODEL");
    expect(mapTechnicalFieldToNextAction("catalogoReferenciaOferecido", "trofeu").nextAction).toBe("OFFER_REFERENCE_CATALOG");
  });
  test("arquivo: arquivoRecebido (pedir o arquivo) é distinto de arquivoEhProdutivo (confirmar)", () => {
    expect(mapTechnicalFieldToNextAction("arquivoRecebido", "placa").nextAction).toBe("ASK_FOR_ART_FILE");
    expect(mapTechnicalFieldToNextAction("arquivoEhProdutivo", "placa").nextAction).toBe("CONFIRM_FILE_IS_PRODUCTION_READY");
  });
  test("caixa: finalidadeUso -> ASK_PURPOSE, temTampa -> ASK_LID, tampaModelo -> ASK_LID_MODEL", () => {
    expect(mapTechnicalFieldToNextAction("finalidadeUso", "caixa").nextAction).toBe("ASK_PURPOSE");
    expect(mapTechnicalFieldToNextAction("temTampa", "caixa").nextAction).toBe("ASK_LID");
    expect(mapTechnicalFieldToNextAction("tampaModelo", "caixa").nextAction).toBe("ASK_LID_MODEL");
  });
});
