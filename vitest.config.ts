import { defineConfig } from 'vitest/config';

// Юнит-тесты ядра и сетевого слоя (чистые функции + LWW-синхронизация на
// fake-indexeddb). UI/Svelte и Rust тестируются отдельно (cargo test).
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    // Workspace-пакеты компилируются из исходников (как в приложении).
    conditions: ['import', 'module', 'default'],
  },
});
