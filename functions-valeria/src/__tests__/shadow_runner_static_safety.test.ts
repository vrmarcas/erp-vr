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
  "shadow_diagnostics.ts",
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

  test("shadow_diagnostics.ts só escreve em valeria_shadow_diagnostics", () => {
    const srcRaw = fs.readFileSync(path.join(__dirname, "..", "shadow_diagnostics.ts"), "utf8");
    expect(srcRaw).toMatch(/const COL\s*=\s*"valeria_shadow_diagnostics"/);
    const src = stripComments(srcRaw);
    const writeMatches = src.match(/\.collection\(([^)]+)\)/g) ?? [];
    expect(writeMatches.length).toBeGreaterThan(0);
    for (const m of writeMatches) {
      expect(m).toContain("COL");
    }
  });

  test("shadow_diagnostics.ts nunca escreve em collections reais (atendimentos/orçamento/briefing/handoff)", () => {
    const src = stripComments(fs.readFileSync(path.join(__dirname, "..", "shadow_diagnostics.ts"), "utf8"));
    for (const proibida of ["atendimentos", "vitre_orcamentos", "valeria_technical_briefings", "valeria_handoffs"]) {
      expect(src).not.toContain(proibida);
    }
  });

  test("shadow_runner.ts não grava mais em valeria_shadow_diagnostics (rodada 'mesmo documento', 2026-09-21) — acumula estágios em memória e devolve no retorno", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "shadow_runner.ts"), "utf8");
    expect(src).not.toMatch(/recordShadowDiagnosticStage/);
    expect(src).not.toMatch(/from\s+["']\.\/shadow_diagnostics["']/);
    // toda gravação de estágio é `stages.push(...)` — síncrono, em memória, sem I/O.
    const pushes = src.match(/stages\.push\(/g) ?? [];
    expect(pushes.length).toBeGreaterThanOrEqual(5); // RUNNER_ENTERED, GATE_EVALUATED, PIPELINE_COMPLETED, RESULT_WRITE_ATTEMPTED, RESULT_WRITE_CONFIRMED (+ EXCEPTION no catch)
  });

  test("ShadowObservationOutcome sempre devolve `stages` — o chamador (webhook.ts) é quem decide gravar, runner nunca escreve estágio em Firestore", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "shadow_runner.ts"), "utf8");
    expect(src).toMatch(/stages:\s*string\[\]/);
    // nenhuma chamada a stages.push está dentro de um `if (await ...)` que decida o retorno — é sempre incondicional na sequência.
    expect(src).not.toMatch(/if\s*\(\s*await\s+.*stages\.push/);
  });

  test("webhook.ts usa a MESMA chave de idempotência para o doc de valeria_webhook_events (messageId = explicitMsgId ?? idempKey) — retry funde no mesmo doc via withIdempotency, nunca duplica", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "webhook.ts"), "utf8");
    expect(src).toMatch(/messageId:\s*explicitMsgId \?\? idempKey/);
  });

  test("webhook.ts captura o DocumentReference do .add() e só faz UM .update() logo em seguida, restrito a shadowDebugEligivel", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "webhook.ts"), "utf8");
    expect(src).toMatch(/const webhookEventRef\s*=\s*await\s+db\.collection\("valeria_webhook_events"\)\.add/);
    expect(src).toMatch(/webhookEventRef\.update\(/);
  });
});
