import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

/** 只跑界面（普通浏览器 + 假后端）：pnpm dev:web。Electron 的构建配置在 electron.vite.config.ts */
export default defineConfig({
  root: path.resolve(__dirname, "src/renderer"),
  base: "./",
  plugins: [react()],
  build: { outDir: path.resolve(__dirname, "out/web"), emptyOutDir: true },
  server: { port: 5199 },
});
