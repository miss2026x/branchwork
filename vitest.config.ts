import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // 测试要启动很多次 git。在启动进程慢的机器上，几个测试文件同时跑会互相拖到超时，所以一个一个跑
    fileParallelism: false,
    testTimeout: 600000,
    hookTimeout: 600000,
  },
});
