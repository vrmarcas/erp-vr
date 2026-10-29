/** @type {import('jest').Config} */
// Primeira configuração de testes automatizados deste codebase
// (functions/, ERP real) — rodada "Operação Valéria, Frente C"
// (2026-10-29). Mesmo padrão já usado em functions-valeria/jest.config.js
// (worktree irmã), nunca uma convenção nova.
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  globals: {
    "ts-jest": {
      tsconfig: "./tsconfig.test.json",
      diagnostics: {
        ignoreCodes: [2345, 2339, 7017],
      },
    },
  },
  clearMocks: true,
  restoreMocks: true,
  collectCoverageFrom: ["src/**/*.ts", "!src/**/__tests__/**", "!src/index.ts"],
};
