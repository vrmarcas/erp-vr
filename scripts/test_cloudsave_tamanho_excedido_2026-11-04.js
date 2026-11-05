/**
 * test_cloudsave_tamanho_excedido_2026-11-04.js
 *
 * Achado do smoke de produção pós-migração (2026-11-04): o espelho legado
 * de orçamentos (erp_vr/orcamentos) ultrapassou de forma PERMANENTE os
 * 1.048.576 bytes do Firestore — todo save/exclusão de orçamento desde
 * então esperava um round-trip de rede inteiro (serializar >1MB, enviar,
 * ser rejeitado) só para descartar o resultado (best-effort). Isso nunca
 * mudava o resultado final (já era ok:false antes), mas somava lentidão
 * real a cada operação e repetia sempre o mesmo erro no console.
 *
 * _cloudSaveExec() agora detecta o estouro ANTES de tentar a rede (via
 * TextEncoder, bytes reais — não .length, que subestima acentuação) e
 * devolve {ok:false, reason:'tamanho-excedido'} sem nenhuma chamada a
 * _db.runTransaction(). Este teste prova a função REAL (nunca
 * reimplementada) com um _db fake que LANÇARIA se fosse chamado —
 * qualquer regressão que volte a tentar a rede quebra o teste na hora.
 *
 * Uso: node scripts/test_cloudsave_tamanho_excedido_2026-11-04.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — ' + name);
  var lineStart = html.lastIndexOf('\n', start) + 1;
  var decl = html.slice(lineStart, start);
  if (/\basync\s*$/.test(decl)) start = lineStart + decl.search(/async/);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

var FN_NAMES = ['_cloudSave', '_cloudSaveExec'];
var src = [
  'var _cloudLastPayload = {};',
  'var _cloudSaveQueue = {};',
  'var _CLOUD_SAVES_EM_VOO = 0;',
  "var _COL = 'erp_vr';",
  'function _homologGuardOrThrow(){}',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { _cloudSave: _cloudSave, setLastPayload: function(k,v){ _cloudLastPayload[k]=v; }, getLastPayload: function(k){ return _cloudLastPayload[k]; } };',
].join('\n\n');

var modPath = path.join(__dirname, '_test_tamanho_excedido_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

let passed = 0, failed = 0;
function ok(desc, cond, extra) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc + (extra ? ' — ' + extra : '')); failed++; } }

console.log('\n=== _cloudSaveExec — payload > 1.048.487 bytes NUNCA tenta a rede (achado real: espelho legado de orçamentos permanentemente estourado) ===\n');

(async function () {
  var chamouRede = false;
  global._db = {
    collection: function () {
      return {
        doc: function () {
          return {};
        },
      };
    },
    runTransaction: function () {
      chamouRede = true; // se isto rodar, a regressão voltou: tentou a rede para um payload já sabidamente grande demais
      return Promise.reject(new Error('NUNCA deveria ter chamado runTransaction para um payload > 1.048.487 bytes'));
    },
  };

  // ── 1. Payload claramente acima do limite (achado real: array de
  // orçamentos migrados, >1.048.487 bytes) — nunca toca a rede. ──
  {
    var dadoGigante = { blob: 'x'.repeat(1_100_000) };
    var r = await mod._cloudSave('orcamentos', dadoGigante, { legacyMirror: true });
    ok('1a. payload > limite devolve {ok:false, reason:"tamanho-excedido"} sem exceção', r && r.ok === false && r.reason === 'tamanho-excedido', JSON.stringify(r));
    ok('1b. NUNCA chamou _db.runTransaction (zero round-trip de rede para um payload já sabidamente grande demais)', chamouRede === false);
  }

  // ── 2. Payload com acentuação PESADA — prova que a checagem usa bytes
  // UTF-8 reais (TextEncoder), não .length (que subestimaria e deixaria
  // passar um payload que na verdade excede). ──
  {
    chamouRede = false;
    // 1 caractere acentuado = 1 code unit UTF-16 (.length conta 1) mas 2
    // bytes em UTF-8 — um payload majoritariamente acentuado pode exceder
    // o limite REAL de bytes mesmo com .length bem abaixo dele.
    var textoAcentuado = 'ç'.repeat(600_000); // .length=600.000 (abaixo do limite), mas ~1.200.000 bytes UTF-8 (acima)
    var rAcento = await mod._cloudSave('qualquer_chave_acentuada', { texto: textoAcentuado }, { legacyMirror: true });
    ok('2. payload com .length abaixo do limite mas BYTES UTF-8 reais acima dele é detectado corretamente (usa TextEncoder, não .length)', rAcento && rAcento.ok === false && rAcento.reason === 'tamanho-excedido', JSON.stringify(rAcento));
    ok('2b. NUNCA chamou _db.runTransaction neste caso também', chamouRede === false);
  }

  // ── 3. Payload NORMAL (bem abaixo do limite) — comportamento 100%
  // preservado, continua tentando a rede normalmente. ──
  {
    chamouRede = false;
    global._db.runTransaction = function () {
      chamouRede = true;
      return Promise.resolve(); // sucesso simulado — só queremos provar que FOI chamado
    };
    var rNormal = await mod._cloudSave('chave_normal', { a: 1, b: 'texto curto' }, {});
    ok('3. payload normal (bem abaixo do limite) continua tentando a rede normalmente — zero regressão para o caso comum', chamouRede === true);
    void rNormal;
  }

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  try { fs.unlinkSync(modPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})().catch(function (e) { console.error('ERRO FATAL:', e); process.exit(1); });
