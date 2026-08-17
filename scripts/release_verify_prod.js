/**
 * release_verify_prod.js
 *
 * Gate anti-falso-positivo do release do Firebase Hosting: prova que a URL
 * de produção está servindo EXATAMENTE o mesmo index.html que existe no
 * commit local (não apenas que "o push foi feito" ou que "o deploy rodou
 * sem erro"). Achado que motivou este script: em rodadas anteriores,
 * commits chegaram a origin/master mas o Hosting continuou servindo uma
 * versão antiga — "push concluído" != "produção atualizada".
 *
 * Método: compara o hash SHA-256 do index.html local (fonte da verdade do
 * commit atual) contra o hash do conteúdo baixado ao vivo da URL de
 * produção (com cache-busting, para não ler cache de CDN/browser). Não
 * depende de nenhuma string/assinatura específica de um fix pontual —
 * funciona para qualquer commit futuro que altere index.html.
 *
 * Uso standalone (chamado por scripts/release_hosting.sh):
 *   node scripts/release_verify_prod.js [--url=https://erp-vrmarcas.web.app] [--tentativas=6] [--intervalo=5]
 * Exit 0 = produção bate com o local. Exit 1 = não bate (ou erro de rede) —
 * a rodada NÃO deve ser considerada concluída.
 *
 * As funções puras abaixo (compararHashes, hashDeConteudo, urlComCacheBust)
 * são exportadas para teste unitário sem rede — ver
 * scripts/test_release_verify_prod_2026-08-17.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashDeConteudo(conteudo) {
  return crypto.createHash('sha256').update(conteudo, 'utf8').digest('hex');
}

function urlComCacheBust(urlBase, timestampMs) {
  var sep = urlBase.indexOf('?') >= 0 ? '&' : '?';
  return urlBase + sep + '_release_check=' + timestampMs;
}

// Resultado puro da comparação — sem I/O, testável isoladamente.
function compararHashes(hashLocal, respostaProd) {
  if (!respostaProd || !respostaProd.ok) {
    return { ok: false, motivo: 'FETCH_FALHOU', detalhe: respostaProd && respostaProd.detalhe || 'sem resposta' };
  }
  var corpo = respostaProd.corpo || '';
  if (!/<!doctype html>/i.test(corpo) && !/<html/i.test(corpo)) {
    return { ok: false, motivo: 'CONTEUDO_INVALIDO', detalhe: 'resposta não parece ser o index.html do ERP (possível página de erro/placeholder)' };
  }
  var hashProd = hashDeConteudo(corpo);
  if (hashProd !== hashLocal) {
    return { ok: false, motivo: 'HASH_DIVERGENTE', detalhe: 'hash local ' + hashLocal + ' != hash produção ' + hashProd, hashLocal: hashLocal, hashProd: hashProd };
  }
  return { ok: true, motivo: 'HASH_CONFERE', hashLocal: hashLocal, hashProd: hashProd };
}

async function buscarProd(urlBase) {
  var url = urlComCacheBust(urlBase, Date.now());
  try {
    var res = await fetch(url, { headers: { 'Cache-Control': 'no-cache, no-store', 'Pragma': 'no-cache' }, redirect: 'follow' });
    if (!res.ok) return { ok: false, detalhe: 'HTTP ' + res.status + ' ' + res.statusText };
    var corpo = await res.text();
    return { ok: true, corpo: corpo };
  } catch (e) {
    return { ok: false, detalhe: e.message };
  }
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function verificarComRetentativas(opts) {
  var indexPath = opts.indexPath;
  var urlBase = opts.urlBase;
  var tentativas = opts.tentativas;
  var intervaloMs = opts.intervaloMs;
  var log = opts.log || function () {};

  var conteudoLocal = fs.readFileSync(indexPath, 'utf8');
  var hashLocal = hashDeConteudo(conteudoLocal);
  log('hash local (index.html, commit atual): ' + hashLocal);

  var ultimoResultado = null;
  for (var i = 1; i <= tentativas; i++) {
    log('tentativa ' + i + '/' + tentativas + ' — buscando ' + urlBase + ' ...');
    var resposta = await buscarProd(urlBase);
    ultimoResultado = compararHashes(hashLocal, resposta);
    if (ultimoResultado.ok) {
      log('OK — produção corresponde ao commit local (hash ' + ultimoResultado.hashProd.slice(0, 12) + '...).');
      return ultimoResultado;
    }
    log('  ainda não bate (' + ultimoResultado.motivo + (ultimoResultado.detalhe ? ': ' + ultimoResultado.detalhe : '') + ')');
    if (i < tentativas) await sleep(intervaloMs);
  }
  return ultimoResultado;
}

module.exports = { hashDeConteudo, urlComCacheBust, compararHashes, buscarProd, verificarComRetentativas };

if (require.main === module) {
  (function () {
    var args = process.argv.slice(2);
    var urlBase = 'https://erp-vrmarcas.web.app';
    var tentativas = 6;
    var intervaloS = 5;
    args.forEach(function (a) {
      var m;
      if ((m = a.match(/^--url=(.+)$/))) urlBase = m[1];
      else if ((m = a.match(/^--tentativas=(\d+)$/))) tentativas = parseInt(m[1], 10);
      else if ((m = a.match(/^--intervalo=(\d+)$/))) intervaloS = parseInt(m[1], 10);
    });
    var indexPath = path.join(__dirname, '..', 'index.html');

    verificarComRetentativas({
      indexPath: indexPath,
      urlBase: urlBase,
      tentativas: tentativas,
      intervaloMs: intervaloS * 1000,
      log: function (msg) { console.log('[release_verify_prod] ' + msg); }
    }).then(function (resultado) {
      if (resultado.ok) {
        console.log('\n✅ PRODUÇÃO CONFERE COM O COMMIT LOCAL — pode considerar o deploy concluído.\n');
        process.exit(0);
      } else {
        console.error('\n❌ PRODUÇÃO NÃO CONFERE — deploy ausente, incompleto, ou servindo versão antiga.');
        console.error('   motivo: ' + resultado.motivo + (resultado.detalhe ? ' — ' + resultado.detalhe : ''));
        console.error('   NÃO considere esta rodada concluída até isso ser resolvido.\n');
        process.exit(1);
      }
    }).catch(function (e) {
      console.error('\n❌ ERRO ao verificar produção: ' + e.message + '\n');
      process.exit(1);
    });
  })();
}
