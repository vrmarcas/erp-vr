/**
 * shadow_runner_static_safety.test.ts — ValerIA 2.0, Fase E.2.8 (2026-09-20).
 *
 * Prova estática exigida pelo item 15.4 do pedido: "demonstrar que não
 * existe import/chamada de send-message/Agent Query/etc. no caminho
 * shadow". Lê o próprio arquivo-fonte de todos os módulos do shadow e
 * falha se qualquer um deles importar um módulo de escrita real
 * (vitre_draft_writer, human_handoff, technical_briefing_store) ou fizer
 * uma chamada de rede que poderia ser send-message/Agent Query/
 * set-ai-enabled do ChatVolt.
 */
import * as fs from "fs";
import * as path from "path";

const SHADOW_FILES = [
  "shadow_runner.ts",
  "shadow_pipeline.ts",
  "shadow_signal_extractor.ts",
  "shadow_output_validator.ts",
  "shadow_redactor.ts",
  "shadow_config.ts",
  "interaction_classifier.ts",
];

const FORBIDDEN_IMPORTS = [
  "vitre_draft_writer",
  "human_handoff",
  "technical_briefing_store",
  "confirmation_detector",
  "handoff_detector",
];

// Domínios/paths reais de send-message, Agent Query e set-ai-enabled do ChatVolt.
const FORBIDDEN_NETWORK_MARKERS = [
  "api.chatvolt.ai/agents",
  "api.chatvolt.ai/conversation",
  "set-ai-enabled",
  "/query",
];

/** Remove comentários de bloco e de linha — os arquivos deste módulo
 * EXPLICAM em prosa quais chamadas são proibidas, o que geraria falso
 * positivo se a varredura lesse comentários como código real. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("Módulos shadow — prova estática de zero side effect real", () => {
  for (const file of SHADOW_FILES) {
    test(`${file} não importa módulo de escrita real`, () => {
      const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(src).not.toMatch(new RegExp(`from\\s+["']\\./${forbidden}["']`));
      }
    });

    test(`${file} não contém chamada de rede para endpoints mutáveis do ChatVolt`, () => {
      const src = stripComments(fs.readFileSync(path.join(__dirname, "..", file), "utf8"));
      for (const marker of FORBIDDEN_NETWORK_MARKERS) {
        expect(src).not.toContain(marker);
      }
    });
  }

  test("shadow_runner.ts é a ÚNICA fronteira de escrita — só grava em valeria_shadow_results", () => {
    const srcRaw = fs.readFileSync(path.join(__dirname, "..", "shadow_runner.ts"), "utf8");
    expect(srcRaw).toMatch(/const RESULTS_COL\s*=\s*"valeria_shadow_results"/);
    const src = stripComments(srcRaw);
    const writeMatches = src.match(/\.collection\(([^)]+)\)/g) ?? [];
    expect(writeMatches.length).toBeGreaterThan(0);
    for (const m of writeMatches) {
      expect(m).toContain("RESULTS_COL");
    }
  });

  test("shadow_pipeline.ts, shadow_signal_extractor.ts, shadow_output_validator.ts, shadow_redactor.ts, interaction_classifier.ts, shadow_config.ts não importam firebase-admin exceto shadow_config.ts (leitura de flag)", () => {
    const semAdmin = ["shadow_pipeline.ts", "shadow_signal_extractor.ts", "shadow_output_validator.ts", "shadow_redactor.ts", "interaction_classifier.ts"];
    for (const file of semAdmin) {
      const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
      expect(src).not.toMatch(/firebase-admin/);
    }
  });
});
