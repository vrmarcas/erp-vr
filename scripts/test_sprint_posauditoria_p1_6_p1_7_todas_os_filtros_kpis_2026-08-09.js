/**
 * test_sprint_posauditoria_p1_6_p1_7_todas_os_filtros_kpis_2026-08-09.js
 *
 * SPRINT DE CORREÇÃO PÓS-AUDITORIA, P1.6/P1.7 — a auditoria read-only
 * encontrou duas lacunas na tela "Todas as OS": (1) a busca do Histórico
 * (e das demais abas) não localizava pelo número do orçamento de origem;
 * (2) não existia nenhum painel de KPIs consolidado no topo — só a
 * contagem da aba/filtro atualmente selecionado (#osTableCount).
 *
 * Corrigido:
 * - renderOsTable(): a string de busca (txtOk) agora inclui os.orcNum/
 *   os.orcRef (campos reais gravados pela OS em orcEnvGerarOS), além de
 *   cliente/número da OS/produto — nunca baseada em texto já renderizado.
 * - osCalcularKPIs()/osRenderKPIs(): 4 indicadores no topo da tela (OS
 *   Ativas, OS Prontas, Entregues Recentes, Saldo a Receber),
 *   acompanhando o filtro de MARCA (documentado explicitamente),
 *   nunca a busca textual nem a aba selecionada. Saldo a Receber lê
 *   exclusivamente de os.restante (campo financeiro só mesclado em
 *   KB_OS para perfis autorizados via _kbMergeFinCache — nunca kb_os
 *   puro) e o KPI inteiro é OMITIDO (não zerado) para a role Produção.
 *
 * Uso: node scripts/test_sprint_posauditoria_p1_6_p1_7_todas_os_filtros_kpis_2026-08-09.js
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

var FN_NAMES = ['moneyToCents', 'centsToMoney', 'sumCents', 'osFiltrarPorAba', 'orcEnvParseDataSalvo', 'osCalcularKPIs'];
var src = [
  'var KB_OS = {}; var _OS_ATIVOS_STATUS = ["iniciada","producao","master","em_andamento","aguard_master"]; var _OS_RECENTES_DIAS = 7;',
  'var _currentSession = null;',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  calcularKPIs: osCalcularKPIs,',
  '  setKBOS: function(v){ KB_OS = v; }, setSession: function(v){ _currentSession = v; },',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_p1_6_7_os_kpis_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== SPRINT DE CORREÇÃO PÓS-AUDITORIA, P1.6/P1.7 — Todas as OS: filtro por orçamento + KPIs ===\n');

// ─────────────────────────────────────────────────────────────────────────
// Fixture — mistura de status/marcas/restantes, incluindo uma OS "recém
// entregue" (dentro de 7 dias) para validar o KPI "Entregues Recentes".
// ─────────────────────────────────────────────────────────────────────────
function hojeMenosDias(n) {
  var d = new Date(); d.setDate(d.getDate() - n);
  return d.getDate().toString().padStart(2, '0') + '/' + (d.getMonth() + 1).toString().padStart(2, '0') + '/' + d.getFullYear();
}
function fixtureKBOS() {
  return {
    os1: { id: 'os1', num: '1', status: 'iniciada', marca: 'vr', restante: 500 },
    os2: { id: 'os2', num: '2', status: 'producao', marca: 'vit', restante: 300 },
    os3: { id: 'os3', num: '3', status: 'pronta', marca: 'vr', restante: 200 },
    os4: { id: 'os4', num: '4', status: 'entregue', marca: 'vr', entregueEm: hojeMenosDias(2), restante: 0 },
    os5: { id: 'os5', num: '5', status: 'entregue', marca: 'vit', entregueEm: hojeMenosDias(30), restante: 0 },
    os6: { id: 'os6', num: '6', status: 'iniciada', marca: 'vit', restante: 0 }, // quitada, não entra no saldo
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 1-4. KPIs — contagens corretas, acompanhando marca (não tab/busca).
// ─────────────────────────────────────────────────────────────────────────
mod.setKBOS(fixtureKBOS());
mod.setSession({ funcao: 'comercial' });
{
  var k = mod.calcularKPIs('');
  test('1. KPI Ativas (todas as marcas) — os1,os2,os6 = 3', k.ativas, 3);
  test('2. KPI Prontas (todas as marcas) — os3 = 1', k.prontas, 1);
  test('3. KPI Entregues Recentes (≤7 dias, todas as marcas) — só os4 (2 dias atrás; os5 tem 30 dias) = 1', k.recentes, 1);
  test('4. KPI Saldo a Receber (todas as marcas) — 500+300+200 = R$1000,00 (os6 tem restante:0, não soma)', k.saldoReais, 1000);
}

// ─────────────────────────────────────────────────────────────────────────
// 5-7. KPIs acompanham o filtro de MARCA.
// ─────────────────────────────────────────────────────────────────────────
{
  var kVR = mod.calcularKPIs('vr');
  test('5. filtro marca=vr — Ativas conta só os1 = 1', kVR.ativas, 1);
  test('6. filtro marca=vr — Saldo a Receber conta só os1+os3 = R$700,00', kVR.saldoReais, 700);
  var kVit = mod.calcularKPIs('vit');
  test('7. filtro marca=vit — Ativas conta os2+os6 = 2', kVit.ativas, 2);
}

// ─────────────────────────────────────────────────────────────────────────
// 8. Privacidade — Produção NUNCA recebe o Saldo a Receber (nem zerado,
// nulo — o card inteiro deve ser omitido pelo chamador osRenderKPIs()).
// ─────────────────────────────────────────────────────────────────────────
mod.setSession({ funcao: 'producao' });
{
  var kProd = mod.calcularKPIs('');
  test('8. Produção — saldoReais é null (não 0, não omitido silenciosamente — o valor sentinela que osRenderKPIs() usa para OMITIR o card)', kProd.saldoReais, null);
  test('8b. Produção — contagens operacionais (Ativas/Prontas/Recentes) continuam normais, só o financeiro é escondido', [kProd.ativas, kProd.prontas, kProd.recentes], [3, 1, 1]);
}
mod.setSession({ funcao: 'comercial' });

try { fs.unlinkSync(modPath); } catch (e) {}

// ─────────────────────────────────────────────────────────────────────────
// 9-12. Wiring estrutural: renderOsTable() busca por orçamento; HTML tem
// o container do KPI bar; osRenderKPIs() lê filtro de marca (não busca
// textual, não aba) e omite o card de saldo quando null.
// ─────────────────────────────────────────────────────────────────────────
var srcRender = extractFn('renderOsTable');
test('9. renderOsTable() inclui os.orcNum/os.orcRef na busca textual (localiza por número de orçamento)',
  /_orcTxt\s*=.*orcNum.*orcRef/.test(srcRender) || (/os\.orcNum/.test(srcRender) && /os\.orcRef/.test(srcRender)), true);
test('10. renderOsTable() chama osRenderKPIs() (KPIs recalculados a cada mudança de filtro/busca/aba)',
  /osRenderKPIs\(\)/.test(srcRender), true);

var srcKpiRender = extractFn('osRenderKPIs');
test('11. osRenderKPIs() lê o filtro de marca (osFilterMarca) — nunca osSearchInput nem _osListTab',
  /osFilterMarca/.test(srcKpiRender) && !/osSearchInput/.test(srcKpiRender) && !/_osListTab/.test(srcKpiRender), true);
test('12. osRenderKPIs() omite o card de Saldo a Receber quando saldoReais é null (privacidade real, não visual)',
  /saldoReais\s*!==\s*null/.test(srcKpiRender), true);

test('13. HTML tem o container #osKpiBar no topo da tela "Todas as OS"', html.indexOf('id="osKpiBar"') >= 0, true);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
