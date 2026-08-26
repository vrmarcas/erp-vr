/**
 * test_certificacao_fase3_ticket_medio_forbidden_2026-08-26.js
 *
 * CERTIFICAÇÃO OPERACIONAL 10/10 — FASE 3, achado 2.3 da auditoria de
 * Roles e Permissões (Certificação 2).
 *
 * ACHADO REAL: a Rule de 'fin_tx' nunca concede leitura ao perfil
 * Comercial (só Financeiro/Master, ver firestore.rules). Antes desta
 * correção, o card "Ticket Médio VR/Vitre" do Dashboard Comercial
 * (comercialRender()) lia FIN_TX sem checar isso — permission-denied
 * deixava FIN_TX=[] para sempre, e o card mostrava "R$ 0" incondicional,
 * uma métrica sempre ERRADA e nunca sinalizada como indisponível
 * (indistinguível de "nenhuma venda ainda", exatamente a classe de bug
 * já eliminada em outras telas na Fase 2, Bloco R).
 *
 * Corrigido reutilizando o sinal genérico já existente
 * _CLOUD_WATCH_FORBIDDEN['fin_tx'] (preenchido pelo próprio _cloudWatch()
 * em caso de permission-denied) — o card agora mostra "—" honesto em vez
 * de um zero fabricado.
 *
 * Função sob teste extraída de index.html (nunca reimplementada):
 * comercialRender.
 *
 * Uso: node "scripts/test_certificacao_fase3_ticket_medio_forbidden_2026-08-26.js"
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

console.log('\n=== CERTIFICAÇÃO FASE 3 — Ticket Médio honesto para Comercial sem acesso a fin_tx ===\n');

var FN_NAMES = ['setEl', 'comercialRender'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {comercialRender: comercialRender};';
var modPath = path.join(__dirname, '_certificacao_fase3_comercialrender.tmp.js');
fs.writeFileSync(modPath, src);

var _els;
function makeEl() { return { textContent: '', style: {}, innerHTML: '' }; }
function reset(opts) {
  opts = opts || {};
  _els = {};
  ['comFunnel', 'comFunnelSub', 'comCvrPct', 'comTotalLeads', 'comCvrBar',
   'comTkVR', 'comTkVit', 'comTkVRBar', 'comTkVitBar', 'comPerdas',
   'comEnvCount', 'comEnvAguard', 'comEnvAprov', 'comEnvRecus',
   'comEnvCountR', 'comEnvAguardR', 'comEnvAprovR', 'comEnvRecusR',
   'comOsVR', 'comOsVit', 'comOsSub', 'comPrazoMedio', 'comPrazoSub', 'comPrazoBar'
  ].forEach(function (id) { _els[id] = makeEl(); });
  global.document = { getElementById: function (id) { return _els[id] || null; } };
  global._comBrand = 'all';
  global.CRM_LEADS = {};
  global._isTestRecord = function () { return false; };
  global.FIN_TX = opts.finTx || [];
  global._CLOUD_WATCH_FORBIDDEN = { fin_tx: !!opts.forbidden };
  global.orcGetEnviados = function () { return []; };
  global.orcEnvNormalizar = function (o) { return o; };
  global.KB_OS = {};
  global.finFmt = function (v) { return 'R$' + v; };
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// 1-2 — Comercial sem acesso a fin_tx (achado real): "—" honesto, nunca "R$ 0".
reset({ forbidden: true, finTx: [] });
mod.comercialRender();
assertTrue(_els.comTkVR.textContent === '—', '1. ACHADO REAL corrigido: sem acesso a fin_tx, Ticket Médio VR mostra "—" honesto, nunca "R$ 0" fabricado');
assertTrue(_els.comTkVit.textContent === '—', '2. mesmo tratamento para Ticket Médio Vitre');

// 3 — barras zeradas quando sem acesso (nenhum cálculo com array vazio disfarçado de "zero real").
reset({ forbidden: true, finTx: [] });
mod.comercialRender();
assertTrue(_els.comTkVRBar.style.width === '0%' && _els.comTkVitBar.style.width === '0%', '3. barras dos KPIs ficam em 0% quando sem acesso — nenhuma barra fantasma');

// 4-5 — caminho feliz preservado: com acesso e dados reais, calcula o ticket médio normalmente.
reset({
  forbidden: false,
  finTx: [
    { marca: 'vr', status: 'recebido', valor: 100 },
    { marca: 'vr', status: 'recebido', valor: 200 },
    { marca: 'vit', status: 'recebido', valor: 50 },
  ]
});
mod.comercialRender();
assertTrue(_els.comTkVR.textContent === 'R$ 150', '4. caminho feliz preservado: com acesso, Ticket Médio VR calcula a média real (100+200)/2=150 — nenhuma regressão de comportamento');
assertTrue(_els.comTkVit.textContent === 'R$ 50', '5. Ticket Médio Vitre calculado normalmente com acesso');

// 6 — sem acesso E sem forbidden (nunca respondeu ainda / genuinamente vazio): mantém "R$ 0" (não é o cenário do achado — aqui não há permission-denied, é dado real vazio).
reset({ forbidden: false, finTx: [] });
mod.comercialRender();
assertTrue(_els.comTkVR.textContent === 'R$ 0', '6. sem forbidden e sem transações reais: mantém "R$ 0" — isto é dado genuinamente vazio, não um permission-denied disfarçado');

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
