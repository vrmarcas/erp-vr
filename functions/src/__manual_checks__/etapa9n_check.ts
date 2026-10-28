/**
 * etapa9n_check.ts — script de verificação manual da Etapa 9N.
 *
 * Testa vendedorExcluirOrcamento (erp_orcamento_exclusao_segura.ts) via
 * chamadas HTTP reais ao Functions Emulator — mesmo padrão das etapas
 * anteriores.
 */
import * as admin from "firebase-admin";

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-erp-homolog";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });

const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key";
const FN_BASE = "http://127.0.0.1:5001/demo-erp-homolog/us-central1";

let passed = 0;
let failed = 0;
const falhas: string[] = [];

async function caso(nome: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    failed++;
    falhas.push(nome);
    console.log(`  ✕ ${nome}`);
    console.log(`     ${(e as Error).message}`);
  }
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`asserção falhou: ${msg}`);
}
function assertEquals<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`${msg} — esperado ${JSON.stringify(b)}, recebido ${JSON.stringify(a)}`);
}

async function tokenFor(email: string): Promise<string> {
  const resp = await fetch(AUTH_BASE, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "senha123456", returnSecureToken: true }),
  });
  return ((await resp.json()) as { idToken: string }).idToken;
}
async function call(fn: string, token: string | null, data: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${FN_BASE}/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const text = await r.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
async function fsReadOrcamentos(): Promise<any[]> {
  const d = await admin.firestore().collection("erp_vr").doc("orcamentos").get();
  return d.exists ? JSON.parse(d.data()!.data) : [];
}
async function fsWriteOrcamentos(arr: unknown[]): Promise<void> {
  await admin.firestore().collection("erp_vr").doc("orcamentos").set({ data: JSON.stringify(arr), ts: Date.now() });
}

async function main() {
  console.log("=== Etapa 9N — verificação manual (vendedorExcluirOrcamento, Functions Emulator real) ===\n");
  const t1 = await tokenFor("vendedor.teste@local.demo");
  const t3 = await tokenFor("producao.teste@local.demo");

  await caso("1. Exclui orçamento comum sem OS/pagamento — sucesso", async () => {
    const id = `orc_9n_del1_${Date.now()}`;
    const atual = await fsReadOrcamentos();
    atual.push({ id, num: 1, cliente: "Cliente 9N", valorFinal: 50, status: "aguardando" });
    await fsWriteOrcamentos(atual);
    const r = await call("vendedorExcluirOrcamento", t1, { orcId: id });
    assertEquals(r.status, 200, "status HTTP");
    const depois = await fsReadOrcamentos();
    assert(!depois.find((o) => o.id === id), "orçamento deveria ter sido removido");
  });

  await caso("2. Exclusão BLOQUEADA quando já existe OS gerada (osRef)", async () => {
    const id = `orc_9n_del2_${Date.now()}`;
    const atual = await fsReadOrcamentos();
    atual.push({ id, num: 2, cliente: "Cliente 9N OS", valorFinal: 80, status: "aprovado", osRef: "OS-9N-123" });
    await fsWriteOrcamentos(atual);
    const r = await call("vendedorExcluirOrcamento", t1, { orcId: id });
    assertEquals(r.status, 400, "status HTTP (failed-precondition)");
    assert(/OS_JA_GERADA/.test(r.json.error.message), "mensagem deveria indicar OS já gerada");
    const depois = await fsReadOrcamentos();
    assert(depois.find((o) => o.id === id), "orçamento NUNCA deveria ter sido removido");
  });

  await caso("3. Exclusão BLOQUEADA quando já existe Conta a Receber (crId)", async () => {
    const id = `orc_9n_del3_${Date.now()}`;
    const atual = await fsReadOrcamentos();
    atual.push({ id, num: 3, cliente: "Cliente 9N CR", valorFinal: 90, status: "aprovado", crId: "cr9n123" });
    await fsWriteOrcamentos(atual);
    const r = await call("vendedorExcluirOrcamento", t1, { orcId: id });
    assertEquals(r.status, 400, "status HTTP (failed-precondition)");
    assert(/PAGAMENTO_JA_REGISTRADO/.test(r.json.error.message), "mensagem deveria indicar pagamento já registrado");
    const depois = await fsReadOrcamentos();
    assert(depois.find((o) => o.id === id), "orçamento NUNCA deveria ter sido removido");
  });

  await caso("4. Repetição (já excluído) é idempotente — sucesso, nunca erro", async () => {
    const id = `orc_9n_del4_${Date.now()}`;
    const atual = await fsReadOrcamentos();
    atual.push({ id, num: 4, cliente: "Cliente 9N Dup", valorFinal: 10, status: "aguardando" });
    await fsWriteOrcamentos(atual);
    const r1 = await call("vendedorExcluirOrcamento", t1, { orcId: id });
    const r2 = await call("vendedorExcluirOrcamento", t1, { orcId: id });
    assertEquals(r1.status, 200, "primeira chamada 200");
    assertEquals(r2.status, 200, "segunda chamada (já excluído) também 200, nunca erro");
    assertEquals(r2.json.result.jaProcessado, true, "segunda chamada sinaliza jaProcessado");
  });

  await caso("5. Usuário sem permissão (role produção) é rejeitado", async () => {
    const id = `orc_9n_del5_${Date.now()}`;
    const atual = await fsReadOrcamentos();
    atual.push({ id, num: 5, cliente: "Cliente 9N Perm", valorFinal: 20, status: "aguardando" });
    await fsWriteOrcamentos(atual);
    const r = await call("vendedorExcluirOrcamento", t3, { orcId: id });
    assertEquals(r.status, 403, "status HTTP (permission-denied)");
    const depois = await fsReadOrcamentos();
    assert(depois.find((o) => o.id === id), "orçamento NUNCA deveria ter sido removido");
  });

  await caso("6. Sem autenticação é rejeitado", async () => {
    const r = await call("vendedorExcluirOrcamento", null, { orcId: "qualquer" });
    assertEquals(r.status, 401, "status HTTP (unauthenticated)");
  });

  console.log(`\n=== Resultado: ${passed} passou, ${failed} falhou ===`);
  if (failed > 0) {
    console.log("Falhas:", falhas.join(", "));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error("ERRO FATAL NO SCRIPT:", e); process.exit(1); });
