/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  globals: {
    "ts-jest": {
      tsconfig: "./tsconfig.test.json",
      diagnostics: {
        // Ignora erros de tipo nas chamadas de teste (objetos simples no lugar de Request/Response)
        ignoreCodes: [2345, 2339, 7017],
      },
    },
  },
  // Limpa mocks automaticamente entre testes
  clearMocks: true,
  restoreMocks: true,
  // Relatório de cobertura
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/__tests__/**",
    "!src/index.ts",
  ],
};
