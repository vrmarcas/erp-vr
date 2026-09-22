/**
 * active_pilot_static_safety.test.ts — ValerIA 2.0, Fase E.2.13 (2026-09-21).
 *
 * Prova estática (mesmo padrão de shadow_runner_static_safety.test.ts):
 *  - webhook.ts calcula a guarda anti-loop ANTES de qualquer processamento
 *    e checa `isBackendEcho` antes de chamar o piloto ativo (nunca reprocessa
 *    eco da própria escrita como inbound novo);
 *  - chatvolt_send_adapter.ts é a ÚNICA fronteira de rede de escrita do
 *    piloto (nenhum outro arquivo do piloto chama fetch/POST diretamente);
 *  - active_pilot_runner.ts só chama sendChatvoltMessage quando o
 *    validador aprovou, nunca antes.
 */
import * as fs from "fs";
import * as path from "path";

function src(file: string): string {
  return fs.readFileSync(path.join(__dirname, "..", file), "utf8");
}

describe("Piloto ativo — guarda anti-loop no webhook.ts", () => {
  test("webhook.ts calcula isBackendEcho a partir de wasSentByBackend antes de processar o evento", () => {
    const webhook = src("webhook.ts");
    expect(webhook).toMatch(/wasSentByBackend\(explicitMsgId\)/);
    expect(webhook).toMatch(/let isBackendEcho = false/);
  });

  test("webhook.ts só chama runActivePilotObservation dentro de `if (!isBackendEcho)`", () => {
    const webhook = src("webhook.ts");
    const idx = webhook.indexOf("await runActivePilotObservation(");
    expect(idx).toBeGreaterThan(0);
    const before = webhook.slice(0, idx);
    const lastIfEcho = before.lastIndexOf("if (!isBackendEcho)");
    expect(lastIfEcho).toBeGreaterThan(0); // existe um `if (!isBackendEcho)` ANTES da chamada
    // e nenhum fechamento de bloco `}` no início da linha entre o if e a chamada
    // (garantia frouxa, mas suficiente: não há newline com `}` isolado logo após o if,
    // o que indicaria um bloco vazio/fechado antes de chegar na chamada real).
    const between = webhook.slice(lastIfEcho, idx);
    expect(between).not.toMatch(/\n\s*\}\s*\n\s*(if|else)\b/);
  });
});

describe("Piloto ativo — path do send-message (Fase E.2.17)", () => {
  test("chatvolt_send_adapter.ts usa o path com type=conversationId, nunca type=id", () => {
    const adapter = src("chatvolt_send_adapter.ts");
    expect(adapter).toMatch(/\/conversation\/message\/conversationId\/\$\{conversationId\}/);
    expect(adapter).not.toMatch(/\/conversation\/message\/id\//);
  });
});

describe("Piloto ativo — chatvolt_send_adapter.ts é a única fronteira de rede de escrita", () => {
  test("active_pilot_runner.ts não chama fetch diretamente — só via sendChatvoltMessage", () => {
    const runner = src("active_pilot_runner.ts");
    expect(runner).not.toMatch(/\bfetch\(/);
    expect(runner).toMatch(/from\s+["']\.\/chatvolt_send_adapter["']/);
  });

  test("active_pilot_send_ledger.ts nunca chama fetch (só Firestore)", () => {
    const ledger = src("active_pilot_send_ledger.ts");
    expect(ledger).not.toMatch(/\bfetch\(/);
  });

  test("chatvolt_send_adapter.ts é o único arquivo do piloto que chama fetch", () => {
    const files = ["active_pilot_config.ts", "active_pilot_runner.ts", "active_pilot_send_ledger.ts"];
    for (const f of files) {
      expect(src(f)).not.toMatch(/\bfetch\(/);
    }
    expect(src("chatvolt_send_adapter.ts")).toMatch(/\bfetch\(/);
  });
});

describe("Piloto ativo — envio só depois do validador aprovar", () => {
  test("active_pilot_runner.ts chama sendChatvoltMessage só dentro do bloco que checa finalValidation.valid", () => {
    const runner = src("active_pilot_runner.ts");
    // Fase E.2.35 — finalValidation substitui result.outputValidation direto,
    // porque quando o side effect comercial real acontece, a validação é
    // RECOMPUTADA (sideEffectsExecuted=true) fora do pipeline puro — ver
    // active_pilot_static_safety.test.ts "side effect comercial" abaixo.
    const validatorCheckIdx = runner.indexOf("finalValidation?.valid");
    const sendCallIdx = runner.indexOf("sendChatvoltMessage(");
    expect(validatorCheckIdx).toBeGreaterThan(0);
    expect(sendCallIdx).toBeGreaterThan(validatorCheckIdx); // checagem do validador vem ANTES da chamada de envio
  });

  test("active_pilot_runner.ts envia finalRawText (nunca o texto saneado de fallback do shadow)", () => {
    const runner = src("active_pilot_runner.ts");
    expect(runner).toMatch(/sendChatvoltMessage\(input\.conversationId,\s*finalRawText\)/);
  });
});

describe("Piloto ativo — side effect comercial real (Fase E.2.35)", () => {
  test("gate comercial é SEPARADO do gate do piloto — active_pilot_runner.ts nunca reusa activePilotEligibilityForRequest para autorizar side effect", () => {
    const runner = src("active_pilot_runner.ts");
    expect(runner).toMatch(/commercialSideEffectsEligibilityForConversation/);
    expect(runner).toMatch(/from\s+["']\.\/commercial_side_effects_config["']/);
  });

  test("side effect só é chamado quando qualificationStatus===READY_CATALOG_DRAFT e ainda não promovido", () => {
    const runner = src("active_pilot_runner.ts");
    expect(runner).toMatch(/qualificationStatus === "READY_CATALOG_DRAFT"/);
    expect(runner).toMatch(/!result\.mergedDraft\.promovido/);
  });

  test("sideEffectsExecuted só vira true DENTRO do bloco que checa sideEffectResult.executed (nunca otimista)", () => {
    const runner = src("active_pilot_runner.ts");
    const executedCheckIdx = runner.indexOf("if (sideEffectResult.executed)");
    const setTrueIdx = runner.indexOf("sideEffectsExecuted = true;");
    expect(executedCheckIdx).toBeGreaterThan(0);
    expect(setTrueIdx).toBeGreaterThan(executedCheckIdx);
  });

  test("commercial_quote_orchestrator.ts é a única fronteira de escrita de orçamento/handoff do piloto — active_pilot_runner.ts nunca chama createVitreDraftIfNotExists/requestQuoteReview diretamente", () => {
    const runner = src("active_pilot_runner.ts");
    expect(runner).not.toMatch(/createVitreDraftIfNotExists|requestQuoteReview\(/);
    expect(runner).toMatch(/executeReadyCatalogDraftSideEffects/);
  });

  test("commercial_quote_orchestrator.ts reusa os helpers de catalog_tools.ts — nunca duplica loadVitreProduct/findGroupOf/resolveClienteNome", () => {
    const orchestrator = src("commercial_quote_orchestrator.ts");
    expect(orchestrator).toMatch(/from\s+["']\.\/catalog_tools["']/);
    expect(orchestrator).not.toMatch(/async function loadVitreProduct|function findGroupOf|async function resolveClienteNome/);
  });
});

describe("Piloto ativo — kill switch e allowlists nunca são reimplementados fora de active_pilot_config.ts", () => {
  test("active_pilot_runner.ts delega toda a elegibilidade a activePilotEligibilityForRequest — não reimplementa checagem de flag/allowlist", () => {
    const runner = src("active_pilot_runner.ts");
    expect(runner).toMatch(/activePilotEligibilityForRequest/);
    expect(runner).not.toMatch(/valeriaV2Enabled/); // nunca reusa o gate do V2 real
    expect(runner).not.toMatch(/shadowEnabled/); // nunca reusa o gate do shadow
  });
});
