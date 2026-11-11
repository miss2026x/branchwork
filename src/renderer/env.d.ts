/// <reference types="vite/client" />
import type { BwApi } from "../shared";

declare global {
  interface Window {
    /** 主进程通过 preload 暴露的全部操作 */
    bw: BwApi;
  }
}
