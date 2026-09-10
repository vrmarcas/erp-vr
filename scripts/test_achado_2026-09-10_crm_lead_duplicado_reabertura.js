/**
 * test_achado_2026-09-10_crm_lead_duplicado_reabertura.js
 *
 * ACHADO ADICIONAL (auditoria read-only, RODADA DE CORREÇÃO 2026-09-10) —
 * durante a limpeza de dados TESTE desta rodada, encontrei 4 cards
 * duplicados no CRM (orc_103..orc_106) todos apontando para o MESMO
 * orçamento (ORC-000123, "AUDITORIA TESTE Bloco1e8"). Investigação por
 * leitura de código (index.html) confirma a causa raiz:
 *
 * `_orcSalvarOrcamentoImpl()` constrói um objeto `orc` NOVO a cada save
 * (~linha 28674) e esse literal NUNCA copia `orcExistente.crmLeadId` —
 * só copia id/status/obs de orcExistente. `crmUpsertLeadPorOrcamento()`
 * (linha ~13892) decide se cria um card novo ou atualiza um existente
 * checando `orc.crmLeadId` — como esse campo sempre chega undefined num
 * orçamento reaberto e salvo de novo, TODA reedição de um orçamento já
 * salvo cria um card NOVO no CRM em vez de atualizar o card existente.
 *
 * O comentário no próprio código (linha ~28804-28807) descreve a
 * intenção correta ("cria 1 vez, grava orc.crmLeadId, e nas próximas
 * chamadas SEMPRE atualiza o MESMO card") — o bug é que essa intenção
 * nunca foi implementada no lado da LEITURA (construção do objeto `orc`),
 * só no lado da ESCRITA (orcSetEnviados após o upsert).
 *
 * NÃO CORRIGIDO NESTA RODADA — fora do escopo autorizado (Blocos 4/5/6).
 * Reportado como achado novo, com teste que comprova o bug reproduzível
 * na função real crmUpsertLeadPorOrcamento() (extraída ao vivo de
 * index.html).
 *
 * Uso: node scripts/test_achado_2026-09-10_crm_lead_duplicado_reabertura.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}

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

console.log('\n=== ACHADO 2026-09-10 — CRM cria card duplicado a cada reedição do mesmo orçamento ===\n');
console.log('(NÃO CORRIGIDO — fora do escopo desta rodada; teste documenta o bug para uma rodada futura)\n');

var src = [
  'var CRM_LEADS = {};',
  'var crmLeadIdCounter = 100;',
  'function _isTestRecord(){ return false; }',
  'function crmSaveLeads(){}',
  'function crmSetBrand(){}',
  'function orcFmt(v){ return (v||0).toFixed(2); }',
  extractFn('crmUpsertLeadPorOrcamento'),
  'module.exports = { crmUpsertLeadPorOrcamento: crmUpsertLeadPorOrcamento, getLeads: function(){ return CRM_LEADS; } };'
].join('\n\n');
var modPath = path.join(__dirname, '_achado_2026-09-10_crm_dup_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

test('ACHADO — reabrir e salvar o MESMO orçamento 3x cria 3 cards diferentes no CRM (deveria atualizar 1 só)', function () {
  // Reproduz fielmente o que _orcSalvarOrcamentoImpl() faz hoje: o objeto
  // `orc` de cada save é construído do zero e NUNCA inclui crmLeadId
  // (confirmado por leitura de código — ver cabeçalho deste arquivo).
  var orcSave1 = { id: 'ORC-000999', cliente: 'Cliente Reaberto', marca: 'vr', produto: 'Caixa', tel: '11900000009', valorFinal: 100 };
  var orcSave2 = { id: 'ORC-000999', cliente: 'Cliente Reaberto', marca: 'vr', produto: 'Caixa', tel: '11900000009', valorFinal: 105 }; // mesmo orçamento, editado
  var orcSave3 = { id: 'ORC-000999', cliente: 'Cliente Reaberto', marca: 'vr', produto: 'Caixa', tel: '11900000009', valorFinal: 110 };

  mod.crmUpsertLeadPorOrcamento(orcSave1, 999);
  mod.crmUpsertLeadPorOrcamento(orcSave2, 999);
  mod.crmUpsertLeadPorOrcamento(orcSave3, 999);

  var cardsDesteOrcamento = Object.values(mod.getLeads()).filter(function (l) { return l.orcamentoId === 'ORC-000999'; });
  // BUG confirmado: 3 cards em vez de 1. Quando corrigido (orc.crmLeadId
  // copiado de orcExistente.crmLeadId a cada save), este teste passará a
  // esperar length===1 — deixado como length===3 propositalmente para
  // documentar o comportamento ATUAL, não o desejado.
  assertEq(cardsDesteOrcamento.length, 3, 'ACHADO CONFIRMADO: 3 saves do mesmo ORC-000999 geraram ' + cardsDesteOrcamento.length + ' card(s) no CRM em vez de 1 — cada reedição duplica o card');
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
console.log('\nEste teste documenta um achado, não uma correção — "passar" aqui confirma que o bug');
console.log('ainda existe (length===3). Quando a rodada de correção for autorizada, inverter a');
console.log('asserção para length===1 fará este teste falhar no código antigo e passar no corrigido.\n');
process.exitCode = failed > 0 ? 1 : 0;
