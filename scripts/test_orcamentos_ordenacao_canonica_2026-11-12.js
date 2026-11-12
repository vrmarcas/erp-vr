/**
 * test_orcamentos_ordenacao_canonica_2026-11-12.js
 *
 * ACHADO REAL (smoke de produção pós-deploy, 2026-11-12) — usuário
 * reportou: "'Orçamentos Enviados' está aparecendo em ordem aparentemente
 * aleatória... orçamentos recentes e antigos aparecem misturados."
 *
 * CAUSA RAIZ: nenhum ponto do pipeline (orcV2MergeComLegado/orcGetEnviados/
 * orcEnviadosRender) jamais ordenava a lista. Para ids migrados, a ordem
 * era a do array legado; para orçamentos v2-only, a ordem era a BRUTA do
 * snapshot do Firestore (erp_vr_orcamentos.onSnapshot SEM orderBy — nunca
 * garantida, pode mudar entre snapshots).
 *
 * Corrigido: orcGetEnviados() (ponto único de leitura, já documentado
 * como tal) agora ordena por `num` (reservado atomicamente, nunca
 * reatribuído) decrescente — mais recente primeiro — com fallback por
 * dataSalvo (resolução de minuto) só quando num está ausente/não
 * numérico.
 *
 * Testa as funções REAIS extraídas de index.html (_orcEnvChaveOrdenacao,
 * orcEnvOrdenarCanonico, orcGetEnviados, orcEnvNormalizar,
 * orcEnvParseDataSalvo, orcV2MergeComLegado, _isTestRecord) — nunca
 * reimplementadas.
 *
 * Uso: node scripts/test_orcamentos_ordenacao_canonica_2026-11-12.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — ' + name);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

var temOrdenacao = html.indexOf('function orcEnvOrdenarCanonico(') >= 0;
var fnMerge = extractFn('orcV2MergeComLegado');
var fnGetEnviados = extractFn('orcGetEnviados');
var fnNormalizar = extractFn('orcEnvNormalizar');
var fnParseData = extractFn('orcEnvParseDataSalvo');
var fnChaveOrd = temOrdenacao ? extractFn('_orcEnvChaveOrdenacao') : '';
var fnOrdenarCanonico = temOrdenacao ? extractFn('orcEnvOrdenarCanonico') : '';

var src = [
  "function _isTestRecord(o){ return false; }",
  fnNormalizar, fnParseData, fnChaveOrd, fnOrdenarCanonico,
  fnMerge, fnGetEnviados,
  'module.exports = {',
  '  rodar: function (legadoArr, v2PorId) {',
  '    _ORC_LEGADO_CACHE = legadoArr;',
  '    _ORC_V2_CACHE = v2PorId;',
  '    _ORC_ENVIADOS_DATA = orcV2MergeComLegado(_ORC_LEGADO_CACHE, _ORC_V2_CACHE);',
  '    return orcGetEnviados();',
  '  },',
  '};',
].join('\n\n');

var modPath = path.join(__dirname, '_test_ordenacao_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
global._ORC_LEGADO_CACHE = [];
global._ORC_V2_CACHE = {};
global._ORC_ENVIADOS_DATA = [];
var mod = require(modPath);
try { fs.unlinkSync(modPath); } catch (e) {}

let passed = 0, failed = 0;
function ok(desc, cond, extra) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc + (extra ? ' — ' + extra : '')); failed++; } }
function nums(lista) { return lista.map(function (o) { return o.num; }); }

console.log('\n=== "Orçamentos Enviados" em ordem canônica — mais recente primeiro (achado real 2026-11-12) ===\n');
console.log('Versão de index.html ' + (temOrdenacao ? 'COM' : 'SEM') + ' ordenação canônica (orcEnvOrdenarCanonico).\n');

// A. Caso real: orçamentos v2-only chegando numa ordem de snapshot
// Firestore ARBITRÁRIA (nunca garantida sem orderBy) — aqui simulada
// deliberadamente fora de ordem cronológica, exatamente como o usuário
// reportou ("recentes e antigos misturados").
var v2PorId = {
  'ORC-000050': { id: 'ORC-000050', num: '000050', cliente: 'A', dataSalvo: '01/11/2026 09:00', valorFinal: 10 },
  'ORC-000120': { id: 'ORC-000120', num: '000120', cliente: 'B', dataSalvo: '10/11/2026 09:00', valorFinal: 10 },
  'ORC-000080': { id: 'ORC-000080', num: '000080', cliente: 'C', dataSalvo: '05/11/2026 09:00', valorFinal: 10 },
};
var r1 = mod.rodar([], v2PorId);
ok('A. mais recente primeiro — ORC-000120 (mais novo) aparece ANTES de ORC-000080 e ORC-000050', nums(r1)[0] === '000120', 'obtido=' + JSON.stringify(nums(r1)));
ok('A2. ordem totalmente decrescente por num, não a ordem de chegada do objeto v2PorId', JSON.stringify(nums(r1)) === JSON.stringify(['000120', '000080', '000050']), 'obtido=' + JSON.stringify(nums(r1)));

// B. Legado (ids antigos, ordem de array já migrada) + v2 novo — merge
// não pode embaralhar a ordem cronológica correta.
var legado = [
  { id: 'ORC-000005', num: '000005', cliente: 'Antigo 1', dataSalvo: '01/01/2026 08:00' },
  { id: 'ORC-000003', num: '000003', cliente: 'Antigo 2', dataSalvo: '01/01/2026 07:00' },
];
var v2Novo = {
  'ORC-000200': { id: 'ORC-000200', num: '000200', cliente: 'Novo', dataSalvo: '12/11/2026 10:00' },
};
var r2 = mod.rodar(legado, v2Novo);
ok('B. orçamento recém-criado (v2-only, maior num) aparece no topo, acima de todo o legado', nums(r2)[0] === '000200', 'obtido=' + JSON.stringify(nums(r2)));
ok('B2. entre os dois antigos do legado, o de num MAIOR (000005) continua antes do de num menor (000003)', nums(r2).indexOf('000005') < nums(r2).indexOf('000003'), 'obtido=' + JSON.stringify(nums(r2)));

// C. Reload com os MESMOS dados (nenhuma mudança) produz a MESMA ordem —
// determinístico, nunca depende de ordem de iteração de objeto/listener.
var r3a = mod.rodar([], v2PorId);
var r3b = mod.rodar([], v2PorId);
ok('C. duas chamadas sucessivas com os mesmos dados produzem EXATAMENTE a mesma ordem (reload estável)', JSON.stringify(nums(r3a)) === JSON.stringify(nums(r3b)), 'r3a=' + JSON.stringify(nums(r3a)) + ' r3b=' + JSON.stringify(nums(r3b)));

// D. Listener em tempo real entregando o MESMO conjunto em ordem de
// objeto diferente (simulando uma atualização incremental do snapshot)
// nunca pode mudar a ordem final renderizada.
var v2PorIdOutraOrdem = {
  'ORC-000080': v2PorId['ORC-000080'],
  'ORC-000050': v2PorId['ORC-000050'],
  'ORC-000120': v2PorId['ORC-000120'],
};
var r4 = mod.rodar([], v2PorIdOutraOrdem);
ok('D. listener entregando o snapshot com ordem de chaves diferente não embaralha a renderização', JSON.stringify(nums(r4)) === JSON.stringify(nums(r1)), 'obtido=' + JSON.stringify(nums(r4)));

// E. Merge legado + v2 preserva a ordem canônica mesmo quando o MESMO id
// existe nos dois lados (v2 sempre vence o conteúdo, mas a posição segue
// a chave de ordenação canônica, nunca a posição no array legado).
var legadoComMigrado = [
  { id: 'ORC-000010', num: '000010', cliente: 'Migrado antigo', dataSalvo: '01/01/2026 08:00' },
];
var v2Migrado = {
  'ORC-000010': { id: 'ORC-000010', num: '000010', cliente: 'Migrado antigo (v2)', dataSalvo: '01/01/2026 08:00' },
  'ORC-000300': { id: 'ORC-000300', num: '000300', cliente: 'Muito mais novo', dataSalvo: '12/11/2026 11:00' },
};
var r5 = mod.rodar(legadoComMigrado, v2Migrado);
ok('E. merge legado+v2 (mesmo id dos dois lados) continua ordenando por num — o mais novo primeiro', nums(r5)[0] === '000300', 'obtido=' + JSON.stringify(nums(r5)));

// F. Datas em dias/meses DIFERENTES ordenam corretamente (não é só
// coincidência de testar tudo em novembro).
var v2MesesDiferentes = {
  'ORC-000001': { id: 'ORC-000001', num: '000001', cliente: 'Jan', dataSalvo: '15/01/2026 10:00' },
  'ORC-000400': { id: 'ORC-000400', num: '000400', cliente: 'Dez (futuro)', dataSalvo: '20/12/2026 10:00' },
  'ORC-000150': { id: 'ORC-000150', num: '000150', cliente: 'Jun', dataSalvo: '10/06/2026 10:00' },
};
var r6 = mod.rodar([], v2MesesDiferentes);
ok('F. ordena corretamente por num independente do mês/dia de dataSalvo', JSON.stringify(nums(r6)) === JSON.stringify(['000400', '000150', '000001']), 'obtido=' + JSON.stringify(nums(r6)));

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (!temOrdenacao) {
  console.log('(Esperado falhar nesta versão — rode novamente após o fix para confirmar que passa.)\n');
}
process.exit(failed > 0 ? 1 : 0);
