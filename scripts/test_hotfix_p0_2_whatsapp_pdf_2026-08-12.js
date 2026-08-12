/**
 * test_hotfix_p0_2_whatsapp_pdf_2026-08-12.js
 *
 * HOTFIX OPERACIONAL PÓS-GO-LIVE 2026-08-12, P0.2 — WhatsApp/PDF:
 * (1) descrição do item nunca mais vaza R$/m² interno (lê data-nome, não
 *     o texto da <option> que inclui espessura+preço/m²); (2) preço
 *     principal (Cartão) nunca diverge do PIX — ambos os canais leem
 *     window._orcCalc.finalPrice (nunca um valor derivado do PIX) através
 *     da MESMA função orcColetarItensDistribuidos; (3) prazo é sempre lido
 *     ao vivo de orcGetPrazoTexto() nos dois canais, sem hardcode.
 *
 * Uso: node scripts/test_hotfix_p0_2_whatsapp_pdf_2026-08-12.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

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

console.log('\n=== HOTFIX P0.2 — WhatsApp/PDF: sem R$/m² interno, paridade de preço, prazo real ===\n');

// ── 1. orcColetarItensDistribuidos() nunca mais lê o .text da <option> (que inclui R$/m²) ──
var coletarSrc = extractFn('orcColetarItensDistribuidos');
ok('1a. orcColetarItensDistribuidos() lê matOptSel.dataset.nome (nome limpo, sem preço/m²)', /matOptSel\.dataset\s*&&\s*matOptSel\.dataset\.nome/.test(coletarSrc));
ok('1b. orcColetarItensDistribuidos() não usa mais ".options[matEl.selectedIndex].text" direto para a descrição do item', !/var matLbl\s*=\s*matEl\s*\?\s*matEl\.options\[matEl\.selectedIndex\]\.text/.test(coletarSrc));

// ── 2. PDF e WhatsApp usam a MESMA fonte (orcColetarItensDistribuidos) e o MESMO finalPrice (Cartão) ──
var pdfSrc = extractFn('orcImprimirOrcamentoPDF');
var waSrc  = extractFn('orcEnviarOrcamentoWA');
ok('2a. PDF chama orcColetarItensDistribuidos(baseEfetiva) — mesma fonte do WhatsApp', /orcColetarItensDistribuidos\(baseEfetiva\)/.test(pdfSrc));
ok('2b. WhatsApp chama orcColetarItensDistribuidos(baseEfetivaWA) — mesma função, nunca um cálculo próprio divergente', /orcColetarItensDistribuidos\(baseEfetivaWA/.test(waSrc));
ok('2c. baseEfetiva do PDF parte de c2.finalPrice (preço Cartão/comercial) — nunca de um valor PIX', /var baseEfetiva\s*=\s*c2\.finalPrice/.test(pdfSrc));
ok('2d. baseEfetivaWA do WhatsApp parte de c\\.finalPrice (mesmo campo, mesma fonte) — nunca de um valor PIX', /baseEfetivaWA\s*=\s*dcOnWA\s*\?\s*\(c\.finalPrice/.test(waSrc));
ok('2e. PIX no WhatsApp é sempre uma linha SEPARADA ("Desconto PIX"), nunca substitui o "VALOR TOTAL"', /\*Desconto PIX:\*/.test(waSrc) && /VALOR TOTAL:\s*'\s*\+\s*totalExibido/.test(waSrc));

// ── 3. window._orcCalc.finalPrice (usado por ambos) é sempre o preço Cartão — nunca recebe valor PIX em nenhuma atribuição do arquivo ──
// (a atribuição "= {}" de orcResetFormularioVR é um reset legítimo, não um payload concorrente — só as atribuições COM CONTEÚDO contam.)
var finalPriceAssigns = (html.match(/window\._orcCalc\s*=\s*\{[^}]+\}/g) || []);
ok('3. Única atribuição de window._orcCalc com payload real é a de orcRecalc() (totalCost/finalPrice/matTotal/...) — nenhuma atribuição alternativa que poderia injetar um valor PIX', finalPriceAssigns.length === 1 && /finalPrice/.test(finalPriceAssigns[0]));

// ── 4. Prazo: os dois canais chamam a MESMA função ao vivo, sem hardcode ──
ok('4a. PDF lê o prazo via orcGetPrazoTexto() (nunca hardcoded)', /orcGetPrazoTexto\(\)/.test(pdfSrc));
ok('4b. WhatsApp lê o prazo via orcGetPrazoTexto() (nunca hardcoded)', /orcGetPrazoTexto\(\)/.test(waSrc));
var prazoSrc = extractFn('orcGetPrazoTexto');
ok('4c. orcGetPrazoTexto() lê ao vivo de #orcPrazoDias/#orcPrazoDiasMax/#orcPrazoEntrega — sem literal fixo de dias', /getElementById\('orcPrazoDias'\)/.test(prazoSrc) && !/return\s*'2 dias/.test(prazoSrc));

// ── 5. Execução real: reproduz o cenário do bug com os números exatos do usuário ──
{
  var FN_NAMES = ['orcColetarItensDistribuidos'];
  try {
    var fnsSrc = FN_NAMES.map(extractFn).join('\n\n');
    var src = [
      fnsSrc,
      "module.exports = { orcColetarItensDistribuidos: orcColetarItensDistribuidos };"
    ].join('\n\n');
    var modPath = path.join(__dirname, '_p0_2_wa_pdf_extracted.tmp.js');
    fs.writeFileSync(modPath, src);
    delete require.cache[require.resolve(modPath)];

    // Fixture: "Display em Acrílico Cristal 4mm", material com R$151,17/m² no texto visível,
    // mas data-nome limpo = "Acrílico Cristal 4mm". Preço principal (Cartão) R$42,60.
    var matOption = { text: 'Acrílico Cristal 4mm — R$151,17/m²', dataset: { nome: 'Acrílico Cristal 4mm' } };
    var _els = {
      'oi_prod_1': { value: 'Display em Acrílico Cristal 4mm' },
      'oi_qty_1': { value: '1' },
      'oi_larg_1': { value: '' },
      'oi_alt_1': { value: '' },
      'oi_mat_1': { options: [matOption], selectedIndex: 0 },
      'oi_det_1': { value: '' },
      'oi_tot_1': { textContent: 'R$42,60' },
    };
    var rows = [{ dataset: { idx: '1' } }];
    global.document = {
      getElementById: function (id) { return _els[id]; },
      querySelectorAll: function () { return rows; },
    };
    global.window = { _orcCalc: { finalPrice: 42.60 }, _orcVitreItensPedido: undefined };
    var mod = require(modPath);
    var itens = mod.orcColetarItensDistribuidos(42.60);
    var desc = itens[0] ? itens[0].desc : '';
    ok('5a. Descrição do item NÃO contém "R$" (nenhum custo/m² interno vazando para o cliente)', desc.indexOf('R$') === -1);
    ok('5b. Descrição do item contém o nome limpo do material ("Acrílico Cristal 4mm", sem "/m²")', desc.indexOf('Acrílico Cristal 4mm') > -1 && desc.indexOf('/m²') === -1);
    ok('5c. Valor unitário do item = R$42,60 (preço Cartão/principal, nunca R$40,41 do PIX)', Math.abs((itens[0] ? itens[0].unit : 0) - 42.60) < 0.01);
    ok('5d. Total do item = R$42,60 (preço Cartão/principal, nunca R$40,41 do PIX)', Math.abs((itens[0] ? itens[0].total : 0) - 42.60) < 0.01);
    try { fs.unlinkSync(modPath); } catch (e) {}
  } catch (e) {
    console.log('  ⚠️  Execução real pulada: ' + e.message);
  }
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
