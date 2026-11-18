/// <reference lib="webworker" />
/** 代码高亮的后台线程：收到一段代码，切好颜色发回去。上色很费时间（150 行 TS 要两三百毫秒），放在这里不卡界面 */
import { highlightNow } from "./highlight-engine";

self.onmessage = async (e: MessageEvent<{ id: number; code: string; lang: string | undefined }>) => {
  const { id, code, lang } = e.data;
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, lines: await highlightNow(code, lang) });
};
