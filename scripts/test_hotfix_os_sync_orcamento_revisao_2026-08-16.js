/**
 * test_hotfix_os_sync_orcamento_revisao_2026-08-16.js
 *
 * HOTFIX OPERACIONAL 2026-08-16 (P0.12-P0.14) — achado real (auditoria
 * estática): editar e re-salvar um orçamento que já tinha OS gerada NUNCA
 * atualizava a OS — _orcSalvarOrcamentoImpl() nunca tocava em KB_OS
 * (orcEnvEditar() já avisava disso via toast, mas nada corrigia o
 * comportamento). Confirmado também: Kanban e "Todas as OS" já
 * compartilhavam a MESMA fonte canônica (Object.values(KB_OS), um único
 * listener _cloudWatch('kb_os', ...)) — não havia divergência de fonte,
 * só um histórico de bug de FILTRO (P0.7, já corrigido antes) que este
 * teste também guarda como invariante de regressão.
 *
 * Corrigido: nova _orcSincronizarOSVinculada(orc), chamada uma vez no fim
 * de _orcSalvarOrcamentoImpl():
 *  - Antes da produção iniciar: sincroniza automaticamente (itens,
 *    material, medidas, qty, prazo prometido) — reusa
 *    osProjecaoOperacionalItem()/osItemMateriaisResumo(), nunca uma
 *    segunda implementação.
 *  - Depois da produção iniciada: só interrompe se algo operacional
 *    REALMENTE mudou; exige confirm() explícito; aceito → grava
 *    os.revisoesPosProducao[] + os.revisadaAposProducao=true; recusado →
 *    preserva o snapshot anterior integralmente.
 *
 * Uso: node scripts/test_hotfix_os_sync_orcamento_revisao_2026-08-16.js
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
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

var FN_NAMES = ['osProjecaoOperacionalItem', 'osItemMateriaisResumo', '_orcSincronizarOSVinculada'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + ', getKB_OS: function(){ return KB_OS; }};';
var modPath = path.join(__dirname, '_hotfix_os_sync_extracted.tmp.js');

console.log('\n=== HOTFIX 2026-08-16 (P0.12-P0.14) — sync orçamento↔OS + revisão pós-produção ===\n');

function novoAmbiente() {
  delete require.cache[require.resolve(modPath)];
  global.KB_OS = {};
  global._currentSession = { email: 'vendedor@vrmarcas.com' };
  global.secAuditLog = function () {};
  global.kbSaveKbos = function () { global._kbSaveKbosCalls = (global._kbSaveKbosCalls || 0) + 1; };
  global.kbRender = function () {};
  global.renderOsTable = function () {};
  global._kbSaveKbosCalls = 0;
  return require(modPath);
}
fs.writeFileSync(modPath, src);

// itens da OS já em formato PROJETADO (osProjecaoOperacionalItem) — é
// exatamente o formato que uma OS real teria ao ser criada por
// orcEnvGerarOS(), então a comparação JSON dentro de
// _orcSincronizarOSVinculada() compara "maçã com maçã".
function osBase(overrides, mod) {
  var itensCrus = (overrides && overrides.itensCrus) || [{ tipoItem: 'personalizado_vr', prod: 'Caixa', qty: '1', larg: '20', alt: '20', mat: 'Acrílico Cristal', pieces: [] }];
  var o = Object.assign({
    id: 'os1', num: '1', orcRef: 'orc1',
    itens: itensCrus.map(function(it){ return mod.osProjecaoOperacionalItem(it); }),
    material: 'Acrílico Cristal', medidas: '20×20cm', qty: 1,
    status: 'iniciada'
  }, overrides || {});
  delete o.itensCrus;
  return o;
}
function orcBase(overrides) {
  return Object.assign({
    id: 'orc1', num: '1', osRef: 'os1',
    itens: [{ tipoItem: 'personalizado_vr', prod: 'Caixa', qty: '1', larg: '30', alt: '30', mat: 'Acrílico Cristal', pieces: [] }],
    prazoTextoPromessa: 'De 5 a 7 dias úteis'
  }, overrides || {});
}

// ── 1. Antes da produção: sincroniza automaticamente, sem confirm() ────────
{
  var mod = novoAmbiente();
  global.KB_OS['os1'] = osBase({}, mod);
  global.confirm = function () { throw new Error('confirm() não deveria ser chamado antes da produção iniciar'); };
  var orc = orcBase();
  mod._orcSincronizarOSVinculada(orc);
  var os = mod.getKB_OS()['os1'];
  ok('1a. medidas da OS atualizadas para o novo tamanho do item (20x20 → 30x30)', os.medidas === '30×30cm');
  ok('1b. prazoPrometidoTexto propagado do orçamento para a OS', os.prazoPrometidoTexto === 'De 5 a 7 dias úteis');
  ok('1c. kbSaveKbos() chamado (persistiu a sincronização)', global._kbSaveKbosCalls === 1);
  ok('1d. nenhuma revisão pós-produção registrada (produção nem começou)', !os.revisoesPosProducao);
}

// ── 2. Sem OS vinculada (orcRef.osRef ausente): não faz nada, não quebra ───
{
  var mod = novoAmbiente();
  global.confirm = function () { throw new Error('não deveria chamar confirm sem OS vinculada'); };
  var orc = orcBase({ osRef: null });
  mod._orcSincronizarOSVinculada(orc); // não deve lançar exceção
  ok('2. orçamento sem osRef não gera nenhum erro nem tentativa de escrita', global._kbSaveKbosCalls === 0);
}

// ── 3. Produção já iniciada + mudança real → exige confirm() ───────────────
{
  var mod = novoAmbiente();
  global.KB_OS['os1'] = osBase({ status: 'producao', producaoStartId: 'prod123' }, mod);
  var confirmChamado = false;
  global.confirm = function (msg) { confirmChamado = true; ok('3a. mensagem de confirmação menciona produção já iniciada', /já está em produção/.test(msg)); return true; };
  var orc = orcBase();
  mod._orcSincronizarOSVinculada(orc);
  ok('3b. confirm() foi chamado (produção já iniciada + mudança real)', confirmChamado);
  var os = mod.getKB_OS()['os1'];
  ok('3c. confirmado → OS atualizada (medidas)', os.medidas === '30×30cm');
  ok('3d. os.revisadaAposProducao = true (indicador visual obrigatório)', os.revisadaAposProducao === true);
  ok('3e. os.revisoesPosProducao registra 1 entrada com usuário/timestamp', os.revisoesPosProducao.length === 1 && os.revisoesPosProducao[0].usuario === 'vendedor@vrmarcas.com' && !!os.revisoesPosProducao[0].ts);
  ok('3f. revisão registra material anterior E novo (auditável)', 'materialAnterior' in os.revisoesPosProducao[0] && 'materialNovo' in os.revisoesPosProducao[0]);
}

// ── 4. Produção já iniciada + usuário RECUSA → snapshot anterior preservado ─
{
  var mod = novoAmbiente();
  var osOriginal = osBase({ status: 'producao', producaoStartId: 'prod123' }, mod);
  global.KB_OS['os1'] = osOriginal;
  var medidasAntes = osOriginal.medidas;
  global.confirm = function () { return false; }; // recusa
  var orc = orcBase();
  mod._orcSincronizarOSVinculada(orc);
  var os = mod.getKB_OS()['os1'];
  ok('4a. recusado → medidas da OS permanecem as anteriores (nunca sobrescreve silenciosamente)', os.medidas === medidasAntes);
  ok('4b. recusado → nenhuma revisão registrada', !os.revisoesPosProducao);
  ok('4c. recusado → revisadaAposProducao continua ausente/false', !os.revisadaAposProducao);
  ok('4d. recusado → kbSaveKbos() NUNCA chamado (nenhuma escrita)', global._kbSaveKbosCalls === 0);
}

// ── 5. Produção já iniciada, SEM mudança operacional real → nunca incomoda o vendedor ──
{
  var mod = novoAmbiente();
  global.KB_OS['os1'] = osBase({ status: 'producao', producaoStartId: 'prod123', material: 'Acrílico Cristal' }, mod);
  global.confirm = function () { throw new Error('confirm() não deveria ser chamado sem mudança real'); };
  // orçamento salvo de novo com os MESMOS itens (ex.: só trocou observação
  // interna que não afeta pieces/material/qty/medidas)
  var orc = orcBase({ itens: [{ tipoItem: 'personalizado_vr', prod: 'Caixa', qty: '1', larg: '20', alt: '20', mat: 'Acrílico Cristal', pieces: [] }], prazoTextoPromessa: '' });
  mod._orcSincronizarOSVinculada(orc);
  ok('5. sem mudança operacional real, nenhuma escrita/confirm — não incomoda o vendedor à toa', global._kbSaveKbosCalls === 0);
}

// ── 6. OS pronta/entregue também conta como "já em produção" (nunca sobrescreve pós-entrega) ──
{
  var mod = novoAmbiente();
  global.KB_OS['os1'] = osBase({ status: 'entregue' }, mod);
  var confirmChamado = false;
  global.confirm = function () { confirmChamado = true; return false; };
  var orc = orcBase();
  mod._orcSincronizarOSVinculada(orc);
  ok('6. OS já entregue também exige confirmação (nunca é tratada como "ainda não produzida")', confirmChamado);
}

// ── 7. Kanban / Todas as OS — mesma fonte canônica (guarda estrutural) ─────
{
  ok('7a. renderOsTable() lê Object.values(KB_OS) — mesma fonte do Kanban, nunca um array paralelo', /Object\.values\(KB_OS\)/.test(html));
  ok('7b. existe só UM listener _cloudWatch(\'kb_os\', ...) alimentando KB_OS (nenhuma fonte paralela)', (html.match(/_cloudWatch\("kb_os"/g) || []).length === 1);
  ok('7c. o mesmo callback do listener chama kbRender() E renderOsTable() juntos (nunca uma tela desatualizada em relação à outra)', /_cloudWatch\("kb_os", function\(d\)\{[\s\S]{0,400}kbRender[\s\S]{0,200}renderOsTable/.test(html));
}

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
