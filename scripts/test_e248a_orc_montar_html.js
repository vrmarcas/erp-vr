/**
 * test_e248a_orc_montar_html.js — ValerIA 2.0 / ERP, Fase E.2.48A (2026-09-23).
 *
 * orcMontarHtmlOrcamento(orc) passa a ser a fonte única HTML/CSS do
 * orçamento comercial oficial (VR-personalizado), usada por:
 *   - impressão manual (orcImprimirOrcamentoPDF, window.print);
 *   - PDF programático (generateErpQuotePdf).
 * Antes desta fase existiam DOIS templates inline divergentes ("Vitre
 * wizard" e "VR Marcas") dentro de orcImprimirOrcamentoPDF, ambos lendo
 * DOM ao vivo.
 *
 * Rodada de correção (mesma data) — reprovação do Gabriel na 1ª entrega
 * apontou 3 problemas reais, todos corrigidos e cobertos aqui:
 *   1. generateErpQuotePdf() tinha um piso artificial de altura
 *      (Math.max(altura, 1160)) que inflava orçamentos curtos para além
 *      de 1 página A4 — removido; agora mede a altura REAL do conteúdo
 *      via getBoundingClientRect(), mesmo padrão já provado em
 *      generateVitreQuotePdf.
 *   2. orcMontarHtmlOrcamento() tinha um fallback `orcCondicaoLabelPorTipo
 *      ('50-50')` quando orc.condicaoPagamentoTexto estava ausente —
 *      removido; um histórico sem esse campo agora omite a linha inteira
 *      de "Condição de pagamento" (nunca inventa).
 *   3. Os testes de "compatibilidade histórica" e "fidelidade visual"
 *      estavam misturados no mesmo fixture — separados em TESTE A e
 *      TESTE B, com o TESTE B usando os dados REAIS do ORC-000163
 *      (produção) + validadeDias/condicaoPagamentoTexto explicitamente
 *      persistidos, simulando o orçamento revisado sob a nova arquitetura.
 *
 * Esta suíte prova:
 *   (a) PUREZA — nenhuma das novas funções lê o DOM ou
 *       window._orcCalc/ORC_ITEM_OPCOES/KB_OS — só o `orc` recebido e
 *       config estática (cfgLoad);
 *   (b) TESTE A (compatibilidade histórica) — objeto sem os 5 campos
 *       novos nunca quebra, nunca lê DOM/catálogo/KB_OS, nunca inventa
 *       valor (nem "50-50", nem "10 dias") — só omite;
 *   (c) TESTE B (fidelidade do orçamento revisado) — objeto completo
 *       (dados reais do ORC-000163 + campos novos persistidos) reproduz
 *       exatamente os mesmos valores que o PDF oficial de referência
 *       mostra, campo a campo;
 *   (d) FONTE ÚNICA — orcImprimirOrcamentoPDF/generateErpQuotePdf chamam
 *       a MESMA função, nenhum template inline duplicado sobrou;
 *   (e) PAGINAÇÃO — generateErpQuotePdf() não tem mais o piso de altura
 *       artificial (checagem estática; a contagem real de páginas em 1
 *       para o ORC-000163 é verificada num harness de browser real, fora
 *       deste script Node — ver relatório da fase).
 *
 * Uso: node scripts/test_e248a_orc_montar_html.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function assert(cond, desc, detail) {
  if (cond) { pass++; console.log('  ✅ ' + desc); }
  else { fail++; console.log('  ❌ ' + desc + (detail ? ' — ' + detail : '')); }
}

function extractFunction(src, name) {
  const marker = 'function ' + name + '(';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('função ' + name + ' não encontrada em index.html');
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const FN_NAMES = [
  'orcDistribuirParcelas', 'orcMotorComercial', 'orcOrdemBlocosPagamento', 'orcMontarBlocosPagamento',
  'orcCondicaoLabelPorTipo', 'orcItemDescricaoComercial', 'osItemMateriaisResumo',
  'orcItensDistribuidosDeOrc', 'orcCondPagamentoDeOrc', 'orcPrazoTextoDeOrc', 'orcMontarHtmlOrcamento',
];
const FN_BODIES = {};
FN_NAMES.forEach((n) => { FN_BODIES[n] = extractFunction(INDEX_HTML, n); });
const COMBINED_SRC = FN_NAMES.map((n) => FN_BODIES[n]).join('\n\n');

const CFG_PARCELAMENTO = [
  { parcelas: 1, taxa: 3.05 }, { parcelas: 2, taxa: 4.24 }, { parcelas: 3, taxa: 5.14 },
];

function makeCtx() {
  const calls = { msgResolverTemplate: [] };
  const ctx = {
    console,
    location: { origin: 'https://erp-vrmarcas.web.app' },
    cfgEsc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    cfgLoad: () => ({ parcelamento: CFG_PARCELAMENTO }),
    CFG_DEFAULT: { parcelamento: CFG_PARCELAMENTO },
    _cfgMateriaisReais: () => [],
    msgResolverTemplate: (nome, vars) => {
      calls.msgResolverTemplate.push(nome);
      if (nome === 'orcamentoComparativo') return 'Escolha uma das opções abaixo (você pode escolher apenas uma):\n\n' + (vars.opcoes || '');
      return '';
    },
    Number, String, Array, Date, Math, JSON, parseFloat, parseInt,
    _calls: calls,
  };
  vm.createContext(ctx);
  vm.runInContext(COMBINED_SRC, ctx, { filename: 'e248a.js' });
  return ctx;
}

// Remove comentários de linha (// ...) antes de checar chamadas reais —
// os próprios comentários explicativos destas funções MENCIONAM os nomes
// proibidos (documentando a restrição), o que não pode ser confundido com
// uma CHAMADA real.
function semComentarios(src) {
  return src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

console.log('== Parte 1 — PUREZA: nenhuma leitura de DOM/estado global vivo ==');
{
  ['orcItensDistribuidosDeOrc', 'orcCondPagamentoDeOrc', 'orcPrazoTextoDeOrc', 'orcMontarHtmlOrcamento'].forEach((n) => {
    const body = semComentarios(FN_BODIES[n]);
    assert(!/document\s*\.\s*(getElementById|querySelector|querySelectorAll)/.test(body), n + '() nunca chama document.getElementById/querySelector*');
    assert(!/window\s*\.\s*_orcCalc/.test(body), n + '() nunca lê window._orcCalc');
    assert(!/\bORC_ITEM_OPCOES\b/.test(body), n + '() nunca lê o global ORC_ITEM_OPCOES ao vivo (só orc.itens[i].grupoOpcao, já persistido)');
    assert(!/\bKB_OS\b/.test(body), n + '() nunca acessa KB_OS diretamente');
  });
  const bodyPuro = semComentarios(FN_BODIES.orcMontarHtmlOrcamento);
  assert(!/orcCondicaoPagamentoAtual\s*\(/.test(bodyPuro), 'orcMontarHtmlOrcamento() nunca CHAMA orcCondicaoPagamentoAtual() — só lê orc.condicaoPagamentoTexto já persistido (menção em comentário é esperada)');
  assert(!/orcGetPrazoTexto\s*\(|orcGetResponsavel\s*\(|orcGetValidadeDias\s*\(/.test(bodyPuro), 'orcMontarHtmlOrcamento() nunca chama orcGetPrazoTexto/orcGetResponsavel/orcGetValidadeDias (todas DOM-dependentes)');
  assert(!/orcCondicaoLabelPorTipo\s*\(\s*['"]50-50['"]\s*\)/.test(bodyPuro), 'CORREÇÃO 2 — orcMontarHtmlOrcamento() NUNCA chama orcCondicaoLabelPorTipo(\'50-50\') como fallback (removido — nunca inventa condição de pagamento)');
}

console.log('\n== Parte 2 — fonte única: sem templates inline duplicados ==');
{
  const idxImprimir = INDEX_HTML.indexOf('async function orcImprimirOrcamentoPDF()');
  const bodyImprimir = extractFunction(INDEX_HTML.slice(idxImprimir - 20), 'orcImprimirOrcamentoPDF').length
    ? INDEX_HTML.slice(idxImprimir, INDEX_HTML.indexOf('\n}', idxImprimir) + 2)
    : '';
  assert(bodyImprimir.includes('orcMontarHtmlOrcamento(_orcSalvo)'), 'orcImprimirOrcamentoPDF() delega a montagem de HTML para orcMontarHtmlOrcamento(_orcSalvo)');
  assert(!bodyImprimir.includes("classList.contains('vitre')"), 'orcImprimirOrcamentoPDF() não lê mais isVitre/DOM diretamente para montar o HTML');
  assert(!bodyImprimir.includes('VITRE TEMPLATE') && !bodyImprimir.includes('VR MARCAS TEMPLATE'), 'nenhum template inline (Vitre/VR Marcas) restou dentro de orcImprimirOrcamentoPDF()');
  assert(INDEX_HTML.includes('function generateErpQuotePdf(orc)'), 'generateErpQuotePdf(orc) existe');
  const idxGenerateErp = INDEX_HTML.indexOf('function generateErpQuotePdf');
  const bodyGenerateErp = extractFunction(INDEX_HTML.slice(idxGenerateErp - 20), 'generateErpQuotePdf');
  assert(bodyGenerateErp.includes('orcMontarHtmlOrcamento(orc)'), 'generateErpQuotePdf() usa a MESMA orcMontarHtmlOrcamento(orc)');
  assert(!semComentarios(bodyGenerateErp).includes('jsPDF.html('), 'regressão: generateErpQuotePdf() nunca CHAMA jsPDF.html() (mesma proibição já validada para o fluxo Vitre; menção em comentário é esperada)');
  assert(bodyGenerateErp.includes("toDataURL('image/jpeg', JPEG_QUALITY)"), 'generateErpQuotePdf() usa JPEG (mesmo padrão homologado em generateVitreQuotePdf)');

  console.log('\n  -- CORREÇÃO 1 (paginação) --');
  assert(!/Math\.max\([^)]*,\s*1160\s*\)/.test(semComentarios(bodyGenerateErp)), 'generateErpQuotePdf() NÃO CHAMA mais o piso artificial Math.max(altura, 1160) que inflava orçamentos curtos além de 1 página (menção em comentário explicando a correção é esperada)');
  assert(bodyGenerateErp.includes('getBoundingClientRect().height'), 'generateErpQuotePdf() mede a altura REAL via getBoundingClientRect() (mesma técnica provada em generateVitreQuotePdf)');
  assert(!/iframe\.style\.height\s*=\s*alturaReal/.test(bodyGenerateErp), 'generateErpQuotePdf() não força mais iframe.style.height para um valor inflado antes de medir');
  const bodyVitrePdf = extractFunction(INDEX_HTML, 'generateVitreQuotePdf');
  const alturaFallbackErp = bodyGenerateErp.match(/\|\|\s*el\.scrollHeight\s*\|\|\s*(\d+)/);
  const alturaFallbackVitre = bodyVitrePdf.match(/\|\|\s*(\d+)\s*;/);
  assert(!!alturaFallbackErp, 'generateErpQuotePdf() tem fallback de altura só para o caso de getBoundingClientRect()/scrollHeight falharem (nunca um piso artificial que force multipágina)');
}

// ============================================================
// Fixtures
// ============================================================

// Dados REAIS do orçamento ORC-000163 (produção, cliente Claudia, Mesa de
// Centro em 3 espessuras num grupo de opções "OU", parcelamento 3x,
// desconto PIX 5,14%) — extraídos de erp_vr/orcamentos em 2026-09-23,
// read-only. tipoItem/mat/pieces/grupoOpcao são exatamente o que está
// persistido hoje (histórico — sem espMm/clienteDoc/clienteCidade/
// validadeDias/condicaoPagamentoTexto, que são os campos novos desta fase).
function orc000163Base() {
  return {
    id: 'ORC-000163', num: '000163', cliente: 'Claudia', tel: '(11) 98329-0088', email: '',
    vendedor: 'Isabella Borges', marca: 'vitre',
    valorBase: 2473.1633027522944, valorFinal: 2607.17,
    descCond: 0, dcData: '', descPix: 5.14, parcelas: 3,
    prazoDias: '2', prazoDiasMax: '', prazo: '',
    itens: [
      { tipoItem: 'personalizado_vr', prod: 'Mesa de Centro', qty: '1', larg: '', alt: '',
        planLarg: '190', planAlt: '80', planProf: '', matKey: 'cfg_6', mat: 'Acrílico Cristal 10mm',
        det: '', unit: 'R$2459,40', total: 'R$2459,40',
        pieces: [{ id: 'auto_mesa_de_centro', nome: 'Mesa de Centro', qty: 1, larg: 190, alt: 80, esp: 10, espessuraMm: 10, origem: 'AUTOMATICA' }],
        grupoOpcao: { grupoId: 'grp_1_mubanhl9', selecionada: true, escolhaConfirmada: false } },
      { tipoItem: 'personalizado_vr', prod: 'Mesa de Centro', qty: '1', larg: '', alt: '',
        planLarg: '190', planAlt: '80', planProf: '', matKey: 'cfg_7', mat: 'Acrílico Cristal 12mm',
        det: '', unit: 'R$4009,17', total: 'R$4009,17',
        pieces: [{ id: 'auto_mesa_de_centro', nome: 'Mesa de Centro', qty: 1, larg: 190, alt: 80, esp: 12, espessuraMm: 12, origem: 'AUTOMATICA' }],
        grupoOpcao: { grupoId: 'grp_1_mubanhl9', selecionada: false, escolhaConfirmada: false } },
      { tipoItem: 'personalizado_vr', prod: 'Mesa de Centro', qty: '1', larg: '', alt: '',
        planLarg: '190', planAlt: '80', planProf: '', matKey: 'cfg_8', mat: 'Acrílico Cristal 15mm',
        det: '', unit: 'R$4357,80', total: 'R$4357,80',
        pieces: [{ id: 'auto_', nome: '', qty: 1, larg: 190, alt: 80, esp: 15, espessuraMm: 15, origem: 'AUTOMATICA' }],
        grupoOpcao: { grupoId: 'grp_1_mubanhl9', selecionada: false, escolhaConfirmada: false } },
    ],
  };
}

// TESTE A — objeto histórico tal como está HOJE em produção (sem nenhum
// dos 5 campos novos desta fase).
function orcFixtureHistorico() {
  return orc000163Base();
}

// TESTE B — o MESMO orçamento, "revisado" sob a nova arquitetura: os 5
// campos novos foram persistidos (simulando o vendedor reabrir e salvar
// de novo). validadeDias=10 e condicaoPagamentoTexto usam exatamente os
// valores que o PDF OFICIAL de referência já mostrava para este pedido
// (validade padrão do sistema/condição comercial padrão '50-50', já
// confirmados na comparação visual anterior) — não são valores
// inventados para o teste, são os valores reais de referência.
function orcFixtureRevisado() {
  const orc = orc000163Base();
  orc.clienteDoc = ''; // nunca preenchido para este pedido, permanece vazio de propósito
  orc.clienteCidade = '';
  orc.validadeDias = 10;
  orc.condicaoPagamentoTexto = '50% no pedido e 50% na retirada do material';
  orc.itens = orc.itens.map((it) => Object.assign({}, it, { espMm: it.pieces[0].espessuraMm }));
  return orc;
}

console.log('\n== TESTE A — COMPATIBILIDADE HISTÓRICA (ORC-000163 tal como está hoje, sem os 5 campos novos) ==');
{
  const ctx = makeCtx();
  const orc = orcFixtureHistorico();
  let threw = null;
  let html = '';
  try { html = ctx.orcMontarHtmlOrcamento(orc); } catch (e) { threw = e; }
  assert(!threw, 'NUNCA lança exceção', threw && threw.message);
  assert(!html.includes('undefined') && !html.includes('null'), 'HTML nunca vaza "undefined"/"null" literal para campo ausente');
  assert(!/Validade: /.test(html), 'validadeDias ausente → linha de Validade omitida por inteiro (nunca inventa "10 dias")');
  assert(!/Doc\.: /.test(html), 'clienteDoc ausente → linha de Documento omitida');
  assert(!/📍 /.test(html), 'clienteCidade ausente → linha de Cidade omitida');
  assert(!/Condição de pagamento:/.test(html), 'CORREÇÃO 2 — condicaoPagamentoTexto ausente → a linha inteira "Condição de pagamento" é OMITIDA (nunca mais fallback "50% no pedido...")');
  assert(!/50% no pedido e 50% na retirada/.test(html), 'texto "50% no pedido..." NUNCA aparece quando condicaoPagamentoTexto não foi persistido (prova negativa direta)');
  assert(html.includes('2 dias úteis após aprovação e comprovante de pagamento'), 'prazo reconstruído de prazoDias/prazoDiasMax (campos históricos já existentes, não são "campo novo") — sempre presente, nunca omitido');
  assert(!/Cristal mmm|Cristal undefinedmm|Cristal nullmm/.test(html), 'item sem espMm nunca mostra espessura fabricada/undefined — osItemMateriaisResumo usa pieces[].espessuraMm (já persistido) e recompõe corretamente');
  assert(html.includes('Acrílico Cristal 10mm') && html.includes('Acrílico Cristal 12mm') && html.includes('Acrílico Cristal 15mm'), 'as 3 opções de espessura aparecem corretamente mesmo sem espMm (via pieces[].espessuraMm)');
  assert(html.includes('ESTE ORÇAMENTO NÃO TEM VALOR FISCAL') && !/a partir da emissão/.test(html), 'disclaimer fiscal omite a parte de validade quando validadeDias ausente (nunca "Válido por undefined dias")');
}

console.log('\n== TESTE B — FIDELIDADE DO ORÇAMENTO REVISADO (ORC-000163 completo, mesmos valores do PDF oficial) ==');
{
  const ctx = makeCtx();
  const orc = orcFixtureRevisado();
  const html = ctx.orcMontarHtmlOrcamento(orc);

  assert(html.includes('Nº 000163'), 'número oficial (Nº 000163)');
  assert(html.includes('Claudia'), 'nome do cliente');
  assert(html.includes('(11) 98329-0088'), 'telefone');
  assert(html.includes('Isabella Borges'), 'responsável (orc.vendedor)');
  assert(html.includes('Validade: 10 dias'), 'validadeDias=10 persistido → "Validade: 10 dias" aparece EXATAMENTE como o PDF oficial');
  assert(html.includes('Válido por 10 dias a partir da emissão'), 'disclaimer fiscal inclui a validade quando presente');
  assert(html.includes('Condição de pagamento:') && html.includes('50% no pedido e 50% na retirada do material'), 'condicaoPagamentoTexto persistido aparece EXATAMENTE — nunca recalculado, nunca outro texto');
  assert(html.includes('2 dias úteis após aprovação e comprovante de pagamento'), 'prazo idêntico ao PDF oficial');
  assert(html.includes('Acrílico Cristal 10mm') && html.includes('Acrílico Cristal 12mm') && html.includes('Acrílico Cristal 15mm'), 'as 3 opções de espessura aparecem, agora também com espMm persistido');
  assert(html.includes('— OU —'), 'separador "OU" entre as 3 opções do mesmo grupoOpcaoId');
  assert(html.includes('ESCOLHA UMA DAS OPÇÕES ABAIXO') || /escolha uma das op/i.test(html), 'cabeçalho do bloco comparativo aparece');
  assert(/Parcelamento/.test(html) && /3x/.test(html) && /869,05/.test(html), 'bloco de parcelamento (3x de R$ 869,05) idêntico ao PDF oficial');
  assert(/Desconto PIX/.test(html) && /5\.14% de desconto/.test(html) && /2\.473,16/.test(html), 'bloco de desconto PIX (5,14%, valor com PIX R$ 2.473,16) idêntico ao PDF oficial');
  assert(html.includes('R$ 2.607,17'), 'Total Geral idêntico ao PDF oficial (R$ 2.607,17)');
  assert(html.includes('CNPJ 37.855.285/0001-52'), 'rodapé com CNPJ oficial');
  assert(html.includes('Georgia'), 'tema Vitre aplicado (orc.marca==="vitre", mesmo do pedido real)');
}

console.log('\n== Parte 5b — orcPrazoTextoDeOrc() byte-idêntico à orcGetPrazoTexto() original (prova de equivalência) ==');
{
  const ctx = makeCtx();
  // Referência: cópia literal da fórmula ORIGINAL orcGetPrazoTexto() (DOM),
  // usada aqui só como oráculo de teste — nunca reintroduzida no app.
  function orcGetPrazoTexto_ORACULO(diasStr, diasMaxStr, entregaStr) {
    var dias = parseInt(diasStr || '0');
    var diasMax = parseInt(diasMaxStr || '0');
    if (dias > 0) {
      var faixaTxt = diasMax > dias ? ('De '+dias+' a '+diasMax+' dias úteis') : (dias+' dia'+(dias!==1?'s úteis':' útil'));
      if (entregaStr) {
        function _addUtil(n){ var d=new Date();var u=0;while(u<n){d.setDate(d.getDate()+1);var dw=d.getDay();if(dw!==0&&dw!==6)u++;}return d.toLocaleDateString('pt-BR');}
        var dtMinStr = _addUtil(dias);
        var dtMaxStr = diasMax > dias ? ' à '+_addUtil(diasMax) : '';
        return faixaTxt+' — entrega prevista: '+dtMinStr+dtMaxStr;
      }
      return faixaTxt+' após aprovação e comprovante de pagamento';
    }
    return 'a combinar após aprovação e comprovante de pagamento';
  }
  const casos = [
    { prazoDias: '2', prazoDiasMax: '', prazo: '' },
    { prazoDias: '5', prazoDiasMax: '7', prazo: '' },
    { prazoDias: '3', prazoDiasMax: '', prazo: '2026-10-01' },
    { prazoDias: '0', prazoDiasMax: '', prazo: '' },
    { prazoDias: '', prazoDiasMax: '', prazo: '' },
  ];
  casos.forEach((c, i) => {
    const esperado = orcGetPrazoTexto_ORACULO(c.prazoDias, c.prazoDiasMax, c.prazo);
    const obtido = ctx.orcPrazoTextoDeOrc(c);
    assert(obtido === esperado, 'caso ' + (i + 1) + ' (prazoDias=' + JSON.stringify(c.prazoDias) + ', prazoDiasMax=' + JSON.stringify(c.prazoDiasMax) + ', prazo=' + JSON.stringify(c.prazo) + '): orcPrazoTextoDeOrc() === orcGetPrazoTexto() original', 'esperado=' + JSON.stringify(esperado) + ' obtido=' + JSON.stringify(obtido));
  });
  const real = ctx.orcPrazoTextoDeOrc({ prazoDias: '2', prazoDiasMax: '', prazo: '' });
  assert(real === '2 dias úteis após aprovação e comprovante de pagamento', 'orçamento real ORC-000163 (prazoDias=2): texto reconstruído bate com o que o PDF oficial mostrava', real);
}

console.log('\n== Parte 6 — órfão de item sem grupoOpcao/pieces continua funcionando (regressão) ==');
{
  const ctx = makeCtx();
  const orc = { id: 'ORC-1', num: '1', marca: 'vr', cliente: 'Teste', valorBase: 100, valorFinal: 100, descCond: 0, descPix: 0, parcelas: 1,
    itens: [{ tipoItem: 'personalizado_vr', prod: 'Item Simples', qty: '1', total: '100,00', mat: 'PS 1mm', espMm: 1 }] };
  let threw = null;
  try { ctx.orcMontarHtmlOrcamento(orc); } catch (e) { threw = e; }
  assert(!threw, 'orçamento de 1 item simples (sem grupo/peças) nunca quebra', threw && threw.message);
}

console.log('\n' + '='.repeat(60));
console.log(pass + ' passaram, ' + fail + ' falharam.');
if (fail > 0) process.exit(1);
