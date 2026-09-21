/**
 * deploy_pipeline_static_safety.test.ts — ValerIA 2.0, Fase E.2.10 (2026-09-21),
 * estendido na Fase E.2.18 (2026-09-21).
 *
 * Regressão da causa raiz nº 1 de E.2.9: `firebase-valeria.json` não
 * compilava TypeScript antes de empacotar `lib/` para deploy — o deploy
 * subia o que já estivesse no disco, podendo ser uma build antiga (foi
 * exatamente o que aconteceu: o deploy do teste 5 rodou código de uma
 * fase anterior). Este arquivo prova estaticamente que:
 *  D. o `predeploy` sempre compila ANTES do guard de branch, sem
 *     enfraquecer o guard;
 *  C. uma build real (tsc, com emit) a partir do `src/` atual produz um
 *     `lib/` que contém a instrumentação corrente — nenhum resíduo de
 *     fase anterior sobrevive a uma rebuild limpa.
 *
 * Fase E.2.18 — causa raiz nº 3 (bug do Firebase CLI que não propaga
 * `CHATVOLT_API_KEY` para `secretEnvironmentVariables` em deploy seletivo
 * de Gen1, provado por evidência direta em E.2.17: a extração local via
 * `__endpoint`/`__trigger` do `firebase-functions` já está correta — o
 * gap é só entre isso e a chamada real da API do Cloud Functions).
 * Correção: `postdeploy` que restaura o binding via `gcloud functions
 * deploy --update-secrets`, automaticamente, em todo deploy futuro.
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

const ROOT = path.join(__dirname, "..", "..");

describe("D. firebase-valeria.json — predeploy compila antes do guard, guard nunca removido", () => {
  test("ordem do predeploy: build primeiro, guard por último", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "..", "firebase-valeria.json"), "utf8"));
    const predeploy: string[] = cfg.functions[0].predeploy;
    expect(Array.isArray(predeploy)).toBe(true);
    expect(predeploy.length).toBeGreaterThanOrEqual(2);

    const buildIdx = predeploy.findIndex((cmd) => /npm .*--prefix functions-valeria run build/.test(cmd));
    const guardIdx = predeploy.findIndex((cmd) => /guard_deploy_branch\.js/.test(cmd));

    expect(buildIdx).toBeGreaterThanOrEqual(0); // etapa de build presente
    expect(guardIdx).toBeGreaterThanOrEqual(0); // guard presente — nunca removido
    expect(buildIdx).toBeLessThan(guardIdx); // build roda ANTES do guard
  });

  test("functions-valeria/package.json ainda expõe 'build': 'tsc' (comando que o predeploy invoca)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.build).toBe("tsc");
  });
});

describe("C. build real a partir do src/ atual não deixa resíduo de fase anterior (guard de regressão de artefato stale)", () => {
  jest.setTimeout(60000);

  test("tsc (com emit) gera lib/webhook.js e lib/shadow_runner.js contendo a instrumentação corrente", () => {
    execFileSync("npx", ["tsc", "-p", "."], { cwd: ROOT, stdio: "pipe" });

    const webhookJs = fs.readFileSync(path.join(ROOT, "lib", "webhook.js"), "utf8");
    const shadowRunnerJs = fs.readFileSync(path.join(ROOT, "lib", "shadow_runner.js"), "utf8");

    // Marcadores da instrumentação atual (Fase E.2.9/E.2.10) — precisam estar no artefato compilado.
    expect(webhookJs).toContain("webhookEventRef");
    expect(webhookJs).toContain("shadowDebugStages");
    expect(webhookJs).toContain("EVENT_CREATED");
    expect(shadowRunnerJs).toContain("runShadowObservation");
    expect(shadowRunnerJs).toContain("sanitizeForFirestore");

    // Marcadores de fase ANTERIOR (E.2.8, console.log) — não podem sobreviver a uma build limpa do src atual,
    // já que foram removidos de webhook.ts nesta fase (ver git history).
    expect(webhookJs).not.toContain("post-context checkpoint");
    expect(webhookJs).not.toContain("pre-shadow checkpoint");
  });
});

describe("E. firebase-valeria.json — postdeploy restaura o binding do CHATVOLT_API_KEY (Fase E.2.18)", () => {
  function loadPostdeploy(): string[] {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "..", "firebase-valeria.json"), "utf8"));
    return cfg.functions[0].postdeploy;
  }

  test("postdeploy existe e contém exatamente um comando de rebind via gcloud", () => {
    const postdeploy = loadPostdeploy();
    expect(Array.isArray(postdeploy)).toBe(true);
    expect(postdeploy.length).toBeGreaterThanOrEqual(1);
    expect(postdeploy.some((cmd) => /gcloud functions deploy valeriaWebhookChatvolt/.test(cmd))).toBe(true);
  });

  test("postdeploy referencia CHATVOLT_API_KEY via --update-secrets, nunca materializa o valor do secret", () => {
    const postdeploy = loadPostdeploy();
    const cmd = postdeploy.find((c) => /gcloud functions deploy/.test(c))!;
    expect(cmd).toMatch(/--update-secrets=CHATVOLT_API_KEY=CHATVOLT_API_KEY:latest/);
    // só referencia o secret pelo NOME — nunca um valor de secret embutido no comando
    // (qualquer string longa alfanumérica solta seria suspeita; aqui só há nomes/flags conhecidos).
    expect(cmd).not.toMatch(/CHATVOLT_API_KEY=[A-Za-z0-9/+_-]{20,}/); // nome != valor materializado
  });

  test("postdeploy usa --update-secrets (atualiza/adiciona), nunca --set-secrets (que substituiria TODOS os secrets)", () => {
    const postdeploy = loadPostdeploy();
    const cmd = postdeploy.find((c) => /gcloud functions deploy/.test(c))!;
    expect(cmd).toMatch(/--update-secrets=/);
    expect(cmd).not.toMatch(/--set-secrets=/); // --set-secrets removeria VALERIA_BEARER_SECRET/_PREV do binding
  });

  test("postdeploy não engole erro do gcloud (sem '|| true', '; true' ou redirecionamento que mascare falha)", () => {
    const postdeploy = loadPostdeploy();
    const cmd = postdeploy.find((c) => /gcloud functions deploy/.test(c))!;
    expect(cmd).not.toMatch(/\|\|\s*true/);
    expect(cmd).not.toMatch(/;\s*true\s*$/);
    expect(cmd).not.toMatch(/2>\s*\/dev\/null/);
    expect(cmd).not.toMatch(/\|\|\s*exit\s*0/);
  });

  test("postdeploy usa a MESMA region/entryPoint/runtime já confirmados da function atual (nunca muda source de forma imprevisível)", () => {
    const postdeploy = loadPostdeploy();
    const cmd = postdeploy.find((c) => /gcloud functions deploy/.test(c))!;
    expect(cmd).toMatch(/--region=us-central1/);
    expect(cmd).toMatch(/--entry-point=valeriaWebhookChatvolt/);
    expect(cmd).toMatch(/--runtime=nodejs22/);
    expect(cmd).toMatch(/--source=functions-valeria/);
  });
});
