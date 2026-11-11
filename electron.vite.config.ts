import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// 三部分各自打包：主进程（Node）、preload（沙箱里的桥）、界面（浏览器）。
// package.json 里 dependencies 的包（Agent SDK 等）不打进主进程的包里，运行时从 node_modules 加载。
export default defineConfig({
  main: {},
  preload: {
    // 开了沙箱的 preload 只能是 CommonJS
    build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
  },
  renderer: {
    plugins: [react()],
  },
});
