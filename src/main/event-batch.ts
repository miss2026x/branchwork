import type { BwEvent } from "../shared";

type Mergeable = Extract<BwEvent, { type: "stop.delta" | "stop.thinking" }>;
const mergeable = (e: BwEvent): e is Mergeable => e.type === "stop.delta" || e.type === "stop.thinking";

/**
 * 发给界面的事件：Claude 吐字很碎（一秒几十段），每段都发一次，界面每段都要重画一次，长对话会追不上，
 * 看起来就是“卡住，过一会儿一下子全蹦出来”。这里把连着的同一站的文字（回答或在想的内容）攒一小会儿（ms）合成一段再发。
 * 别的事件照常马上发；发之前先把攒着的发掉。只和紧挨着的前一段合并，先后顺序一点不变。
 */
export function batchEvents(send: (e: BwEvent) => void, ms = 40) {
  let pending: Mergeable[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const list = pending;
    pending = [];
    for (const e of list) send(e);
  };
  const push = (e: BwEvent) => {
    if (!mergeable(e)) {
      flush();
      send(e);
      return;
    }
    const last = pending.at(-1);
    if (last && last.type === e.type && last.stopId === e.stopId) pending[pending.length - 1] = { ...last, text: last.text + e.text };
    else pending.push(e);
    timer ??= setTimeout(flush, ms);
  };
  return Object.assign(push, { flush });
}
