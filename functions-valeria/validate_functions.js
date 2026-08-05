#!/usr/bin/env node
/**
 * validate_functions.js — Valida que todos os endpoints declarados em functions.yaml
 * estão exportados no index.js (e vice-versa).
 *
 * Uso: node "C:\Projetos\ERP VR\functions-valeria\validate_functions.js"
 */

const fs   = require("fs");
const path = require("path");

const BASE = path.join(__dirname);
const YAML_PATH  = path.join(BASE, "functions.yaml");
const INDEX_PATH = path.join(BASE, "lib", "index.js");

// ── Ler functions.yaml ────────────────────────────────────────────────────────
// O arquivo é JSON com chave "endpoints" contendo objeto { nome: { ... } }
let yamlFunctions = [];
try {
  const raw = fs.readFileSync(YAML_PATH, "utf8");
  const parsed = JSON.parse(raw);
  // Suporta formato { endpoints: { name: ... } } ou { name: ... } direto
  const endpoints = parsed.endpoints ?? parsed;
  yamlFunctions = Object.keys(endpoints);
} catch(e) {
  // Tentar formato YAML simples com "name:" lines
  try {
    const raw = fs.readFileSync(YAML_PATH, "utf8");
    const nameLines = raw.match(/^\s*"?name"?\s*:\s*["']?(\w+)["']?/gm) ?? [];
    yamlFunctions = nameLines.map(l => l.replace(/.*:\s*["']?(\w+)["']?.*/, '$1').trim());
    if (yamlFunctions.length === 0) {
      // Tentar top-level keys que não sejam meta
      const parsed = JSON.parse(raw);
      yamlFunctions = Object.keys(parsed).filter(k => !['version', 'runtime', 'source'].includes(k));
    }
  } catch(e2) {
    console.error("ERRO ao ler functions.yaml:", e2.message);
    process.exit(1);
  }
}

// ── Ler exports do index.js ───────────────────────────────────────────────────
let indexExports = [];
try {
  const raw = fs.readFileSync(INDEX_PATH, "utf8");
  // Capturar: exports.nomeFunc = ... ou Object.defineProperty(exports, "nomeFunc", ...)
  const assignMatches = raw.match(/exports\.(\w+)\s*=/g) ?? [];
  const defineMatches = raw.match(/exports,\s*"(\w+)"/g) ?? [];
  const set1 = assignMatches.map(m => m.replace(/exports\.(\w+)\s*=.*/, '$1'));
  const set2 = defineMatches.map(m => m.replace(/exports,\s*"(\w+)".*/, '$1'));
  indexExports = [...new Set([...set1, ...set2])];
} catch(e) {
  console.error("ERRO ao ler lib/index.js:", e.message);
  process.exit(1);
}

// Exports internos do CommonJS — não são endpoints reais
const INTERNAL_EXPORTS = ['__esModule'];

// ── Comparar ──────────────────────────────────────────────────────────────────
const inYamlNotIndex  = yamlFunctions.filter(f => !indexExports.includes(f));
const inIndexNotYaml  = indexExports.filter(f => !yamlFunctions.includes(f) && !INTERNAL_EXPORTS.includes(f));
const inBoth          = yamlFunctions.filter(f => indexExports.includes(f));

console.log("\n=== validate_functions.js ===\n");
console.log(`functions.yaml: ${yamlFunctions.length} endpoint(s)`);
console.log(`lib/index.js:   ${indexExports.length} export(s)`);
console.log(`Coincidência:   ${inBoth.length} função(ões)\n`);

if (inBoth.length > 0) {
  console.log("✅ Declaradas e exportadas:");
  inBoth.forEach(f => console.log("   ", f));
}

let hasError = false;

if (inYamlNotIndex.length > 0) {
  hasError = true;
  console.log("\n❌ No functions.yaml mas NÃO exportadas no index.js:");
  inYamlNotIndex.forEach(f => console.log("   ", f));
}

if (inIndexNotYaml.length > 0) {
  hasError = true;
  console.log("\n❌ Exportadas no index.js mas NÃO declaradas no functions.yaml:");
  inIndexNotYaml.forEach(f => console.log("   ", f));
}

if (!hasError) {
  console.log("\n✅ VALIDAÇÃO OK — todos os endpoints do functions.yaml estão exportados.");
  process.exit(0);
} else {
  console.log("\n❌ VALIDAÇÃO FALHOU — endpoints faltando no index.js.");
  process.exit(1);
}
