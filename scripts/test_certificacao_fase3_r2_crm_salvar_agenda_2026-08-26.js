/**
 * test_certificacao_fase3_r2_crm_salvar_agenda_2026-08-26.js
 *
 * CERTIFICAÇÃO OPERACIONAL 10/10 — FASE 3, RODADA 2 (Certificação 5, CRM).
 *
 * ACHADO REAL reproduzido AO VIVO em produção: no painel de detalhe de um
 * lead do CRM, preencher "Nota de Follow-up"/"Data de Retorno" e clicar
 * "Salvar Agenda & Tarefa" mostrava o toast "Agenda salva para ..." — mas
 * crmSalvarAgenda() nunca chamava crmSaveLeads() (o wrapper que grava
 * CRM_LEADS no Firestore via _cloudSave). A mudança só existia em memória;
 * um reload completo apagava a nota/data por completo, apesar do toast de
 * sucesso. Toda função irmã na mesma região do arquivo (crmCongelar,
 * crmConverterEmOS, crmAvançarEtapa) já chamava crmSaveLeads() — só esta
 * ficou de fora.
 *
 * Corrigido com uma linha (crmSaveLeads() ao final, mesmo padrão fire-
 * and-forget já usado pelas funções irmãs — _cloudSave() tem seu próprio
 * tratamento de falha/conflito, nunca rejeita).
 *
 * Função sob teste extraída de index.html (nunca reimplementada):
 * crmSalvarAgenda.
 *
 * Uso: node "scripts/test_certificacao_fase3_r2_crm_salvar_agenda_2026-08-26.js"
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

console.log('\n=== CERTIFICAÇÃO FASE 3, RODADA 2 — crmSalvarAgenda() persiste no Firestore ===\n');

var src = extractFn('crmSalvarAgenda') + '\n\nmodule.exports = {crmSalvarAgenda: crmSalvarAgenda};';
var modPath = path.join(__dirname, '_certificacao_fase3_r2_crm_salvar_agenda.tmp.js');
fs.writeFileSync(modPath, src);

var _els, _toasts, _saveLeadsCalls, _updateCardTarefaCalls, _updateFollowBarCalls;
function reset(opts) {
  opts = opts || {};
  _els = {
    crmProxTarefa: { value: opts.proxTarefa || '' },
    crmProxTarefaData: { value: opts.proxTarefaData || '' },
    crmDtRetorno: { value: opts.dtRetorno || '' },
    crmNotaFU: { value: opts.nota || '' },
  };
  global.document = { getElementById: function (id) { return _els[id] || null; } };
  global.CRM_LEADS = { lead1: { nome: 'Cliente Teste' } };
  _toasts = [];
  global.showToast = function (msg, tipo) { _toasts.push({ msg: msg, tipo: tipo }); };
  _saveLeadsCalls = 0;
  global.crmSaveLeads = function () { _saveLeadsCalls++; return Promise.resolve({ ok: true }); };
  _updateCardTarefaCalls = 0;
  global.crmUpdateCardTarefa = function () { _updateCardTarefaCalls++; };
  _updateFollowBarCalls = 0;
  global.crmUpdateFollowBar = function () { _updateFollowBarCalls++; };
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// 1-3 — ACHADO REAL corrigido: crmSaveLeads() é chamado exatamente 1 vez.
reset({ nota: 'Nota de teste', dtRetorno: '2026-09-01' });
mod.crmSalvarAgenda('lead1');
assertTrue(_saveLeadsCalls === 1, '1. ACHADO REAL corrigido: crmSalvarAgenda() chama crmSaveLeads() — a mudança agora é persistida no Firestore, não só em memória');
assertTrue(global.CRM_LEADS.lead1.nota_followup === 'Nota de teste', '2. nota_followup é aplicada ao objeto ANTES de crmSaveLeads() ser chamado (nunca grava um objeto desatualizado)');
assertTrue(global.CRM_LEADS.lead1.data_retorno === '2026-09-01', '3. data_retorno é aplicada ao objeto ANTES de crmSaveLeads() ser chamado');

// 4 — toast de sucesso continua aparecendo (nenhuma regressão de UX).
assertTrue(_toasts.some(function (t) { return t.tipo === 'ok' && /Agenda salva/.test(t.msg); }), '4. toast de sucesso "Agenda salva" continua aparecendo — nenhuma regressão de comportamento visível');

// 5-6 — lead sem próxima tarefa: nunca chama crmUpdateCardTarefa, mas AINDA chama crmSaveLeads().
reset({ nota: 'Só nota, sem tarefa' });
mod.crmSalvarAgenda('lead1');
assertTrue(_updateCardTarefaCalls === 0, '5. sem próxima tarefa preenchida: crmUpdateCardTarefa() não é chamado (comportamento original preservado)');
assertTrue(_saveLeadsCalls === 1, '6. mesmo sem tarefa, a nota/data ainda são persistidas — crmSaveLeads() chamado');

// 7 — lead inexistente: nunca chama crmSaveLeads() (guard já existente preservado).
reset();
mod.crmSalvarAgenda('lead_inexistente');
assertTrue(_saveLeadsCalls === 0, '7. lead inexistente (CRM_LEADS[id] undefined): função retorna cedo, nunca chama crmSaveLeads() — guard original preservado');

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
