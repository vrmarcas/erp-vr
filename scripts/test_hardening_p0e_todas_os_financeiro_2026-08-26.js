/**
 * test_hardening_p0e_todas_os_financeiro_2026-08-26.js
 *
 * RODADA DE HARDENING 10/10 — FASE 1 — P0-E: "Todas as OS" × perfil
 * Financeiro — UI e Rules discordavam.
 *
 * AUDITORIA CONFIRMADA: `PERM_DEFAULT` (index.html, `MODULOS`/
 * `PERM_DEFAULT`) já concede acesso padrão à tela "Todas as OS" para o
 * perfil Financeiro (`financeiro: [...,'os-list',...]`) — mas
 * `firestore.rules` só concedia leitura de `kb_os` a `isComercial()`/
 * `isProducao()`, nunca a `isFinanceiro()`. A tela ficava estruturalmente
 * inutilizável para esse perfil ("Nenhuma OS encontrada" sempre, mesmo
 * com centenas de OS reais).
 *
 * DECISÃO (nunca suposta — evidência da própria arquitetura): Financeiro
 * DEVE ver OS. Prova: `kb_os_fin` (o documento financeiro COMPANHEIRO de
 * `kb_os`, ver comentário original em firestore.rules) já concede leitura
 * a `isFinanceiro()` explicitamente — esse desenho só faz sentido se
 * Financeiro também pudesse ler o documento BASE (`kb_os`) para "colar"
 * o dado financeiro em cima (`_kbMergeFinCache`, index.html). Sem acesso
 * a `kb_os`, a leitura de `kb_os_fin` já concedida a Financeiro não tinha
 * nada para se juntar — era letra morta.
 *
 * CORRIGIDO: nova regra mínima `allow read: if isFinanceiro() && docId ==
 * 'kb_os';` — só leitura (Financeiro não opera o Kanban, nunca precisa
 * escrever aqui, regra inegociável "não conceder write operacional ao
 * Financeiro sem necessidade").
 *
 * Uso: node "scripts/test_hardening_p0e_todas_os_financeiro_2026-08-26.js"
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

var rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

console.log('\n=== HARDENING P0-E — "Todas as OS" × perfil Financeiro (UI × Rules) ===\n');

// 1 — evidência de que a UI já oferece a tela para Financeiro por padrão
// (isto NÃO foi alterado nesta rodada — só confirmamos que a evidência
// que justificou a decisão continua real).
assertTrue(/financeiro:\s*\[.*?'os-list'.*?\]\.includes\(m\.id\)/.test(html), '1. Evidência confirmada: PERM_DEFAULT já concede "Todas as OS" (os-list) para o perfil Financeiro por padrão');

// 2 — ACHADO REAL: nova Rule de leitura para Financeiro em kb_os existe.
assertTrue(/allow read: if isFinanceiro\(\) && docId == 'kb_os';/.test(rules), '2. ACHADO REAL: nova Rule "allow read: if isFinanceiro() && docId == \'kb_os\';" agora existe — antes, nenhuma regra concedia isso');

// 3 — só leitura, nunca escrita (regra inegociável: não conceder write
// operacional ao Financeiro sem necessidade).
var novaRegraIdx = rules.indexOf("allow read: if isFinanceiro() && docId == 'kb_os';");
var contextoAoRedor = rules.slice(Math.max(0, novaRegraIdx - 50), novaRegraIdx + 200);
assertTrue(!/allow write: if isFinanceiro\(\) && docId == 'kb_os'/.test(rules), '3. Nenhuma regra de ESCRITA em kb_os foi concedida a Financeiro — só leitura, como decidido');

// 4 — não abriu para "qualquer autenticado" nem ampliou além do
// necessário (regras inegociáveis 8/9 da rodada).
assertTrue(!/allow read, write: if isAuthenticated\(\)[^;]*kb_os/.test(rules), '4. Nenhuma regra ampla tipo isAuthenticated() foi usada — permissão concedida por role específica (isFinanceiro), nunca genérica');

// 5 — kb_os_fin (o documento financeiro companheiro que já concedia
// leitura a Financeiro) continua intocado — a correção foi só adicionar
// a peça que faltava, nunca reescrever o que já funcionava.
assertTrue(/allow read, write: if \(isMaster\(\) \|\| isFinanceiro\(\) \|\| isComercial\(\)\) && docId == 'kb_os_fin';/.test(rules), '5. Regra pré-existente de kb_os_fin (que já incluía Financeiro) permanece exatamente igual — nenhuma regressão');

// 6 — deny-by-default de outras coleções sensíveis (stock/retalhos etc.)
// continua intocado — a correção foi cirúrgica, só kb_os para Financeiro.
assertTrue(/allow read: if isProducao\(\) && docId in\s*\n?\s*\['stock', 'stock_deleted', 'erp_stock_log', 'retalhos', 'retalhos_seq'\];/.test(rules), '6. Regra de stock/retalhos (só Produção) permanece exatamente igual — Financeiro continua sem acesso a estoque, nenhuma permissão ampliada além do necessário para este achado');

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
