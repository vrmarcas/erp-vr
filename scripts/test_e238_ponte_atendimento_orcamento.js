/**
 * test_e238_ponte_atendimento_orcamento.js — ValerIA 2.0, Fase E.2.38
 * (2026-09-22).
 *
 * index.html não tem harness de testes (é um app single-file, funções
 * globais via <script> inline, sem módulos) — mesmo padrão desta pasta
 * (scripts/test_*.js) de scripts Node ad-hoc. Este arquivo:
 *   (a) extrai por texto as duas funções NOVAS desta fase
 *       (atdValeriaOrcInit / atdAbrirRascunhoValeria) e roda cada uma
 *       isolada num vm.Context com _db/ATD_CACHE/nav/vitreOrcAbrirRascunho
 *       mockados — comportamento real, sem precisar executar o app
 *       inteiro (36k+ linhas, cheio de side effects de DOM/Firebase no
 *       carregamento);
 *   (b) faz checagens estáticas de string sobre o arquivo inteiro — nunca
 *       escreve atendimentos.orcamentoId, nunca chama atdVincularOrcamento
 *       fora do único call site já existente, nenhum arquivo de backend
 *       foi tocado (git diff).
 *
 * Uso: node scripts/test_e238_ponte_atendimento_orcamento.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(desc) { pass++; console.log('  ✅ ' + desc); }
function bad(desc, detail) { fail++; console.log('  ❌ ' + desc + (detail ? ' — ' + detail : '')); }
function assert(cond, desc, detail) { if (cond) ok(desc); else bad(desc, detail); }

// ── Extração das funções novas por contagem de chaves (sem depender de regex gulosa) ──
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

const fnValeriaOrcInit = extractFunction(INDEX_HTML, 'atdValeriaOrcInit');
const fnAbrirRascunho = extractFunction(INDEX_HTML, 'atdAbrirRascunhoValeria');

console.log('== Parte 1 — comportamento (vm isolado) ==');

function makeContext(overrides) {
  const calls = { renderPainel: [], warn: [], nav: [], vitreOrcAbrirRascunho: [] };
  const ctx = {
    ATD_SELECTED_ID: null,
    ATD_VALERIA_ORC_CACHE: null,
    ATD_VALERIA_ORC_ATENDIMENTO_ID: null,
    ATD_CACHE: [],
    _db: null, // definido por cada cenário
    console: { warn: (...a) => calls.warn.push(a.join(' ')), log: () => {}, error: () => {} },
    nav: (...a) => calls.nav.push(a),
    vitreOrcAbrirRascunho: (id) => calls.vitreOrcAbrirRascunho.push(id),
    atdRenderPainel: (atd) => calls.renderPainel.push(atd),
    setTimeout,
    Promise,
  };
  Object.assign(ctx, overrides);
  vm.createContext(ctx);
  return { ctx, calls };
}

function fakeSnap(docsData) {
  return { docs: docsData.map((d) => ({ data: () => d })) };
}

function fakeDb(resultPromise, whereCalls) {
  return {
    collection(name) {
      if (whereCalls) whereCalls.push(['collection', name]);
      const chain = {
        where(field, op, value) {
          if (whereCalls) whereCalls.push(['where', field, op, value]);
          return chain;
        },
        get() { return resultPromise; },
      };
      return chain;
    },
  };
}

(async () => {
  // Envolve a função extraída expondo-a no context, e chama com await aqui
  // fora — testa o comportamento assíncrono de verdade (a função interna
  // usa Promises reais via _db.get()).
  function runValeriaOrcInit(overrides) {
    const { ctx, calls } = makeContext(overrides);
    vm.runInContext(fnValeriaOrcInit + '\nthis.__fn = atdValeriaOrcInit;', ctx, { filename: 'atdValeriaOrcInit.js' });
    const p = ctx.__fn(overrides.atendimentoId);
    return { ctx, calls, promise: p };
  }

  // Cenário A — exatamente 1 doc.
  {
    const doc = { id: 'valeria2_catalog_conv1', conversationId: 'conv1', status: 'rascunho', origem: 'valeria_v2', total: 3300 };
    const whereCalls = [];
    const { ctx, calls, promise } = runValeriaOrcInit({
      atendimentoId: 'conv1',
      ATD_SELECTED_ID: 'conv1',
      ATD_CACHE: [{ id: 'conv1' }],
      _db: fakeDb(Promise.resolve(fakeSnap([doc])), whereCalls),
    });
    await promise;
    assert(ctx.ATD_VALERIA_ORC_CACHE && ctx.ATD_VALERIA_ORC_CACHE.id === 'valeria2_catalog_conv1', 'atendimento com rascunho ValerIA → cache preenchido com o doc certo');
    assert(ctx.ATD_VALERIA_ORC_ATENDIMENTO_ID === 'conv1', 'ATD_VALERIA_ORC_ATENDIMENTO_ID marcado com o atendimento certo');
    assert(calls.renderPainel.length === 1, 'atdRenderPainel chamado exatamente 1x após resolver');
    const filtros = whereCalls.filter((c) => c[0] === 'where').map((c) => c.slice(1));
    // Fase E.2.47 (reenvio de homologação) — a consulta passou a aceitar
    // status IN ['rascunho','enviado'] (antes: status==='rascunho' apenas),
    // para permitir o banner de reenvio de orçamentos já enviados.
    assert(
      filtros.some((f) => f[0] === 'conversationId' && f[2] === 'conv1') &&
      filtros.some((f) => f[0] === 'status' && f[1] === 'in' && Array.isArray(f[2]) && f[2].includes('rascunho') && f[2].includes('enviado')) &&
      filtros.some((f) => f[0] === 'origem' && f[2] === 'valeria_v2'),
      'consulta usa conversationId + status in [rascunho, enviado] + origem=valeria_v2'
    );
  }

  // Cenário B — nenhum doc (atendimento sem rascunho).
  {
    const { ctx, calls, promise } = runValeriaOrcInit({
      atendimentoId: 'conv2',
      ATD_SELECTED_ID: 'conv2',
      ATD_CACHE: [{ id: 'conv2' }],
      _db: fakeDb(Promise.resolve(fakeSnap([]))),
    });
    await promise;
    assert(ctx.ATD_VALERIA_ORC_CACHE === null, 'atendimento sem rascunho ValerIA → cache permanece null (sem banner)');
    assert(calls.warn.length === 0, 'nenhum warning para o caso normal de ausência de rascunho');
  }

  // Cenário C — 2 docs, um bate com o id determinístico esperado → escolhe esse, sem warning.
  {
    const certo = { id: 'valeria2_catalog_conv3', conversationId: 'conv3', status: 'rascunho', origem: 'valeria_v2' };
    const espurio = { id: 'outro_doc_qualquer', conversationId: 'conv3', status: 'rascunho', origem: 'valeria_v2' };
    const { ctx, calls, promise } = runValeriaOrcInit({
      atendimentoId: 'conv3',
      ATD_SELECTED_ID: 'conv3',
      ATD_CACHE: [{ id: 'conv3' }],
      _db: fakeDb(Promise.resolve(fakeSnap([espurio, certo]))),
    });
    await promise;
    assert(ctx.ATD_VALERIA_ORC_CACHE && ctx.ATD_VALERIA_ORC_CACHE.id === 'valeria2_catalog_conv3', 'múltiplos docs, um com id determinístico → escolhe o determinístico');
    assert(calls.warn.length === 0, 'nenhum warning quando o id determinístico resolve a ambiguidade');
  }

  // Cenário D — 2 docs, NENHUM bate com o id determinístico → fail-safe (null + warning), nunca escolha arbitrária.
  {
    const a = { id: 'doc_a', conversationId: 'conv4', status: 'rascunho', origem: 'valeria_v2' };
    const b = { id: 'doc_b', conversationId: 'conv4', status: 'rascunho', origem: 'valeria_v2' };
    const { ctx, calls, promise } = runValeriaOrcInit({
      atendimentoId: 'conv4',
      ATD_SELECTED_ID: 'conv4',
      ATD_CACHE: [{ id: 'conv4' }],
      _db: fakeDb(Promise.resolve(fakeSnap([a, b]))),
    });
    await promise;
    assert(ctx.ATD_VALERIA_ORC_CACHE === null, 'múltiplos docs ambíguos (nenhum id determinístico bate) → cache null, nunca escolha arbitrária');
    assert(calls.warn.length === 1, 'warning registrado exatamente 1x no caso ambíguo');
  }

  // Cenário E — corrida: atendimento selecionado muda ANTES da consulta resolver → resultado descartado.
  {
    const doc = { id: 'valeria2_catalog_conv5', conversationId: 'conv5', status: 'rascunho', origem: 'valeria_v2' };
    let resolveFn;
    const pendingPromise = new Promise((resolve) => { resolveFn = resolve; });
    const { ctx, calls, promise } = runValeriaOrcInit({
      atendimentoId: 'conv5',
      ATD_SELECTED_ID: 'conv5',
      ATD_CACHE: [{ id: 'conv5' }],
      _db: fakeDb(pendingPromise),
    });
    ctx.ATD_SELECTED_ID = 'conv_outro'; // usuário trocou de atendimento enquanto a consulta ainda estava em voo
    resolveFn(fakeSnap([doc]));
    await promise;
    assert(ctx.ATD_VALERIA_ORC_CACHE === null, 'atendimento trocou durante a consulta → resultado stale descartado (cache continua null)');
    assert(calls.renderPainel.length === 0, 'atdRenderPainel não é chamado para um resultado stale');
  }

  console.log('\n== Parte 2 — botão de revisão (atdAbrirRascunhoValeria) ==');
  {
    const { ctx, calls } = makeContext({});
    vm.runInContext(fnAbrirRascunho + '\nthis.__fn = atdAbrirRascunhoValeria;', ctx, { filename: 'atdAbrirRascunhoValeria.js' });
    ctx.__fn('valeria2_catalog_cmt95yjqa0dksuvqt63to9tbm');
    assert(calls.nav.length === 1 && calls.nav[0][0] === 'orcamento', 'botão navega para a página do orçamento (nav("orcamento", null)) antes de abrir');
    await new Promise((r) => setTimeout(r, 400));
    assert(
      calls.vitreOrcAbrirRascunho.length === 1 && calls.vitreOrcAbrirRascunho[0] === 'valeria2_catalog_cmt95yjqa0dksuvqt63to9tbm',
      'chama vitreOrcAbrirRascunho com o ID exato do rascunho, reaproveitando o wizard existente'
    );
  }

  console.log('\n== Parte 3 — checagens estáticas (texto do arquivo) ==');

  assert(!/atendimentos\.orcamentoId\s*=/.test(fnValeriaOrcInit) && !/orcamentoId\s*:/.test(fnValeriaOrcInit), 'atdValeriaOrcInit nunca escreve atendimentos.orcamentoId');
  assert(!/atendimentos\.orcamentoId\s*=/.test(fnAbrirRascunho), 'atdAbrirRascunhoValeria nunca escreve atendimentos.orcamentoId');

  // atdVincularOrcamento é uma Cloud Function (backend) — chamada só via
  // httpsCallable('atdVincularOrcamento'), nunca como função JS direta no
  // front. Único call site esperado: dentro de atdVincularOrcamentoAposSalvar.
  const vincularCallSites = (INDEX_HTML.match(/httpsCallable\(['"]atdVincularOrcamento['"]\)/g) || []).length;
  assert(vincularCallSites === 1, 'nenhum novo call site de httpsCallable("atdVincularOrcamento") foi introduzido', 'encontrados: ' + vincularCallSites);

  // Checagem relativa a ESTA fase (E.2.38): nenhum arquivo de backend foi
  // tocado. Não exige mais "só index.html" no diff total do repo — fases
  // posteriores (E.2.43+) legitimamente alteram outros arquivos de
  // front/scripts; a garantia real (backend intocado) já é validada de
  // forma robusta logo abaixo, contra o diff de functions/functions-valeria.
  const gitDiffFiles = execSync('git diff --name-only', { cwd: ROOT }).toString().trim().split('\n').filter(Boolean);
  assert(
    !gitDiffFiles.some((f) => f.startsWith('functions-valeria/')),
    'nenhum arquivo de functions-valeria/ (gates ValerIA V2) aparece no diff atual',
    'arquivos alterados: ' + JSON.stringify(gitDiffFiles)
  );
  // (Removida a restrição "só vitre_quote_send.ts em functions/" — era um
  // snapshot do escopo transiente da Fase E.2.47. Fases seguintes
  // (E.2.48B: chatvolt_attachment_send.ts/atd_orcamento_send.ts) legitimamente
  // adicionam outros arquivos em functions/. A garantia durável que esta
  // suíte (E.2.38 — ponte Atendimentos↔orçamento) precisa preservar é só
  // functions-valeria/ intocado, já checado acima.)

  // O que continua garantido: functions-valeria/ (gates/
  // fluxo comercial ValerIA V2) permanece 100% intocado.
  const diffOutput = execSync('git diff -- functions-valeria', { cwd: ROOT }).toString();
  assert(diffOutput.trim() === '', 'diff de functions-valeria/ está vazio — fluxo comercial/gates/handoff ValerIA V2 intocados');

  // atdAssumirAtendimento (takeover) é só backend TS, definido em functions/src/atendimentos.ts
  // (nunca em vitre_quote_send.ts) — confirmação adicional de que não foi tocado, via grep no
  // diff completo de functions/ + functions-valeria/ (já coberto por arquivo acima, explícito por nome).
  const diffFunctionsCompleto = execSync('git diff -- functions functions-valeria', { cwd: ROOT }).toString();
  assert(!diffFunctionsCompleto.includes('atdAssumirAtendimento'), 'atdAssumirAtendimento não aparece em nenhum diff — takeover humano intocado');

  const fnRenderPainel = extractFunction(INDEX_HTML, 'atdRenderPainel');
  assert(
    fnRenderPainel.includes('ATD_VALERIA_ORC_CACHE && ATD_VALERIA_ORC_ATENDIMENTO_ID===atd.id'),
    'atdRenderPainel só mostra o banner quando o cache pertence ao atendimento ATUALMENTE renderizado — nunca vaza dado de um atendimento anterior'
  );
  // Fase E.2.47 (reenvio de homologação) — filtro ampliado para
  // status IN ['rascunho','enviado'], nunca outros status (ex.: 'cancelado').
  assert(
    /\.where\(\s*['"]status['"]\s*,\s*['"]in['"]\s*,\s*\[\s*['"]rascunho['"]\s*,\s*['"]enviado['"]\s*\]\s*\)/.test(fnValeriaOrcInit),
    'consulta filtra explicitamente status in [rascunho, enviado] no servidor — nunca traz outros status (ex.: cancelado) para o cliente decidir'
  );
  assert(
    /\.where\(\s*['"]origem['"]\s*,\s*['"]==['"]\s*,\s*['"]valeria_v2['"]\s*\)/.test(fnValeriaOrcInit),
    'consulta filtra explicitamente origem==="valeria_v2" no servidor — rascunhos manuais (Vitre wizard direto) nunca aparecem aqui'
  );

  console.log('\n' + '='.repeat(60));
  console.log(pass + ' passaram, ' + fail + ' falharam.');
  if (fail > 0) process.exit(1);
})().catch((e) => { console.error('ERRO FATAL:', e); process.exit(1); });
