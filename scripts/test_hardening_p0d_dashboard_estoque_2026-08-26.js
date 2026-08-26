/**
 * test_hardening_p0d_dashboard_estoque_2026-08-26.js
 *
 * RODADA DE HARDENING 10/10 — FASE 1 — P0-D: Dashboard podia mostrar falso
 * "Estoque OK" quando o perfil não tem permissão para ler estoque.
 *
 * AUDITORIA CONFIRMADA: o KPI "Estoque crítico" do Dashboard lia STOCK
 * direto e calculava `dashCalcularEstoqueCritico(STOCK).itens.length`.
 * `firestore.rules` só concede leitura de `stock` a `isProducao()`
 * (master/produção) — Comercial e Financeiro sempre recebem
 * permission-denied em silêncio, e STOCK fica `{}` para sempre para esses
 * perfis. O KPI não distinguia isso de "0 materiais críticos de verdade"
 * — ERRO DE PERMISSÃO ≠ ESTOQUE ZERO. Um usuário Financeiro via sempre
 * "✅ Todos os materiais OK", uma informação falsa sobre um dado que ele
 * nem tem acesso para conferir.
 *
 * CORRIGIDO (index.html, dentro de dashRender()) sem abrir a Rule de
 * stock para mais perfis (isso vazaria dado de estoque para quem não deve
 * ver — regra inegociável 8 da rodada: "não resolver problema de
 * permissão abrindo acesso amplo"): o KPI agora distingue 4 estados —
 * sem acesso (Comercial/Financeiro) / carregando (ainda não confirmado
 * pelo servidor) / falha de leitura / dado real — usando os mesmos sinais
 * já corrigidos no P0 de leitura da rodada anterior
 * (_stockServerConfirmed/_STOCK_LOAD_ERROR). O mesmo problema existia
 * duplicado na linha "🧱 Materiais críticos" do painel "Central de Ação →
 * Hoje" (mesmo cálculo, segunda renderização) — corrigido junto.
 *
 * Este teste extrai o BLOCO de código real de dentro de dashRender()
 * (entre os marcadores de comentário "KPI 4" e "KPI 5", nunca
 * reimplementado) — dashRender() inteira não é isolável para teste
 * unitário (função enorme, dezenas de dependências de DOM de todo o
 * Dashboard), mas este bloco específico só depende de _currentSession/
 * _stockServerConfirmed/_STOCK_LOAD_ERROR/STOCK/dashCalcularEstoqueCritico
 * e escreve em 3 elementos — testável isoladamente sem reimplementar nada.
 *
 * Uso: node "scripts/test_hardening_p0d_dashboard_estoque_2026-08-26.js"
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
function extractBlock(startMarker, endMarker) {
  var start = html.indexOf(startMarker);
  if (start < 0) throw new Error('Marcador inicial não encontrado: ' + startMarker);
  var end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error('Marcador final não encontrado: ' + endMarker);
  return html.slice(start, end);
}

console.log('\n=== HARDENING P0-D — Dashboard: falso "Estoque OK" sem permissão ===\n');

var kpi4Block = extractBlock(
  '// ── KPI 4: Estoque crítico ───────────────────────────────────────────────',
  '// ── KPI 5: Despesas do mês (FIN_CP) ────────────────────────────────────'
);
var dashCalcularEstoqueCriticoSrc = extractFn('dashCalcularEstoqueCritico');
var src = dashCalcularEstoqueCriticoSrc + '\n\nfunction _kpi4(){\n' + kpi4Block + '\n}\nmodule.exports = { _kpi4: _kpi4 };';
var modPath = path.join(__dirname, '_hardening_p0d_dashboard.tmp.js');
fs.writeFileSync(modPath, src);

var _els;
function makeEl(props) { return Object.assign({ textContent: '', style: {} }, props || {}); }
function reset(opts) {
  opts = opts || {};
  _els = { dkEstq: makeEl(), dkEstqSub: makeEl(), dkEstqBar: makeEl({ style: {} }) };
  global.document = { getElementById: function (id) { return _els[id] || null; } };
  global.window = global;
  global._currentSession = { funcao: opts.funcao || 'master' };
  global._stockServerConfirmed = !!opts.confirmado;
  global._STOCK_LOAD_ERROR = !!opts.erro;
  global.STOCK = opts.stock || {};
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// 1-3 — ACHADO REAL: Financeiro (sem permissão de ler stock) NUNCA mostra
// "Todos os materiais OK" — mesmo com STOCK={} (o estado real de
// permission-denied para esse perfil).
reset({ funcao: 'financeiro', confirmado: false, erro: false, stock: {} });
mod._kpi4();
assertTrue(_els.dkEstqSub.textContent === 'Sem acesso a este dado para seu perfil', '1. ACHADO REAL: perfil Financeiro nunca mais vê "Todos os materiais OK" — vê explicitamente que não tem acesso a este dado');
assertTrue(_els.dkEstq.textContent === '—', '2. Valor do KPI mostra "—" (nunca um "0" que parece positivo) para quem não tem permissão');

reset({ funcao: 'comercial', confirmado: false, erro: false, stock: {} });
mod._kpi4();
assertTrue(_els.dkEstqSub.textContent === 'Sem acesso a este dado para seu perfil', '3. Mesmo comportamento para Comercial (mesma Rule, mesmo perfil sem acesso a stock)');

// 4-5 — Master/Produção com dado ainda não confirmado pelo servidor
// (mesma corrida do P0 original) → estado de carregando, nunca "0 crítico".
reset({ funcao: 'producao', confirmado: false, erro: false, stock: {} });
mod._kpi4();
assertTrue(_els.dkEstqSub.textContent === 'Carregando estoque…', '4. Produção com dado ainda não confirmado: mostra "Carregando…", nunca finge que o estoque está OK');
reset({ funcao: 'master', confirmado: false, erro: false, stock: {} });
mod._kpi4();
assertTrue(_els.dkEstqSub.textContent === 'Carregando estoque…', '5. Master com dado ainda não confirmado: mesmo comportamento correto');

// 6 — falha real de leitura (mesmo para quem TEM permissão) → estado de
// erro explícito, nunca "0 crítico".
reset({ funcao: 'master', confirmado: false, erro: true, stock: {} });
mod._kpi4();
assertTrue(_els.dkEstqSub.textContent === 'Falha ao carregar estoque', '6. Falha real de leitura (mesmo com permissão): mostra erro explícito, nunca "Todos os materiais OK"');

// 7-8 — caso feliz: Master/Produção com dado confirmado — comportamento
// original preservado, sem regressão.
reset({ funcao: 'master', confirmado: true, erro: false, stock: { m1: { qty: 10, min: 2 }, m2: { qty: 1, min: 5, label: 'Acrílico Preto 3mm' } } });
mod._kpi4();
assertTrue(_els.dkEstq.textContent === 1 && _els.dkEstqSub.textContent.indexOf('Acrílico') >= 0, '7. Master com dado real confirmado: mostra a contagem real de materiais críticos (comportamento original preservado)');
reset({ funcao: 'producao', confirmado: true, erro: false, stock: { m1: { qty: 10, min: 2 } } });
mod._kpi4();
assertTrue(_els.dkEstqSub.textContent === 'Todos os materiais OK', '8. Produção com dado real confirmado e genuinamente sem crítico: "Todos os materiais OK" continua aparecendo — só quando é verdade');

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
