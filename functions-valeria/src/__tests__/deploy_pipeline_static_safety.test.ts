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

describe("E. firebase-valeria.json — postdeploy chama só o wrapper (Fase E.2.19)", () => {
  function loadPostdeploy(): string[] {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "..", "firebase-valeria.json"), "utf8"));
    return cfg.functions[0].postdeploy;
  }

  test("postdeploy chama somente 'bash scripts/rebind_chatvolt_api_key.sh' — nada mais, sem '=' na string", () => {
    const postdeploy = loadPostdeploy();
    expect(Array.isArray(postdeploy)).toBe(true);
    expect(postdeploy).toEqual(["bash scripts/rebind_chatvolt_api_key.sh"]);
    // Fase E.2.18: Firebase CLI avisou que comandos de postdeploy com '=' podem não rodar
    // corretamente — a string do postdeploy em si nunca deve mais conter '='.
    expect(postdeploy[0]).not.toContain("=");
  });
});

describe("F. scripts/rebind_chatvolt_api_key.sh — wrapper de rebind do CHATVOLT_API_KEY (Fase E.2.19)", () => {
  function loadWrapper(): string {
    return fs.readFileSync(path.join(ROOT, "..", "scripts", "rebind_chatvolt_api_key.sh"), "utf8");
  }

  test("fail-closed: set -euo pipefail presente", () => {
    expect(loadWrapper()).toMatch(/^set -euo pipefail/m);
  });

  test("referencia CHATVOLT_API_KEY via --update-secrets, nunca materializa valor de secret", () => {
    const sh = loadWrapper();
    expect(sh).toMatch(/--update-secrets="\$\{SECRET_KEY\}=\$\{SECRET_REF\}"/);
    expect(sh).toMatch(/SECRET_REF="CHATVOLT_API_KEY:latest"/);
    // nenhum valor de secret (string opaca longa) commitado — só nomes/flags/referências por versão.
    expect(sh).not.toMatch(/[A-Za-z0-9_-]{32,}/); // nenhuma string longa opaca (hash/token/chave) no arquivo
  });

  test("usa --update-secrets (atualiza/adiciona), nunca --set-secrets (que substituiria TODOS os secrets)", () => {
    const sh = loadWrapper();
    expect(sh).toMatch(/--update-secrets=/);
    expect(sh).not.toMatch(/--set-secrets=/);
  });

  test("faz verificação final via gcloud describe e falha (exit 1) se CHATVOLT_API_KEY não aparecer no binding", () => {
    const sh = loadWrapper();
    expect(sh).toMatch(/gcloud functions describe/);
    expect(sh).toMatch(/check_secret_bound "CHATVOLT_API_KEY"/);
    expect(sh).toMatch(/exit 1/);
  });

  test("verificação final também confirma os dois secrets pré-existentes (prova que --update-secrets não os removeu)", () => {
    const sh = loadWrapper();
    expect(sh).toMatch(/check_secret_bound "VALERIA_BEARER_SECRET"/);
    expect(sh).toMatch(/check_secret_bound "VALERIA_BEARER_SECRET_PREV"/);
  });

  test("nunca imprime o valor de um secret (sem describe.*format.*value do próprio secret, sem cat/echo de credencial)", () => {
    const sh = loadWrapper();
    expect(sh).not.toMatch(/secrets\s+versions\s+access/); // nunca busca o VALOR do secret, só o binding (key)
  });

  test("usa region/entryPoint/runtime/source já confirmados da function atual — nunca muda URL/trigger/service account", () => {
    const sh = loadWrapper();
    expect(sh).toMatch(/REGION="us-central1"/);
    expect(sh).toMatch(/ENTRY_POINT="valeriaWebhookChatvolt"/);
    expect(sh).toMatch(/RUNTIME="nodejs22"/);
    expect(sh).toMatch(/SOURCE_DIR="functions-valeria"/);
    expect(sh).not.toMatch(/--trigger-topic|--trigger-bucket|--trigger-event/); // nunca muda o TIPO de trigger (continua HTTP)
    expect(sh).toMatch(/--trigger-http/);
  });
});
