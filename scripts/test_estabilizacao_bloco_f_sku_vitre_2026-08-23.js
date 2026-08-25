/**
 * test_estabilizacao_bloco_f_sku_vitre_2026-08-23.js
 *
 * RODADA DE ESTABILIZAÇÃO (2026-08-23) — Bloco F.
 *
 * BUG relatado: Catálogo Vitre → Editar Produto não permite corrigir o SKU
 * depois de salvo.
 *
 * Causa raiz (auditoria dedicada): SKU É o próprio ID do documento
 * Firestore (`vitre_produtos/{sku}`) — não existe (nunca existiu) um ID
 * interno separado. O campo fica travado na UI de propósito (comentário já
 * documentava isso), e é referenciado como chave estável em pelo menos 15
 * pontos diferentes (orçamentos Vitre salvos, conversão orçamento→OS,
 * pedido único VR+Vitre, integração Valéria). Migrar TODOS esses pontos
 * para um ID interno novo é uma mudança de arquitetura de escopo muito
 * maior que este bloco, e o pedido veda migração destrutiva.
 *
 * Corrigido com "Renomear SKU" (vitreRenomearSku, aditivo): cria um
 * documento NOVO com o SKU novo (dados 100% copiados) e marca o documento
 * ANTIGO como tombstone (status:'renomeado', skuRenomeadoPara) — NUNCA
 * apagado, preservando histórico/vínculos/pedidos que já referenciam o SKU
 * antigo. Também fecha dois achados secundários da auditoria:
 * vitreCriarOuEditarProduto não validava SKU duplicado ao criar (diferente
 * de vitreDuplicarProduto, que já validava) — mescla silenciosa no produto
 * errado; e lucroBruto/margemBruta não eram recalculados fora da
 * importação, ficando desatualizados após editar custo/preço manualmente.
 *
 * Backend (functions/) não tem emulador Firestore configurado neste
 * projeto — verificado por: tsc --noEmit limpo, exportação, e asserção
 * ESTRUTURAL sobre o código-fonte real (mesmo princípio já usado nos
 * outros blocos desta rodada). Frontend: vitreCatStatusCor/Label
 * (funções puras) testadas por execução real; o resto (DOM-pesado) por
 * asserção estrutural.
 *
 * Uso: node scripts/test_estabilizacao_bloco_f_sku_vitre_2026-08-23.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

var functionsDir = path.join(__dirname, '..', 'functions');
var htmlPath = path.join(__dirname, '..', 'index.html');

console.log('\n=== RODADA DE ESTABILIZAÇÃO — Bloco F (SKU do Catálogo Vitre não editável) ===\n');

try {
  execSync('npx tsc -p .', { cwd: functionsDir, stdio: 'pipe' });
  assertTrue(true, '0. functions/ compila limpo (tsc) — inclui vitreRenomearSku');
} catch (e) {
  assertTrue(false, '0. functions/ compila limpo (tsc) — ' + (e.stdout || e.message).toString().slice(0, 500));
  console.log('\n======================================================================');
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('======================================================================\n');
  process.exit(1);
}

var indexLib = fs.readFileSync(path.join(functionsDir, 'lib', 'index.js'), 'utf8');
var vitreLib = fs.readFileSync(path.join(functionsDir, 'lib', 'vitre.js'), 'utf8');
var vitreSrc = fs.readFileSync(path.join(functionsDir, 'src', 'vitre.ts'), 'utf8');

// ══════════════════════════════════════════════════════════════════════════
// PARTE 1 — vitreRenomearSku: exportada, deployável, e nunca apaga nada
// ══════════════════════════════════════════════════════════════════════════
assertTrue(/exports\.vitreRenomearSku\s*=/.test(vitreLib), '1. vitreRenomearSku exportada de functions/lib/vitre.js');
assertTrue(/vitreRenomearSku/.test(indexLib), '2. vitreRenomearSku re-exportada de functions/lib/index.js (deployável)');

var srcRenomear = vitreSrc.slice(vitreSrc.indexOf('export const vitreRenomearSku'));
assertTrue(/requireRole\(caller, \[\], "renomear SKU/.test(srcRenomear), '3. master-only (SKU é atributo estrutural, mesma fronteira de vitreDuplicarProduto/vitreAtivarDesativarProduto)');
assertTrue(!/\.delete\(\)/.test(srcRenomear), '4. NUNCA chama .delete() — o documento antigo nunca é apagado (não é migração destrutiva)');
assertTrue(/status:\s*"renomeado"/.test(srcRenomear), '5. documento antigo vira tombstone (status:"renomeado"), não é removido');
assertTrue(/skuRenomeadoPara:\s*skuNovo/.test(srcRenomear), '6. tombstone aponta para o SKU novo (skuRenomeadoPara) — permite localizar o produto de verdade a partir do SKU antigo');
assertTrue(/skuAnterior:\s*skuAtual/.test(srcRenomear), '7. documento novo registra de onde veio (skuAnterior) — rastreabilidade nas duas direções');
assertTrue(/\.\.\.atual,/.test(srcRenomear), '8. documento novo copia TODOS os dados do produto original (imagens, ficha técnica, vínculos) — não recria do zero');
assertTrue(/novoSnap\.exists\)\s*throw.*already-exists.*SKU_JA_EXISTE/.test(srcRenomear), '9. bloqueia se o SKU novo já existir — mesma checagem de duplicidade de vitreDuplicarProduto');
assertTrue(/atual\.status === "renomeado"\)\s*throw/.test(srcRenomear), '10. bloqueia renomear um SKU que já é ele mesmo um tombstone (evita corrente de renomeações confusa)');
assertTrue(/runTransaction/.test(srcRenomear), '11. lê+grava dentro de uma transação (nunca duas escritas separadas que podem divergir sob concorrência)');
assertTrue(/acquireIdem\(idemKey\)/.test(srcRenomear), '12. idempotente (retry de rede não renomeia duas vezes)');

// ══════════════════════════════════════════════════════════════════════════
// PARTE 2 — achados secundários da auditoria (vitreCriarOuEditarProduto)
// ══════════════════════════════════════════════════════════════════════════
var srcCriarEditar = vitreSrc.slice(vitreSrc.indexOf('export const vitreCriarOuEditarProduto'), vitreSrc.indexOf('export const vitreAtivarDesativarProduto'));
assertTrue(/modo === "criar" && existia.*already-exists.*SKU_JA_EXISTE/.test(srcCriarEditar), '13. "Novo Produto" com um SKU que já existe agora é bloqueado (achado real: antes fazia merge silencioso no produto ERRADO)');
assertTrue(/modo === "editar" && !existia/.test(srcCriarEditar), '14. "Editar Produto" cujo documento sumiu (removido/renomeado por outra sessão) é sinalizado, não silenciosamente vira um "criar" acidental');
assertTrue(/lucroBruto = \(_preco != null && _custo != null\)/.test(srcCriarEditar), '15. lucroBruto recalculado ao editar custo/preço manualmente — antes só a importação recalculava, ficava desatualizado');
assertTrue(/margemBruta = \(_preco != null && _custo != null && _preco > 0\)/.test(srcCriarEditar), '16. margemBruta recalculada junto — mesma fórmula já usada em vitreImportarProdutos, nunca uma segunda');

// ══════════════════════════════════════════════════════════════════════════
// PARTE 3 — frontend: funções puras testadas por execução real
// ══════════════════════════════════════════════════════════════════════════
var html = fs.readFileSync(htmlPath, 'utf8');
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
(function () {
  var FN_NAMES = ['vitreCatStatusCor', 'vitreCatStatusLabel'];
  var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
  var modPath = path.join(__dirname, '_estabilizacao_bloco_f.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  assertTrue(mod.vitreCatStatusLabel({ status: 'ativo' }) === 'ATIVO', '17. rótulo de status "ativo" continua "ATIVO" — zero regressão');
  assertTrue(mod.vitreCatStatusLabel({ status: 'inativo' }) === 'INATIVO', '18. rótulo "inativo" continua "INATIVO" — zero regressão');
  assertTrue(mod.vitreCatStatusLabel({ status: 'renomeado' }) === 'RENOMEADO', '19. tombstone tem rótulo PRÓPRIO ("RENOMEADO") — nunca aparenta ser um produto desativado');
  assertTrue(mod.vitreCatStatusCor({ status: 'renomeado' }) !== mod.vitreCatStatusCor({ status: 'inativo' }), '20. cor do tombstone é visualmente distinta de "inativo"');
})();

// ══════════════════════════════════════════════════════════════════════════
// PARTE 4 — frontend: garantias estruturais (DOM pesado demais p/ mockar)
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var srcRender = extractFn('vitreCatalogoRender');
  assertTrue(/if \(!fStatus && p\.status === 'renomeado'\) return false;/.test(srcRender), '21. tombstones ficam fora da lista por padrão — nunca poluem o catálogo/busca normal, só aparecem com filtro explícito');
  assertTrue(/value="renomeado"/.test(html), '22. filtro de status tem a opção "Renomeado" — o operador consegue localizar o tombstone de propósito');

  var srcAcoes = html.slice(html.indexOf('function vitreCatAcoes'), html.indexOf('function vitreCatAcoes') + 1200);
  assertTrue(/p\.status === 'renomeado'/.test(srcAcoes), "23. vitreCatAcoes() trata tombstone separadamente — nunca oferece Editar/Ativar/Duplicar num produto já renomeado");
  assertTrue(/skuRenomeadoPara/.test(srcAcoes), '24. ação do tombstone linka direto para o produto no SKU novo — rastreabilidade de um clique');

  var srcEditar = extractFn('vitreCatalogoEditarModal');
  assertTrue(/vitreCatSku'\)\.disabled = true/.test(srcEditar), '25. campo SKU continua travado no formulário principal (mudança de arquitetura full, não este bloco) — a correção é a ação separada de renomear');
  assertTrue(/vitreCatSkuRenomearBtn/.test(srcEditar), '26. botão "Renomear SKU" é mostrado/escondido pela mesma função que abre o modal de edição');
  assertTrue(/vitreCatSouMaster\(\) && p\.status !== 'renomeado'/.test(srcEditar), '27. renomear é restrito a Master, e nunca oferecido para um produto que já é ele mesmo um tombstone');

  var srcRenomearFn = extractFn('vitreCatalogoRenomearSku');
  assertTrue(/httpsCallable\('vitreRenomearSku'\)/.test(srcRenomearFn), '28. chama a Cloud Function real (nunca um write direto do client no Firestore)');
  assertTrue(/SKU_JA_EXISTE/.test(srcRenomearFn), '29. trata o erro de SKU duplicado com mensagem clara ao operador');

  var srcSalvar = extractFn('vitreCatalogoSalvar');
  assertTrue(/modo:\s*editando\s*\?\s*'editar'\s*:\s*'criar'/.test(srcSalvar), "30. vitreCatalogoSalvar() informa a intenção real (criar/editar) ao backend — fecha o achado de merge silencioso em SKU duplicado");
})();

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
