/**
 * 代码高亮（技术方案：“代码高亮用 shiki”）。真正上色的在 highlight-engine.ts，放在后台线程里跑；
 * 这里只负责把代码送过去、把结果接回来，并记住最近上过色的代码（同一段不用再算一遍）。
 * 没有后台线程可用时（测试、老环境）在本线程里算。
 */
import type { CodeLine } from "./highlight-engine";
import { resolveLang } from "./highlight-langs";

export type { CodeLine };
export { resolveLang };

let worker: Worker | null | undefined;
let seq = 0;
const waiting = new Map<number, (lines: CodeLine[] | null) => void>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === "undefined" ? null : new Worker(new URL("./highlight.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  if (worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; lines: CodeLine[] | null }>) => {
      waiting.get(e.data.id)?.(e.data.lines);
      waiting.delete(e.data.id);
    };
    // 后台线程起不来：之后都在本线程算，正在等的也别干等
    worker.onerror = () => {
      worker = null;
      for (const resolve of waiting.values()) resolve(null);
      waiting.clear();
      cache.clear(); // 刚才没算出来的别记着，下次在本线程重算
    };
  }
  return worker;
}

/** 最近上过色的代码（按内容和语言），最多 200 段 */
const cache = new Map<string, Promise<CodeLine[] | null>>();

/** 把一段代码切成带颜色的词；语言不认识或出错时返回 null，调用方原样显示 */
export function highlight(code: string, langName: string | undefined): Promise<CodeLine[] | null> {
  if (!resolveLang(langName)) return Promise.resolve(null);
  const key = `${langName}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w = getWorker();
  const job: Promise<CodeLine[] | null> = w
    ? new Promise((resolve) => {
        const id = ++seq;
        waiting.set(id, resolve);
        w.postMessage({ id, code, lang: langName });
      })
    : import("./highlight-engine").then((m) => m.highlightNow(code, langName));
  cache.set(key, job);
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return job;
}
