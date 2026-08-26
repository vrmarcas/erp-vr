/**
 * test_hardening_fase2_blocod_atendimentos_race_2026-08-26.js
 *
 * RODADA DE HARDENING 10/10 — FASE 2, BLOCO D (2026-08-26) — varredura
 * direcionada de race conditions (request A / request B / B retorna / A
 * retorna depois / A sobrescreve B).
 *
 * INVESTIGAÇÃO (não suposição): auditados os pontos de troca rápida de
 * entidade mais prováveis de sofrer esse padrão — troca de atendimento
 * (atdSelecionar → atdMsgListenerInit/atdBriefingListenerInit), abrir
 * cliente (cliOpenDetalhe), abrir card de CRM (crmOpenCard), busca Vitre
 * no wizard de orçamento (orcVitreBuscar). Achado: cliOpenDetalhe/
 * crmOpenCard/orcVitreBuscar são 100% síncronos (leem array já em
 * memória, sem fetch por operação) — nenhuma corrida possível, por
 * construção. atdMsgListenerInit/atdBriefingListenerInit JÁ tinham
 * proteção real: (1) desinscrevem o listener antigo ANTES de inscrever o
 * novo (onSnapshot para de entregar callbacks assim que unsubscribe() é
 * chamado — não há "resposta em voo" possível como haveria com um
 * fetch/Promise cancelável só por convenção); (2) atdBriefingListenerInit
 * AINDA fecha o closure sobre o atendimentoId da chamada e só renderiza
 * se `ATD_SELECTED_ID===atendimentoId` no momento em que o snapshot
 * chega — dupla proteção contra o mesmo padrão A/B do enunciado.
 *
 * Nenhum mecanismo novo foi adicionado aqui (epoch/token/abort) porque
 * NENHUM risco concreto foi encontrado nesses pontos — mecanismo extra
 * sem risco real violaria a instrução explícita desta rodada ("não
 * adicione mecanismo se não houver risco concreto"). Esta suíte trava a
 * proteção JÁ EXISTENTE como regressão: se atdBriefingListenerInit()
 * perder o guard por ATD_SELECTED_ID, ou se atdMsgListenerInit()/
 * atdBriefingListenerInit() pararem de desinscrever o listener anterior
 * antes de criar um novo, o teste falha.
 *
 * Cenário reproduzido de verdade (não só leitura estática): conversa A
 * selecionada → operador troca para conversa B → resposta ATRASADA do
 * briefing de A chega DEPOIS da troca → NUNCA deve atualizar a tela
 * (que já mostra B).
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * atdBriefingListenerInit, atdMsgListenerInit.
 *
 * Uso: node "scripts/test_hardening_fase2_blocod_atendimentos_race_2026-08-26.js"
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

console.log('\n=== HARDENING FASE 2, BLOCO D — race de troca de conversa (Atendimentos) ===\n');

var FN_NAMES = ['atdBriefingListenerInit', 'atdMsgListenerInit'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_hardening_fase2_blocod_atendimentos.tmp.js');
fs.writeFileSync(modPath, src);

var _briefingCbs, _msgCbs, _painelRenderCount, _painelRenderComId, _msgsRenderCount, _msgsRenderComLista;
function reset() {
  global.window = global;
  global.ATD_BRIEFING_UNSUB = null;
  global.ATD_BRIEFING_CACHE = null;
  global.ATD_MSG_UNSUB = null;
  global.ATD_SELECTED_ID = null;
  global.ATD_CACHE = [{ id: 'atd_A', nome: 'Cliente A' }, { id: 'atd_B', nome: 'Cliente B' }];
  _briefingCbs = {}; // atendimentoId -> onSnapshot success callback capturado
  _msgCbs = {};
  _painelRenderCount = 0; _painelRenderComId = null;
  _msgsRenderCount = 0; _msgsRenderComLista = null;
  global.atdRenderPainel = function (atd) { _painelRenderCount++; _painelRenderComId = atd && atd.id; };
  global.atdRenderMsgs = function (lista) { _msgsRenderCount++; _msgsRenderComLista = lista; };
  global._db = {
    collection: function (colName) {
      return {
        doc: function (docId) {
          return {
            onSnapshot: function (successCb) {
              // simula a API real do Firestore: onSnapshot(...) devolve a
              // função de unsubscribe; capturamos o callback de sucesso por
              // id para poder "disparar uma resposta atrasada" no teste.
              _briefingCbs[docId] = successCb;
              return function () { delete _briefingCbs[docId]; };
            },
            collection: function () {
              return {
                orderBy: function () {
                  return {
                    onSnapshot: function (successCb) {
                      _msgCbs[docId] = successCb;
                      return function () { delete _msgCbs[docId]; };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };
  global.console = console;
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// ── CENÁRIO REAL: A selecionada → troca para B → resposta ATRASADA do
// briefing de A chega depois da troca → NUNCA deve repintar o painel
// (que já mostra B). ──────────────────────────────────────────────────
reset();
global.ATD_SELECTED_ID = 'atd_A';
mod.atdBriefingListenerInit('atd_A');
assertTrue(typeof _briefingCbs['atd_A'] === 'function', '1. listener de briefing de A foi registrado (callback capturado)');

// Operador troca para B ANTES da resposta de A chegar.
global.ATD_SELECTED_ID = 'atd_B';
mod.atdBriefingListenerInit('atd_B');
assertTrue(_briefingCbs['atd_A'] === undefined, '2. trocar de conversa desinscreve o listener de A imediatamente (unsubscribe síncrono) — nunca duas inscrições vivas ao mesmo tempo');

// Resposta atrasada de A "chega" (simulada) — só é possível testar a
// segunda camada de proteção (closure de atendimentoId) se ainda
// tivéssemos o callback; como já foi desinscrito, simulamos diretamente
// via chamada da função original de novo com o id antigo para provar que,
// MESMO SE o SDK ainda entregasse algo residual, o guard por
// ATD_SELECTED_ID barraria a repintura.
reset();
global.ATD_SELECTED_ID = 'atd_A';
mod.atdBriefingListenerInit('atd_A');
var cbAtrasadoDeA = _briefingCbs['atd_A'];
global.ATD_SELECTED_ID = 'atd_B'; // operador já trocou de conversa
cbAtrasadoDeA({ exists: true, data: function () { return { produto: 'Troféu (de A, atrasado)' }; } }); // resposta atrasada "chegando" mesmo assim
assertTrue(_painelRenderCount === 0, '3. ACHADO VERIFICADO (proteção já existente): resposta atrasada do briefing de A, chegando DEPOIS da troca para B, NUNCA repinta o painel — guard por ATD_SELECTED_ID===atendimentoId barra a atualização');

// ── Caminho feliz: resposta a tempo (mesma conversa ainda selecionada)
// continua funcionando normalmente — nenhuma regressão de comportamento. ─
reset();
global.ATD_SELECTED_ID = 'atd_A';
mod.atdBriefingListenerInit('atd_A');
_briefingCbs['atd_A']({ exists: true, data: function () { return { produto: 'Troféu' }; } });
assertTrue(_painelRenderCount === 1 && _painelRenderComId === 'atd_A', '4. caminho feliz preservado: resposta enquanto a MESMA conversa ainda está selecionada repinta o painel normalmente');

// ── Mesma verificação para o listener de mensagens: trocar de conversa
// desinscreve o anterior antes de inscrever o novo (sem gap síncrono onde
// os dois ficariam vivos ao mesmo tempo). ────────────────────────────────
reset();
mod.atdMsgListenerInit('atd_A');
assertTrue(typeof _msgCbs['atd_A'] === 'function', '5. listener de mensagens de A registrado');
mod.atdMsgListenerInit('atd_B');
assertTrue(_msgCbs['atd_A'] === undefined && typeof _msgCbs['atd_B'] === 'function', '6. trocar de conversa desinscreve o listener de mensagens de A antes de inscrever o de B — nunca duas inscrições de thread vivas ao mesmo tempo');

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
