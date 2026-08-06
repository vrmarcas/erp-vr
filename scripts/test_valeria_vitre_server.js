/**
 * test_valeria_vitre_server.js
 *
 * FASE G — Parte C, C5: testa via HTTP REAL (Functions Emulator, endpoints
 * onRequest — não onCall) as Functions de preparação Valéria × Catálogo
 * Vitre (functions/src/valeria_vitre.ts). Nenhum agente Chatvolt real é
 * usado — apenas requisições HTTP diretas com o Bearer token de teste,
 * exatamente o transporte que o Chatvolt usaria numa configuração real
 * futura (ver relatório final, Parte C — não configurado nesta rodada).
 *
 * Uso: node scripts/test_valeria_vitre_server.js
 * Pré-requisito: Emulators rodando (demo-erp-homolog) — Firestore :8080,
 * Functions :5001. Catálogo Vitre já importado (scripts/vitre_importar_planilha.js).
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const http = require('http');
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();

const PROJECT = 'demo-erp-homolog';
const REGION = 'us-central1';
const SECRET = 'e2e_valeria_secret_teste_' + Date.now();

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) { var g = JSON.stringify(got), e = JSON.stringify(exp); if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g); }
function assertTruthy(v, msg) { if (!v) throw new Error(msg || 'esperado valor truthy'); }

function httpJson(method, fnName, pathQuery, body, bearer) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = {};
    if (bearer !== undefined) headers.Authorization = 'Bearer ' + bearer;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({
      hostname: 'localhost', port: 5001, method: method,
      path: `/${PROJECT}/${REGION}/${fnName}${pathQuery || ''}`,
      headers: headers,
    }, (res) => {
      let out = ''; res.on('data', (c) => out += c); res.on('end', () => {
        let parsed = null; try { parsed = JSON.parse(out); } catch (e) { /* corpo não-JSON */ }
        resolve({ status: res.statusCode, body: parsed, raw: out });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function reqId() { return 'req_valeria_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
const CONV = { conversationId: 'conv_e2e_' + Date.now(), organizationId: 'org_e2e_teste' };

console.log('\n=== FASE G Parte C — Valéria × Catálogo Vitre: Functions reais via HTTP (preparação, não configurado no Chatvolt) ===\n');

(async function main() {
  await db.collection('erp_vr').doc('valeria_config').set({ data: JSON.stringify({ secret: SECRET }), ts: Date.now() });

  // Produto elegível (nível >= 2, ativoValeria=true) e produto NÃO elegível, para os testes de C3.
  const skuElegivel = 'E2E_VALERIA_ELEG_' + Date.now();
  const skuInelegivel = 'E2E_VALERIA_INELEG_' + Date.now();
  await db.collection('vitre_produtos').doc(skuElegivel).set({
    sku: skuElegivel, nome: 'Produto Elegível Valéria', marca: 'vitre', status: 'ativo', ativoValeria: true,
    custo: 10, precoVenda: 50, categoria: 'Teste', prazoDias: 5, descricaoCurta: 'desc', embalagem: '10x10x10',
    pesoKg: 1, fotos: ['x.jpg'], usos: ['presente'], beneficios: ['bonito'], palavrasChave: ['teste', 'valeria'],
    disponibilidade: 'pronta_entrega', origem: 'manual',
  });
  await db.collection('vitre_produtos').doc(skuInelegivel).set({
    sku: skuInelegivel, nome: 'Produto Incompleto', marca: 'vitre', status: 'ativo', ativoValeria: true,
    custo: 10, precoVenda: 50, origem: 'manual', // sem categoria/fotos/descricaoCurta/prazoDias — nível 1, abaixo do mínimo (2)
  });

  await test('1. Sem Authorization header → 401', async function () {
    var r = await httpJson('GET', 'valeriaVitreBuscarCatalogo', '?q=teste', undefined, undefined);
    assertEq(r.status, 401);
  });

  await test('2. Bearer token errado → 401', async function () {
    var r = await httpJson('GET', 'valeriaVitreBuscarCatalogo', '?q=teste', undefined, 'token_forjado_qualquer');
    assertEq(r.status, 401);
  });

  await test('3. Busca por palavra-chave — retorna produto elegível, NUNCA custo/margem no payload', async function () {
    var r = await httpJson('GET', 'valeriaVitreBuscarCatalogo', '?q=valeria', undefined, SECRET);
    assertEq(r.status, 200);
    assertTruthy(r.body.ok);
    var achou = r.body.produtos.some(function (p) { return p.sku === skuElegivel; });
    assertTruthy(achou, 'produto elegível deve aparecer na busca por palavra-chave');
    var raw = JSON.stringify(r.body);
    assertTruthy(raw.toLowerCase().indexOf('custo') < 0, 'resposta NUNCA deve conter o campo custo');
    assertTruthy(raw.toLowerCase().indexOf('margem') < 0, 'resposta NUNCA deve conter margem');
  });

  await test('4. Busca não retorna produto abaixo do nível mínimo (C3 — nunca oferece incompleto automaticamente)', async function () {
    var r = await httpJson('GET', 'valeriaVitreBuscarCatalogo', '?q=incompleto', undefined, SECRET);
    var achou = r.body.produtos.some(function (p) { return p.sku === skuInelegivel; });
    assertEq(achou, false, 'produto de nível insuficiente NUNCA deve ser oferecido automaticamente pela Valéria');
  });

  await test('5. Consultar produto elegível por SKU → elegivel:true, dados corretos', async function () {
    var r = await httpJson('GET', 'valeriaVitreConsultarProduto', '?sku=' + skuElegivel, undefined, SECRET);
    assertEq(r.status, 200);
    assertEq(r.body.elegivel, true);
    assertEq(r.body.produto.sku, skuElegivel);
  });

  await test('6. Consultar produto inelegível → elegivel:false, motivo explícito, sem inventar dado', async function () {
    var r = await httpJson('GET', 'valeriaVitreConsultarProduto', '?sku=' + skuInelegivel, undefined, SECRET);
    assertEq(r.body.elegivel, false);
    assertTruthy(r.body.motivo);
  });

  await test('7. Consultar SKU inexistente → nunca inventa, responde SKU_NAO_ENCONTRADO', async function () {
    var r = await httpJson('GET', 'valeriaVitreConsultarProduto', '?sku=SKU_QUE_NUNCA_EXISTIU_JAMAIS', undefined, SECRET);
    assertEq(r.body.elegivel, false);
    assertEq(r.body.motivo, 'SKU_NAO_ENCONTRADO');
  });

  await test('8. Simular orçamento com produto elegível → calcula corretamente, não persiste nada', async function () {
    var antes = (await db.collection('vitre_orcamentos').get()).size;
    var r = await httpJson('POST', 'valeriaVitreSimularOrcamento', '', { itens: [{ sku: skuElegivel, qtd: 2 }], descontoPct: 10 }, SECRET);
    assertEq(r.status, 200);
    assertEq(r.body.total, 90); // 50*2=100, -10% = 90
    var depois = (await db.collection('vitre_orcamentos').get()).size;
    assertEq(depois, antes, 'simulação nunca deve criar um documento em vitre_orcamentos');
  });

  await test('9. Simular orçamento com produto inelegível → falha fail-closed, não inventa preço', async function () {
    var r = await httpJson('POST', 'valeriaVitreSimularOrcamento', '', { itens: [{ sku: skuInelegivel, qtd: 1 }] }, SECRET);
    assertEq(r.body.ok, false);
    assertTruthy(String(r.body.error).indexOf('PRODUTO_NAO_ELEGIVEL') >= 0);
  });

  await test('10. Criar rascunho sem conversationId/organizationId → 400 (isolamento obrigatório)', async function () {
    var r = await httpJson('POST', 'valeriaVitreCriarRascunho', '', { clienteNome: 'X', itens: [{ sku: skuElegivel, qtd: 1 }], requestId: reqId() }, SECRET);
    assertEq(r.status, 400);
  });

  var idRascunho;
  await test('11. Criar rascunho real com produto elegível → grava em vitre_orcamentos com origem=valeria e snapshot correto', async function () {
    var body = Object.assign({ clienteNome: 'Cliente Valéria E2E', itens: [{ sku: skuElegivel, qtd: 1 }], requestId: reqId() }, CONV);
    var r = await httpJson('POST', 'valeriaVitreCriarRascunho', '', body, SECRET);
    assertEq(r.status, 200);
    assertTruthy(r.body.ok);
    idRascunho = r.body.id;
    var doc = await db.collection('vitre_orcamentos').doc(idRascunho).get();
    assertTruthy(doc.exists);
    var d = doc.data();
    assertEq(d.origem, 'valeria');
    assertEq(d.conversationId, CONV.conversationId);
    assertEq(d.itens[0].precoSnapshot, 50);
  });

  await test('12. Mesmo requestId (retry/timeout simulado) → idempotente, não duplica', async function () {
    var mesmoReq = reqId();
    var body = Object.assign({ clienteNome: 'Cliente Retry', itens: [{ sku: skuElegivel, qtd: 1 }], requestId: mesmoReq }, CONV);
    var r1 = await httpJson('POST', 'valeriaVitreCriarRascunho', '', body, SECRET);
    var r2 = await httpJson('POST', 'valeriaVitreCriarRascunho', '', body, SECRET);
    assertTruthy(r1.body.id);
    assertEq(r2.body.jaProcessado, true);
    assertEq(r2.body.id, r1.body.id);
  });

  await test('13. Duas conversas simultâneas (isolamento) — mesmo cliente, conversationId diferente, ambas gravam separadamente', async function () {
    var reqA = reqId(), reqB = reqId();
    var bodyA = { clienteNome: 'Cliente Isolamento', itens: [{ sku: skuElegivel, qtd: 1 }], requestId: reqA, conversationId: 'conv_A_' + Date.now(), organizationId: CONV.organizationId };
    var bodyB = { clienteNome: 'Cliente Isolamento', itens: [{ sku: skuElegivel, qtd: 1 }], requestId: reqB, conversationId: 'conv_B_' + Date.now(), organizationId: CONV.organizationId };
    var rA = await httpJson('POST', 'valeriaVitreCriarRascunho', '', bodyA, SECRET);
    var rB = await httpJson('POST', 'valeriaVitreCriarRascunho', '', bodyB, SECRET);
    assertTruthy(rA.body.id && rB.body.id && rA.body.id !== rB.body.id, 'conversas diferentes devem gerar orçamentos separados, nunca colidir');
  });

  await test('14. Encaminhar para VR (fora das regras de catálogo) → grava handoff auditável', async function () {
    var body = Object.assign({ clienteNome: 'Cliente Fora do Catálogo', motivo: 'medida_fora_do_padrao', detalhe: 'Cliente quer 3.5m, maior que qualquer SKU', requestId: reqId() }, CONV);
    var r = await httpJson('POST', 'valeriaVitreEncaminharVR', '', body, SECRET);
    assertEq(r.status, 200);
    var doc = await db.collection('valeria_handoffs').doc(r.body.id).get();
    assertTruthy(doc.exists);
    assertEq(doc.data().motivo, 'medida_fora_do_padrao');
  });

  await test('15. Motivo inválido no encaminhamento → normalizado para "outro", nunca quebra', async function () {
    var body = Object.assign({ clienteNome: 'X', motivo: 'motivo_forjado_qualquer', requestId: reqId() }, CONV);
    var r = await httpJson('POST', 'valeriaVitreEncaminharVR', '', body, SECRET);
    assertEq(r.status, 200);
    var doc = await db.collection('valeria_handoffs').doc(r.body.id).get();
    assertEq(doc.data().motivo, 'outro');
  });

  // ══════════════════════════════════════════════════════════════════════
  // PARTE 10 da homologação guiada (2026-08-06) — os 17 cenários exigidos
  // pela instrução. Vários já estão cobertos acima (5=produto exato,
  // 4/6=produto incompleto, 8=desconto, 14=transferência humana) — os
  // testes 16+ cobrem os que ainda não tinham um cenário isolado
  // dedicado: PF/PJ×Vitre/VR (estrutural), produto semelhante, tamanho
  // inexistente, personalização permitida/não permitida, produto
  // desativado, preço ausente, prazo ausente, foto ausente, pedido misto.
  // ══════════════════════════════════════════════════════════════════════

  await test('16. PF×Vitre / PJ×Vitre / PF×VR / PJ×VR — nenhuma Function aceita ou usa CPF/CNPJ/pessoaTipo; enviar o campo não muda nada no resultado (C1 é estrutural, não uma checagem que possa ser esquecida)', async function () {
    var semDado = await httpJson('GET', 'valeriaVitreConsultarProduto', '?sku=' + skuElegivel, undefined, SECRET);
    var comCpfForjado = await httpJson('GET', 'valeriaVitreConsultarProduto', '?sku=' + skuElegivel + '&cpf=11122233344&pessoaTipo=fisica', undefined, SECRET);
    var comCnpjForjado = await httpJson('GET', 'valeriaVitreConsultarProduto', '?sku=' + skuElegivel + '&cnpj=11222333000144&pessoaTipo=juridica', undefined, SECRET);
    assertEq(semDado.body, comCpfForjado.body, 'CPF não deve alterar a resposta');
    assertEq(semDado.body, comCnpjForjado.body, 'CNPJ não deve alterar a resposta');
    // Mesma lógica vale para "encaminhar para VR" — o motivo do handoff é sempre
    // uma necessidade do catálogo (medida/material/alteração/arquivo), nunca
    // "é pessoa física" ou "é pessoa jurídica" (ver lista `motivosValidos` em
    // valeria_vitre.ts — nenhum deles é PF/PJ).
  });

  await test('17. Produto semelhante — busca por sinônimo/uso (não SKU exato, não nome exato) encontra o produto certo', async function () {
    var r = await httpJson('GET', 'valeriaVitreBuscarCatalogo', '?q=presente', undefined, SECRET); // busca por "usos", não pelo nome
    var achou = r.body.produtos.some(function (p) { return p.sku === skuElegivel; });
    assertTruthy(achou, 'busca por uso/sinônimo (não nome/SKU exato) deve encontrar o produto elegível');
  });

  await test('18. Tamanho/variante inexistente — consulta por SKU que seria uma variante nunca cadastrada → nunca aproxima para outro produto', async function () {
    var r = await httpJson('GET', 'valeriaVitreConsultarProduto', '?sku=' + skuElegivel + '_VARIANTE_GIGANTE_INEXISTENTE', undefined, SECRET);
    assertEq(r.body.elegivel, false);
    assertEq(r.body.motivo, 'SKU_NAO_ENCONTRADO', 'nunca deve devolver um produto "parecido" no lugar do tamanho pedido');
  });

  var skuComPersonalizacao = 'E2E_VALERIA_PERSONALIZ_' + Date.now();
  await db.collection('vitre_produtos').doc(skuComPersonalizacao).set({
    sku: skuComPersonalizacao, nome: 'Produto Personalizável', marca: 'vitre', status: 'ativo', ativoValeria: true,
    custo: 10, precoVenda: 100, categoria: 'Teste', prazoDias: 5, descricaoCurta: 'desc', embalagem: '10x10x10',
    pesoKg: 1, fotos: ['x.jpg'], usos: ['presente'], beneficios: ['bonito'], palavrasChave: ['personalizavel'],
    disponibilidade: 'pronta_entrega', origem: 'manual',
    personalizacoes: [{ nome: 'Gravação a laser', preco: 25 }],
  });

  await test('19. Personalização permitida — adicional cadastrado no produto é aplicado, preço vem do catálogo (nunca do que o agente informar)', async function () {
    var r = await httpJson('POST', 'valeriaVitreSimularOrcamento', '', { itens: [{ sku: skuComPersonalizacao, qtd: 1, adicionais: [{ nome: 'Gravação a laser', preco: 0.01 }] }] }, SECRET);
    assertEq(r.status, 200);
    assertEq(r.body.total, 125, 'total deve usar o preço REAL da personalização (25), não o preco:0.01 forjado no payload');
    assertEq(r.body.itens[0].adicionaisRejeitados, [], 'personalização permitida não deve aparecer como rejeitada');
  });

  await test('20. Personalização NÃO permitida — adicional pedido mas não cadastrado no produto → rejeitado explicitamente, nunca aplicado silenciosamente', async function () {
    var r = await httpJson('POST', 'valeriaVitreSimularOrcamento', '', { itens: [{ sku: skuComPersonalizacao, qtd: 1, adicionais: [{ nome: 'Pintura dourada inexistente', preco: 999 }] }] }, SECRET);
    assertEq(r.status, 200);
    assertEq(r.body.total, 100, 'total NÃO deve incluir a personalização não permitida');
    assertEq(r.body.itens[0].adicionaisRejeitados, ['Pintura dourada inexistente'], 'agente precisa saber que foi rejeitada, para explicar ao cliente');
  });

  var skuDesativado = 'E2E_VALERIA_DESATIVADO_' + Date.now();
  await db.collection('vitre_produtos').doc(skuDesativado).set({
    sku: skuDesativado, nome: 'Produto Desativado', marca: 'vitre', status: 'inativo', ativoValeria: true,
    custo: 10, precoVenda: 50, categoria: 'Teste', prazoDias: 5, descricaoCurta: 'desc', embalagem: '10x10x10',
    pesoKg: 1, fotos: ['x.jpg'], usos: ['teste'], beneficios: ['x'], palavrasChave: ['desativado'],
    disponibilidade: 'indisponivel', origem: 'manual',
  });
  await test('21. Produto desativado (status=inativo, mesmo com todos os outros campos completos) — nunca oferecido', async function () {
    var busca = await httpJson('GET', 'valeriaVitreBuscarCatalogo', '?q=desativado', undefined, SECRET);
    assertEq(busca.body.produtos.some(function (p) { return p.sku === skuDesativado; }), false);
    var consulta = await httpJson('GET', 'valeriaVitreConsultarProduto', '?sku=' + skuDesativado, undefined, SECRET);
    assertEq(consulta.body.elegivel, false);
  });

  var skuSemPreco = 'E2E_VALERIA_SEMPRECO_' + Date.now();
  await db.collection('vitre_produtos').doc(skuSemPreco).set({
    sku: skuSemPreco, nome: 'Produto Sem Preço', marca: 'vitre', status: 'ativo', ativoValeria: true,
    custo: 10, precoVenda: null, categoria: 'Teste', prazoDias: 5, descricaoCurta: 'desc', embalagem: '10x10x10',
    pesoKg: 1, fotos: ['x.jpg'], usos: ['teste'], beneficios: ['x'], palavrasChave: ['sempreco'],
    disponibilidade: 'pronta_entrega', origem: 'manual',
  });
  await test('22. Preço ausente (tudo mais completo) — nunca oferecido, nunca inventa um preço', async function () {
    var r = await httpJson('GET', 'valeriaVitreConsultarProduto', '?sku=' + skuSemPreco, undefined, SECRET);
    assertEq(r.body.elegivel, false);
  });

  var skuSemPrazo = 'E2E_VALERIA_SEMPRAZO_' + Date.now();
  await db.collection('vitre_produtos').doc(skuSemPrazo).set({
    sku: skuSemPrazo, nome: 'Produto Sem Prazo', marca: 'vitre', status: 'ativo', ativoValeria: true,
    custo: 10, precoVenda: 50, categoria: 'Teste', prazoDias: null, descricaoCurta: 'desc', embalagem: '10x10x10',
    pesoKg: 1, fotos: ['x.jpg'], usos: ['teste'], beneficios: ['x'], palavrasChave: ['semprazo'],
    disponibilidade: 'pronta_entrega', origem: 'manual',
  });
  await test('23. Prazo ausente (tudo mais completo) — nunca oferecido, nunca promete uma data que não existe', async function () {
    var r = await httpJson('GET', 'valeriaVitreConsultarProduto', '?sku=' + skuSemPrazo, undefined, SECRET);
    assertEq(r.body.elegivel, false);
  });

  var skuSemFoto = 'E2E_VALERIA_SEMFOTO_' + Date.now();
  await db.collection('vitre_produtos').doc(skuSemFoto).set({
    sku: skuSemFoto, nome: 'Produto Sem Foto', marca: 'vitre', status: 'ativo', ativoValeria: true,
    custo: 10, precoVenda: 50, categoria: 'Teste', prazoDias: 5, descricaoCurta: 'desc', embalagem: '10x10x10',
    pesoKg: 1, fotos: [], usos: ['teste'], beneficios: ['x'], palavrasChave: ['semfoto'],
    disponibilidade: 'pronta_entrega', origem: 'manual',
  });
  await test('24. Foto ausente (array vazio, tudo mais completo) — nunca oferecido (nível 2 exige ao menos 1 foto)', async function () {
    var r = await httpJson('GET', 'valeriaVitreConsultarProduto', '?sku=' + skuSemFoto, undefined, SECRET);
    assertEq(r.body.elegivel, false);
  });

  await test('25. Pedido misto — item de catálogo elegível vira rascunho normalmente; a parte que exige personalizado é encaminhada à VR separadamente, nunca misturada num único registro', async function () {
    var reqRascunho = reqId(), reqHandoff = reqId();
    var rRascunho = await httpJson('POST', 'valeriaVitreCriarRascunho', '', Object.assign({ clienteNome: 'Cliente Misto', itens: [{ sku: skuElegivel, qtd: 1 }], requestId: reqRascunho }, CONV), SECRET);
    var rHandoff = await httpJson('POST', 'valeriaVitreEncaminharVR', '', Object.assign({ clienteNome: 'Cliente Misto', motivo: 'medida_fora_do_padrao', detalhe: 'Pedido também inclui uma peça sob medida, fora do catálogo', requestId: reqHandoff }, CONV), SECRET);
    assertTruthy(rRascunho.body.id, 'a parte de catálogo deve ser registrada normalmente');
    assertTruthy(rHandoff.body.id, 'a parte fora do catálogo deve virar um handoff próprio');
    assertTruthy(rRascunho.body.id !== rHandoff.body.id, 'nunca devem ser o mesmo registro — são dois destinos diferentes (Vitre automático vs VR humano)');
  });

  await db.collection('vitre_produtos').doc(skuElegivel).delete().catch(function () {});
  await db.collection('vitre_produtos').doc(skuInelegivel).delete().catch(function () {});
  await db.collection('vitre_produtos').doc(skuComPersonalizacao).delete().catch(function () {});
  await db.collection('vitre_produtos').doc(skuDesativado).delete().catch(function () {});
  await db.collection('vitre_produtos').doc(skuSemPreco).delete().catch(function () {});
  await db.collection('vitre_produtos').doc(skuSemPrazo).delete().catch(function () {});
  await db.collection('vitre_produtos').doc(skuSemFoto).delete().catch(function () {});

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error('Erro fatal:', e); process.exit(1); });
