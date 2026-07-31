// git_commit_push.js — stage + commit + push via isomorphic-git (sem git.exe)
// Auto-detecta TODOS os arquivos modificados/novos (não usa lista fixa).
// Execução: node "C:\Projetos\ERP VR\git_commit_push.js" ["mensagem de commit"]

const git  = require("isomorphic-git");
const http = require("isomorphic-git/http/node");
const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const dir    = "C:\\Projetos\\ERP VR";
const remote = "https://github.com/vrmarcas/erp-vr.git";
const ref    = "master";

// Mensagem de commit: primeiro argumento CLI ou padrão com timestamp
const COMMIT_MSG = process.argv[2] ||
  `chore: atualização automática ${new Date().toISOString().slice(0,19).replace('T',' ')}`;

// Arquivos/padrões a EXCLUIR do commit automático (nunca devem ir para o repo)
const EXCLUDE_PATTERNS = [
  /^\.git\//,
  /node_modules\//,
  /\.bat$/,
  /^functions-valeria\/lib\//,   // compilados — incluídos separadamente se necessário
];

function shouldExclude(filepath) {
  return EXCLUDE_PATTERNS.some(re => re.test(filepath));
}

function promptToken() {
  const ps = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('Cole seu GitHub Personal Access Token:', 'GitHub Commit + Push', '')`;
  try {
    return execSync(`powershell -Command "${ps}"`, { encoding: "utf8" }).trim();
  } catch { return ""; }
}

async function main() {
  console.log("=== ERP VR — git commit + push via isomorphic-git ===\n");
  console.log("Mensagem de commit:", COMMIT_MSG, "\n");

  // Status completo do repositório
  const statusMatrix = await git.statusMatrix({ fs, dir });

  // Filtrar arquivos modificados ou não rastreados (excluindo ignored patterns)
  // statusMatrix entry: [filepath, HEAD, workdir, stage]
  // HEAD=0 workdir=2 = novo arquivo; HEAD=1 workdir=2 = modificado; HEAD=1 workdir=0 = deletado
  const toStage = statusMatrix
    .filter(([filepath, head, workdir]) =>
      workdir !== head && !shouldExclude(filepath)
    )
    .map(([filepath]) => filepath);

  if (toStage.length === 0) {
    console.log("Nenhum arquivo modificado detectado. Branch já atualizada.");
    process.exit(0);
  }

  console.log(`Arquivos a commitar (${toStage.length}):`);
  toStage.forEach(f => console.log("  [MOD]", f));

  // Stage todos os arquivos modificados
  for (const filepath of toStage) {
    try {
      await git.add({ fs, dir, filepath });
    } catch(e) {
      console.warn("  [WARN] Não foi possível adicionar:", filepath, "—", e.message);
    }
  }

  // Commit
  const sha = await git.commit({
    fs, dir,
    message: COMMIT_MSG,
    author: { name: "VR Marcas ERP", email: "erp@vrmarcas.com.br" },
  });
  console.log("\nCommit criado:", sha);

  // Log do HEAD
  const log = await git.log({ fs, dir, depth: 1 });
  if (log.length) {
    console.log("HEAD:", log[0].oid.slice(0, 8), "—", log[0].commit.message.split("\n")[0]);
  }

  // Token via prompt do Windows
  console.log("\nAbrindo diálogo para o token do GitHub...");
  const token = promptToken();
  if (!token) { console.error("ERRO: Token vazio. Abortando."); process.exit(1); }
  console.log("Token recebido. Iniciando push...\n");

  // Push
  const result = await git.push({
    fs, http, dir,
    url: remote,
    remoteRef: "master",
    ref,
    force: false,
    onAuth: () => ({ username: "x-token", password: token }),
    onAuthFailure: () => { console.error("ERRO: Autenticação falhou."); process.exit(1); },
    onMessage: (msg) => process.stdout.write("[GitHub] " + msg),
  });

  console.log("\nResultado:", JSON.stringify(result, null, 2));

  const refResult = result && result.refs && result.refs["refs/heads/master"];
  if (refResult && refResult.ok) {
    console.log("\n✅ Push concluído com sucesso! Master atualizado no GitHub.");
  } else if (result && result.ok === true) {
    console.log("\n✅ Push OK — branch já estava no estado correto.");
  } else {
    console.error("\n❌ Push pode ter falhado. Verifique o resultado acima.");
  }
}

main().catch(function(e) {
  console.error("\nERRO fatal:", e.message || e);
  process.exit(1);
});
