#!/usr/bin/env node
/**
 * prepare_ponte_homolog_deploy_package.js — "Operação Valéria", rodada
 * "publicar e validar a ponte ERP em homologação" (2026-10-29).
 *
 * Gera functions_ponte_homolog/src/ a partir de functions/src/ (única
 * fonte de verdade — nunca editar os arquivos gerados diretamente).
 * Existe pelo MESMO motivo documentado em
 * scripts/prepare_meta_homolog_deploy_package.js (worktree
 * meta-cloud-api-fase2): um `firebase deploy --only functions:X,Y` a
 * partir do codebase `default` completo ainda carrega TODO o
 * functions/src/index.ts para análise — e esse index.ts reexporta
 * metaAds.ts/googleAds.ts, que chamam `defineSecret("META_APP_ID")` etc.
 * no escopo do módulo. O Firebase CLI exige essas credenciais no Secret
 * Manager do projeto de DESTINO mesmo quando essas Functions não serão
 * publicadas. Prova real (2026-10-29):
 *
 *   Error: In non-interactive mode but have no value for the secret:
 *   META_APP_ID
 *
 * Criar esses secrets só para satisfazer a análise seria escopo fora
 * desta rodada (integrações de Ads, não a ponte ERP↔Valéria) — este
 * pacote separado evita o problema na raiz: só inclui o fecho
 * transitivo real das 8 Functions autorizadas, nenhuma outra.
 *
 * Mesmo padrão de fecho transitivo + blocklist do script irmão.
 *
 * Uso: node scripts/prepare_ponte_homolog_deploy_package.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(REPO_ROOT, 'functions', 'src');
const DEST_DIR = path.join(REPO_ROOT, 'functions_ponte_homolog', 'src');

// As 5 Functions pedidas pelo usuário vivem nestes 2 módulos; as 2
// dependências comprovadamente indispensáveis ao fluxo Vitre
// (valeriaVitreBuscarCatalogo/valeriaVitreCriarRascunho, chamadas por
// erp_bridge_client.ts na Central) vivem em valeria_vitre.ts.
const ENTRY_MODULES = [
  'valeria_pre_orcamento_identidade.ts',   // valeriaConsultarClientePorTelefone, valeriaPrepararCadastroProvisorio
  'valeria_pre_orcamento_personalizado.ts', // valeriaCriarRascunhoPersonalizado
  'valeria_pre_orcamento_revisao.ts',      // vendedorAssumirRevisaoPreOrcamento, vendedorConcluirRevisaoPreOrcamento
  'valeria_pre_orcamento_aprovacao.ts',    // vendedorDecidirPreOrcamentoValeria
  'valeria_vitre.ts',                      // valeriaVitreBuscarCatalogo, valeriaVitreCriarRascunho (dependência real da ponte)
];

// Módulos que NUNCA podem aparecer no fecho transitivo deste pacote —
// nem a correção financeira ainda não autorizada para produção, nem
// nenhuma integração de Ads (defineSecret, fora do escopo desta rodada).
// Se aparecerem, é sinal de que algum arquivo novo introduziu uma
// dependência inesperada — o script para e avisa, nunca inclui
// silenciosamente.
const BLOCKLIST = new Set([
  'finCr.ts',
  'valeria_orcamentos_integrity_guard.ts',
  'metaAds.ts',
  'googleAds.ts',
  'erp_orcamento_exclusao_segura.ts',
]);

function resolveRelativeImport(specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null; // pacote externo (firebase-admin, etc.) — nunca copiado
  const base = specifier.replace(/^\.\//, '').replace(/^\.\.\//, '');
  const candidate = `${base}.ts`;
  return fs.existsSync(path.join(SOURCE_DIR, candidate)) ? candidate : null;
}

const IMPORT_RE = /from\s+["']([^"']+)["']/g;

function extractLocalImports(fileContent) {
  const found = [];
  let m;
  while ((m = IMPORT_RE.exec(fileContent)) !== null) {
    const resolved = resolveRelativeImport(m[1]);
    if (resolved) found.push(resolved);
  }
  return found;
}

function computeTransitiveClosure(entries) {
  const visited = new Set();
  const queue = [...entries];
  const blocked = [];

  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) continue;

    if (BLOCKLIST.has(file)) {
      blocked.push(file);
      continue;
    }

    visited.add(file);
    const fullPath = path.join(SOURCE_DIR, file);
    if (!fs.existsSync(fullPath)) {
      console.error(`ERRO: módulo de origem não encontrado: ${fullPath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    for (const dep of extractLocalImports(content)) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }

  return { included: visited, blocked: new Set(blocked) };
}

const INDEX_TS = `/**
 * index.ts — GERADO por scripts/prepare_ponte_homolog_deploy_package.js.
 * NÃO EDITAR À MÃO — editar os módulos de origem em functions/src/ e
 * rodar o script de novo.
 *
 * Exporta SOMENTE as 8 Functions da ponte Central(Valéria)↔ERP
 * autorizadas para homologação (rodada "publicar e validar a ponte ERP
 * em homologação", 2026-10-29) — nenhuma outra, nenhuma dependência de
 * secret de Ads (META_APP_ID/GOOGLE_*), nunca finCrAutoAprovarOrcamento
 * nem valeriaOrcamentosIntegrityGuard (bloqueados explicitamente no
 * BLOCKLIST do gerador).
 */
import * as admin from "firebase-admin";
admin.initializeApp();

export {
  valeriaConsultarClientePorTelefone,
  valeriaPrepararCadastroProvisorio,
} from "./valeria_pre_orcamento_identidade";
export { valeriaCriarRascunhoPersonalizado } from "./valeria_pre_orcamento_personalizado";
export {
  vendedorAssumirRevisaoPreOrcamento,
  vendedorConcluirRevisaoPreOrcamento,
} from "./valeria_pre_orcamento_revisao";
export { vendedorDecidirPreOrcamentoValeria } from "./valeria_pre_orcamento_aprovacao";
export {
  valeriaVitreBuscarCatalogo,
  valeriaVitreCriarRascunho,
} from "./valeria_vitre";
`;

function main() {
  const { included, blocked } = computeTransitiveClosure(ENTRY_MODULES);

  if (blocked.size > 0) {
    console.error('ERRO: dependência(s) bloqueada(s) encontrada(s) no fecho transitivo — NUNCA incluídas automaticamente:');
    for (const f of blocked) console.error(`  - ${f}`);
    console.error('Investigue qual módulo novo passou a importar isso antes de prosseguir.');
    process.exit(1);
  }

  fs.rmSync(DEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEST_DIR, { recursive: true });

  for (const file of included) {
    fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(DEST_DIR, file));
  }

  fs.writeFileSync(path.join(DEST_DIR, 'index.ts'), INDEX_TS, 'utf8');

  console.log(`✔ functions_ponte_homolog/src/ gerado com ${included.size} módulos (fecho transitivo de ${ENTRY_MODULES.length} entradas) + index.ts.`);
  console.log(`✔ Nenhuma dependência bloqueada encontrada (blocklist: ${BLOCKLIST.size} módulos verificados).`);
  console.log('Módulos incluídos:', [...included].sort().join(', '));
}

main();
