/**
 * test_sprint_pregolive_blocoM_todas_os_abas_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco M — reformulação da tela "Todas as OS" em 4
 * abas (Ativas / Prontas / Entregues Recentes / Histórico) + auditoria
 * real de entrega (quem entregou, quando).
 *
 * Achados corrigidos:
 *   1. renderOsTable() era uma lista única, sem separação por fase da OS.
 *      Corrigido com osFiltrarPorAba(tab, list, agora) — função pura,
 *      testada aqui por execução real (sem DOM).
 *   2. Histórico precisa ser a fonte COMPLETA — osExcluir() continua sendo
 *      a única forma de remover uma OS (ação manual, com confirm()); a
 *      aba Histórico nunca aplica corte de tempo por padrão.
 *   3. "Entregues Recentes" é só um recorte de conveniência: só entram OS
 *      com status 'entregue' E entregueEm dentro de _OS_RECENTES_DIAS (7 —
 *      corrigido de 30 para 7 em hotfix pós-Sprint, requisito aprovado
 *      sempre foi 7 dias corridos) dias. OS entregues sem entregueEm
 *      (legado, antes desta correção) não entram no recorte, mas
 *      continuam no Histórico normalmente.
 *   4. osLiberar() só gravava auditoria (secAuditLog) no caminho de
 *      EXCEÇÃO (saldo pendente). O caminho normal não gravava quem/quando
 *      entregou nem chamava secAuditLog. Corrigido: os dois caminhos agora
 *      gravam os.entregueEm/os.entreguePor (campos operacionais, vivem
 *      direto em KB_OS/kb_os — nunca em kb_os_fin) e chamam secAuditLog
 *      com ações distintas ('os_entrega' normal / 'os_entrega_excecao'
 *      exceção, já existente).
 *
 * Uso: node scripts/test_sprint_pregolive_blocoM_todas_os_abas_2026-08-09.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}
async function testAsync(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion falhou'); }

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}
function extractVarLine(name) {
  var marker = 'var ' + name + ' =';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var end = html.indexOf(';', start);
  return html.slice(start, end + 1);
}

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco M — "Todas as OS" em 4 abas + auditoria de entrega ===\n');

// ── 1-4. Regressão estrutural: HTML e wiring das abas ──
{
  test('1. HTML tem os 4 botões de aba (Ativas/Prontas/Recentes/Histórico)',
    /id="osListTabBtnAtivas"/.test(html) && /id="osListTabBtnProntas"/.test(html)
      && /id="osListTabBtnRecentes"/.test(html) && /id="osListTabBtnHistorico"/.test(html), true);
  test('2. HTML tem os filtros de data exclusivos da aba Histórico (osHistDataIni/osHistDataFim)',
    /id="osHistDataIni"/.test(html) && /id="osHistDataFim"/.test(html), true);

  var srcOsListTab = extractFn('osListTab');
  test('3. osListTab() sempre redesenha a tabela após trocar de aba (chama renderOsTable())',
    /renderOsTable\(\)/.test(srcOsListTab), true);
  test('4. osListTab() só mostra o filtro de status manual na aba Ativas (onde não é redundante com a aba)',
    /t === 'ativas'/.test(srcOsListTab), true);
}

// ── 5+. Execução real: osFiltrarPorAba() — separação por aba, sem DOM ──
{
  var src = [extractFn('orcEnvParseDataSalvo'),
    extractVarLine('_OS_ATIVOS_STATUS'), extractVarLine('_OS_RECENTES_DIAS'),
    extractFn('osFiltrarPorAba'),
    "module.exports = { osFiltrarPorAba };"].join('\n\n');
  var modPath = path.join(__dirname, '_blocoM_osfiltrar_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  // Data de referência fixa para tornar o teste determinístico.
  var AGORA = new Date(2026, 7, 9, 12, 0, 0); // 09/08/2026 12:00

  function dataStr(diasAtras, hhmm) {
    var d = new Date(AGORA.getTime() - diasAtras * 86400000);
    var dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0'), yyyy = d.getFullYear();
    return dd + '/' + mm + '/' + yyyy + ' ' + (hhmm || '10:00');
  }

  var fixture = [
    { id: 'a1', num: 1, status: 'iniciada' },
    { id: 'a2', num: 2, status: 'producao' },
    { id: 'a3', num: 3, status: 'master' },
    { id: 'a4', num: 4, status: 'em_andamento' },   // alias legado de 'iniciada'
    { id: 'a5', num: 5, status: 'aguard_master' },  // alias legado de 'master'
    { id: 'p1', num: 6, status: 'pronta' },
    { id: 'e1', num: 7, status: 'entregue', entregueEm: dataStr(2) },   // 2 dias atrás — recente
    { id: 'e2', num: 8, status: 'entregue', entregueEm: dataStr(200) }, // 200 dias atrás — só histórico
    { id: 'e3', num: 9, status: 'entregue' },                            // legado, sem entregueEm — só histórico
    { id: 'canc', num: 10, status: 'cancelado' },
  ];

  var ativas = mod.osFiltrarPorAba('ativas', fixture, AGORA);
  test('5. aba ATIVAS traz iniciada/producao/master + aliases legados (5 OS), nunca pronta/entregue/cancelado',
    ativas.map(function(o){return o.id;}).sort(), ['a1','a2','a3','a4','a5']);

  var prontas = mod.osFiltrarPorAba('prontas', fixture, AGORA);
  test('6. aba PRONTAS traz só status "pronta" (1 OS)', prontas.map(function(o){return o.id;}), ['p1']);

  var recentes = mod.osFiltrarPorAba('recentes', fixture, AGORA);
  test('7. aba ENTREGUES RECENTES traz só a OS entregue há 2 dias — a de 200 dias e a sem entregueEm ficam de fora',
    recentes.map(function(o){return o.id;}), ['e1']);

  var historico = mod.osFiltrarPorAba('historico', fixture, AGORA);
  test('8. aba HISTÓRICO traz TODAS as 3 OS entregues (2 dias, 200 dias e sem entregueEm) — nunca corta por tempo',
    historico.map(function(o){return o.id;}).sort(), ['e1','e2','e3']);

  test('9. HISTÓRICO inclui a OS entregue há 200 dias que RECENTES exclui — prova direta de que só Recentes corta por tempo',
    historico.some(function(o){return o.id==='e2';}) && !recentes.some(function(o){return o.id==='e2';}), true);

  // Ordenação: RECENTES sempre mais recente primeiro. As 3 datas precisam
  // caber dentro da janela de 7 dias (HOTFIX 2026-08-09) para que as 3
  // apareçam no recorte e a ordenação seja de fato exercitada.
  var fixtureOrdem = [
    { id: 'x1', num: 20, status: 'entregue', entregueEm: dataStr(7) },
    { id: 'x2', num: 21, status: 'entregue', entregueEm: dataStr(1) },
    { id: 'x3', num: 22, status: 'entregue', entregueEm: dataStr(5) },
  ];
  var recentesOrdenado = mod.osFiltrarPorAba('recentes', fixtureOrdem, AGORA);
  test('10. ENTREGUES RECENTES vem ordenada por data de entrega mais recente primeiro',
    recentesOrdenado.map(function(o){return o.id;}), ['x2','x3','x1']);

  // ── HOTFIX 2026-08-09 — fronteira do corte de 7 dias (corrigido de 30) ──
  // orcEnvParseDataSalvo() já ignora a hora (só lê a parte da data), e
  // osFiltrarPorAba() agora normaliza `agora` para meia-noite antes de
  // comparar — a regra é por DIA DE CALENDÁRIO, nunca por hora corrida.
  // Para provar isso de verdade (não só coincidência de horário), o teste
  // usa "agora" numa hora do dia bem diferente das entregas (12:00 vs
  // entregas às 23:30 e 00:05) — se a comparação fosse por milissegundos
  // corridos em vez de dia calendário, esses casos dariam resultado
  // errado.
  var AGORA_TARDE = new Date(2026, 7, 9, 12, 0, 0); // 09/08/2026 12:00 (meio da tarde)
  function dataStrEm(diasAtras, hhmm) {
    var base = new Date(2026, 7, 9); // dia de calendário de referência (sem hora)
    var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - diasAtras);
    var dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0'), yyyy = d.getFullYear();
    return dd + '/' + mm + '/' + yyyy + ' ' + (hhmm || '10:00');
  }
  var fixtureFronteira = [
    { id: 'hoje',   num: 40, status: 'entregue', entregueEm: dataStrEm(0, '23:30') },  // entregue hoje, à noite
    { id: 'd1',     num: 41, status: 'entregue', entregueEm: dataStrEm(1, '00:05') },  // há 1 dia, logo após meia-noite
    { id: 'd6',     num: 42, status: 'entregue', entregueEm: dataStrEm(6) },           // há 6 dias
    { id: 'd7',     num: 43, status: 'entregue', entregueEm: dataStrEm(7) },           // há exatamente 7 dias — fronteira
    { id: 'd8',     num: 44, status: 'entregue', entregueEm: dataStrEm(8) },           // há 8 dias
    { id: 'd30',    num: 45, status: 'entregue', entregueEm: dataStrEm(30) },          // há 30 dias (valor antigo do bug)
  ];
  var recentesFronteira = mod.osFiltrarPorAba('recentes', fixtureFronteira, AGORA_TARDE);
  var idsRecentes = recentesFronteira.map(function(o){return o.id;}).sort();

  test('11. HOTFIX — entregue HOJE conta como recente', idsRecentes.indexOf('hoje') >= 0, true);
  test('12. HOTFIX — entregue há 1 DIA conta como recente', idsRecentes.indexOf('d1') >= 0, true);
  test('13. HOTFIX — entregue há 6 DIAS conta como recente', idsRecentes.indexOf('d6') >= 0, true);
  test('14. HOTFIX — fronteira: entregue há EXATAMENTE 7 DIAS ainda conta como recente (regra documentada: inclusiva, sai só no dia seguinte)',
    idsRecentes.indexOf('d7') >= 0, true);
  test('15. HOTFIX — entregue há 8 DIAS já NÃO conta como recente (só Histórico)', idsRecentes.indexOf('d8') >= 0, false);
  test('16. HOTFIX — entregue há 30 DIAS (valor antigo do bug) definitivamente só no Histórico', idsRecentes.indexOf('d30') >= 0, false);
  test('17. HOTFIX — o recorte de 7 dias traz exatamente {hoje, d1, d6, d7} e mais nada — prova de que a lista inteira bate, não só presença/ausência isolada',
    idsRecentes, ['d1','d6','d7','hoje']);

  // As mesmas OS de 8 e 30 dias continuam no Histórico normalmente —
  // Histórico nunca aplica o corte de 7 dias.
  var historicoFronteira = mod.osFiltrarPorAba('historico', fixtureFronteira, AGORA_TARDE);
  test('18. HOTFIX — Histórico continua trazendo TODAS as 6 OS (inclusive as de 8 e 30 dias que Recentes excluiu)',
    historicoFronteira.length, 6);

  try { fs.unlinkSync(modPath); } catch (e) {}
}

// ── 19+. Regressão de privacidade financeira: renderOsTable()/osFiltrarPorAba()
//         nunca leem campo financeiro fora do já protegido por kb_os_fin ──
{
  var srcRender = extractFn('renderOsTable');
  var srcFiltrar = extractFn('osFiltrarPorAba');
  var CAMPOS_FIN_PROTEGIDOS = ['totalGeral', 'parcelas', 'formaPgto', 'pagtoTipo', 'valorEntrada', 'restante'];
  var vazou = CAMPOS_FIN_PROTEGIDOS.filter(function(f) {
    return srcRender.indexOf('os.' + f) >= 0 || srcFiltrar.indexOf('os.' + f) >= 0;
  });
  test('19. nem renderOsTable() nem osFiltrarPorAba() leem nenhum campo financeiro além de os.valor (já protegido pelo split kb_os_fin existente)',
    vazou, []);

  // Execução real: sem os.valor populado (cenário Produção — Rules nunca
  // entregam kb_os_fin, então _kbMergeFinCache() nunca preenche esse campo
  // para esse papel), a coluna Valor mostra "—", nunca undefined/NaN/erro.
  test('20. renderOsTable() usa os.valor com fallback seguro para "—" quando o campo não existe (coerente com o papel Produção nunca recebendo esse campo)',
    /_v\?\(typeof _v/.test(srcRender) && /:'—'/.test(srcRender), true);
}

// ── 21+. Execução real: osLiberar() grava auditoria em AMBOS os caminhos ──
(async function main() {
  var src = [
    extractFn('_confirmarAposSalvar'),
    extractFn('osLiberar'),
    'module.exports = { osLiberar };'
  ].join('\n\n');
  var modPath = path.join(__dirname, '_blocoM_osliberar_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];

  function novoAmbiente(opts) {
    opts = opts || {};
    var toasts = [];
    var auditLogs = [];
    var promptCalls = [];
    global.showToast = function(msg, kind) { toasts.push({ msg: msg, kind: kind }); };
    global.secAuditLog = function(action, detail) { auditLogs.push({ action: action, detail: detail }); };
    global.finFmt = function(v) { return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2 }); };
    global.prompt = function(msg) { promptCalls.push(msg); return opts.promptReturn !== undefined ? opts.promptReturn : 'justificativa de teste'; };
    global._currentSession = { user: 'valeria@vrmarcas.com.br' };
    global._kbOsId = undefined; // detalhe da OS não está aberto — pula o bloco de DOM do modal
    global.document = {
      querySelectorAll: function () { return []; }, // nenhum kcard no Kanban durante o teste
      getElementById: function () { return null; }
    };
    global.renderOsTable = function () {};
    global.syncSidebarBadges = function () {};
    global._kbStatusMap = {};
    global.kbSaveKbos = function () { return opts.saveResult || Promise.resolve({ ok: true }); };
    delete require.cache[require.resolve(modPath)];
    return require(modPath);
  }

  // Caminho NORMAL (sem saldo pendente).
  await testAsync('21. osLiberar() caminho normal: grava os.entregueEm no padrão DD/MM/AAAA HH:mm', async function () {
    var os = { id: 'n1', num: 100, status: 'pronta', restante: 0 };
    global.KB_OS = { n1: os };
    var mod = novoAmbiente();
    await mod.osLiberar('n1');
    assert(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(os.entregueEm), 'entregueEm fora do padrão: ' + os.entregueEm);
  });

  await testAsync('22. osLiberar() caminho normal: grava os.entreguePor com o usuário da sessão atual', async function () {
    var os = { id: 'n2', num: 101, status: 'pronta', restante: 0 };
    global.KB_OS = { n2: os };
    var mod = novoAmbiente();
    await mod.osLiberar('n2');
    assertEq(os.entreguePor, 'valeria@vrmarcas.com.br');
  });

  await testAsync('23. osLiberar() caminho normal: chama secAuditLog com ação "os_entrega" (nunca "os_entrega_excecao")', async function () {
    var os = { id: 'n3', num: 102, status: 'pronta', restante: 0 };
    global.KB_OS = { n3: os };
    var logs = [];
    var mod = novoAmbiente();
    global.secAuditLog = function (action, detail) { logs.push({ action: action, detail: detail }); };
    await mod.osLiberar('n3');
    assertEq(logs.length, 1, 'secAuditLog deveria ser chamado exatamente 1 vez');
    assertEq(logs[0].action, 'os_entrega');
  });

  // Caminho de EXCEÇÃO (saldo pendente, com justificativa).
  await testAsync('24. osLiberar() caminho de EXCEÇÃO (saldo pendente): grava entregueEm/entreguePor também', async function () {
    var os = { id: 'x1', num: 200, status: 'pronta', restante: 350.5 };
    global.KB_OS = { x1: os };
    var mod = novoAmbiente({ promptReturn: 'cliente autorizou retirar com saldo em aberto' });
    await mod.osLiberar('x1');
    assert(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(os.entregueEm), 'entregueEm fora do padrão: ' + os.entregueEm);
    assertEq(os.entreguePor, 'valeria@vrmarcas.com.br');
  });

  await testAsync('25. osLiberar() caminho de EXCEÇÃO: chama secAuditLog com ação "os_entrega_excecao" (nunca "os_entrega")', async function () {
    var os = { id: 'x2', num: 201, status: 'pronta', restante: 100 };
    global.KB_OS = { x2: os };
    var logs = [];
    var mod = novoAmbiente({ promptReturn: 'ok' });
    global.secAuditLog = function (action, detail) { logs.push({ action: action, detail: detail }); };
    await mod.osLiberar('x2');
    assertEq(logs.length, 1, 'secAuditLog deveria ser chamado exatamente 1 vez');
    assertEq(logs[0].action, 'os_entrega_excecao');
  });

  await testAsync('26. osLiberar() caminho de EXCEÇÃO cancelado (justificativa vazia): NÃO grava entregueEm/entreguePor nem chama secAuditLog', async function () {
    var os = { id: 'x3', num: 202, status: 'pronta', restante: 100 };
    global.KB_OS = { x3: os };
    var logs = [];
    var mod = novoAmbiente({ promptReturn: '' });
    global.secAuditLog = function (action, detail) { logs.push({ action: action, detail: detail }); };
    await mod.osLiberar('x3');
    assertEq(os.status, 'pronta', 'status não deveria mudar quando a exceção é cancelada');
    assertEq(os.entregueEm, undefined);
    assertEq(logs.length, 0, 'secAuditLog não deveria ser chamado quando a entrega é cancelada');
  });

  await testAsync('27. osLiberar(): se kbSaveKbos() falhar, entregueEm/entreguePor voltam ao valor anterior (reversão completa, não só o status)', async function () {
    var os = { id: 'f1', num: 300, status: 'pronta', restante: 0, entregueEm: undefined, entreguePor: undefined };
    global.KB_OS = { f1: os };
    var mod = novoAmbiente({ saveResult: Promise.resolve({ ok: false }) });
    await mod.osLiberar('f1');
    assertEq(os.status, 'pronta', 'status deveria ter sido revertido');
    assertEq(os.entregueEm, undefined, 'entregueEm deveria ter sido revertido');
    assertEq(os.entreguePor, undefined, 'entreguePor deveria ter sido revertido');
  });

  try { fs.unlinkSync(modPath); } catch (e) {}

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  if (failed > 0) process.exitCode = 1;
})();
