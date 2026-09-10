/**
 * test_rodada_cirurgica_2026-09-10_bug1_crm_lead_unico.js
 *
 * RODADA CIRÚRGICA 2026-09-10, Bug 1 — CRM criava um card NOVO a cada
 * reedição/resave do mesmo orçamento em vez de atualizar o existente.
 *
 * Causa raiz (confirmada por leitura de código na rodada anterior,
 * corrigida agora): o objeto `orc` reconstruído em
 * _orcSalvarOrcamentoImpl() (~index.html:28674) nunca copiava
 * `orcExistente.crmLeadId` — crmUpsertLeadPorOrcamento() (~index.html:
 * 13892) sempre achava o campo vazio e criava um lead novo.
 *
 * Corrigido com uma linha: `crmLeadId: orcExistente ? orcExistente.crmLeadId
 * : undefined` no literal de `orc` — o resto do fluxo
 * (crmUpsertLeadPorOrcamento, persistência via orcSetEnviados) já estava
 * correto e não foi tocado.
 *
 * Este teste simula fielmente o contrato de resave: a cada chamada, o
 * `orc` novo é construído copiando `crmLeadId` do `orcExistente` (exatamente
 * a expressão adicionada no código real), depois passa pela função
 * REAL crmUpsertLeadPorOrcamento() extraída ao vivo de index.html.
 *
 * Falha no código anterior (sem a cópia de crmLeadId — ver
 * test_achado_2026-09-10_crm_lead_duplicado_reabertura.js, que documentou
 * o bug com length===3), passa agora com length===1.
 *
 * Uso: node scripts/test_rodada_cirurgica_2026-09-10_bug1_crm_lead_unico.js
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
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'esperado true'); }

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

// ── Prova de execução: o literal de `orc` em index.html REALMENTE copia
// crmLeadId de orcExistente (não é só este teste que simula isso) ──────────
console.log('\n=== Bug 1 — CRM: um orçamento tem no máximo 1 lead canônico ===\n');
test('PROVA DE EXECUÇÃO — index.html copia orcExistente.crmLeadId ao reconstruir o objeto `orc` (linha real, não simulada)', function () {
  var idx = html.indexOf('var orc = {');
  assertTrue(idx >= 0, 'literal `var orc = {` não encontrado — teste desatualizado?');
  var braceOpen = html.indexOf('{', idx);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  var orcLiteralSrc = html.slice(idx, i + 1);
  assertTrue(/crmLeadId:\s*orcExistente\s*\?\s*orcExistente\.crmLeadId\s*:\s*undefined/.test(orcLiteralSrc),
    'BUG: o literal `orc` em index.html ainda não copia orcExistente.crmLeadId');
});

var src = [
  'var CRM_LEADS = global.__CRM_LEADS__;',
  'var crmLeadIdCounter = 100;',
  'function _isTestRecord(){ return false; }',
  'function crmSaveLeads(){}',
  'function crmSetBrand(){}',
  'function orcFmt(v){ return (v||0).toFixed(2); }',
  extractFn('crmUpsertLeadPorOrcamento'),
  'module.exports = { crmUpsertLeadPorOrcamento: crmUpsertLeadPorOrcamento, getLeads: function(){ return CRM_LEADS; } };'
].join('\n\n');
var modPath = path.join(__dirname, '_rodada_cirurgica_2026-09-10_bug1_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// Simula o pipeline real: cada "save" reconstrói `orc` do zero, mas agora
// (igual ao index.html corrigido) copia crmLeadId de orcExistente antes de
// chamar a função REAL crmUpsertLeadPorOrcamento().
function simularSave(orcExistente, dadosNovos, num, mod) {
  var orc = Object.assign({
    id: orcExistente ? orcExistente.id : ('ORC-' + num),
    crmLeadId: orcExistente ? orcExistente.crmLeadId : undefined
  }, dadosNovos);
  mod.crmUpsertLeadPorOrcamento(orc, num);
  return orc;
}

// ── Caso 1 — save 3x seguidas → sempre 1 lead ───────────────────────────
(function () {
  global.__CRM_LEADS__ = {};
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  var orc1 = simularSave(null, { cliente: 'Cliente Reaberto', marca: 'vr', produto: 'Caixa', tel: '11900000009', valorFinal: 100 }, 999, mod);
  var orc2 = simularSave(orc1, { cliente: 'Cliente Reaberto', marca: 'vr', produto: 'Caixa', tel: '11900000009', valorFinal: 105 }, 999, mod);
  var orc3 = simularSave(orc2, { cliente: 'Cliente Reaberto', marca: 'vr', produto: 'Caixa', tel: '11900000009', valorFinal: 110 }, 999, mod);

  test('Caso 1 — novo orçamento → save → 1 lead CRM', function () {
    var cards = Object.values(mod.getLeads()).filter(function (l) { return l.orcamentoId === 'ORC-999'; });
    assertEq(cards.length >= 1, true, 'nenhum lead foi criado no primeiro save');
  });

  test('Caso 1 — reabrir → editar → save 2x mais → CONTINUA 1 lead CRM (não 3)', function () {
    var cards = Object.values(mod.getLeads()).filter(function (l) { return l.orcamentoId === 'ORC-999'; });
    assertEq(cards.length, 1, 'BUG: ' + cards.length + ' card(s) para o mesmo orçamento depois de 3 saves — deveria ser 1');
  });

  test('Caso 1 — crmLeadId é o MESMO id em todas as 3 reconstruções de `orc`', function () {
    assertEq(orc1.crmLeadId, orc2.crmLeadId, 'crmLeadId mudou entre save 1 e 2');
    assertEq(orc2.crmLeadId, orc3.crmLeadId, 'crmLeadId mudou entre save 2 e 3');
  });
})();

// ── Caso 2 — alterar nome/telefone atualiza o lead existente, não duplica ──
(function () {
  global.__CRM_LEADS__ = {};
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  var orc1 = simularSave(null, { cliente: 'Nome Original', marca: 'vr', produto: 'Placa', tel: '11911110000', valorFinal: 50 }, 500, mod);
  var orc2 = simularSave(orc1, { cliente: 'Nome Corrigido', marca: 'vr', produto: 'Placa', tel: '11922220000', valorFinal: 50 }, 500, mod);

  test('Caso 2 — alterar nome/telefone atualiza o MESMO lead (não duplica)', function () {
    var cards = Object.values(mod.getLeads()).filter(function (l) { return l.orcamentoId === 'ORC-500'; });
    assertEq(cards.length, 1, 'BUG: alterar nome/telefone criou um card novo em vez de atualizar');
    assertEq(cards[0].nome, 'Nome Corrigido', 'o card existente deveria refletir o nome atualizado');
    assertEq(cards[0].tel, '11922220000', 'o card existente deveria refletir o telefone atualizado');
  });
})();

// ── Caso 3 — crmLeadId válido é reutilizado ─────────────────────────────
(function () {
  global.__CRM_LEADS__ = { 'orc_777': { nome: 'Pré-existente', orcamentoId: 'ORC-000700', etapa: 'orc_emitido' } };
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  var orcComLeadValido = { id: 'ORC-000700', crmLeadId: 'orc_777', cliente: 'Pré-existente Atualizado', marca: 'vr', produto: 'X', tel: '11900001111', valorFinal: 10 };
  mod.crmUpsertLeadPorOrcamento(orcComLeadValido, 700);

  test('Caso 3 — crmLeadId válido é reaproveitado (não cria um id novo)', function () {
    assertEq(orcComLeadValido.crmLeadId, 'orc_777', 'crmLeadId válido não deveria ter sido trocado');
    assertEq(Object.keys(mod.getLeads()).length, 1, 'nenhum lead extra deveria ter sido criado com um crmLeadId já válido');
  });
})();

// ── Caso 4 — crmLeadId inválido/inexistente: tratado de forma segura ────
(function () {
  global.__CRM_LEADS__ = {};
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  var orcComLeadFantasma = { id: 'ORC-000800', crmLeadId: 'orc_id_que_nunca_existiu', cliente: 'Cliente Órfão', marca: 'vr', produto: 'Y', tel: '11900002222', valorFinal: 20 };
  mod.crmUpsertLeadPorOrcamento(orcComLeadFantasma, 800);

  test('Caso 4 — crmLeadId apontando para lead inexistente: cria exatamente 1 lead novo (comportamento seguro, não trava, não duplica)', function () {
    var cards = Object.values(mod.getLeads()).filter(function (l) { return l.orcamentoId === 'ORC-000800'; });
    assertEq(cards.length, 1, 'deveria criar exatamente 1 lead novo quando o crmLeadId referenciado não existe');
    assertTrue(orcComLeadFantasma.crmLeadId !== 'orc_id_que_nunca_existiu', 'o novo crmLeadId deveria substituir a referência fantasma no próprio objeto orc');
  });
})();

// ── Caso 5 — "reload" entre saves: novo objeto `orc` carregado do zero
// (como aconteceria ao reabrir a página) ainda preserva o vínculo, desde
// que a leitura do orçamento salvo traga o crmLeadId persistido ────────────
(function () {
  global.__CRM_LEADS__ = {};
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  var orc1 = simularSave(null, { cliente: 'Cliente Reload', marca: 'vr', produto: 'Z', tel: '11900003333', valorFinal: 30 }, 900, mod);
  // Simula reload completo: o "orcExistente" da próxima sessão vem de uma
  // leitura fresca do array persistido (mesmo shape do objeto salvo).
  var orcPersistidoLido = JSON.parse(JSON.stringify(orc1));
  var orc2 = simularSave(orcPersistidoLido, { cliente: 'Cliente Reload', marca: 'vr', produto: 'Z', tel: '11900003333', valorFinal: 35 }, 900, mod);

  test('Caso 5 — reload completo entre saves: vínculo continua (1 lead só)', function () {
    var cards = Object.values(mod.getLeads()).filter(function (l) { return l.orcamentoId === 'ORC-900'; });
    assertEq(cards.length, 1, 'BUG: reload entre saves duplicou o lead');
    assertEq(orc2.crmLeadId, orc1.crmLeadId, 'crmLeadId deveria sobreviver ao reload');
  });
})();

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
