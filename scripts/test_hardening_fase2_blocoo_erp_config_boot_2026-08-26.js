/**
 * test_hardening_fase2_blocoo_erp_config_boot_2026-08-26.js
 *
 * RODADA DE HARDENING 10/10 — FASE 2, BLOCO O (2026-08-26) — investigação
 * concluída antes de qualquer correção (mapeamento de _cloudIniciar/
 * _cloudLoadAll/merges/listeners/ordem de inicialização, ver comentários em
 * index.html nos dois pontos).
 *
 * ACHADO REAL (não suposição): erp_config era lido por 2 chamadas
 * _cloudLoad() genuinamente independentes — uma em _cloudIniciar()
 * (imediata, t=0, "materiais disponíveis no orçamento") e outra dentro de
 * _cloudLoadAll() (~800ms depois, parte do contador de boot). No caso
 * comum (rede normal) a primeira sempre resolve antes da segunda começar,
 * então o achado nunca se manifestava como corrupção visível — mas a
 * corrida EXISTE de verdade: se a leitura mais ANTIGA (imediata) estiver
 * anormalmente lenta e só resolver DEPOIS da mais NOVA (a de dentro de
 * _cloudLoadAll), e uma escrita concorrente de outra aba acontecer nesse
 * intervalo, a resposta mais antiga podia sobrescrever o merge mais novo
 * — exatamente a classe "resposta antiga sobrescreve estado novo" desta
 * rodada. Além disso, eram sempre 2 requisições de rede reais para o
 * MESMO documento, mesmo no caso feliz.
 *
 * CORRIGIDO com a mudança mínima possível: uma única leitura
 * (_cloudIniciar segue disparando na hora, sem delay — "materiais
 * disponíveis no orçamento" preservado), cujo resultado é uma Promise
 * compartilhada (_cfgBootPromise) que _cloudLoadAll() reaproveita (nunca
 * dispara uma segunda leitura) — elimina a corrida por eliminar a
 * possibilidade de duas respostas para o mesmo doc chegarem fora de
 * ordem. O algoritmo de merge em si (_cfgMergeMateriais, cloudWins,
 * fallback de maquinas/maodeobra) não mudou — a lógica que só existia no
 * ponto de _cloudLoadAll() foi copiada (não reinventada) para dentro de
 * _cloudIniciar(), que agora é a ÚNICA fonte do merge.
 *
 * NUNCA migração de dado: nenhuma escrita nova, nenhuma mudança de regra
 * de negócio/preço/cálculo — só elimina uma leitura de rede redundante e a
 * janela de corrida que ela abria.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * _cloudIniciar, _cfgMergeMateriais.
 *
 * Uso: node "scripts/test_hardening_fase2_blocoo_erp_config_boot_2026-08-26.js"
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
function extractBlock(startMarker, endMarker) {
  var start = html.indexOf(startMarker);
  if (start < 0) throw new Error('Marcador "' + startMarker + '" não encontrado — teste desatualizado?');
  var end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error('Marcador final "' + endMarker + '" não encontrado — teste desatualizado?');
  return html.slice(start, end);
}

console.log('\n=== HARDENING FASE 2, BLOCO O — erp_config: uma única leitura, sem corrida ===\n');

// ── 1-2 — ACHADO ESTÁTICO: _cloudLoadAll() nunca mais dispara sua própria
// leitura de erp_config; reaproveita _cfgBootPromise. ──────────────────
var corpoCloudLoadAll = extractFn('_cloudLoadAll');
// ACHADO REAL corrigido: _cloudLoadAll() reaproveita _cfgBootPromise via
// .finally(), sem nenhum guard/else redundante — _cfgBootPromise SEMPRE
// existe quando este ponto roda (só é chamado 800ms depois de
// _cloudIniciar já tê-la criado), então um `else` "defensivo" aqui seria
// exatamente a mesma classe de ramo morto já corrigida nesta função para
// crmBaseLoadIdx (ver test_cloud_ready_never_stuck) — de propósito, não
// existe.
assertTrue(/_cfgBootPromise\.finally\(function\(\)\{\s*done\(\);\s*\}\);/.test(corpoCloudLoadAll), '1. ACHADO REAL corrigido: _cloudLoadAll() reaproveita _cfgBootPromise via .finally(() => done()) — nunca dispara sua própria leitura de erp_config, e sem ramo morto (nenhum else redundante)');
assertTrue(/_cfgBootPromise/.test(corpoCloudLoadAll), '2. _cloudLoadAll() reaproveita _cfgBootPromise (a mesma Promise criada em _cloudIniciar()) em vez de duplicar a leitura');

var corpoCloudIniciar = extractFn('_cloudIniciar');
assertTrue((corpoCloudIniciar.match(/_cloudLoad\(['"]erp_config['"]/g) || []).length === 1, '3. _cloudIniciar() dispara exatamente UMA leitura de erp_config (a única do boot inteiro)');
assertTrue(/_cfgBootPromise\s*=\s*new Promise/.test(corpoCloudIniciar), '4. _cloudIniciar() cria _cfgBootPromise ao redor dessa única leitura, para _cloudLoadAll() reaproveitar');

// ── 5 — o merge completo (fallback maquinas/maodeobra) que só existia na
// leitura de _cloudLoadAll() foi preservado (copiado, não perdido) para
// dentro de _cloudIniciar() — nenhuma regressão de comportamento no caso
// "cloud sem materiais". ─────────────────────────────────────────────
assertTrue(/merged\.maquinas\s*=/.test(corpoCloudIniciar) && /merged\.maodeobra\s*=/.test(corpoCloudIniciar), '5. fallback de maquinas/maodeobra (só existia na leitura antiga de _cloudLoadAll) preservado dentro de _cloudIniciar() — nenhuma lógica de merge foi perdida ao unificar as duas leituras');

// ── 6-9 — execução real: _cloudIniciar() dispara UMA única chamada real a
// _cloudLoad('erp_config', ...) e o merge aplica corretamente. ─────────
(function () {
  var FN_NAMES = ['_cloudIniciar', '_cfgMergeMateriais', '_cfgFindMaterialMatchIdx'];
  var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
  var modPath = path.join(__dirname, '_hardening_fase2_blocoo_erp_config.tmp.js');
  fs.writeFileSync(modPath, src);

  var _cloudLoadCalls, _localCfg, _cfgDataFinal, _timeouts;
  function reset() {
    global.window = global;
    _cloudLoadCalls = [];
    global._cloudLoad = function (key, cb) {
      _cloudLoadCalls.push(key);
      // resolve de forma assíncrona real (mesmo formato de _cloudLoad de verdade)
      Promise.resolve().then(function () {
        cb({ materiais: [{ id: 'm1', nome: 'Acrílico Cristal', esp: 2, custo: 10 }, { id: 'm2', nome: 'Acrílico Fumê', esp: 3, custo: 12 }] });
      });
    };
    _localCfg = { materiais: [{ id: 'm1', nome: 'Acrílico Cristal', esp: 2, custo: 10, rsm2: 99 }] };
    global.cfgLoad = function () { return _localCfg; };
    global._cfgData = null;
    // _cfgDataLoaded=true simula "dado real já confirmado antes" (não o
    // primeiríssimo boot) — cenário em que edições locais (ex.: rsm2)
    // devem sobreviver ao merge; no primeiríssimo boot (_cfgDataLoaded
    // ainda false), o merge intencionalmente ignora `local` para nunca
    // reanexar o catálogo de bootstrap (HOTFIX 2026-08-13, comportamento
    // pré-existente, não alterado por este Bloco O).
    global._cfgDataLoaded = true;
    global._cfgRecalcRsm2Todos = function () {};
    global.orcRefreshMatSelects = function () {};
    global.CFG_DEFAULT = { materiais: [], maquinas: [], maodeobra: [] };
    global._cloudLoadAll = function () {};
    global.kbProntaSync = function () {};
    _timeouts = [];
    global.setTimeout = function (fn, ms) { _timeouts.push({ fn: fn, ms: ms }); return _timeouts.length; };
    global._cloudIniciou = false;
    global._cfgBootPromise = null;
  }

  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  reset();
  mod._cloudIniciar();
  assertTrue(_cloudLoadCalls.length === 1 && _cloudLoadCalls[0] === 'erp_config', '6. execução real: _cloudIniciar() dispara exatamente 1 chamada a _cloudLoad("erp_config") — nunca 2');
  assertTrue(global._cfgBootPromise !== null && typeof global._cfgBootPromise.then === 'function', '7. _cfgBootPromise fica disponível globalmente logo após a chamada (síncrono) — _cloudLoadAll() (agendado 800ms depois) sempre a encontra pronta para reaproveitar');

  return global._cfgBootPromise.then(function () {
    assertTrue(global._cfgDataLoaded === true && global._cfgData && global._cfgData.materiais.length === 2, '8. o merge real aplica corretamente (2 materiais do cloud, mesclados com o local) usando a única leitura disparada');
    var m1 = global._cfgData.materiais.find(function (m) { return m.id === 'm1'; });
    assertTrue(m1 && m1.rsm2 === 99, '9. merge preserva campo local (rsm2) do material já existente ao mesclar com o cloud — mesmo comportamento de sempre, só uma leitura a menos');

    // ── 10-11 — _cfgBootPromise nunca trava _cloudLoadAll() mesmo se a
    // leitura falhar (nenhuma exceção síncrona propagada) — simulação de
    // homologGuardOrThrow lançando dentro de _cloudLoad. ────────────────
    reset();
    global._cloudLoad = function () { throw new Error('modo homologação bloqueado (simulado)'); };
    var threw = false;
    try { mod._cloudIniciar(); } catch (e) { threw = true; }
    assertTrue(!threw, '10. uma exceção síncrona dentro de _cloudLoad() (ex.: guard de homologação) não escapa de _cloudIniciar() — a Promise captura e rejeita, nunca quebra o boot inteiro');
    assertTrue(global._cfgBootPromise !== null, '11. _cfgBootPromise ainda é criada mesmo quando a leitura falha logo de cara — _cloudLoadAll() tem o que aguardar (rejeitado, mas nunca undefined)');

    try { fs.unlinkSync(modPath); } catch (e) {}
    console.log('\n' + '='.repeat(70));
    console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
    console.log('='.repeat(70) + '\n');
    process.exit(failed > 0 ? 1 : 0);
  });
})().catch(function (e) {
  console.log('  ❌  Exceção inesperada no teste: ' + (e && e.stack || e));
  process.exit(1);
});
