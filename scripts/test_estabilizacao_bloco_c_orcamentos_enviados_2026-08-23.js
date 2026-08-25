/**
 * test_estabilizacao_bloco_c_orcamentos_enviados_2026-08-23.js
 *
 * RODADA DE ESTABILIZAÇÃO (2026-08-23) — Bloco C.
 *
 * BUG relatado: tela "Orçamentos Enviados" mostra "Nenhum orçamento
 * encontrado." mesmo havendo vários orçamentos reais salvos; busca também
 * não funciona.
 *
 * Auditoria (sem alterar nenhuma linha até confirmar): _ORC_ENVIADOS_DATA
 * é populada pela MESMA chave/coleção ("orcamentos", erp_vr) que
 * _orcSalvarOrcamentoImpl() grava — nenhum mismatch de schema/campo
 * encontrado entre save e read; nenhum filtro é pré-aplicado sem ação do
 * usuário. O ponto concreto e confirmado de falha silenciosa:
 * _cloudWatch('orcamentos', ...) já seta _CLOUD_WATCH_ERROR['orcamentos']
 * = true em erro de permissão/rede (onSnapshot), mas essa flag nunca era
 * consultada por orcEnviadosRender() — uma falha de leitura ficava
 * indistinguível de "não há orçamentos". Corrigido consultando a MESMA
 * flag já usada pelo padrão de Estoque/Retalhos (Rodada 9, Bloco B,
 * _kbOpenProdOverlay) — nunca uma segunda fonte de verdade, só a leitura
 * de um sinal que já existia e era ignorado. Busca também passou a usar
 * vitreOrcNormalizarTexto() (já existente, reaproveitada — nunca uma
 * segunda normalização) para tolerar acento/caixa.
 *
 * Função sob teste extraída de index.html (nunca reimplementada):
 * orcEnviadosRender, vitreOrcNormalizarTexto, orcEnvParseDataSalvo,
 * orcEnvFiltroMesPopular (stubada — popula um <select>, não relacionada
 * ao bug).
 *
 * Uso: node scripts/test_estabilizacao_bloco_c_orcamentos_enviados_2026-08-23.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
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

console.log('\n=== RODADA DE ESTABILIZAÇÃO — Bloco C (Orçamentos Enviados vazio/busca quebrada) ===\n');

var FN_NAMES = ['orcEnviadosRender', 'vitreOrcNormalizarTexto', 'orcEnvParseDataSalvo'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_estabilizacao_bloco_c.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(props) { return Object.assign({ value: '', textContent: '', innerHTML: '', checked: false, style: {}, dataset: {} }, props || {}); }

var ORCAMENTOS_REAIS = [
  { id: 'ORC-1', num: '000057', cliente: 'Cliente SEBRAE', produto: 'Troféu', marca: 'vr', valorFinal: 806.84, valorBase: 806.84, status: 'aguardando', dataSalvo: '23/08/2026 10:00', nfSolicitada: false },
  { id: 'ORC-2', num: '000058', cliente: 'João da Conceição', produto: 'Placa', marca: 'vr', valorFinal: 150, valorBase: 150, status: 'aprovado', dataSalvo: '23/08/2026 11:00', nfSolicitada: true },
];

var _els, _cloudWatchError;
function reset() {
  _els = {
    orcEnvBody: makeEl(), orcEnvTotal: makeEl(),
    orcEnvSearch: makeEl({ value: '' }), orcEnvFiltroStatus: makeEl({ value: '' }),
    orcEnvFiltroNF: makeEl({ value: '' }), orcEnvFiltroDataDe: makeEl({ value: '' }), orcEnvFiltroDataAte: makeEl({ value: '' }),
  };
  global.document = { getElementById: function (id) { return _els[id] || null; } };
  global.orcGetEnviados = function () { return ORCAMENTOS_REAIS.slice(); };
  global.orcEnvFiltroMesPopular = function () {};
  // Estilo visual de cada linha — não relacionado ao bug de listagem/busca.
  global.orcStatusCor = function () { return '#999999'; };
  global.orcStatusLabel = function (s) { return s || ''; };
  _cloudWatchError = {};
  global._CLOUD_WATCH_ERROR = _cloudWatchError;
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// 1-2 — caso base: sem filtros, sem erro de nuvem → lista TODOS os orçamentos reais
reset();
mod.orcEnviadosRender();
assertTrue(_els.orcEnvBody.innerHTML.indexOf('Nenhum orçamento encontrado') < 0, '1. sem filtros e sem erro de nuvem: NUNCA mostra "Nenhum orçamento encontrado" havendo orçamentos reais — reprodução do bug relatado corrigida');
assertTrue(_els.orcEnvTotal.textContent === '2 orçamento(s)', '2. contador mostra os 2 orçamentos reais existentes');

// 3-4 — Bloco C, achado real: _CLOUD_WATCH_ERROR['orcamentos']=true (permissão/rede)
// precisa avisar claramente, nunca mostrar "Nenhum orçamento encontrado" como se fosse ausência de dados
reset();
_cloudWatchError['orcamentos'] = true;
mod.orcEnviadosRender();
assertTrue(_els.orcEnvBody.innerHTML.indexOf('Nenhum orçamento encontrado') < 0, '3. com falha de leitura sinalizada (_CLOUD_WATCH_ERROR): NUNCA mostra a mensagem de "não há orçamentos" (mensagem enganosa)');
assertTrue(/n.o foi poss.vel carregar/i.test(_els.orcEnvBody.innerHTML), '4. mostra uma mensagem de ERRO explícita e específica sobre falha de carregamento — mesmo padrão já usado para Estoque/Retalhos');

// 5 — quando o erro desaparece (reconectou), a tela volta a mostrar os dados normalmente
reset();
_cloudWatchError['orcamentos'] = false;
mod.orcEnviadosRender();
assertTrue(_els.orcEnvTotal.textContent === '2 orçamento(s)', '5. flag de erro false (nuvem OK) — lista volta a aparecer normalmente, nenhuma regressão introduzida pelo novo check');

// 6-10 — Busca tolerante a acento/caixa
reset();
_els.orcEnvSearch.value = 'sebrae';
mod.orcEnviadosRender();
assertTrue(_els.orcEnvTotal.textContent === '1 orçamento(s)', '6. busca por nome em minúsculas encontra "Cliente SEBRAE" (caixa alta no registro)');

reset();
_els.orcEnvSearch.value = 'CONCEICAO'; // sem acento, cliente real tem "Conceição"
mod.orcEnviadosRender();
assertTrue(_els.orcEnvTotal.textContent === '1 orçamento(s)', '7. busca SEM acento ("CONCEICAO") encontra cliente cadastrado COM acento ("Conceição") — tolerância de acento pedida explicitamente');

reset();
_els.orcEnvSearch.value = '000057';
mod.orcEnviadosRender();
assertTrue(_els.orcEnvTotal.textContent === '1 orçamento(s)', '8. busca por número do orçamento (com zeros à esquerda) funciona');

reset();
_els.orcEnvSearch.value = 'inexistente-xyz';
mod.orcEnviadosRender();
assertTrue(_els.orcEnvBody.innerHTML.indexOf('Nenhum orçamento encontrado') >= 0, '9. busca sem nenhum resultado real mostra a mensagem correta de "não encontrado" (comportamento esperado, não um erro)');

reset();
_els.orcEnvSearch.value = '';
mod.orcEnviadosRender();
assertTrue(_els.orcEnvTotal.textContent === '2 orçamento(s)', '10. campo de busca vazio: lista completa volta (nenhum filtro residual)');

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
