import { defineConfig } from "vitest/config";

/** 整个应用的测试（要先 pnpm build）。和普通测试分开，因为要启动 Electron */
export default defineConfig({
  test: { include: ["tests/e2e/**/*.e2e.ts"], fileParallelism: false, testTimeout: 300000, hookTimeout: 300000 },
});
