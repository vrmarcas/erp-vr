/**
 * etapa9j_check.ts — script de verificação manual da Etapa 9J.
 *
 * Continuação de etapa9i_check.ts (não duplicado aqui — os 19 casos da
 * 9I continuam válidos e não foram alterados). Este arquivo cobre só o
 * que é NOVO na 9J:
 *   2. Campos cadastrais do rascunho Vitre (valeria_vitre.ts, editado
 *      nesta etapa) — nunca inventa dado, nunca sobrescreve confirmado.
 *   5F. Concorrência real na CRIAÇÃO do mesmo rascunho (mesmo requestId).
 *   5H. onCall de revisão rejeita chamada sem autenticação e sem a role
 *       "comercial" (a 9I só tinha testado o Bearer dos onRequest).
 *
 * Mesma infraestrutura da 9I: Firestore+Auth Emulator, projeto demo-*,
 * sem Jest (decisão da 9J, item 3: "sem instalar Jest ou novas
 * dependências"), node após tsc.
 */
import * as admin from "firebase-admin";

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-erp-vrmarcas-etapa9j";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });

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

async function fsWrite(key: string, data: unknown): Promise<void> {
  await admin.firestore().collection("erp_vr").doc(key).set({ data: JSON.stringify(data), ts: Date.now() });
}

function telSintetico(): string {
  return `5511${Math.floor(900000000 + Math.random() * 99999999)}`;
}

function mockReqRes(opts: { method: string; headers?: Record<string, string>; body?: unknown; query?: Record<string, string> }) {
  const jsonCalls: unknown[] = [];
  let statusCode = 200;
  const res: any = {
    set: () => res,
    status: (c: number) => { statusCode = c; return res; },
    json: (payload: unknown) => { jsonCalls.push(payload); return res; },
    send: (payload: unknown) => { jsonCalls.push(payload); return res; },
  };
  const req: any = { method: opts.method, headers: opts.headers || {}, body: opts.body || {}, query: opts.query || {} };
  return { req, res, getStatus: () => statusCode, getJson: () => jsonCalls[jsonCalls.length - 1] };
}

async function main() {
  console.log("=== Etapa 9J — verificação manual (continuação da 9I) ===\n");

  const SECRET = "etapa9j_secret_sintetico_local";
  await fsWrite("valeria_config", { secret: SECRET });

  const { valeriaVitreCriarRascunho, valeriaVitreAtualizarRascunho } = await import("../valeria_vitre");
  const { vendedorAssumirRevisaoPreOrcamento } = await import("../valeria_pre_orcamento_revisao");

  // doc id DEVE ser igual ao sku — valeriaVitreCriarRascunho busca por
  // db.collection('vitre_produtos').doc(sku), nunca por um campo separado.
  async function seedProduto(sku: string) {
    await admin.firestore().collection("vitre_produtos").doc(sku).set({
      sku, nome: "Produto " + sku, status: "ativo", ativoValeria: true,
      precoVenda: 150, custo: 60, prazoDias: 4, categoria: "placas", descricaoCurta: "x",
      fotos: ["a"], usos: ["uso"], palavrasChave: ["p"], disponibilidade: "pronta_entrega", beneficios: ["b"], embalagem: "caixa", pesoKg: 1,
    });
  }

  console.log("2. Campos cadastrais do rascunho Vitre");

  await caso("2a. CriarRascunho grava clienteTel/Email/Cidade/Documento/Tipo quando enviados", async () => {
    const atd = `atd_9j_cad_${Date.now()}`;
    const sku = `SKU9J_${Date.now()}`;
    await seedProduto(sku);
    const tel = telSintetico();
    const { req, res, getJson } = mockReqRes({
      method: "POST", headers: { authorization: `Bearer ${SECRET}` },
      body: {
        conversationId: atd, organizationId: "org_teste", clienteNome: "Cliente 9J", requestId: `req_${atd}`,
        itens: [{ sku, qtd: 1 }], clienteTel: tel, clienteEmail: "cliente9j@teste.local", clienteCidade: "Ribeirão Preto",
        clienteDocumento: "12345678900", clienteTipo: "pf",
      },
    });
    await (valeriaVitreCriarRascunho as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res);
    const id = (getJson() as any).id;
    assert(id, "deveria retornar um id");
    const doc = await admin.firestore().collection("vitre_orcamentos").doc(id).get();
    assertEquals(doc.data()?.clienteTel, tel, "clienteTel gravado");
    assertEquals(doc.data()?.clienteEmail, "cliente9j@teste.local", "clienteEmail gravado");
    assertEquals(doc.data()?.clienteCidade, "Ribeirão Preto", "clienteCidade gravado");
    assertEquals(doc.data()?.clienteDocumento, "12345678900", "clienteDocumento gravado");
    assertEquals(doc.data()?.clienteTipo, "pf", "clienteTipo gravado");
  });

  await caso("2b. CriarRascunho nunca inventa campos cadastrais não enviados (ficam null)", async () => {
    const atd = `atd_9j_cad2_${Date.now()}`;
    const sku = `SKU9J2_${Date.now()}`;
    await seedProduto(sku);
    const { req, res, getJson } = mockReqRes({
      method: "POST", headers: { authorization: `Bearer ${SECRET}` },
      body: { conversationId: atd, organizationId: "org_teste", clienteNome: "Cliente Sem Cadastro", requestId: `req_${atd}`, itens: [{ sku, qtd: 1 }] },
    });
    await (valeriaVitreCriarRascunho as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res);
    const id = (getJson() as any).id;
    const doc = await admin.firestore().collection("vitre_orcamentos").doc(id).get();
    assertEquals(doc.data()?.clienteTel, null, "clienteTel deveria ficar null, nunca inventado");
    assertEquals(doc.data()?.clienteEmail, null, "clienteEmail deveria ficar null");
  });

  await caso("2c. AtualizarRascunho NUNCA sobrescreve campo cadastral já preenchido", async () => {
    const atd = `atd_9j_cad3_${Date.now()}`;
    const sku = `SKU9J3_${Date.now()}`;
    await seedProduto(sku);
    const telOriginal = telSintetico();
    const { req: req1, res: res1, getJson: getJson1 } = mockReqRes({
      method: "POST", headers: { authorization: `Bearer ${SECRET}` },
      body: { conversationId: atd, organizationId: "org_teste", clienteNome: "Cliente 9J-3", requestId: `req_${atd}_1`, itens: [{ sku, qtd: 1 }], clienteTel: telOriginal },
    });
    await (valeriaVitreCriarRascunho as unknown as (req: unknown, res: unknown) => Promise<void>)(req1, res1);
    const id = (getJson1() as any).id;

    const telNovo = telSintetico();
    const { req: req2, res: res2 } = mockReqRes({
      method: "POST", headers: { authorization: `Bearer ${SECRET}` },
      body: { conversationId: atd, organizationId: "org_teste", orcamentoId: id, requestId: `req_${atd}_2`, itens: [{ sku, qtd: 2 }], clienteTel: telNovo, clienteEmail: "novo@teste.local" },
    });
    await (valeriaVitreAtualizarRascunho as unknown as (req: unknown, res: unknown) => Promise<void>)(req2, res2);

    const doc = await admin.firestore().collection("vitre_orcamentos").doc(id).get();
    assertEquals(doc.data()?.clienteTel, telOriginal, "clienteTel original NUNCA deve ser sobrescrito");
    assertEquals(doc.data()?.clienteEmail, "novo@teste.local", "clienteEmail (vazio antes) deveria ser preenchido agora");
  });

  console.log("\n5F. Concorrência — duas requisições simultâneas, MESMO requestId, criando o mesmo rascunho");

  await caso("5F. Reprocessar o mesmo requestId concorrentemente nunca cria dois rascunhos", async () => {
    const atd = `atd_9j_f_${Date.now()}`;
    const sku = `SKU9JF_${Date.now()}`;
    await seedProduto(sku);
    const requestId = `req_${atd}`;
    const bodyBase = { conversationId: atd, organizationId: "org_teste", clienteNome: "Cliente 5F", requestId, itens: [{ sku, qtd: 1 }] };
    const [r1, r2] = await Promise.all([
      (async () => { const { req, res, getJson } = mockReqRes({ method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: bodyBase }); await (valeriaVitreCriarRascunho as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res); return getJson() as any; })(),
      (async () => { const { req, res, getJson } = mockReqRes({ method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: bodyBase }); await (valeriaVitreCriarRascunho as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res); return getJson() as any; })(),
    ]);
    assert(r1.ok && r2.ok, "ambas as respostas deveriam ser ok");
    const snap = await admin.firestore().collection("vitre_orcamentos").where("conversationId", "==", atd).get();
    assertEquals(snap.docs.length, 1, "deveria existir exatamente 1 rascunho, nunca 2, mesmo com requisições concorrentes");
  });

  console.log("\n5H. onCall de revisão rejeita chamadas sem autenticação / sem permissão");

  // onCall exportado pelo SDK (functions.https.onCall) não é diretamente
  // invocável como (data,context) — internamente trata os 2 primeiros
  // argumentos como (req,res) do Express. O próprio SDK expõe `.run(data,
  // context)` para teste direto sem precisar de firebase-functions-test
  // (decisão da 9J: nenhuma dependência nova).
  const assumirRun = (vendedorAssumirRevisaoPreOrcamento as unknown as { run: (data: unknown, context: unknown) => Promise<any> }).run;

  await caso("5H-1. Sem autenticação (context.auth ausente) — rejeitado", async () => {
    let rejeitou = false;
    try {
      await assumirRun(
        { atendimentoId: `atd_9j_h1_${Date.now()}` }, {}
      );
    } catch (e) {
      rejeitou = (e as any).code === "unauthenticated" || /unauthenticated/i.test((e as Error).message);
    }
    assert(rejeitou, "chamada sem auth deveria ser rejeitada (unauthenticated)");
  });

  await caso("5H-2. Autenticado mas SEM a role comercial (ex.: producao) — rejeitado", async () => {
    const uid = `uid_9j_prod_${Date.now()}`;
    await admin.firestore().collection("erp_vr_usuarios").doc(uid).set({ nome: "Produção Teste", funcao: "producao", ativo: true, email: "prod@teste.local" });
    let rejeitou = false;
    try {
      await assumirRun(
        { atendimentoId: `atd_9j_h2_${Date.now()}` },
        { auth: { uid, token: { role: "producao" } } }
      );
    } catch (e) {
      rejeitou = (e as any).code === "permission-denied" || /permission-denied/i.test((e as Error).message);
    }
    assert(rejeitou, "role producao deveria ser rejeitada (permission-denied)");
  });

  await caso("5H-3. Autenticado COM a role comercial — aceito", async () => {
    const uid = `uid_9j_com_${Date.now()}`;
    await admin.firestore().collection("erp_vr_usuarios").doc(uid).set({ nome: "Comercial Teste", funcao: "comercial", ativo: true, email: "com@teste.local" });
    const atd = `atd_9j_h3_${Date.now()}`;
    const resultado = await assumirRun(
      { atendimentoId: atd },
      { auth: { uid, token: { role: "comercial" } } }
    );
    assertEquals(resultado.ok, true, "comercial deveria conseguir assumir a revisão");
  });

  console.log(`\n=== Resultado: ${passed} passou, ${failed} falhou ===`);
  if (failed > 0) {
    console.log("Falhas:", falhas.join(", "));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error("ERRO FATAL NO SCRIPT:", e); process.exit(1); });
