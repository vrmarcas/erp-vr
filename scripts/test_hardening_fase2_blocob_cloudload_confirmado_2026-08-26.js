/**
 * test_hardening_fase2_blocob_cloudload_confirmado_2026-08-26.js
 *
 * RODADA DE HARDENING 10/10 — FASE 2, BLOCO B (2026-08-26) — generalização
 * do estado de leitura confirmado/erro.
 *
 * ACHADO REAL: _cloudWatch() já tinha _CLOUD_WATCH_CONFIRMED/_CLOUD_WATCH_ERROR
 * por chave desde a Rodada 9 (2026-08-22) — mas _cloudLoad() (usado por
 * ~42 chaves de boot em _cloudLoadAll(), incluindo erp_fornecedores,
 * clientes_lixeira, erp_usuarios etc.) nunca teve NENHUM sinal por chave:
 * uma falha de rede/permissão sempre virava cb(null) silenciosamente,
 * indistinguível de "documento vazio de verdade" para qualquer tela que
 * consumisse o resultado. Adicionados _CLOUD_LOAD_CONFIRMED/_CLOUD_LOAD_ERROR,
 * mesmo padrão e mesma semântica de _CLOUD_WATCH_CONFIRMED/_CLOUD_WATCH_ERROR
 * (nunca uma segunda fórmula) — puramente aditivo, nenhum callback
 * existente muda de comportamento/timing.
 *
 * Consumidores corrigidos nesta rodada que passaram a diferenciar
 * carregando/falhou/vazio usando sinais genéricos (novos ou já existentes,
 * nunca uma fórmula própria por tela): renderClientes() (clientes),
 * atdRenderLista() (atendimentos — sinal dedicado _ATD_LOADED/_ATD_LOAD_ERROR,
 * pois usa onSnapshot próprio, não _cloudWatch genérico), renderOsTable()
 * (kb_os), crmRenderBoard() (crm_leads), finCRRender()/finCPRender()
 * (fin_cr/fin_cp), fornRender() (erp_fornecedores, via os novos
 * _CLOUD_LOAD_CONFIRMED/_CLOUD_LOAD_ERROR desta função).
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * _cloudLoad.
 *
 * Uso: node "scripts/test_hardening_fase2_blocob_cloudload_confirmado_2026-08-26.js"
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

console.log('\n=== HARDENING FASE 2, BLOCO B — _cloudLoad() ganha sinal genérico de confirmado/erro por chave ===\n');

// ── 1-2 — achados estáticos: as 6 telas corrigidas de fato consultam um
// sinal de confirmação/erro (genérico ou dedicado) no ramo vazio, nunca só
// a lista filtrada. ──────────────────────────────────────────────────────
[
  ['renderClientes', '_CLOUD_WATCH_CONFIRMED'],
  ['atdRenderLista', '_ATD_LOADED'],
  ['renderOsTable', '_CLOUD_WATCH_CONFIRMED'],
  ['crmRenderBoard', '_CLOUD_WATCH_CONFIRMED'],
  ['finCRRender', '_CLOUD_WATCH_CONFIRMED'],
  ['finCPRender', '_CLOUD_WATCH_CONFIRMED'],
  ['fornRender', '_CLOUD_LOAD_CONFIRMED'],
].forEach(function (par) {
  var corpo = extractFn(par[0]);
  assertTrue(corpo.indexOf(par[1]) >= 0, '1.' + par[0] + '(): consulta ' + par[1] + ' antes de decidir o empty-state (nunca confunde "ainda não confirmado" com "vazio de verdade")');
});

// ── 3-8 — execução real de _cloudLoad(): confirma/erro por chave, nunca
// vaza entre chaves diferentes, nunca muda o valor entregue ao callback. ──
(function () {
  var src = extractFn('_cloudLoad') + '\n\nmodule.exports = {_cloudLoad};';
  var modPath = path.join(__dirname, '_hardening_fase2_blocob_cloudload.tmp.js');
  fs.writeFileSync(modPath, src);

  var _getResult, _getError, _homologThrow;
  function reset() {
    _getResult = undefined; _getError = undefined; _homologThrow = false;
    global._homologGuardOrThrow = function () { if (_homologThrow) throw new Error('homolog guard'); };
    global._COL = 'erp_vr';
    global._cloudLastPayload = {};
    global._CLOUD_LOAD_CONFIRMED = {};
    global._CLOUD_LOAD_ERROR = {};
    global.console = console;
    _homologThrow = false;
    global._db = {
      collection: function () {
        return {
          doc: function () {
            return {
              get: function () {
                if (_getError) return Promise.reject(_getError);
                return Promise.resolve(_getResult);
              }
            };
          }
        };
      }
    };
  }

  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  // 3 — sucesso real: CONFIRMED=true, ERROR=false, dado entregue normalmente.
  reset();
  _getResult = { exists: true, data: function () { return { data: JSON.stringify({ foo: 'bar' }) }; } };
  var received1 = 'não chamado';
  mod._cloudLoad('minha_chave', function (d) { received1 = d; });
  return Promise.resolve().then(function () {
    assertTrue(global._CLOUD_LOAD_CONFIRMED['minha_chave'] === true, '3. sucesso real: _CLOUD_LOAD_CONFIRMED[chave] fica true');
    assertTrue(global._CLOUD_LOAD_ERROR['minha_chave'] === false, '4. sucesso real: _CLOUD_LOAD_ERROR[chave] fica false');
    assertTrue(received1 && received1.foo === 'bar', '5. dado entregue ao callback exatamente como antes (nenhuma mudança de comportamento)');

    // 6-7 — falha de rede: ERROR=true, nunca CONFIRMED — callback ainda
    // recebe null (comportamento antigo preservado, nunca quebra chamador).
    reset();
    _getError = new Error('unavailable');
    var received2 = 'não chamado';
    mod._cloudLoad('outra_chave', function (d) { received2 = d; });
    return Promise.resolve().then(function () {}).then(function () {}).then(function () {
      assertTrue(global._CLOUD_LOAD_ERROR['outra_chave'] === true, '6. ACHADO REAL corrigido: falha de rede real marca _CLOUD_LOAD_ERROR[chave]=true — antes, nenhum sinal existia para isso');
      assertTrue(!global._CLOUD_LOAD_CONFIRMED['outra_chave'], '7. falha de rede NUNCA marca _CLOUD_LOAD_CONFIRMED — "falhou" e "confirmado vazio" continuam distinguíveis');
      assertTrue(received2 === null, '8. callback ainda recebe null em caso de falha — nenhuma mudança na assinatura/comportamento que os ~42 chamadores existentes já esperam');

      // 9 — chaves diferentes nunca vazam sinal uma pra outra.
      reset();
      _getResult = { exists: false };
      mod._cloudLoad('chave_a', function () {});
      return Promise.resolve().then(function () {
        assertTrue(global._CLOUD_LOAD_CONFIRMED['chave_a'] === true && global._CLOUD_LOAD_CONFIRMED['chave_b'] === undefined, '9. sinais são por chave — confirmar "chave_a" nunca afeta o estado de "chave_b" (ainda não consultada)');

        try { fs.unlinkSync(modPath); } catch (e) {}
        console.log('\n' + '='.repeat(70));
        console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
        console.log('='.repeat(70) + '\n');
        process.exit(failed > 0 ? 1 : 0);
      });
    });
  });
})().catch(function (e) {
  console.log('  ❌  Exceção inesperada no teste: ' + (e && e.stack || e));
  process.exit(1);
});
