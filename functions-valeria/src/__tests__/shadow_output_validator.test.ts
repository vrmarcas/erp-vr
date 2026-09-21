/**
 * shadow_output_validator.test.ts — ValerIA 2.0, Fase E.2.7 (2026-09-20).
 *
 * Prova central do item 8: "o LLM pode errar, mas o erro não chega ao
 * cliente" — mesmo simulando um redator "ruim" que despreza a instrução.
 */
import { validateOutput } from "../shadow_output_validator";

describe("validateOutput — questionAllowed=false (EXPLORATORY/AMBIGUOUS)", () => {
  test("texto correto (sem pergunta) passa", () => {
    const r = validateOutput("Sim, fazemos peças sob medida.", { questionAllowed: false, factsAllowed: ["Sim, fazemos peças sob medida."] });
    expect(r.valid).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.sanitizedText).toBe("Sim, fazemos peças sob medida.");
  });

  test("LLM 'ruim' termina em pergunta de acompanhamento → rejeitado e saneado", () => {
    const bad = "Sim, fazemos peças sob medida. Pode me passar as medidas?";
    const r = validateOutput(bad, { questionAllowed: false, factsAllowed: ["Sim, fazemos peças sob medida."] });
    expect(r.valid).toBe(false);
    expect(r.violations).toEqual(expect.arrayContaining(["CONTAINS_QUESTION_MARK"]));
    expect(r.sanitizedText).toBe("Sim, fazemos peças sob medida.");
    expect(r.sanitizedText).not.toContain("?");
  });

  test("pede quantidade mesmo sem '?' → rejeitado", () => {
    const bad = "Anotado. Me diga a quantidade necessária para eu seguir.";
    const r = validateOutput(bad, { questionAllowed: false, factsAllowed: ["Posso ajudar com isso."] });
    expect(r.valid).toBe(false);
    expect(r.violations).toEqual(expect.arrayContaining(["ASKS_QUANTITY"]));
  });

  test("pede medidas/material/prazo/foto → cada um rejeitado isoladamente", () => {
    const casos: Array<[string, string]> = [
      ["Quais as medidas que você precisa?", "ASKS_MEASUREMENTS"],
      ["Qual o material desejado?", "ASKS_MATERIAL"],
      ["Qual o prazo que você precisa?", "ASKS_DEADLINE"],
      ["Pode enviar uma foto?", "ASKS_FILE_OR_PHOTO"],
    ];
    for (const [texto, violacaoEsperada] of casos) {
      const r = validateOutput(texto, { questionAllowed: false, factsAllowed: ["fato seguro."] });
      expect(r.valid).toBe(false);
      expect(r.violations).toContain(violacaoEsperada);
    }
  });

  test("sem factsAllowed, cai para fallback genérico seguro", () => {
    const r = validateOutput("Pode me passar as medidas?", { questionAllowed: false, factsAllowed: [] });
    expect(r.valid).toBe(false);
    expect(r.sanitizedText).not.toContain("?");
    expect(r.sanitizedText.length).toBeGreaterThan(0);
  });
});

describe("validateOutput — questionAllowed=true (COMMERCIAL_INTENT)", () => {
  test("pergunta é permitida e não é violação", () => {
    const r = validateOutput("Quantas unidades você precisa?", { questionAllowed: true, factsAllowed: [] });
    expect(r.valid).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.sanitizedText).toBe("Quantas unidades você precisa?");
  });
});

describe("validateOutput — determinismo", () => {
  test("mesma entrada produz sempre a mesma saída", () => {
    const args: [string, { questionAllowed: boolean; factsAllowed: string[] }] = [
      "Pode me passar as medidas?",
      { questionAllowed: false, factsAllowed: ["fato."] },
    ];
    expect(validateOutput(...args)).toEqual(validateOutput(...args));
  });
});
