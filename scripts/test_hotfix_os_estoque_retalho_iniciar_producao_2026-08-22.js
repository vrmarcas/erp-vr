/**
 * test_hotfix_os_estoque_retalho_iniciar_producao_2026-08-22.js
 *
 * RODADA 9, BLOCOS B/C (2026-08-22) — bug bloqueador real: no Kanban,
 * "Iniciar Produção" abria o modal mas o campo Material/Cor não carregava
 * nada — impossível iniciar a produção.
 *
 * Causa raiz (duas partes, confirmadas lendo o código, não suposição):
 * 1) _kbOpenProdOverlay() tenta pré-selecionar o material por os.esp, mas
 *    esse campo NUNCA era escrito na criação da OS (orcEnvGerarOS) — a
 *    OS nunca herdava nada do orçamento/planificação, o operador sempre
 *    precisava reconstruir manualmente.
 *    Corrigido: orcEnvGerarOS() agora grava os.esp/os.matNomeBase quando a
 *    espessura da planificação efetiva é única e inequívoca.
 * 2) Falha real de carregamento do Estoque/Retalhos (permissão, rede) era
 *    só console.warn — o operador via só um dropdown vazio, indistinguível
 *    de "nada cadastrado".
 *    Corrigido: _STOCK_LOAD_ERROR/_CLOUD_WATCH_ERROR rastreiam falha real;
 *    _kbOpenProdOverlay() avisa explicitamente quando é o caso.
 *
 * BLOCO C — retalho deve ser priorizado sobre chapa nova, mas o ERP nunca
 * pode afirmar "retalho suficiente" para a OS inteira se ele só serve
 * para UMA peça da planificação. Novo: kbNecessidadesPecasOS() (peças
 * reais da planificação efetiva) + kbRetalhoCobertura() (cobertura total
 * vs parcial, com rotação 90°) — kbSugerirMaterial() só recomenda um
 * retalho como sugestão principal quando cobre TUDO.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * kbRetalhoCabeGeometricamente, kbNecessidadeDimsOS, kbNecessidadesPecasOS,
 * kbRetalhoCobertura, kbParseDimsWH, kbParseDimsArea, kbCalcAreaOS,
 * kbMargemSegurancaRetalhoCm, kbSugerirMaterial.
 *
 * Uso: node scripts/test_hotfix_os_estoque_retalho_iniciar_producao_2026-08-22.js
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
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

var FN_NAMES = ['kbRetalhoCabeGeometricamente', 'kbNecessidadeDimsOS', 'kbNecessidadesPecasOS', 'kbRetalhoCobertura', 'kbParseDimsWH', 'kbParseDimsArea', 'kbCalcAreaOS', 'kbMargemSegurancaRetalhoCm', 'kbSugerirMaterial'];
global.window = global;
global.cfgLoad = function () { return { producao: {} }; };
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_os_estoque_retalho_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 9, Blocos B/C — estoque + retalho ao Iniciar Produção ===\n');

// ── Geometria básica de retalho (casos pedidos explicitamente) ──────────────
test('1. retalho 100x50 para peça 80x40 (sem margem) — serve', mod.kbRetalhoCabeGeometricamente({ w: 80, h: 40 }, { w: 100, h: 50 }, 0), true);
test('2. retalho 45x85 para peça 80x40 (sem margem) — serve por rotação 90°', mod.kbRetalhoCabeGeometricamente({ w: 80, h: 40 }, { w: 45, h: 85 }, 0), true);
test('3. retalho 70x30 para peça 80x40 (sem margem) — não serve (nenhuma orientação cabe)', mod.kbRetalhoCabeGeometricamente({ w: 80, h: 40 }, { w: 70, h: 30 }, 0), false);
test('4. margem de segurança é aplicada — retalho 80x40 exato NÃO serve para peça 80x40 com 1cm de margem', mod.kbRetalhoCabeGeometricamente({ w: 80, h: 40 }, { w: 80, h: 40 }, 1), false);

// ── kbNecessidadesPecasOS: lê a planificação efetiva real (item.pieces) ─────
(function () {
  var os = { itens: [{ prod: 'Caixa', qty: '2', pieces: [
    { nome: 'Tampa', larg: 30, alt: 20, qty: 1 },
    { nome: 'Lateral', larg: 20, alt: 15, qty: 4 },
  ] }] };
  var nec = mod.kbNecessidadesPecasOS(os);
  test('5. kbNecessidadesPecasOS lê item.pieces (planificação efetiva) — 2 formas distintas', nec.length, 2);
  test('6. quantidade de cada peça é preservada (não colapsa em 1)', nec.map(function(n){return n.qty;}), [1, 4]);
})();

(function () {
  // Fallback: OS antiga sem pieces detalhadas, só dimensão única do item.
  var os = { itens: [{ prod: 'Placa', qty: '3', larg: 50, alt: 40 }] };
  var nec = mod.kbNecessidadesPecasOS(os);
  test('7. sem peças detalhadas: cai no fallback de dimensão única do item (sem regressão)', nec, [{ w: 50, h: 40, qty: 3 }]);
})();

test('8. múltiplos itens na OS: retorna null (sem dimensão segura, comportamento já estabelecido)', mod.kbNecessidadesPecasOS({ itens: [{ prod: 'A', larg: 10, alt: 10 }, { prod: 'B', larg: 20, alt: 20 }] }), null);

// ── kbRetalhoCobertura: cobertura total vs parcial (pedido explícito) ───────
(function () {
  // Tampa e Lateral: Tampa DOMINA Lateral em ambos os eixos (30>=20cm,
  // 20>=15cm) — qualquer retalho que caiba a Tampa também cabe a Lateral.
  // Porta: comprida e estreita (15×35) — não é dominada nem domina a
  // Tampa, então um retalho pode caber uma sem caber a outra (cenário
  // real de cobertura PARCIAL).
  var necessidades = [
    { w: 30, h: 20, qty: 1 }, // Tampa
    { w: 20, h: 15, qty: 4 }, // Lateral ×4
    { w: 15, h: 35, qty: 2 }, // Porta ×2 (comprida/estreita)
  ];
  // Retalho grande o bastante para a maior peça E para a área total.
  var cobTotal = mod.kbRetalhoCobertura(necessidades, { w: 90, h: 60 }, 0);
  assertTrue(cobTotal.total === true, '9. retalho grande o bastante (maior peça cabe + área total cabe) — cobertura TOTAL');
  test('10. cobertura total também reporta todas as peças como "cabíveis" individualmente', cobTotal.pecasQueCabem, cobTotal.totalPecas);

  // Retalho 32×22: cabe a Tampa (30×20) e a Lateral (20×15, dominada pela
  // Tampa), mas NÃO cabe a Porta (15×35 — nem 32≥15&22≥35 nem 32≥35&22≥15).
  var cobParcial = mod.kbRetalhoCobertura(necessidades, { w: 32, h: 22 }, 0);
  assertTrue(cobParcial.total === false, '11. retalho pequeno demais para a área total — NUNCA afirma cobertura total');
  test('12. cobertura parcial reporta corretamente quantas peças cabem (Tampa+Laterais=5, Porta fica de fora) — achado explícito do pedido', cobParcial.pecasQueCabem, 5);
  assertTrue(cobParcial.pecasQueCabem < cobParcial.totalPecas, '12b. cobertura parcial nunca é confundida com total (5 de 7 peças)');

  // Retalho que não cabe NENHUMA peça.
  var cobNenhuma = mod.kbRetalhoCobertura(necessidades, { w: 5, h: 5 }, 0);
  test('13. retalho minúsculo: nenhuma peça cabe', cobNenhuma.pecasQueCabem, 0);
  test('14. retalho minúsculo: cobertura total é false', cobNenhuma.total, false);
})();

// ── kbSugerirMaterial: nunca recomenda retalho parcial como sugestão principal ──
(function () {
  global.STOCK = { ac2: { label: 'Acrílico Cristal', esp: 2, qty: 10, chapLarg: 200, chapComp: 300 } };
  global.RETALHOS = [
    { mat: 'ac2', qty: 3, dims: '32x22', codigo: 'R-parcial' }, // só cobre a Tampa
    { mat: 'ac2', qty: 2, dims: '90x60', codigo: 'R-total' },   // cobre tudo
    { mat: 'outroMat', qty: 5, dims: '200x200', codigo: 'R-outro-material' },
  ];
  var os = { itens: [{ prod: 'Caixa', qty: '1', planArea: 0.18, pieces: [
    { nome: 'Tampa', larg: 30, alt: 20, qty: 1 },
    { nome: 'Lateral', larg: 20, alt: 15, qty: 4 },
  ] }] };
  var sug = mod.kbSugerirMaterial(os, 'ac2');
  assertTrue(!!(sug && sug.tipo === 'retalho' && sug.retalho.codigo === 'R-total'), '15. sugestão automática escolhe o retalho de cobertura TOTAL (R-total), nunca o parcial (R-parcial)');
  assertTrue(!!(sug && /toda a planificação/.test(sug.texto)), '16. texto da sugestão afirma explicitamente cobertura total quando é o caso');
})();

(function () {
  // Nenhum retalho cobre tudo — só um parcial disponível. A sugestão
  // automática NÃO pode recomendar o parcial como "a solução" — cai para
  // chapa nova.
  global.STOCK = { ac2: { label: 'Acrílico Cristal', esp: 2, qty: 10, chapLarg: 200, chapComp: 300 } };
  global.RETALHOS = [ { mat: 'ac2', qty: 3, dims: '32x22', codigo: 'R-parcial' } ];
  var os = { itens: [{ prod: 'Caixa', qty: '1', planArea: 0.18, pieces: [
    { nome: 'Tampa', larg: 30, alt: 20, qty: 1 },
    { nome: 'Lateral', larg: 20, alt: 15, qty: 4 },
  ] }] };
  var sug = mod.kbSugerirMaterial(os, 'ac2');
  assertTrue(!!(sug && sug.tipo === 'chapa'), '17. sem retalho de cobertura total: sugestão automática cai para chapa nova, nunca afirma "retalho suficiente" para um parcial');
})();

// ── Material/espessura diferentes — nunca compatível ─────────────────────────
(function () {
  global.STOCK = { ac2: { label: 'Acrílico Cristal', esp: 2, qty: 10, chapLarg: 200, chapComp: 300 } };
  global.RETALHOS = [ { mat: 'ac3_outraEsp', qty: 5, dims: '200x200', codigo: 'R-esp-errada' } ];
  var os = { itens: [{ prod: 'Placa', qty: '1', larg: 50, alt: 40 }] };
  var sug = mod.kbSugerirMaterial(os, 'ac2');
  assertTrue(!sug || sug.tipo !== 'retalho', '18. retalho de material/chave diferente (mesmo com dimensões enormes) NUNCA é sugerido');
})();

(function () {
  // Retalho indisponível (qty<=0) nunca é considerado.
  global.STOCK = { ac2: { label: 'Acrílico Cristal', esp: 2, qty: 10, chapLarg: 200, chapComp: 300 } };
  global.RETALHOS = [ { mat: 'ac2', qty: 0, dims: '200x200', codigo: 'R-indisponivel' } ];
  var os = { itens: [{ prod: 'Placa', qty: '1', larg: 50, alt: 40 }] };
  var sug = mod.kbSugerirMaterial(os, 'ac2');
  assertTrue(!sug || sug.tipo !== 'retalho', '19. retalho com qty=0 (indisponível) nunca é sugerido, mesmo sendo geometricamente compatível');
})();

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
