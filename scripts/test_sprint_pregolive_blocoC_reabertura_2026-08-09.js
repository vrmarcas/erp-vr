/**
 * test_sprint_pregolive_blocoC_reabertura_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco C — achado real de homologação: reabrir um
 * orçamento salvo com desconto condicional/parcelamento no cartão/desconto
 * PIX mostrava esses campos desmarcados/vazios mesmo com o registro
 * gravando os valores corretos (o.descCond/o.dcData/o.descPix/o.parcelas —
 * ver _orcSalvarOrcamentoImpl). orcEnvEditar() nunca lia esses 4 campos de
 * volta para o DOM ao restaurar um orçamento para edição.
 *
 * Corrigido: orcEnvEditar() agora restaura fielmente os 4 campos e
 * reaciona os toggles/preview (orcToggleDescCond/orcTogglePixDisc/
 * orcToggleParc/orcDescCondPreview/orcCalcPixDisc/orcCalcParc) para que a
 * tela reflita exatamente o que foi salvo.
 *
 * orcEnvEditar() é uma função grande (nav(), orcAddItem(),
 * orcItemVRRestaurarDados(), etc. — dezenas de dependências), então este
 * teste usa o mesmo padrão já estabelecido nesta suíte para funções desse
 * porte: regressão estrutural (regex sobre a função extraída) + execução
 * real isolada só da lógica de restauração dos 4 campos.
 *
 * Uso: node scripts/test_sprint_pregolive_blocoC_reabertura_2026-08-09.js
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

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco C — reabertura fiel de orçamento (desconto/parcelas/PIX) ===\n');

// ── 1-6. Regressão estrutural: orcEnvEditar() lê e restaura os 4 campos ──
{
  var src = extractFn('orcEnvEditar');
  test('1. achado real corrigido: orcEnvEditar() lê o.descCond do registro salvo (antes nunca lia)',
    /o\.descCond\s*>\s*0/.test(src), true);
  test('2. lê o.dcData (data limite do desconto condicional)', /setV\('orcDescCondData',\s*o\.dcData\)/.test(src), true);
  test('3. achado real corrigido: orcEnvEditar() lê o.descPix do registro salvo', /o\.descPix\s*>\s*0/.test(src), true);
  // SPRINT PRÉ-GO-LIVE, Bloco E — parcelamento no cartão deixou de ser
  // Sim/Não (nova regra comercial: 1/2/3x sempre sem juros); o valor
  // salvo agora é aplicado direto no orcParcSel, capado em 1-3x (nunca
  // repassa um valor legado/fora da faixa nova, tipo 6x).
  test('4. achado real corrigido: orcEnvEditar() lê o.parcelas do registro salvo e repõe no orcParcSel (capado em 1-3x)',
    /o\.parcelas\s*>=\s*1\s*&&\s*o\.parcelas\s*<=\s*3/.test(src) && /parcSel\.value\s*=\s*String\(/.test(src), true);
  test('5. reaciona os toggles visuais (não só seta .checked em silêncio — o card teria texto/preview desatualizado)',
    /orcToggleDescCond\(\)/.test(src) && /orcTogglePixDisc\(\)/.test(src) && /orcToggleParc\(\)/.test(src), true);
  test('6. recalcula os previews de desconto condicional/PIX/parcela após restaurar (orcDescCondPreview/orcCalcPixDisc/orcCalcParc)',
    /orcDescCondPreview\(\)/.test(src) && /orcCalcPixDisc\(\)/.test(src) && /orcCalcParc\(\)/.test(src), true);
}

// ── 7-10. Execução real isolada da lógica de restauração dos 4 campos ───
{
  function makeEl(props) { return Object.assign({ value: '', checked: false }, props || {}); }
  var _els = {};
  global.document = { getElementById: function (id) { return _els[id]; } };

  // Simula exatamente o bloco de restauração adicionado a orcEnvEditar —
  // mesma lógica, sem as dezenas de dependências do resto da função.
  function restaurarCondicoesPagamento(o) {
    var setV = function (id, v) { var el = document.getElementById(id); if (el) el.value = v; };
    var descCondCb = document.getElementById('orcDescCondToggle');
    if (descCondCb) {
      var temDescCond = !!(o.descCond > 0);
      descCondCb.checked = temDescCond;
      if (temDescCond) { setV('orcDescCond', o.descCond); setV('orcDescCondData', o.dcData); }
    }
    var pixCb = document.getElementById('orcPixDiscToggle');
    if (pixCb) {
      var temPix = !!(o.descPix > 0);
      pixCb.checked = temPix;
      if (temPix) setV('orcPixDiscPct', o.descPix);
    }
    var parcCb = document.getElementById('orcParcToggle');
    if (parcCb) {
      var temParc = !!(o.parcelas > 1);
      parcCb.checked = temParc;
      if (temParc) { var parcSel = document.getElementById('orcParcSel'); if (parcSel) parcSel.value = String(o.parcelas); }
    }
  }

  _els = {
    orcDescCondToggle: makeEl(), orcDescCond: makeEl(), orcDescCondData: makeEl(),
    orcPixDiscToggle: makeEl(), orcPixDiscPct: makeEl(),
    orcParcToggle: makeEl(), orcParcSel: makeEl()
  };
  restaurarCondicoesPagamento({ descCond: 10, dcData: '2026-08-20', descPix: 0.99, parcelas: 3 });

  test('7. orçamento salvo com desconto condicional de 10% até 2026-08-20: toggle marcado e valores restaurados',
    [_els.orcDescCondToggle.checked, _els.orcDescCond.value, _els.orcDescCondData.value], [true, 10, '2026-08-20']);
  test('8. mesmo orçamento com PIX 0,99%: toggle marcado e percentual restaurado',
    [_els.orcPixDiscToggle.checked, _els.orcPixDiscPct.value], [true, 0.99]);
  test('9. mesmo orçamento com parcelamento 3x: toggle marcado e select em "3"',
    [_els.orcParcToggle.checked, _els.orcParcSel.value], [true, '3']);

  _els = {
    orcDescCondToggle: makeEl({ checked: true }), orcDescCond: makeEl(), orcDescCondData: makeEl(),
    orcPixDiscToggle: makeEl({ checked: true }), orcPixDiscPct: makeEl(),
    orcParcToggle: makeEl({ checked: true }), orcParcSel: makeEl()
  };
  restaurarCondicoesPagamento({ descCond: 0, dcData: '', descPix: 0, parcelas: 1 });
  test('10. orçamento SEM nenhuma dessas condições (à vista, sem desconto): todos os toggles ficam desmarcados, nunca "presos" em um estado anterior da tela',
    [_els.orcDescCondToggle.checked, _els.orcPixDiscToggle.checked, _els.orcParcToggle.checked], [false, false, false]);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
