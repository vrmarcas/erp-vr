/**
 * admin_ops.ts — RODADA 3.1: caminho administrativo temporário e auditável
 * para operações que exigem escrita privilegiada no Firestore de produção
 * quando não há GOOGLE_APPLICATION_CREDENTIALS disponível no ambiente local
 * (Admin SDK local não consegue autenticar; a Cloud Function SIM, porque o
 * runtime do Cloud Functions injeta credenciais automaticamente — sem
 * nenhum arquivo de chave, sem segredo persistido em coleção nenhuma).
 *
 * Autorização: Bearer token comparado com ADMIN_ONE_TIME_SECRET (variável
 * de ambiente, carregada de functions/.env.<project-id> no deploy — nunca
 * commitada, coberta por .gitignore). Mesmo padrão já usado em valeria.ts
 * (checkAuth contra um segredo), reaproveitado aqui para consistência.
 *
 * Escopo estritamente limitado a duas operações já validadas via dry-run
 * local: seed de contas bancárias (Bradesco/Itaú) e aplicação idempotente
 * do histórico financeiro 2018-2026 por fonte (hist_mensal/hist_nf/
 * hist_caixa_diario/hist_movimentacoes/hist_despesas) + rollback lógico.
 * Toda a lógica de PARSING/NORMALIZAÇÃO/VALIDAÇÃO continua rodando
 * localmente (scripts/hist_lib.js, já testado) — esta função só recebe os
 * registros JÁ normalizados e faz o merge idempotente por id_importacao,
 * exatamente a mesma lógica de scripts/import_historico_financeiro.js.
 *
 * Recomendado: remover este arquivo (e o export em index.ts) depois do uso
 * único desta rodada, para não manter uma superfície administrativa extra
 * em produção além do necessário.
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const COL = "erp_vr";

function checkSecret(req: functions.https.Request, res: functions.Response): boolean {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const expected = process.env.ADMIN_ONE_TIME_SECRET || "";
  if (!expected) {
    res.status(500).json({ ok: false, error: "ADMIN_ONE_TIME_SECRET não configurado no ambiente da function" });
    return false;
  }
  if (!token || token !== expected) {
    res.status(401).json({ ok: false, error: "Bearer token inválido" });
    return false;
  }
  return true;
}

async function lerDoc(docId: string): Promise<any> {
  const db = admin.firestore();
  const snap = await db.collection(COL).doc(docId).get();
  if (!snap.exists) return {};
  const raw = snap.data()?.data;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
async function gravarDoc(docId: string, data: any): Promise<void> {
  const db = admin.firestore();
  await db.collection(COL).doc(docId).set({ data: JSON.stringify(data), ts: Date.now() });
}

interface ContaBancaria {
  id: string; nome: string; tipo: string; agencia: string; conta: string;
  titular: string; doc: string; pix: string; pixTipo: string; principal: boolean;
  saldoInicial: number | null;
}

async function opSeedBancos(): Promise<any> {
  const data = await lerDoc("erp_bank_config");
  const vrLista: ContaBancaria[] = Array.isArray(data.vr) ? data.vr.slice() : [];
  const existentes = vrLista.map((b) => (b.nome || "").trim().toLowerCase());
  const faltando = ["Bradesco", "Itaú"].filter((nome) => existentes.indexOf(nome.toLowerCase()) < 0);

  if (!faltando.length) {
    return { ok: true, faltando: [], jaCompleto: true, contasVr: vrLista.map((b) => b.nome) };
  }

  faltando.forEach((nome) => {
    vrLista.push({
      id: "seed_" + nome.toLowerCase().replace(/[^a-z0-9]/g, "") + "_" + Date.now().toString(36),
      nome, tipo: "corrente", agencia: "", conta: "", titular: "", doc: "", pix: "",
      pixTipo: "cpf", principal: false, saldoInicial: null,
    });
  });
  data.vr = vrLista;
  await gravarDoc("erp_bank_config", data);
  return { ok: true, adicionadas: faltando, contasVr: vrLista.map((b) => b.nome) };
}

async function opImportarFonte(body: any): Promise<any> {
  const { docId, importRunId, registros } = body;
  if (!docId || !importRunId || !registros || typeof registros !== "object") {
    throw new functions.https.HttpsError("invalid-argument", "docId, importRunId e registros são obrigatórios");
  }
  const permitidos = ["hist_mensal", "hist_nf", "hist_caixa_diario", "hist_movimentacoes", "hist_despesas"];
  if (permitidos.indexOf(docId) < 0) {
    throw new functions.https.HttpsError("invalid-argument", "docId fora da lista permitida: " + docId);
  }
  const atual = await lerDoc(docId);
  let novos = 0, jaExistiam = 0;
  Object.keys(registros).forEach((chave) => {
    if (atual[chave]) { jaExistiam++; return; } // idempotente — nunca sobrescreve
    atual[chave] = registros[chave];
    novos++;
  });
  await gravarDoc(docId, atual);
  return { ok: true, docId, novos, jaExistiam, totalNoDoc: Object.keys(atual).length };
}

async function opRegistrarRun(body: any): Promise<any> {
  const { runRecord } = body;
  if (!runRecord || !runRecord.importRunId) {
    throw new functions.https.HttpsError("invalid-argument", "runRecord.importRunId é obrigatório");
  }
  const runsAtual = await lerDoc("hist_import_runs");
  if (!runsAtual.runs) runsAtual.runs = [];
  runsAtual.runs.push(runRecord);
  await gravarDoc("hist_import_runs", runsAtual);
  return { ok: true, importRunId: runRecord.importRunId };
}

async function opRollbackHistorico(body: any): Promise<any> {
  const { importRunId } = body;
  if (!importRunId) throw new functions.https.HttpsError("invalid-argument", "importRunId é obrigatório");
  const docs = ["hist_mensal", "hist_nf", "hist_caixa_diario", "hist_movimentacoes", "hist_despesas"];
  let totalRemovido = 0;
  const porDoc: Record<string, number> = {};
  for (const docId of docs) {
    const atual = await lerDoc(docId);
    let removidos = 0;
    Object.keys(atual).forEach((chave) => {
      if (atual[chave] && atual[chave].importRunId === importRunId) { delete atual[chave]; removidos++; }
    });
    if (removidos) await gravarDoc(docId, atual);
    porDoc[docId] = removidos;
    totalRemovido += removidos;
  }
  const runsAtual = await lerDoc("hist_import_runs");
  if (runsAtual.runs) {
    const run = runsAtual.runs.find((r: any) => r.importRunId === importRunId);
    if (run) run.status = "revertido";
    await gravarDoc("hist_import_runs", runsAtual);
  }
  return { ok: true, importRunId, totalRemovido, porDoc };
}

async function opStatus(): Promise<any> {
  const bancos = await lerDoc("erp_bank_config");
  const runs = await lerDoc("hist_import_runs");
  const hist: Record<string, number> = {};
  for (const docId of ["hist_mensal", "hist_nf", "hist_caixa_diario", "hist_movimentacoes", "hist_despesas"]) {
    const d = await lerDoc(docId);
    hist[docId] = Object.keys(d).length;
  }
  return {
    ok: true,
    contasVr: (bancos.vr || []).map((b: ContaBancaria) => ({ nome: b.nome, principal: b.principal })),
    hist,
    runs: (runs.runs || []).map((r: any) => ({ importRunId: r.importRunId, status: r.status, dataImportacao: r.dataImportacao })),
  };
}

export const adminOneTimeOps = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (!checkSecret(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

  const body = req.body || {};
  const op = body.op;
  try {
    let resultado: any;
    if (op === "seed_bancos") resultado = await opSeedBancos();
    else if (op === "importar_fonte") resultado = await opImportarFonte(body);
    else if (op === "registrar_run") resultado = await opRegistrarRun(body);
    else if (op === "rollback_historico") resultado = await opRollbackHistorico(body);
    else if (op === "status") resultado = await opStatus();
    else { res.status(400).json({ ok: false, error: "op desconhecida: " + op }); return; }
    res.json(resultado);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});
