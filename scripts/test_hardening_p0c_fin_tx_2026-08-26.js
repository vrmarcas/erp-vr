/**
 * test_hardening_p0c_fin_tx_2026-08-26.js
 *
 * RODADA DE HARDENING 10/10 — FASE 1 — P0-C: FIN_TX nascia com transações
 * financeiras FICTÍCIAS hardcoded.
 *
 * AUDITORIA CONFIRMADA: `var FIN_TX = [...]` (index.html) tinha 8
 * transações de demonstração hardcoded (OI Telecom R$2.400, CLARO Display
 * R$1.800, BAUHAUS SP R$5.600 etc., com datas fixas de 2026-06/07) — e,
 * diferente dos dados irmãos fin_cr/fin_cp (que têm `_cloudLoad` no boot,
 * dentro de `_cloudLoadAll`), fin_tx só tinha `_cloudWatch` (tempo real,
 * registrado só DEPOIS de `_cloudReady=true`, ou seja, só depois que as
 * 41 leituras iniciais já resolveram). Entre o boot e a 1ª resposta desse
 * listener, Dashboard/Financeiro podiam renderizar as 8 transações
 * fictícias como se fossem reais — dado financeiro nunca pode nascer de
 * demonstração (regra explícita desta rodada).
 *
 * CORRIGIDO: FIN_TX agora nasce vazio (`[]`, mesmo padrão de FIN_CR/
 * FIN_CP) e ganhou `_cloudLoad("fin_tx", ...)` no mesmo lugar/mesmo
 * padrão de fin_cr/fin_cp em `_cloudLoadAll()` — nunca mais uma janela em
 * que dado fictício pode aparecer como real. `total` (contador de
 * `_cloudLoadAll`) ajustado de 41 para 42 — já reconferido pelo teste
 * estrutural existente (test_cloud_load_all_counter_2026-08-08.js).
 *
 * ACHADO EXTRA (mesma categoria, mesmo risco): auditando o padrão em toda
 * a base (todo par _cloudLoad/_cloudWatch(key, fn){ if(d&&...){ VAR=d }})
 * contra a declaração inicial de cada VAR, achei o MESMO defeito em
 * `CLIENTES_DATA` — 8 clientes FICTÍCIOS hardcoded (nomes/e-mails/
 * telefones inventados). O guard `if(d&&d.length)` já existente em
 * `_cloudLoad`/`_cloudWatch("clientes", ...)` nunca sobrescreve esse seed
 * quando a coleção real está genuinamente vazia — uma conta nova veria
 * essas 8 pessoas/empresas fictícias como se fossem clientes reais,
 * inclusive em seletores de cliente do orçamento. Corrigido com o mesmo
 * padrão vazio. As demais ~19 variáveis alimentadas por esse mesmo padrão
 * em toda a base já nasciam vazias (`[]`/`{}`) — conferido nesta rodada,
 * nenhuma outra tem o mesmo defeito.
 *
 * Nota (não corrigido, fora do escopo): `_FIN_CR_DEFAULT`/
 * `_FIN_CP_DEFAULT` (index.html, logo acima da declaração de FIN_CR/
 * FIN_CP) também têm dados fictícios, mas são código morto de verdade —
 * grep confirma zero outras ocorrências desses 2 nomes no arquivo inteiro
 * (nunca atribuídos a FIN_CR/FIN_CP nem lidos por nada) — documentado
 * como P3 (código morto) no relatório final, não como P0 (nunca alimenta
 * produção porque nunca é consumido).
 *
 * Uso: node "scripts/test_hardening_p0c_fin_tx_2026-08-26.js"
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

console.log('\n=== HARDENING P0-C — FIN_TX nascia com transações fictícias ===\n');

// 1 — ACHADO REAL: as declarações VIVAS de FIN_TX e CLIENTES_DATA nunca
// mais têm dado fictício embutido — checagem escopada às próprias
// declarações (nunca um grep solto no arquivo inteiro, que pegaria
// comentários explicativos ou outros dados fictícios já documentados e
// inertes, como CRM_LEADS_DEFAULT).
function extraiDeclaracao(nome) {
  var marker = 'var ' + nome + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error(nome + ' não encontrada');
  var end = html.indexOf(';', start);
  return html.slice(start, end + 1);
}
var declFinTx = extraiDeclaracao('FIN_TX');
var declClientes = extraiDeclaracao('CLIENTES_DATA');
assertTrue(declFinTx === 'var FIN_TX = [];', '1a. ACHADO REAL: declaração viva de FIN_TX nasce vazia — nenhuma das 8 transações fictícias do seed antigo sobrevive');
assertTrue(declClientes === 'var CLIENTES_DATA = [];', '1b. ACHADO EXTRA (mesma categoria): declaração viva de CLIENTES_DATA também nasce vazia agora — nenhum dos 8 clientes fictícios sobrevive');

// 2 — FIN_TX nasce vazio, mesmo padrão de FIN_CR/FIN_CP.
assertTrue(/var FIN_TX = \[\];/.test(html), '2. var FIN_TX = []; — nasce vazio, nunca mais com dado fictício embutido (mesmo padrão de FIN_CR/FIN_CP)');

// 2b — o guard if(d&&d.length) de clientes (_cloudLoad/_cloudWatch)
// continua existindo — CLIENTES_DATA vazio agora é seguro contra ele
// (nunca mais "esconde" dado fictício atrás do guard).
assertTrue(/_cloudLoad\("clientes", function\(d\)\{ if\(d&&d\.length\)\{ CLIENTES_DATA=d; \} done\(\); \}\);/.test(html), '2c. _cloudLoad("clientes", ...) continua no mesmo lugar/mesmo guard — só a fonte fictícia por trás dele que foi removida');

// 3 — ACHADO REAL: fin_tx agora tem carga de boot (_cloudLoad), não só
// tempo real — mesma classe de correção do P0 original desta rodada
// (Kanban/Estoque/Retalhos: nunca decidir "vazio" antes do servidor
// confirmar).
assertTrue(/_cloudLoad\("fin_tx", function\(d\)\{ if\(d&&Array\.isArray\(d\)\)\{ FIN_TX=d; \} done\(\); \}\);/.test(html), '3. ACHADO REAL: _cloudLoad("fin_tx", ...) agora existe no boot (_cloudLoadAll) — antes só existia _cloudWatch, registrado depois de _cloudReady');

// 4 — o _cloudLoad de fin_tx está na MESMA função/mesmo padrão de
// fin_cr/fin_cp (nunca uma segunda forma de carregar dado financeiro).
var idxFinCr = html.indexOf('_cloudLoad("fin_cr"');
var idxFinTx = html.indexOf('_cloudLoad("fin_tx"');
var idxCloudReadyTrue = html.indexOf('_cloudReady = true;');
assertTrue(idxFinCr >= 0 && idxFinTx >= 0 && idxFinTx > idxFinCr, '4. _cloudLoad("fin_tx", ...) está agrupado junto de fin_cr/fin_cp, mesmo bloco de leituras de boot');
assertTrue(idxCloudReadyTrue >= 0 && idxFinTx > idxCloudReadyTrue, '5. A leitura de fin_tx acontece na função que roda ANTES de _cloudReady virar true — nunca depois');

// 6 — o total do contador de _cloudLoadAll foi ajustado (42, não mais 41)
// — já validado estruturalmente por test_cloud_load_all_counter_2026-08-08.js,
// aqui só uma confirmação direta e legível para quem ler este arquivo.
assertTrue(/var loaded = 0, total = 42;/.test(html), '6. Contador de _cloudLoadAll ajustado para 42 (41 + a nova leitura de fin_tx) — mesmo padrão que já existia para fin_cr/fin_cp/etc.');

// 7 — nota de auditoria: _FIN_CR_DEFAULT/_FIN_CP_DEFAULT confirmados como
// código morto de verdade (só a própria declaração, nunca consumidos) —
// por isso NÃO foram removidos nesta rodada (fora do escopo de P0,
// documentados como P3 no relatório final).
['_FIN_CR_DEFAULT', '_FIN_CP_DEFAULT'].forEach(function (nome) {
  var ocorrencias = (html.match(new RegExp(nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  assertTrue(ocorrencias === 1, '7. ' + nome + ' aparece só 1× no arquivo (a própria declaração) — código morto confirmado, nunca alimenta produção, corretamente deixado para o relatório de auditoria (P3) e não tratado como P0 nesta rodada');
});

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
