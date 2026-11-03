/**
 * test_save_confirmacao_real_2026-11-03.js
 *
 * BUG REAL reproduzido em produção: ao salvar o orçamento #000266, a tela
 * mostrou, nesta ordem: (1) "Orçamento salvo SEM custo de máquina
 * configurado para: Laser..." (2) "Falha ao salvar 'orcamentos' — tente
 * novamente" (3) "Não foi possível salvar o orçamento #000266 — nenhuma
 * alteração foi confirmada."
 *
 * Causa raiz #1 (por que o save falhou): o documento erp_vr/orcamentos
 * (array de TODOS os orçamentos, serializado como string) estava a
 * 1.046.595 bytes de um limite de 1.048.576 bytes (1MiB) do Firestore —
 * medido diretamente em produção (scripts/_diag_orcamentos_doc_size_2026-11-03.js,
 * leitura, sem escrever nada). Qualquer orçamento com itens reais (vários
 * KB) excede o limite. Isso é um problema de ARQUITETURA de armazenamento
 * (um único documento para todos os orçamentos) que não se corrige com um
 * patch de validação — requer decisão do usuário sobre como reestruturar
 * (ver relato enviado ao usuário). Este teste não cobre essa parte.
 *
 * Causa raiz #2 (por que a TELA mentiu sobre o resultado, coberta aqui):
 * _orcSalvarOrcamentoImpl() é `async` mas nunca aguardava a confirmação
 * real do Firestore (_pSalvarOrc) antes de devolver `orc` — então um save
 * REJEITADO ainda fazia os chamadores (botão "Salvar e iniciar novo",
 * geração de PDF/WhatsApp, vínculo com Atendimento) tratarem o salvamento
 * como bem-sucedido, e o aviso "...SEM custo de máquina..." disparava de
 * forma síncrona e incondicional ANTES até da tentativa de salvar,
 * contendo a palavra "salvo" mesmo quando nada foi persistido. Além
 * disso, o estado local otimista (_ORC_ENVIADOS_DATA, já mutado por
 * orcSetEnviados() antes da confirmação) continuava "fingindo" que o
 * orçamento existia mesmo após uma falha não-conflito.
 *
 * Corrigido (ver index.html, orcSalvarOrcamento / _orcSalvarOrcamentoImpl):
 *   - _orcSalvarOrcamentoImpl() agora aguarda a confirmação real antes de
 *     devolver `orc`; sem confirmação, desfaz o estado otimista e devolve
 *     null — MESMO contrato de falha já usado pelo resto da função.
 *   - O aviso de máquina sem custo só dispara DEPOIS que o save é
 *     confirmado (nunca antes, nunca em caso de falha) — mas continua
 *     NUNCA bloqueando o salvamento (regra de negócio intocada).
 *   - Nenhum efeito colateral de sucesso (CRM, auto-cadastro de cliente,
 *     liberar número reservado, limpar rascunho, dual-write) roda quando
 *     o save falha.
 *
 * Usa as FUNÇÕES REAIS extraídas de index.html (nunca reimplementadas);
 * dependências pesadas (Firestore, motor comercial, DOM completo do
 * wizard) são substituídas por dublês controláveis — a função sob teste
 * (orcSalvarOrcamento/_orcSalvarOrcamentoImpl) é sempre a do arquivo real.
 *
 * Uso: node scripts/test_save_confirmacao_real_2026-11-03.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  if (html.slice(Math.max(0, start - 6), start) === 'async ') start -= 6; // preserva `async function` (ex.: _orcSalvarOrcamentoImpl)
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}
function extractArr(name) {
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var afterMarker = start + marker.length;
  var openChar = html[afterMarker];
  var closeChar = openChar === '[' ? ']' : '}';
  var depth = 0, i = afterMarker;
  for (; i < html.length; i++) { if (html[i] === openChar) depth++; else if (html[i] === closeChar) { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1) + ';';
}

var FN_NAMES = ['orcSalvarOrcamento', '_orcSalvarOrcamentoImpl', 'orcFeedbackSalvamento', 'orcObterNumeroOficial', 'orcLimparNumeroOficial', '_isTestRecord', 'orcGetEnviados'];
var src = [
  'var _orcSalvarEmVoo = null;',
  extractArr('ORC_MAQ_OPS'),
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { ' + FN_NAMES.map(function(n){ return n + ': ' + n; }).join(', ') + ' };'
].join('\n\n');
var modPath = path.join(__dirname, '_save_confirmacao_real_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 2026-11-03 — Save de orçamento só "sucede" com confirmação real ===\n');

// ── Dublês de dependências pesadas (Firestore, motor comercial, DOM) ───────
var CALLS; // resetado a cada teste — registra quem foi chamado
function resetAmbiente(opts) {
  opts = opts || {};
  CALLS = { crm: [], clienteAuto: [], clienteLink: [], rascunhoLimpar: [], badge: 0, enviadosRender: 0, dualWrite: 0, toasts: [] };

  global.showToast = function (msg, tipo) { CALLS.toasts.push({ msg: msg, tipo: tipo }); };
  global.orcProximoNumeroAtomico = function () { return Promise.resolve(266); };
  global.orcMotorComercial = function (base) {
    var cents = Math.round(base * 100);
    return { cartao: { 1: { totalCents: cents }, 2: { totalCents: cents }, 3: { totalCents: cents } } };
  };
  global.orcCondicaoPagamentoAtual = function () { return '50% na aprovação, 50% na entrega'; };
  global.orcComparativoPendente = function () { return false; };
  global.cfgHashNaoReversivel = function (s) { return 'hash_' + s; };
  global.crmUpsertLeadPorOrcamento = function (orc, num) { CALLS.crm.push({ orc: orc, num: num }); return false; };
  global.orcAutoSalvarCliente = function (orc) { CALLS.clienteAuto.push(orc); };
  global.orcLinkClienteOrcamento = function (orc) { CALLS.clienteLink.push(orc); };
  global.orcRascunhoLimpar = function (uid) { CALLS.rascunhoLimpar.push(uid); return null; };
  global.orcAtualizarBadgeEnviados = function () { CALLS.badge++; };
  global.orcEnviadosRender = function () { CALLS.enviadosRender++; };
  global._orcSincronizarOSVinculada = undefined; // typeof-guardado no real — deixa indefinido de propósito
  global._db = undefined; // pula dual-write (typeof-guardado no real)
  global._HOMOLOG_MODE = false;
  global._cfgData = { financeiro: {} };
  global._currentSession = { email: 'vendedor@teste.com', uid: 'uid_teste' };
  global.ORC_REGRA_COMPARATIVO_ATUAL = 2;
  global._orcVitreItensPedido = [];
  global.window = global;
  window._orcSessaoAtualId = null;
  window._orcNumeroOficial = null;
  window._orcNumeroOficialPromise = null;
  window._orcCalc = { finalPrice: 1000, totalCost: 500, matTotal: 300 };
  window._orcMaqOpsCalc = opts.maqOpsCalc || {};
  window._atdOrigemAtendimentoId = null;

  global.document = {
    body: { classList: { contains: function () { return false; } } },
    getElementById: function () { return undefined; },
    querySelectorAll: function (sel) { if (sel === '#orcItemBody tr[data-idx]') return []; return []; }
  };

  // Resultado controlado de orcSetEnviados() — o único ponto de contato
  // desta função com a "nuvem" real (Firestore). Captura também o array
  // otimista que ela "aplicaria" em _ORC_ENVIADOS_DATA, exatamente como o
  // real faz (`_ORC_ENVIADOS_DATA=arr`), para provar que a falha desfaz
  // esse otimismo.
  global._ORC_ENVIADOS_DATA = opts.enviadosAntes || [];
  global.orcSetEnviados = function (arr) {
    global._ORC_ENVIADOS_DATA = arr; // otimista, igual ao real
    return Promise.resolve(opts.resultadoSalvar || { ok: true });
  };
}

function maqOpsSemCusto(minLaser) {
  return {
    laser: { min: minLaser, custo: 0, info: { ok: false, motivo: 'nao_vinculada' } },
    dobra: { min: 0, custo: 0, info: { ok: true } }, pol: { min: 0, custo: 0, info: { ok: true } },
    uv: { min: 0, custo: 0, info: { ok: true } }, lixa: { min: 0, custo: 0, info: { ok: true } }, tupia: { min: 0, custo: 0, info: { ok: true } }
  };
}
function maqOpsComCusto(minLaser) {
  return {
    laser: { min: minLaser, custo: minLaser * 2, info: { ok: true } },
    dobra: { min: 0, custo: 0, info: { ok: true } }, pol: { min: 0, custo: 0, info: { ok: true } },
    uv: { min: 0, custo: 0, info: { ok: true } }, lixa: { min: 0, custo: 0, info: { ok: true } }, tupia: { min: 0, custo: 0, info: { ok: true } }
  };
}
function temToast(regex) { return CALLS.toasts.some(function (t) { return regex.test(t.msg); }); }

(async function () {
  // ── Caso 1 — Laser com minutos preenchidos SEM máquina/custo configurado,
  // e o save é CONFIRMADO pelo Firestore (ok:true). Regra desejada: o
  // alerta aparece, mas NUNCA bloqueia — e só depois da confirmação real. ──
  {
    resetAmbiente({ maqOpsCalc: maqOpsSemCusto(45), resultadoSalvar: { ok: true } });
    var r1 = await mod.orcSalvarOrcamento();
    ok('Laser sem custo + save confirmado: NÃO bloqueia (retorna o orçamento salvo)', !!r1 && r1.id);
    ok('Laser sem custo + save confirmado: mostra o alerta de máquina sem custo', temToast(/SEM custo de máquina.*Laser/));
    ok('Laser sem custo + save confirmado: mostra o toast de sucesso ("salvo!")', temToast(/salvo!/));
    ok('Laser sem custo + save confirmado: efeitos de sucesso rodam (CRM upsert chamado)', CALLS.crm.length === 1);
    ok('Laser sem custo + save confirmado: número oficial liberado (não fica reservado)', window._orcNumeroOficial === null);
  }

  // ── Caso 2 — MESMO cenário (Laser sem custo), mas o Firestore REJEITA o
  // save com um erro genérico (ex.: documento excedeu o limite de 1MiB —
  // causa raiz real do #000266). Regra desejada: nenhum toast pode dizer
  // "salvo" e nenhum estado local pode fingir que persistiu. ──────────────
  {
    var listaAntes = [{ id: 'ORC-000001', num: '000001', cliente: 'Cliente Antigo' }];
    resetAmbiente({ maqOpsCalc: maqOpsSemCusto(45), resultadoSalvar: { ok: false, reason: 'erro', error: new Error('Firestore: documento excede 1048576 bytes') }, enviadosAntes: listaAntes });
    var r2 = await mod.orcSalvarOrcamento();
    ok('Laser sem custo + Firestore rejeita: devolve null (nunca finge sucesso)', r2 === null);
    ok('Laser sem custo + Firestore rejeita: NUNCA mostra o alerta "salvo SEM custo..."', !temToast(/SEM custo de máquina/));
    ok('Laser sem custo + Firestore rejeita: mostra o toast real de falha ("não foi possível salvar")', temToast(/Não foi possível salvar/));
    ok('Laser sem custo + Firestore rejeita: nenhum toast afirma "salvo"', !temToast(/salvo!|salvo SEM/));
    ok('Falha: desfaz o estado otimista local (_ORC_ENVIADOS_DATA volta ao estado anterior)', global._ORC_ENVIADOS_DATA === listaAntes);
    ok('Falha: re-renderiza a lista de Orçamentos Enviados para remover o fantasma', CALLS.enviadosRender >= 1);
    ok('Falha: NENHUM efeito de sucesso roda (CRM upsert nunca chamado)', CALLS.crm.length === 0);
    ok('Falha: NENHUM efeito de sucesso roda (auto-cadastro de cliente nunca chamado)', CALLS.clienteAuto.length === 0);
    ok('Falha: NENHUM efeito de sucesso roda (rascunho nunca limpo)', CALLS.rascunhoLimpar.length === 0);
    ok('Falha: número oficial reservado NÃO é liberado (retry reaproveita o mesmo #)', window._orcNumeroOficial === '000266');
    ok('Falha: window._orcSessaoAtualId volta ao valor anterior (não fica "editando" um id nunca salvo)', window._orcSessaoAtualId === null);
  }

  // ── Caso 3 — Laser com máquina/custo configurado corretamente. Sem
  // alerta nenhum, save normal. ───────────────────────────────────────────
  {
    resetAmbiente({ maqOpsCalc: maqOpsComCusto(45), resultadoSalvar: { ok: true } });
    var r3 = await mod.orcSalvarOrcamento();
    ok('Laser COM custo configurado: salva normalmente', !!r3 && r3.id);
    ok('Laser COM custo configurado: nenhum alerta de "sem custo"', !temToast(/SEM custo de máquina/));
  }

  // ── Caso 4 — conflito real (outra sessão alterou o mesmo documento):
  // orcSetEnviados() já reidrataria _ORC_ENVIADOS_DATA com a verdade do
  // servidor — a falha NÃO deve sobrescrever de volta com o estado antigo
  // desta aba. ─────────────────────────────────────────────────────────────
  {
    var serverData = [{ id: 'ORC-999999', num: '999999', cliente: 'Servidor' }];
    resetAmbiente({ maqOpsCalc: maqOpsComCusto(0), resultadoSalvar: { ok: false, reason: 'conflito', serverData: serverData } });
    // orcSetEnviados (dublê) já aplica o array otimista; simula o comportamento real
    // de conflito sobrescrevendo em seguida com o array do servidor, como o
    // orcSetEnviados() de produção faz antes de resolver.
    var _origSet = global.orcSetEnviados;
    global.orcSetEnviados = function (arr) { global._ORC_ENVIADOS_DATA = serverData; return Promise.resolve({ ok: false, reason: 'conflito', serverData: serverData }); };
    var r4 = await mod.orcSalvarOrcamento();
    ok('Conflito real: devolve null (nada foi confirmado para ESTA tentativa)', r4 === null);
    ok('Conflito real: preserva o array já reidratado do servidor (não reaplica o estado antigo da aba)', global._ORC_ENVIADOS_DATA === serverData);
  }

  console.log('\n' + passed + ' passou(aram), ' + failed + ' falhou(aram)\n');
  process.exit(failed > 0 ? 1 : 0);
})();
