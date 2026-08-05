// git_push_valeria.js — push via isomorphic-git (sem git.exe)
// Execução: node "C:\Projetos\ERP VR\git_push_valeria.js"
// Ou execute push_valeria_now.bat nessa mesma pasta

const git  = require("isomorphic-git");
const http = require("isomorphic-git/http/node");
const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const dir    = "C:\\Projetos\\ERP VR";
const remote = "https://github.com/vrmarcas/erp-vr.git";
const ref    = "master";

// ── Lê token via Windows InputBox ─────────────────────────────────────────────
function promptToken() {
  const ps = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('Cole seu GitHub Personal Access Token (classic ou fine-grained):', 'GitHub Push — Valeria v2.1.0', '')`;
  try {
    const token = execSync(`powershell -Command "${ps}"`, { encoding: "utf8" }).trim();
    return token;
  } catch {
    return "";
  }
}

async function main() {
  console.log("=== Valeria v2.1.0 — git push via isomorphic-git ===\n");

  // Log do commit atual
  const log = await git.log({ fs, dir, depth: 1 });
  if (log.length) {
    console.log("Commit atual:");
    console.log("  SHA:", log[0].oid);
    console.log("  MSG:", log[0].commit.message.split("\n")[0]);
    console.log();
  }

  // Obter token
  console.log("Abrindo dialogo para o token do GitHub...");
  const token = promptToken();
  if (!token) {
    console.error("ERRO: Token vazio ou cancelado. Abortando.");
    process.exit(1);
  }
  console.log("Token recebido. Iniciando push...\n");

  // Push
  try {
    const result = await git.push({
      fs,
      http,
      dir,
      url: remote,
      remoteRef: "master",
      ref,
      force: false,
      onAuth: () => ({ username: "x-token", password: token }),
      onAuthFailure: () => {
        console.error("\nERRO: Autenticacao falhou. Token invalido ou sem permissao de escrita.");
        process.exit(1);
      },
      onMessage: (msg) => process.stdout.write("[GitHub] " + msg),
    });

    // Log completo do resultado para debug
    console.log("\nResultado raw:", JSON.stringify(result, null, 2));

    const hasErrors = result.errors && result.errors.length > 0;
    const hasOk     = result.ok && result.ok.length > 0;

    if (hasErrors) {
      console.error("\nERRO no push:", result.errors);
      process.exit(1);
    } else if (hasOk) {
      console.log("\n========================================");
      console.log("  PUSH CONCLUIDO COM SUCESSO!");
      console.log("  Branch: master -> origin/master");
      console.log("  " + result.ok.join(", "));
      console.log("  https://github.com/vrmarcas/erp-vr/tree/master");
      console.log("========================================\n");
    } else {
      // Sem ok e sem errors = branch ja estava atualizada ou push vazio
      console.log("\n[INFO] Push retornou sem ok/errors.");
      console.log("[INFO] Pode ser que a branch ja estava no estado correto.");
      console.log("[INFO] Verifique: https://github.com/vrmarcas/erp-vr/branches");
    }
  } catch (e) {
    console.error("\nERRO:", e.message);
    if (e.data) console.error("Detalhe:", JSON.stringify(e.data));
    process.exit(1);
  }
}

main().catch((e) => { console.error("ERRO fatal:", e.message); process.exit(1); });
