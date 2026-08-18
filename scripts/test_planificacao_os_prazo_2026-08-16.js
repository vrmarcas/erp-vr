/**
 * test_planificacao_os_prazo_2026-08-16.js
 *
 * Rodada cirúrgica 2026-08-16 (planificação/OS/prazo) — TESTES A-G exatos
 * do escopo, contra as funções REAIS extraídas de index.html.
 *
 * ACHADO DESTA RODADA: itens 1, 2, 3 (caso testado), 5, 6 e 8 do escopo
 * JÁ estavam corrigidos por uma rodada anterior (commits cd4d726..48a4bb7,
 * já em origin/master e já implantados em produção antes desta sessão
 * começar) — os testes A-E e G abaixo comprovam isso rodando as funções
 * reais, não reimplementações. O único bug REAL encontrado e corrigido
 * nesta sessão foi o item 7 (TESTE F): a data sugerida da OS usava o
 * TETO da faixa de prazo prometida ("5 a 7 dias úteis" sugeria o 7º dia
 * útil), quando deveria usar o início da faixa (5º dia útil).
 *
 * Uso: node scripts/test_planificacao_os_prazo_2026-08-16.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, got, expected) {
  const g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}
function ok(desc, cond) {
  if (cond) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc); failed++; }
}

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  const braceOpen = html.indexOf('{', start);
  let depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}
function extractBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error('Trecho não encontrado (start): ' + startMarker);
  const end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error('Trecho não encontrado (end): ' + endMarker);
  return html.slice(start, end + endMarker.length);
}

console.log('\n=== Rodada planificação/OS/prazo 2026-08-16 — TESTES A-G ===\n');

// ══════════════════════════════════════════════════════════════════
// TESTE A — exclusão persistente
// ══════════════════════════════════════════════════════════════════
console.log('-- TESTE A: 6 automáticas → excluir 1 → adicionar manual → continua 6 efetivas → fechar/reabrir --');
{
  const src = [
    extractFn('_planReconcilePieces'),
    extractFn('_planSeedFromPersisted'),
    extractFn('_planPieceSlug'),
    'var _planEditPieces = [];',
    'var planManualPieces = [];',
    extractFn('_planBuildAllPecas'),
    'module.exports = { _planReconcilePieces, _planSeedFromPersisted, _planBuildAllPecas,',
    '  setEditPieces: function(p){ _planEditPieces = p; }, getEditPieces: function(){ return _planEditPieces; },',
    '  setManual: function(p){ planManualPieces = p; } };',
  ].join('\n\n');
  const modPath = path.join(__dirname, '_tmp_test_A.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  const mod = require(modPath);

  // Receita da "Caixa 20x20x20": 6 peças (Lateral x2, Frente/Fundo x2, Base, Tampa)
  const RECEITA_CAIXA = [
    { nome: 'Lateral', qty: 2, larg: 19.4, alt: 19.7, esp: null, tipo: '' },
    { nome: 'Frente/Fundo', qty: 2, larg: 19.4, alt: 19.7, esp: null, tipo: '' },
    { nome: 'Base', qty: 1, larg: 19.7, alt: 19.7, esp: null, tipo: '' },
    { nome: 'Tampa', qty: 1, larg: 19.7, alt: 19.7, esp: null, tipo: '' },
  ];

  // 1-2. Criar Caixa 20x20x20 → receita gera 6 peças (via reconcile numa lista vazia)
  const reconciliado1 = mod._planReconcilePieces(RECEITA_CAIXA, 3);
  mod.setEditPieces(reconciliado1);
  const totalPecasIniciais = reconciliado1.reduce((s, p) => s + p.qty, 0);
  test('1-2. Receita gera 6 peças (2+2+1+1)', totalPecasIniciais, 6);

  // 3-4. Excluir Tampa → total = 5
  const editPieces = mod.getEditPieces();
  const idxTampa = editPieces.findIndex(p => p.nome === 'Tampa');
  editPieces[idxTampa]._deleted = true;
  const totalAposExcluir = mod._planBuildAllPecas().reduce((s, p) => s + p.qty, 0);
  test('3-4. Excluir Tampa: total = 5', totalAposExcluir, 5);

  // 5-6. Adicionar Peça 1 manual → total = 6
  mod.setManual([{ nome: 'Peça 1', larg: 20, alt: 20, qty: 1, esp: 4, precoM2: 120 }]);
  const totalComManual = mod._planBuildAllPecas().reduce((s, p) => s + p.qty, 0);
  test('5-6. Adicionar Peça 1 manual: total = 6', totalComManual, 6);

  // 7. Confirmar que Tampa continua ausente
  ok('7. Tampa ausente da lista efetiva', !mod._planBuildAllPecas().some(p => p.nome === 'Tampa'));

  // 8-9. Alterar medida da Peça 1 → Tampa continua ausente
  mod.getEditPieces(); // no-op, mas simula edição de campo
  const manualAtual = [{ nome: 'Peça 1', larg: 22, alt: 20, qty: 1, esp: 4, precoM2: 120 }];
  mod.setManual(manualAtual);
  ok('8-9. Alterar medida da Peça 1 (22×20): Tampa continua ausente', !mod._planBuildAllPecas().some(p => p.nome === 'Tampa'));

  // 10-11. Alterar material (esp) da Peça 1 → Tampa continua ausente
  manualAtual[0].esp = 5;
  ok('10-11. Alterar espessura da Peça 1 (5mm): Tampa continua ausente', !mod._planBuildAllPecas().some(p => p.nome === 'Tampa'));

  // 12-13. "Aplicar Planificação" → persiste snapshot efetivo (simulado: JSON do _planBuildAllPecas)
  const planPecasPersistido = JSON.stringify(mod._planBuildAllPecas());

  // 14-15. Fechar → reabrir: simula planAbrir() re-semeando a partir do persistido
  const reconciliado2 = mod._planSeedFromPersisted(RECEITA_CAIXA, planPecasPersistido, 3);
  mod.setEditPieces(reconciliado2);
  // _planBuildAllPecas() já concatena planManualPieces internamente — não somar de novo.
  const totalAposReabrir = mod._planBuildAllPecas().reduce((s, p) => s + p.qty, 0);
  ok('14-15a. Reabrir: Tampa continua ausente (nunca ressuscitada pela receita)', !reconciliado2.some(p => p.nome === 'Tampa' && !p._deleted));
  test('14-15b. Reabrir: exatamente 5 peças automáticas remanescentes + 1 manual = 6', totalAposReabrir, 6);
  fs.unlinkSync(modPath);
}

// ══════════════════════════════════════════════════════════════════
// TESTE B — layout usa a MESMA fonte da tabela (sumBox.dataset.pcs)
// ══════════════════════════════════════════════════════════════════
console.log('\n-- TESTE B: layout visual usa a mesma fonte filtrada que a tabela --');
{
  // planCalc() e _planRecompute() escrevem sumBox.dataset.pcs com o MESMO
  // filtro (!p._deleted); planDrawCanvas() lê exclusivamente desse dataset
  // (nunca relê a receita). Verificação estrutural direta no código-fonte.
  const planCalcSrc = extractFn('planCalc');
  const recomputeSrc = extractFn('_planRecompute');
  const drawSrc = extractFn('planDrawCanvas');
  ok('B1. planCalc() grava sumBox.dataset.pcs filtrando !p._deleted', /sumBox\.dataset\.pcs\s*=\s*JSON\.stringify\(_planEditPieces\.filter\(function\(p\)\{\s*return !p\._deleted;/.test(planCalcSrc));
  ok('B2. _planRecompute() (chamado por excluir/editar peça) grava o MESMO filtro', /sumBox\.dataset\.pcs\s*=\s*JSON\.stringify\(_planEditPieces\.filter\(function\(p\)\{\s*return !p\._deleted;/.test(recomputeSrc));
  ok('B3. planDrawCanvas() lê de sumBox.dataset.pcs (nunca relê a receita/PLAN_RECIPES diretamente)', /sumBox\.dataset\.pcs/.test(drawSrc) && !/PLAN_RECIPES/.test(drawSrc));
  ok('B4. _planDeleteAuto (excluir peça) dispara _planRecompute() — layout atualiza no mesmo clique', /_planRecompute\(\)/.test(extractFn('_planDeleteAuto')));
  ok('B5. planAddManual/planRemoveManual disparam _planCalcAndMerge() — layout atualiza no mesmo clique', /_planCalcAndMerge\(\)/.test(extractFn('planAddManual')) && /_planCalcAndMerge\(\)/.test(extractFn('planRemoveManual')));
}

// ══════════════════════════════════════════════════════════════════
// TESTE C — espessuras corretas em tabela/OS/planificação
// ══════════════════════════════════════════════════════════════════
console.log('\n-- TESTE C: automáticas 3mm + manual 4mm → tabela/OS/planificação mostram ambos --');
{
  const src = [extractFn('osItemMateriaisResumo'), 'module.exports = { osItemMateriaisResumo };'].join('\n\n');
  const modPath = path.join(__dirname, '_tmp_test_C.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  const mod = require(modPath);

  const item = {
    mat: 'Acrílico Cristal 3mm',
    pieces: [
      { nome: 'Lateral', qty: 2, larg: 19.4, alt: 19.7, esp: 3, espessuraMm: 3, origem: 'AUTOMATICA' },
      { nome: 'Base', qty: 1, larg: 19.7, alt: 19.7, esp: 3, espessuraMm: 3, origem: 'AUTOMATICA' },
      { nome: 'Peça 1', larg: 20, alt: 20, qty: 1, esp: 4, espessuraMm: 4, origem: 'MANUAL' },
    ],
  };
  const resumo = mod.osItemMateriaisResumo(item);
  test('C1. Resumo da OS mostra as DUAS espessuras (3mm e 4mm), sem duplicar', resumo, 'Acrílico Cristal 3mm + Acrílico Cristal 4mm');

  // Renderização "Esp.: Xmm" na planificação da OS — mesma lógica de
  // kbAbrirPlanificacaoItem (P0.6): nunca "mm" sem número.
  const kbSrc = extractFn('kbAbrirPlanificacaoItem');
  ok('C2. kbAbrirPlanificacaoItem calcula _espVal com fallback para espessuraMm (nunca deixa "mm" sem número)', /_espVal\s*=\s*\(p\.esp!=null && p\.esp!==''\)\s*\?\s*p\.esp\s*:\s*\(p\.espessuraMm!=null/.test(kbSrc));
  ok('C3. Célula da tabela só imprime "Xmm" quando _espVal!=null, senão "—" (nunca "mm" solto)', /_espVal!=null\?_espVal\+'mm':'—'/.test(kbSrc));

  fs.unlinkSync(modPath);
}

// ══════════════════════════════════════════════════════════════════
// TESTE D — snapshot estrutural igual entre orçamento e OS
// ══════════════════════════════════════════════════════════════════
console.log('\n-- TESTE D: gerar OS → snapshot estruturalmente igual à planificação aplicada --');
{
  const src = [extractFn('osItemMateriaisResumo'), extractFn('osProjecaoOperacionalItem'), 'module.exports = { osProjecaoOperacionalItem };'].join('\n\n');
  const modPath = path.join(__dirname, '_tmp_test_D.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  const mod = require(modPath);

  const pecasAplicadas = [
    { nome: 'Lateral', qty: 2, larg: 19.4, alt: 19.7, esp: 3, espessuraMm: 3, origem: 'AUTOMATICA' },
    { nome: 'Peça 1', larg: 20, alt: 20, qty: 1, esp: 4, espessuraMm: 4, origem: 'MANUAL' },
  ];
  const itemOrcamento = {
    tipoItem: 'produto', prod: 'Caixa 20x20x20', qty: 1, larg: 20, alt: 20,
    mat: 'Acrílico Cristal 3mm', det: '', planArea: 0.5, pieces: pecasAplicadas,
    productId: 'p1', recipeVersion: 1, camposExtras: null,
    planLarg: 20, planAlt: 20, planProf: 20,
    recipeSnapshot: { nome: 'Caixa', dim3d: '20x20x20', pecas: pecasAplicadas, campos: [], planificacoes: null },
    custoInterno: 999, margem: 0.5, // nunca devem vazar para a OS
  };
  const snapshot = mod.osProjecaoOperacionalItem(itemOrcamento);
  test('D1. snapshot.pieces é IDÊNTICO ao aplicado no orçamento (mesma referência de dados)', snapshot.pieces, pecasAplicadas);
  test('D2. snapshot.recipeSnapshot.pecas é IDÊNTICO ao aplicado', snapshot.recipeSnapshot.pecas, pecasAplicadas);
  ok('D3. snapshot NUNCA inclui custo/margem interno (privacidade da Produção preservada)', !('custoInterno' in snapshot) && !('margem' in snapshot));

  const kbSrc = extractFn('kbAbrirPlanificacaoItem');
  // RODADA 5 — a ORDEM de precedência inverteu (it.pieces passou a vir
  // PRIMEIRO — bug real corrigido: recipeSnapshot.pecas guarda fórmulas
  // cruas da receita para itens customizados, não as peças calculadas; ver
  // mesma correção em osItemMateriaisResumo()), mas a propriedade testada
  // aqui (lê exclusivamente dos dois campos do snapshot CONGELADO, nunca
  // recalcula a partir de dado vivo) continua verdadeira — checagem
  // independente de ordem.
  ok('D4. "Abrir Planificação do Orçamento" na OS lê de it.pieces/it.recipeSnapshot.pecas (o snapshot congelado, nunca recalcula)', /it\.pieces/.test(kbSrc) && /it\.recipeSnapshot\s*&&\s*it\.recipeSnapshot\.pecas/.test(kbSrc));
  fs.unlinkSync(modPath);
}

// ══════════════════════════════════════════════════════════════════
// TESTE E — edição do orçamento antes do início da produção
// ══════════════════════════════════════════════════════════════════
console.log('\n-- TESTE E: editar orçamento antes de iniciar produção → mesma OS atualizada --');
{
  const src = [
    'function secAuditLog(){}',
    'function kbRender(){}',
    'function renderOsTable(){}',
    'function syncSidebarBadges(){}',
    'var _currentSession = {user:"vendedor.teste"};',
    extractFn('_orcSincronizarOSVinculada'),
    'module.exports = { _orcSincronizarOSVinculada };',
  ].join('\n\n');
  const modPath = path.join(__dirname, '_tmp_test_E.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  const mod = require(modPath);

  // Cenário 1: OS ainda NÃO iniciou produção → sincroniza silenciosamente
  const osNaoIniciada = { id: 'os1', status: 'iniciada', itens: [{ mat: 'Acrílico Cristal 3mm' }], material: 'Acrílico Cristal 3mm' };
  global.KB_OS = { os1: osNaoIniciada };
  const orcAtualizado = {
    id: 'orc1', osRef: 'os1',
    itens: [{ mat: 'Acrílico Cristal 4mm', pieces: [{ nome: 'x', esp: 4, espessuraMm: 4, qty: 1 }] }],
    prazoPrometidoTexto: '5 a 7 dias úteis',
  };
  mod._orcSincronizarOSVinculada(orcAtualizado);
  ok('E1. OS pré-produção: itens atualizados automaticamente (mesma osId, sem confirm())', global.KB_OS.os1.itens[0].mat === 'Acrílico Cristal 4mm');
  ok('E2. Nenhuma segunda OS foi criada — KB_OS ainda tem só 1 chave', Object.keys(global.KB_OS).length === 1);

  // Cenário 2: OS JÁ em produção → exige confirm() explícito
  let confirmChamado = 0;
  global.confirm = function () { confirmChamado++; return false; }; // usuário RECUSA
  const osEmProducao = { id: 'os2', status: 'producao', itens: [{ mat: 'Acrílico Cristal 3mm' }], material: 'Acrílico Cristal 3mm' };
  global.KB_OS = { os2: osEmProducao };
  const orc2 = { id: 'orc2', osRef: 'os2', itens: [{ mat: 'Acrílico Cristal 5mm' }], prazoPrometidoTexto: '' };
  mod._orcSincronizarOSVinculada(orc2);
  ok('E3. OS em produção: confirm() foi chamado (não atualiza silenciosamente)', confirmChamado === 1);
  ok('E4. Usuário recusou: OS mantém os dados ANTERIORES', global.KB_OS.os2.itens[0].mat === 'Acrílico Cristal 3mm');

  global.confirm = function () { return true; }; // usuário CONFIRMA
  mod._orcSincronizarOSVinculada(orc2);
  ok('E5. Usuário confirmou: OS atualizada com os novos dados', global.KB_OS.os2.itens[0].mat === 'Acrílico Cristal 5mm');
  ok('E6. Revisão registrada em os.revisoesPosProducao[] (mecanismo já existente, reaproveitado)', Array.isArray(global.KB_OS.os2.revisoesPosProducao) && global.KB_OS.os2.revisoesPosProducao.length === 1);
  ok('E7. os.revisadaAposProducao = true (indicador visual no Kanban/detalhe)', global.KB_OS.os2.revisadaAposProducao === true);

  delete global.KB_OS; delete global.confirm;
  fs.unlinkSync(modPath);
}

// ══════════════════════════════════════════════════════════════════
// TESTE F — prazo: "5 a 7 dias úteis" → data sugerida = 5º dia útil
// ══════════════════════════════════════════════════════════════════
console.log('\n-- TESTE F: data sugerida usa o INÍCIO da faixa prometida (não o teto) --');
{
  const trecho = extractBetween(
    "var _prazoDiasOS = parseInt(o.prazoDias||'0')||0;",
    "diaSugerido = _dtSug.getDate().toString().padStart(2,'0')+'/'+(_dtSug.getMonth()+1).toString().padStart(2,'0')+'/'+_dtSug.getFullYear();\n  }"
  );
  const trechoSemComentarios = trecho.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  ok('F0. Código (fora de comentários) não referencia mais _prazoDiasMaxOS (bug do teto da faixa removido)', !/_prazoDiasMaxOS/.test(trechoSemComentarios));

  function calcularDiaSugerido(o, hoje, dia) {
    const fn = new Function('o', 'hoje', 'dia', trecho + '\nreturn diaSugerido;');
    return fn(o, hoje, dia);
  }

  // 2026-08-17 é uma segunda-feira (confirmado: 16/08/2026 é domingo).
  const segunda = new Date(2026, 7, 17); // mês 0-indexed: agosto=7
  ok('Sanidade: 17/08/2026 é mesmo segunda-feira (getDay()===1)', segunda.getDay() === 1);

  // "5 a 7 dias úteis" a partir de segunda 17/08 → 5º dia útil = segunda-feira seguinte (24/08)
  // (17 conta como dia 0; útil 1=ter18, 2=qua19, 3=qui20, 4=sex21, 5=seg24 — pula sáb22/dom23)
  const r1 = calcularDiaSugerido({ prazoDias: '5', prazoDiasMax: '7' }, segunda, '17/08/2026');
  test('F1. "5 a 7 dias úteis" a partir de segunda 17/08 → sugere 24/08 (5º dia útil, NÃO o 7º=26/08)', r1, '24/08/2026');

  // "7 a 10 dias úteis" → 7º dia útil = quarta 26/08
  const r2 = calcularDiaSugerido({ prazoDias: '7', prazoDiasMax: '10' }, segunda, '17/08/2026');
  test('F2. "7 a 10 dias úteis" a partir de segunda 17/08 → sugere 26/08 (7º dia útil)', r2, '26/08/2026');

  // "3 dias úteis" (sem faixa, min=max) → 3º dia útil = quinta 20/08
  const r3 = calcularDiaSugerido({ prazoDias: '3', prazoDiasMax: '3' }, segunda, '17/08/2026');
  test('F3. "3 dias úteis" (sem faixa) a partir de segunda 17/08 → sugere 20/08 (3º dia útil)', r3, '20/08/2026');

  // Sem prazoDias informado → cai no fallback (data de hoje/criação da OS)
  const r4 = calcularDiaSugerido({ prazoDias: '', prazoDiasMax: '' }, segunda, '17/08/2026');
  test('F4. Sem prazoDias informado: cai no fallback (data de criação da OS)', r4, '17/08/2026');
}

// ══════════════════════════════════════════════════════════════════
// TESTE G — "R$X / unidade" removido do resumo global do orçamento
// ══════════════════════════════════════════════════════════════════
console.log('\n-- TESTE G: sem "R$X/unidade" no resumo do Orçamento Total --');
{
  ok('G1. Nenhuma ocorrência viva de "/unidade" fora de comentários explicativos', !/(?<!\/\/[^\n]*)\/\s*unidade/.test(html.replace(/\/\/[^\n]*/g, '')));
  const orcRecalcSrc = extractFn('orcRecalc');
  ok('G2. orcRecalc() sempre zera #orcUnitLbl (card principal) — nunca calcula "R$/unidade" médio do total', /if\(ul\) ul\.textContent = '';/.test(orcRecalcSrc));
  ok('G3. orcRecalc() sempre zera #orcUnitLbl3 (sidebar Step 3) — mesmo motivo', /if\(ul3\) ul3\.textContent = '';/.test(orcRecalcSrc));
  ok('G4. Preço unitário INDIVIDUAL de cada item continua existindo (não foi removido, só o "médio" do total)', /oi_unit_/.test(orcRecalcSrc));
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
