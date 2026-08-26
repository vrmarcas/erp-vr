/**
 * test_estabilizacao_bloco_a_b_orcamento_2026-08-23.js
 *
 * RODADA DE ESTABILIZAÇÃO (2026-08-23) — Blocos A e B.
 *
 * BLOCO A — bug real de produção: abrir um orçamento já enviado para
 * editar mostrava a tela praticamente vazia (Cliente em branco, "Total de
 * itens: 0un", "Custo Direto: R$0,00", "Valor Final: R$0,00"), mesmo o
 * orçamento tendo dados reais salvos. Causa raiz: orcEnvEditar() não tinha
 * NENHUM try/catch — qualquer exceção durante a restauração de um item
 * abortava a função inteira em silêncio, inclusive orcRecalc()/orcStep(4)
 * no final, que são os ÚNICOS pontos que repintam o resumo. Corrigido
 * envolvendo a hidratação em try/catch (nunca engole o erro — console.error
 * + toast) e garantindo que orcRecalc()/orcStep(4)/orcAplicarSnapshotCongelado
 * rodem SEMPRE, mesmo que a hidratação tenha falhado parcialmente.
 *
 * BLOCO B — bug real: um orçamento enviado ao cliente mostrando R$1.175,71
 * passou a mostrar R$1.142,83 ao reabrir para editar, sem nenhuma alteração
 * do usuário. Causa raiz: orcEnvEditar() nunca lia o valorFinal/breakdown
 * CONGELADO (já persistido há várias rodadas) — só restaurava os INPUTS e
 * deixava orcRecalc() recalcular do zero com a config VIGENTE (preço de
 * material, overhead/vrml/impostos atuais). Corrigido com
 * orcAplicarSnapshotCongelado(o), que sobrepõe o valor congelado por cima
 * do recálculo ao vivo — nunca um segundo motor de cálculo, só um overlay
 * de exibição usando dados JÁ salvos. "Edição real" (o usuário muda algo)
 * continua recalculando ao vivo normalmente — o overlay só protege contra
 * mudança SILENCIOSA por reabertura.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * orcAplicarSnapshotCongelado, orcFmt, e (harness separado) orcRecalc.
 * A estrutura de try/catch de orcEnvEditar em si é grande demais para
 * mockar toda a árvore de dependências (~15 funções) num teste unitário
 * puro — verificada por asserção ESTRUTURAL sobre o código-fonte real
 * (mesmo princípio de assertOnclickBemFormado de rodadas anteriores:
 * precisão sobre substring, nunca um regex frouxo demais para pegar
 * regressão real) + comportamento real do overlay/hook via execução.
 *
 * Uso: node scripts/test_estabilizacao_bloco_a_b_orcamento_2026-08-23.js
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

console.log('\n=== RODADA DE ESTABILIZAÇÃO — Bloco A (orçamento zerado) + Bloco B (preço muda sozinho) ===\n');

// ══════════════════════════════════════════════════════════════════════════
// PARTE 1 — orcAplicarSnapshotCongelado() isolada (comportamento real)
// ══════════════════════════════════════════════════════════════════════════
(function () {
  // HOTFIX BLOCO G (Rodada de Hardening, Fase 2, 2026-08-26) — orcAplicarSnapshotCongelado()
  // passou a checar valorFinal via orcEnvNormalizar() (schema legado × ValerIA), nunca reimplementada.
  var FN_NAMES = ['orcFmt', 'orcAplicarSnapshotCongelado', 'orcEnvNormalizar'];
  var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
  var modPath = path.join(__dirname, '_estabilizacao_bloco_ab_congelado.tmp.js');
  fs.writeFileSync(modPath, src);

  function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, style: {}, dataset: {} }, props || {}); }
  var _els, _created;
  function reset() {
    _els = {
      oi_unit_1: makeEl({ textContent: 'R$50,00' }), oi_tot_1: makeEl({ textContent: 'R$50,00' }),
      oi_unit_2: makeEl({ textContent: 'R$30,00' }), oi_tot_2: makeEl({ textContent: 'R$60,00' }),
      orcRsmCusto: makeEl({ textContent: 'R$40,00' }), orcRsmTotal: makeEl({ textContent: 'R$40,00' }),
    };
    _created = [];
    global.window = global;
    global.document = {
      getElementById: function (id) { return _els[id] || null; },
      createElement: function () { var el = makeEl(); el.id = ''; _created.push(el); return el; },
      querySelector: function (sel) { return sel === '#pg-orcamento .card' ? { insertBefore: function (el) { el._inserted = true; } } : null; },
    };
  }

  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  // 1 — orçamento com valorFinal + itens salvos: overlay aplica os valores CONGELADOS
  reset();
  var orcCongelado = {
    num: '000057', valorFinal: 806.84,
    itens: [
      { tipoItem: 'personalizado_vr', unit: 'R$45,46', total: 'R$45,46' },
      { tipoItem: 'vitre_catalogo', prod: 'Item Vitre' }, // pulado — não conta ri
      { tipoItem: 'personalizado_vr', unit: 'R$45,46', total: 'R$90,92' },
    ],
    snapshotCompleto: { breakdown: { totalCost: 166.85 } },
  };
  // simula um recálculo AO VIVO anterior que teria produzido números diferentes
  _els.oi_unit_1.textContent = 'R$47,90'; _els.oi_tot_1.textContent = 'R$47,90';
  _els.oi_unit_2.textContent = 'R$47,90'; _els.oi_tot_2.textContent = 'R$95,80';
  _els.orcRsmCusto.textContent = 'R$180,00'; _els.orcRsmTotal.textContent = 'R$850,00';
  mod.orcAplicarSnapshotCongelado(orcCongelado);
  test('1. item 1: unit sobrescrito pelo valor CONGELADO (R$45,46), não o recalculado ao vivo (R$47,90)', _els.oi_unit_1.textContent, 'R$45,46');
  test('2. item 2 (índice 2, pulando o item Vitre no meio): total congelado R$90,92, nunca o valor ao vivo', _els.oi_tot_2.textContent, 'R$90,92');
  assertTrue(_els.orcRsmCusto.textContent.indexOf('166,85') >= 0 && _els.orcRsmCusto.textContent.indexOf('180,00') < 0, '3. custo total do resumo sobrescrito pelo breakdown congelado (166,85), nunca o recalculado ao vivo (180,00)');
  assertTrue(_els.orcRsmTotal.textContent.indexOf('806,84') >= 0 && _els.orcRsmTotal.textContent.indexOf('850,00') < 0, '4. valor final do resumo sobrescrito por o.valorFinal congelado — o caso real relatado (806,84), nunca 850,00 recalculado ao vivo');
  assertTrue(global._orcMostrandoCongelado === true, '5. flag _orcMostrandoCongelado fica true — sinaliza que a tela está exibindo o valor congelado, não um recálculo');
  assertTrue(_created.length === 1 && _created[0]._inserted === true, '6. banner de aviso ("valor ENVIADO originalmente") é criado e inserido na tela — nunca uma troca de número silenciosa sem explicação');
  assertTrue(_created[0].innerHTML.indexOf('806,84') >= 0, '7. banner menciona o valor congelado real, não um texto genérico');

  // 8 — orçamento legado (sem valorFinal utilizável): nunca inventa um congelado
  reset();
  mod.orcAplicarSnapshotCongelado({ num: '000010', valorFinal: 0, itens: [] });
  assertTrue(global._orcMostrandoCongelado === false, '8. orçamento legado sem valorFinal: NUNCA inventa um valor congelado (regra "não inventar dado ausente") — flag fica false');
  test('9. orçamento legado: itens do DOM não são tocados (continuam com o que orcRecalc() já calculou ao vivo)', _els.oi_unit_1.textContent, 'R$50,00');

  // 10 — o() null/undefined nunca lança exceção
  reset();
  var threw = false;
  try { mod.orcAplicarSnapshotCongelado(null); } catch (e) { threw = true; }
  assertTrue(!threw, '10. orcAplicarSnapshotCongelado(null) nunca lança exceção — chamável com segurança de dentro de um catch()');
})();

// ══════════════════════════════════════════════════════════════════════════
// PARTE 2 — hook de "revisão" no final de orcRecalc() (comportamento real)
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var FN_NAMES = ['orcFmt', 'orcRecalc'];
  var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
  var modPath = path.join(__dirname, '_estabilizacao_bloco_ab_recalc.tmp.js');
  fs.writeFileSync(modPath, src);

  function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, style: {}, dataset: {}, remove: function () {} }, props || {}); }
  var _els, _toasts;
  function reset() {
    _els = {
      cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
      orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
      om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
      om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
      oi_qty_1: makeEl({ value: '1' }), oi_larg_1: makeEl({ value: '100' }), oi_alt_1: makeEl({ value: '100' }),
      oi_mat_1: makeEl({ value: 'ac3' }),
      oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }), oc_imp: makeEl({ value: '0' }),
      oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
      orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
      oi_custo_1: makeEl(), oi_unit_1: makeEl(), oi_tot_1: makeEl(),
      oir_1: makeEl(),
      orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
      orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
      soCorteValor: makeEl(),
      orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(),
      orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl(),
    };
    global.document = {
      body: { appendChild: function () {} },
      createElement: function () { return makeEl(); },
      getElementById: function (id) { return _els[id] || (_els[id] = makeEl()); },
      querySelector: function () { return null; },
      querySelectorAll: function (sel) {
        if (sel === '#orcItemBody tr') return [{ dataset: { idx: '1' } }];
        return [];
      }
    };
    global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
    global._matGetRsm2 = function () { return 100; };
    global.ORC_ITEM_EXTRAS = {}; global.ORC_ITEM_AJUSTES = {}; global.ORC_ITEM_OPCOES = {};
    global._orcVitreItensPedido = [];
    global.orcVitreItensPedidoTotal = function () { return 0; };
    global.window = global;
    global.orcItemCount = 1;
    global.orcUpdateSummary = function () {};
    global.orcSetV = function (id, v) { var el = _els[id] || (_els[id] = makeEl()); el.value = v; };
    global._orcHidratando = false;
    global._orcMostrandoCongelado = false;
    _toasts = [];
    global.showToast = function (msg, kind) { _toasts.push({ msg: msg, kind: kind }); };
  }

  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  // 11 — durante a hidratação (_orcHidratando=true), múltiplas chamadas de
  // orcRecalc() NUNCA derrubam a flag de congelado nem disparam o toast de revisão.
  reset();
  global._orcHidratando = true;
  global._orcMostrandoCongelado = true;
  mod.orcRecalc(); mod.orcRecalc(); mod.orcRecalc(); // simula as várias chamadas internas de orcMatChanged por item durante a hidratação
  assertTrue(global._orcMostrandoCongelado === true, '11. várias chamadas de orcRecalc() DURANTE a hidratação (_orcHidratando=true) nunca derrubam o modo congelado');
  assertTrue(_toasts.length === 0, '12. nenhum toast de "revisão" disparado enquanto ainda hidratando — evita alarme falso no meio da restauração');

  // 13 — depois que a hidratação termina (_orcHidratando=false), a PRÓXIMA
  // chamada de orcRecalc() (disparada por uma edição real do usuário) DERRUBA
  // o modo congelado e avisa que é uma revisão.
  reset();
  global._orcHidratando = false;
  global._orcMostrandoCongelado = true;
  mod.orcRecalc();
  assertTrue(global._orcMostrandoCongelado === false, '13. edição real do usuário (fora da hidratação) sai do modo congelado — "Edição real" pode recalcular, por regra explícita');
  assertTrue(_toasts.length === 1 && _toasts[0].msg.toLowerCase().indexOf('revis') >= 0, '14. usuário é avisado explicitamente de que está vendo uma revisão, nunca uma troca de valor silenciosa');

  // 15 — orçamento novo (nunca esteve em modo congelado): orcRecalc() nunca dispara o toast à toa
  reset();
  mod.orcRecalc();
  assertTrue(_toasts.length === 0, '15. Novo Orçamento (nunca em modo congelado) — orcRecalc() normal nunca dispara toast de revisão indevido — zero regressão para o fluxo comum');
})();

// ══════════════════════════════════════════════════════════════════════════
// PARTE 3 — Bloco A: estrutura real de try/catch em orcEnvEditar (asserção
// sobre o código-fonte — mockar toda a árvore de dependências dessa função
// não é viável num teste unitário puro; a garantia estrutural É o fix).
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var srcEnvEditar = extractFn('orcEnvEditar');

  assertTrue(/window\._orcHidratando\s*=\s*true/.test(srcEnvEditar), '16. orcEnvEditar marca _orcHidratando=true antes de começar a restaurar dados');
  assertTrue(/try\s*\{/.test(srcEnvEditar), '17. orcEnvEditar agora tem pelo menos um try{} — antes desta rodada não tinha NENHUM (achado da auditoria)');
  assertTrue(/catch\s*\(_eHidratacao\)/.test(srcEnvEditar), '18. existe um catch dedicado para a hidratação (nome específico, não um catch genérico solto)');
  assertTrue(/console\.error\(.*orcEnvEditar.*falha ao restaurar/i.test(srcEnvEditar), '19. o catch da hidratação LOGA o erro real (console.error) — nunca engole em silêncio');
  assertTrue(/showToast\('Este orçamento não pôde ser restaurado completamente/.test(srcEnvEditar), '20. o catch da hidratação AVISA o operador com um toast claro — nunca falha silenciosa');

  // A garantia central do Bloco A: orcRecalc()/orcStep(4)/orcAplicarSnapshotCongelado
  // precisam estar FORA do try (ou em seus próprios try/catch subsequentes),
  // nunca aninhados de um jeito que uma exceção no catch os impeça de rodar.
  var catchIdx = srcEnvEditar.indexOf('catch(_eHidratacao)');
  var tailApósCatch = srcEnvEditar.slice(catchIdx);
  assertTrue(/window\._orcHidratando\s*=\s*false/.test(tailApósCatch), '21. _orcHidratando volta a false DEPOIS do catch — sempre executa, hidratação tendo falhado ou não');
  assertTrue(/try\s*\{\s*orcRecalc\(\);\s*\}\s*catch/.test(tailApósCatch), '22. orcRecalc() roda em seu próprio try/catch, garantido, depois do catch principal — nunca fica pendente de a hidratação ter dado certo');
  assertTrue(/try\s*\{\s*orcStep\(4\);\s*\}\s*catch/.test(tailApósCatch), '23. orcStep(4) roda em seu próprio try/catch, garantido, na mesma seção — sempre repinta a etapa/resumo');
  assertTrue(/try\s*\{\s*orcAplicarSnapshotCongelado\(o\);\s*\}\s*catch/.test(tailApósCatch), '24. orcAplicarSnapshotCongelado(o) (Bloco B) roda garantido, mesmo que a hidratação de itens tenha falhado parcialmente');
})();

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
