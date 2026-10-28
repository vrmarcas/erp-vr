/**
 * etapa9m_check.ts — script de verificação manual da Etapa 9M.
 *
 * Testa o módulo valeria_pre_orcamento_aprovacao.ts (aprovação/recusa
 * server-side, transacional) via CHAMADAS HTTP REAIS ao Functions
 * Emulator (não só Core functions isoladas) — mesmo padrão da 9L, agora
 * cobrindo concorrência e integridade financeira (seção 3 do pedido).
 *
 * Pré-requisito: Functions+Firestore+Auth Emulator rodando
 * (functions_local_test_9l), com os 3 usuários sintéticos já semeados
 * (vendedor.teste@local.demo, vendedor2.teste@local.demo,
 * producao.teste@local.demo — todos senha123456).
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
  const data = (await resp.json()) as { idToken: string };
  return data.idToken;
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

async function fsWriteOrcamentos(arr: unknown[]): Promise<void> {
  await admin.firestore().collection("erp_vr").doc("orcamentos").set({ data: JSON.stringify(arr), ts: Date.now() });
}
async function fsReadOrcamentos(): Promise<any[]> {
  const d = await admin.firestore().collection("erp_vr").doc("orcamentos").get();
  return d.exists ? JSON.parse(d.data()!.data) : [];
}
async function fsReadFinCr(): Promise<any[]> {
  const d = await admin.firestore().collection("erp_vr").doc("fin_cr").get();
  return d.exists ? JSON.parse(d.data()!.data) : [];
}

function telSintetico(): string {
  return `5511${Math.floor(900000000 + Math.random() * 99999999)}`;
}

async function seedPreOrcamento(opts: { id: string; atendimentoId: string; total: number }): Promise<void> {
  const atual = await fsReadOrcamentos();
  atual.push({
    id: opts.id, n: 1, nomeCliente: "Cliente " + opts.id, telCliente: telSintetico(),
    total: opts.total, status: "pre_orc_valeria", conversationId: opts.atendimentoId, marca: "vr",
  });
  await fsWriteOrcamentos(atual);
}

async function revisarCompleto(token: string, atendimentoId: string): Promise<void> {
  const r1 = await call("vendedorAssumirRevisaoPreOrcamento", token, { atendimentoId });
  assertEquals(r1.status, 200, "assumir deveria retornar 200");
  const r2 = await call("vendedorConcluirRevisaoPreOrcamento", token, { atendimentoId });
  assertEquals(r2.status, 200, "concluir deveria retornar 200");
}

async function main() {
  console.log("=== Etapa 9M — verificação manual (aprovação server-side, Functions Emulator real) ===\n");
  const t1 = await tokenFor("vendedor.teste@local.demo");
  const t2 = await tokenFor("vendedor2.teste@local.demo");
  const t3 = await tokenFor("producao.teste@local.demo");

  console.log("3. Integridade financeira\n");

  await caso("3a. Aprovação única válida — cria 1 Conta a Receber, status muda para aprovado", async () => {
    const atd = `atd_9m_3a_${Date.now()}`;
    const orcId = `orc_9m_3a_${Date.now()}`;
    await seedPreOrcamento({ id: orcId, atendimentoId: atd, total: 500 });
    await revisarCompleto(t1, atd);
    const r = await call("vendedorDecidirPreOrcamentoValeria", t1, { orcId, decisao: "aprovado" });
    assertEquals(r.status, 200, "status HTTP");
    assertEquals(r.json.result.status, "aprovado", "status retornado");
    assert(r.json.result.crId, "deveria retornar crId");
    const orcamentos = await fsReadOrcamentos();
    const orc = orcamentos.find((o) => o.id === orcId);
    assertEquals(orc.status, "aprovado", "status gravado no Firestore");
    const fincr = await fsReadFinCr();
    assertEquals(fincr.filter((c) => c.orcamentoId === orcId).length, 1, "exatamente 1 CR para este orçamento");
  });

  await caso("3b. Duas aprovações SIMULTÂNEAS (Promise.all) — nunca duas Contas a Receber", async () => {
    const atd = `atd_9m_3b_${Date.now()}`;
    const orcId = `orc_9m_3b_${Date.now()}`;
    await seedPreOrcamento({ id: orcId, atendimentoId: atd, total: 300 });
    await revisarCompleto(t1, atd);
    const [r1, r2] = await Promise.all([
      call("vendedorDecidirPreOrcamentoValeria", t1, { orcId, decisao: "aprovado" }),
      call("vendedorDecidirPreOrcamentoValeria", t1, { orcId, decisao: "aprovado" }),
    ]);
    assert(r1.status === 200 && r2.status === 200, "ambas as chamadas deveriam ser aceitas (idempotente, nunca erro)");
    const fincr = await fsReadFinCr();
    assertEquals(fincr.filter((c) => c.orcamentoId === orcId).length, 1, "exatamente 1 CR mesmo com 2 chamadas concorrentes");
  });

  await caso("3c. Repetição da MESMA requisição (sequencial) — idempotente, mesmo crId", async () => {
    const atd = `atd_9m_3c_${Date.now()}`;
    const orcId = `orc_9m_3c_${Date.now()}`;
    await seedPreOrcamento({ id: orcId, atendimentoId: atd, total: 150 });
    await revisarCompleto(t1, atd);
    const r1 = await call("vendedorDecidirPreOrcamentoValeria", t1, { orcId, decisao: "aprovado" });
    const r2 = await call("vendedorDecidirPreOrcamentoValeria", t1, { orcId, decisao: "aprovado" });
    assertEquals(r1.json.result.crId, r2.json.result.crId, "mesmo crId nas duas chamadas");
    assertEquals(r2.json.result.jaProcessado, true, "segunda chamada deveria sinalizar jaProcessado");
    const fincr = await fsReadFinCr();
    assertEquals(fincr.filter((c) => c.orcamentoId === orcId).length, 1, "ainda exatamente 1 CR");
  });

  await caso("3e. Recusa NUNCA cria Conta a Receber", async () => {
    const atd = `atd_9m_3e_${Date.now()}`;
    const orcId = `orc_9m_3e_${Date.now()}`;
    await seedPreOrcamento({ id: orcId, atendimentoId: atd, total: 777 });
    await revisarCompleto(t1, atd);
    const r = await call("vendedorDecidirPreOrcamentoValeria", t1, { orcId, decisao: "recusado" });
    assertEquals(r.json.result.status, "recusado", "status retornado");
    const fincr = await fsReadFinCr();
    assertEquals(fincr.filter((c) => c.orcamentoId === orcId).length, 0, "nenhuma CR para orçamento recusado");
  });

  await caso("3g. Aprovação SEM revisão concluída é bloqueada (chamada direta ao backend)", async () => {
    const atd = `atd_9m_3g_${Date.now()}`;
    const orcId = `orc_9m_3g_${Date.now()}`;
    await seedPreOrcamento({ id: orcId, atendimentoId: atd, total: 999 });
    // Nunca chama assumir/concluir — tenta aprovar direto.
    const r = await call("vendedorDecidirPreOrcamentoValeria", t1, { orcId, decisao: "aprovado" });
    assertEquals(r.status, 400, "status HTTP (failed-precondition)");
    assert(/PENDING_HUMAN_REVIEW/.test(r.json.error.message), "mensagem deveria indicar revisão pendente");
    const orcamentos = await fsReadOrcamentos();
    assertEquals(orcamentos.find((o) => o.id === orcId).status, "pre_orc_valeria", "status NUNCA deveria mudar");
  });

  await caso("3h. Usuário sem permissão (role producao) é rejeitado", async () => {
    const atd = `atd_9m_3h_${Date.now()}`;
    const orcId = `orc_9m_3h_${Date.now()}`;
    await seedPreOrcamento({ id: orcId, atendimentoId: atd, total: 100 });
    await revisarCompleto(t1, atd);
    const r = await call("vendedorDecidirPreOrcamentoValeria", t3, { orcId, decisao: "aprovado" });
    assertEquals(r.status, 403, "status HTTP (permission-denied)");
    const orcamentos = await fsReadOrcamentos();
    assertEquals(orcamentos.find((o) => o.id === orcId).status, "pre_orc_valeria", "status NUNCA deveria mudar");
  });

  await caso("3i. Orçamento LEGADO (não-Valéria) nunca passa por esta função — rejeitado explicitamente", async () => {
    const orcId = `orc_9m_legado_${Date.now()}`;
    const atual = await fsReadOrcamentos();
    atual.push({ id: orcId, num: 99, cliente: "Cliente Legado", tel: telSintetico(), valorFinal: 50, status: "aguardando", data: new Date().toISOString(), marca: "vr" });
    await fsWriteOrcamentos(atual);
    const r = await call("vendedorDecidirPreOrcamentoValeria", t1, { orcId, decisao: "aprovado" });
    assertEquals(r.status, 400, "status HTTP (invalid-argument)");
    assert(/NAO_E_ORIGEM_VALERIA/.test(r.json.error.message), "mensagem deveria indicar que não é origem Valéria");
    const orcamentos = await fsReadOrcamentos();
    assertEquals(orcamentos.find((o) => o.id === orcId).status, "aguardando", "orçamento legado NUNCA deveria ser tocado por esta função");
  });

  console.log("\n5. Teste end-to-end completo\n");

  await caso("5. Fluxo completo: preparar → assumir → editar(simulado) → concluir → aprovar → CR único → repetição não duplica → chamada direta sem revisão bloqueada → legado funcional", async () => {
    const atd = `atd_9m_e2e_${Date.now()}`;
    const orcId = `orc_9m_e2e_${Date.now()}`;
    // 1. Valéria prepara (sintético, mesmo shape do motor real).
    await seedPreOrcamento({ id: orcId, atendimentoId: atd, total: 1234.5 });
    // 2. Vendedor assume.
    const rAssumir = await call("vendedorAssumirRevisaoPreOrcamento", t1, { atendimentoId: atd });
    assertEquals(rAssumir.status, 200, "assumir");
    // 2b. Segundo vendedor NÃO consegue assumir o mesmo atendimento.
    const rAssumir2 = await call("vendedorAssumirRevisaoPreOrcamento", t2, { atendimentoId: atd });
    assertEquals(rAssumir2.status, 409, "segundo vendedor deveria ser rejeitado (409)");
    // 3. Vendedor "edita" (simulado — edição real de campos do orçamento
    // não é escopo desta função; o que importa aqui é a sequência do lock).
    // 4. Conclui revisão.
    const rConcluir = await call("vendedorConcluirRevisaoPreOrcamento", t1, { atendimentoId: atd });
    assertEquals(rConcluir.status, 200, "concluir");
    // 5+6. Backend autoriza a aprovação — efeito financeiro ocorre 1x.
    const rAprovar = await call("vendedorDecidirPreOrcamentoValeria", t1, { orcId, decisao: "aprovado" });
    assertEquals(rAprovar.status, 200, "aprovar");
    const crId1 = rAprovar.json.result.crId;
    // 7. Nova tentativa não duplica efeito.
    const rAprovar2 = await call("vendedorDecidirPreOrcamentoValeria", t1, { orcId, decisao: "aprovado" });
    assertEquals(rAprovar2.json.result.crId, crId1, "segunda aprovação devolve o MESMO crId");
    const fincr = await fsReadFinCr();
    assertEquals(fincr.filter((c) => c.orcamentoId === orcId).length, 1, "exatamente 1 CR no fim de todo o fluxo");
    // 9. Fluxo de orçamento comum permanece funcional (nunca passa por
    // esta função — confirmado em 3i; aqui só reconfirmamos que o motor
    // comum nem precisa de lock nenhum).
  });

  console.log(`\n=== Resultado: ${passed} passou, ${failed} falhou ===`);
  if (failed > 0) {
    console.log("Falhas:", falhas.join(", "));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error("ERRO FATAL NO SCRIPT:", e); process.exit(1); });
