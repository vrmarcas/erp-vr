/**
 * etapa9i_check.ts — script de verificação manual da Etapa 9I.
 *
 * NÃO é um teste automatizado (go-live/functions não tem Jest — decisão
 * desta etapa: nenhuma dependência nova). Roda com `node` (após `tsc`)
 * contra o Firestore + Auth Emulator, usando um projeto demo (NUNCA
 * `erp-vrmarcas` real — ver `--project demo-...` no comando de start).
 *
 * Exercita, com dados 100% sintéticos:
 *   5. Identificação de cliente (único, inexistente, ambíguo, 9º dígito, concorrência)
 *   6. Lock de revisão (assumir, concluir, bloqueio pós-revisão, pendência)
 *   7. Cenários A-D ponta a ponta (reutilizando o motor Vitre REAL de
 *      valeria_vitre.ts; o motor personalizado real vive em
 *      functions-valeria/quote_core.ts — fora de escopo desta etapa — por
 *      isso o item "personalizado" dos cenários usa um registro SINTÉTICO
 *      que imita o shape já documentado em index.html:30973-30987, nunca
 *      um novo motor de cálculo).
 *
 * Este arquivo é compilado normalmente pelo `tsc` do pacote (fica dentro
 * de src/), mas não é um `export` usado por nenhuma Cloud Function —
 * zero risco de deploy.
 */
import * as admin from "firebase-admin";

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-erp-vrmarcas-etapa9i";
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
  console.log("=== Etapa 9I — verificação manual (Firestore+Auth Emulator, dados sintéticos) ===\n");

  // Secret Bearer para checkAuth (valeria.ts) — mesmo contrato real.
  const SECRET = "etapa9i_secret_sintetico_local";
  await fsWrite("valeria_config", { secret: SECRET });

  const {
    consultarClientePorTelefoneCore,
    identificarOuPrepararClienteCore,
    completarClienteProvisorioCore,
    valeriaConsultarClientePorTelefone,
    valeriaPrepararCadastroProvisorio,
  } = await import("../valeria_pre_orcamento_identidade");
  const {
    assertValeriaPodeEscrever,
    assumirRevisaoCore,
    concluirRevisaoCore,
    RevisaoConcluidaError,
    RevisaoJaAssumidaError,
  } = await import("../valeria_pre_orcamento_revisao");
  const { consultarEstadoRevisaoCore, valeriaConsultarEstadoRevisao } = await import("../valeria_pre_orcamento_estado");
  const { valeriaVitreCriarRascunho } = await import("../valeria_vitre");

  console.log("5. Identificação e cadastro do cliente");

  await caso("5a. Cliente já existente — identificação única (lido de erp_vr/clientes real)", async () => {
    const tel = telSintetico();
    await fsWrite("clientes", [{ id: "c_sint_1", nome: "Cliente Sintético Único", tel, email: "", cidade: "Ribeirão Preto" }]);
    const r = await consultarClientePorTelefoneCore(tel);
    assertEquals(r.status, "single_match", "status");
  });

  await caso("5b. Cliente inexistente — cria registro PROVISÓRIO, nunca toca erp_vr/clientes", async () => {
    const tel = telSintetico();
    const atd = `atd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const r = await identificarOuPrepararClienteCore(tel, atd);
    assertEquals(r.status, "cliente_provisorio", "status");
    const clientesDepois = (await admin.firestore().collection("erp_vr").doc("clientes").get()).data();
    assert(JSON.stringify(clientesDepois?.data || "").indexOf(tel) === -1, "telefone provisório nunca deve aparecer em erp_vr/clientes");
  });

  await caso("5c. Telefone AMBÍGUO (2 clientes reais com mesmo telefone) — nunca escolhe o primeiro", async () => {
    const tel = telSintetico();
    await fsWrite("clientes", [
      { id: "c_amb_1", nome: "Cliente Ambíguo A", tel, email: "", cidade: "X" },
      { id: "c_amb_2", nome: "Cliente Ambíguo B", tel, email: "", cidade: "Y" },
    ]);
    const r = await consultarClientePorTelefoneCore(tel);
    assertEquals(r.status, "ambiguous", "status");
    if (r.status === "ambiguous") assertEquals(r.candidateClienteIds.length, 2, "quantidade de candidatos");
  });

  await caso("5d. Variação do 9º dígito — resolve para o MESMO registro provisório (chave canônica)", async () => {
    const base = `9876${Math.floor(1000 + Math.random() * 8999)}`; // 8 dígitos
    const com9 = `55119${base}`; // 55 + DDD(11) + 9 + 8 dígitos = 13 dígitos
    const sem9 = `5511${base}`; // 55 + DDD(11) + 8 dígitos = 12 dígitos
    const atd1 = `atd_${Date.now()}_a`;
    const atd2 = `atd_${Date.now()}_b`;
    const r1 = await identificarOuPrepararClienteCore(com9, atd1);
    const r2 = await identificarOuPrepararClienteCore(sem9, atd2);
    assertEquals(r1.status, "cliente_provisorio", "status r1");
    assertEquals(r2.status, "cliente_provisorio", "status r2");
    if (r1.status === "cliente_provisorio" && r2.status === "cliente_provisorio") {
      assertEquals(r1.clienteProvisorioId, r2.clienteProvisorioId, "mesmo registro provisório");
    }
  });

  await caso("5e. Duas conversas CONCORRENTES do mesmo número — convergem para o MESMO registro, nunca duplicam", async () => {
    const tel = telSintetico();
    const [r1, r2] = await Promise.all([
      identificarOuPrepararClienteCore(tel, `atd_conc_${Date.now()}_1`),
      identificarOuPrepararClienteCore(tel, `atd_conc_${Date.now()}_2`),
    ]);
    assertEquals(r1.status, "cliente_provisorio", "status r1");
    assertEquals(r2.status, "cliente_provisorio", "status r2");
    if (r1.status === "cliente_provisorio" && r2.status === "cliente_provisorio") {
      assertEquals(r1.clienteProvisorioId, r2.clienteProvisorioId, "convergência para o mesmo id");
    }
  });

  await caso("5f. Cadastro provisório incompleto — completarClienteProvisorioCore nunca sobrescreve nome já preenchido", async () => {
    const tel = telSintetico();
    const r = await identificarOuPrepararClienteCore(tel, `atd_${Date.now()}`);
    assert(r.status === "cliente_provisorio", "esperava provisório");
    if (r.status !== "cliente_provisorio") return;
    await completarClienteProvisorioCore(r.clienteProvisorioId, { nome: "Primeiro Nome Informado" });
    await completarClienteProvisorioCore(r.clienteProvisorioId, { nome: "Segundo Nome (nunca deve sobrescrever)" });
    const doc = await admin.firestore().collection("valeria_pre_orcamento_pre_cadastros_provisorios").doc(r.clienteProvisorioId).get();
    assertEquals(doc.data()?.nome, "Primeiro Nome Informado", "nome não deve ser sobrescrito");
  });

  console.log("\n6. Lock de revisão (server-side)");

  await caso("6a. Valéria pode atualizar um atendimento ainda não assumido (versão incrementa)", async () => {
    const atd = `atd_lock_${Date.now()}`;
    const v1 = await assertValeriaPodeEscrever(atd);
    const v2 = await assertValeriaPodeEscrever(atd);
    assert(v2 > v1, "versão deve incrementar a cada escrita");
  });

  await caso("6b. Vendedor assume; segundo vendedor NUNCA pode assumir o mesmo atendimento", async () => {
    const atd = `atd_lock_${Date.now()}_b`;
    await assumirRevisaoCore(atd, "uid_vendedor_1");
    let lancou = false;
    try { await assumirRevisaoCore(atd, "uid_vendedor_2"); } catch (e) { lancou = e instanceof RevisaoJaAssumidaError; }
    assert(lancou, "segundo vendedor deveria ser bloqueado");
  });

  await caso("6c. Depois de CONCLUIR a revisão, a Valéria é BLOQUEADA (RevisaoConcluidaError)", async () => {
    const atd = `atd_lock_${Date.now()}_c`;
    await assumirRevisaoCore(atd, "uid_vendedor_1");
    await concluirRevisaoCore(atd, "uid_vendedor_1");
    let lancou = false;
    try { await assertValeriaPodeEscrever(atd); } catch (e) { lancou = e instanceof RevisaoConcluidaError; }
    assert(lancou, "Valéria deveria ser bloqueada após conclusão humana");
  });

  await caso("6d. Mudança do cliente DEPOIS da revisão gera pendência (nunca silenciosa)", async () => {
    const atd = `atd_lock_${Date.now()}_d`;
    await assumirRevisaoCore(atd, "uid_vendedor_1");
    await concluirRevisaoCore(atd, "uid_vendedor_1");
    try { await assertValeriaPodeEscrever(atd); } catch { /* esperado */ }
    const doc = await admin.firestore().collection("valeria_pre_orcamentos_revisao").doc(atd).get();
    assertEquals(doc.data()?.pendenciaPosRevisao, true, "pendenciaPosRevisao deveria estar true");
  });

  console.log("\n7. Cenários ponta a ponta (dados sintéticos)");

  await caso("7A. Produto pronto — cliente identificado + rascunho Vitre REAL (valeria_vitre.ts) criado", async () => {
    const tel = telSintetico();
    const atd = `atd_cenA_${Date.now()}`;
    const identidade = await identificarOuPrepararClienteCore(tel, atd);
    assert(identidade.status === "cliente_provisorio", "cliente novo esperado");

    await admin.firestore().collection("vitre_produtos").doc("SINT-CENA").set({
      sku: "SINT-CENA", nome: "Produto Cenário A", status: "ativo", ativoValeria: true,
      precoVenda: 199.9, custo: 90, prazoDias: 5, categoria: "placas", descricaoCurta: "x",
      fotos: ["a"], usos: ["uso"], palavrasChave: ["p"], disponibilidade: "pronta_entrega", beneficios: ["b"], embalagem: "caixa", pesoKg: 1,
    });
    const { req, res, getStatus, getJson } = mockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
      body: { conversationId: atd, organizationId: "org_sintetico", clienteNome: "Cliente Cenário A", requestId: `req_${atd}`, itens: [{ sku: "SINT-CENA", qtd: 1 }] },
    });
    await (valeriaVitreCriarRascunho as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res);
    assertEquals(getStatus(), 200, "status HTTP");
    assertEquals((getJson() as any).ok, true, "rascunho deveria ser criado com sucesso");

    const estado = await consultarEstadoRevisaoCore(atd);
    assertEquals(estado.itensVitre.length, 1, "deveria agregar 1 item Vitre vinculado ao atendimento");
  });

  await caso("7B. Produto personalizado — cliente identificado + rascunho SINTÉTICO (estrutura real do motor de produção) agregado", async () => {
    const tel = telSintetico();
    const atd = `atd_cenB_${Date.now()}`;
    const identidade = await identificarOuPrepararClienteCore(tel, atd);
    assert(identidade.status === "cliente_provisorio", "cliente novo esperado");

    // Sintético — imita o shape real documentado em index.html:30973-30987
    // (campos n/nomeCliente/telCliente/total), nunca um motor novo de preço.
    await fsWrite("orcamentos", [{ id: "orc_sint_cenB", n: 1, nomeCliente: "Cliente Cenário B", telCliente: tel, total: 350.0, status: "aguardando", conversationId: atd, marca: "vr" }]);

    const estado = await consultarEstadoRevisaoCore(atd);
    assertEquals(estado.itensPersonalizados.length, 1, "deveria agregar 1 item personalizado vinculado ao atendimento");
  });

  await caso("7C. Atendimento misto — 1 cliente, 1 atendimento, Vitre + personalizado agregados na MESMA visão", async () => {
    const tel = telSintetico();
    const atd = `atd_cenC_${Date.now()}`;
    const id1 = await identificarOuPrepararClienteCore(tel, atd);
    const id2 = await identificarOuPrepararClienteCore(tel, atd);
    assert(id1.status === "cliente_provisorio" && id2.status === "cliente_provisorio", "deveria ser provisório nas duas chamadas");
    if (id1.status === "cliente_provisorio" && id2.status === "cliente_provisorio") {
      assertEquals(id1.clienteProvisorioId, id2.clienteProvisorioId, "mesmo cliente nas duas modalidades do mesmo atendimento");
    }

    await admin.firestore().collection("vitre_produtos").doc("SINT-CENC").set({
      sku: "SINT-CENC", nome: "Produto Cenário C", status: "ativo", ativoValeria: true,
      precoVenda: 80, custo: 30, prazoDias: 3, categoria: "placas", descricaoCurta: "x",
      fotos: ["a"], usos: ["uso"], palavrasChave: ["p"], disponibilidade: "pronta_entrega", beneficios: ["b"], embalagem: "caixa", pesoKg: 1,
    });
    const { req, res } = mockReqRes({
      method: "POST", headers: { authorization: `Bearer ${SECRET}` },
      body: { conversationId: atd, organizationId: "org_sintetico", clienteNome: "Cliente Cenário C", requestId: `req_${atd}`, itens: [{ sku: "SINT-CENC", qtd: 2 }] },
    });
    await (valeriaVitreCriarRascunho as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res);
    await fsWrite("orcamentos", [{ id: "orc_sint_cenC", n: 1, nomeCliente: "Cliente Cenário C", telCliente: tel, total: 420.0, status: "aguardando", conversationId: atd, marca: "vr" }]);

    const estado = await consultarEstadoRevisaoCore(atd);
    assertEquals(estado.itensVitre.length, 1, "1 item Vitre");
    assertEquals(estado.itensPersonalizados.length, 1, "1 item personalizado");

    // Idempotência: reprocessar a mesma mensagem (mesmo requestId) não duplica.
    const { req: req2, res: res2 } = mockReqRes({
      method: "POST", headers: { authorization: `Bearer ${SECRET}` },
      body: { conversationId: atd, organizationId: "org_sintetico", clienteNome: "Cliente Cenário C", requestId: `req_${atd}`, itens: [{ sku: "SINT-CENC", qtd: 2 }] },
    });
    await (valeriaVitreCriarRascunho as unknown as (req: unknown, res: unknown) => Promise<void>)(req2, res2);
    const estadoDepois = await consultarEstadoRevisaoCore(atd);
    assertEquals(estadoDepois.itensVitre.length, 1, "idempotência — reprocessar não deve duplicar o rascunho Vitre");
  });

  await caso("7D. Revisão humana — vendedor assume e conclui; nova mensagem do cliente NUNCA sobrescreve (gera pendência)", async () => {
    const atd = `atd_cenD_${Date.now()}`;
    await assertValeriaPodeEscrever(atd); // Valéria escreve normalmente antes da revisão
    await assumirRevisaoCore(atd, "uid_vendedor_cenD");
    await concluirRevisaoCore(atd, "uid_vendedor_cenD");
    let bloqueou = false;
    try { await assertValeriaPodeEscrever(atd); } catch (e) { bloqueou = e instanceof RevisaoConcluidaError; }
    assert(bloqueou, "escrita da Valéria após revisão concluída deveria ser bloqueada");
    const revisao = await consultarRevisaoCoreCheck(atd);
    assertEquals(revisao.status, "REVISADO", "status final deveria ser REVISADO");
    assertEquals(revisao.pendenciaPosRevisao, true, "pendência deveria ter sido sinalizada");
  });

  async function consultarRevisaoCoreCheck(atendimentoId: string) {
    const { consultarRevisaoCore } = await import("../valeria_pre_orcamento_revisao");
    return consultarRevisaoCore(atendimentoId);
  }

  console.log("\n8. Wrappers HTTP (Bearer) — gate de autenticação");

  await caso("8a. Sem Bearer token — 401", async () => {
    const { req, res, getStatus } = mockReqRes({ method: "GET", query: { telefone: telSintetico() } });
    await (valeriaConsultarClientePorTelefone as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res);
    assertEquals(getStatus(), 401, "status HTTP sem Bearer");
  });

  await caso("8b. Bearer inválido — 401", async () => {
    const { req, res, getStatus } = mockReqRes({ method: "GET", headers: { authorization: "Bearer token_errado" }, query: { telefone: telSintetico() } });
    await (valeriaConsultarClientePorTelefone as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res);
    assertEquals(getStatus(), 401, "status HTTP com Bearer inválido");
  });

  await caso("8c. Bearer correto — 200 (valeriaConsultarClientePorTelefone)", async () => {
    const { req, res, getStatus, getJson } = mockReqRes({ method: "GET", headers: { authorization: `Bearer ${SECRET}` }, query: { telefone: telSintetico() } });
    await (valeriaConsultarClientePorTelefone as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res);
    assertEquals(getStatus(), 200, "status HTTP com Bearer correto");
    assertEquals((getJson() as any).ok, true, "resposta ok");
  });

  await caso("8d. Bearer correto — 200 (valeriaPrepararCadastroProvisorio)", async () => {
    const tel = telSintetico();
    const { req, res, getStatus, getJson } = mockReqRes({
      method: "POST", headers: { authorization: `Bearer ${SECRET}` },
      body: { telefone: tel, atendimentoId: `atd_http_${Date.now()}` },
    });
    await (valeriaPrepararCadastroProvisorio as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res);
    assertEquals(getStatus(), 200, "status HTTP");
    assertEquals((getJson() as any).status, "cliente_provisorio", "deveria criar provisório");
  });

  await caso("8e. Bearer correto — 200 (valeriaConsultarEstadoRevisao)", async () => {
    const atd = `atd_http_estado_${Date.now()}`;
    await assertValeriaPodeEscrever(atd);
    const { req, res, getStatus, getJson } = mockReqRes({ method: "GET", headers: { authorization: `Bearer ${SECRET}` }, query: { atendimentoId: atd } });
    await (valeriaConsultarEstadoRevisao as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res);
    assertEquals(getStatus(), 200, "status HTTP");
    assertEquals((getJson() as any).atendimentoId, atd, "atendimentoId no retorno");
  });

  console.log(`\n=== Resultado: ${passed} passou, ${failed} falhou ===`);
  if (failed > 0) {
    console.log("Falhas:", falhas.join(", "));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error("ERRO FATAL NO SCRIPT:", e); process.exit(1); });
