import type { BwEvent } from "../shared";

/**
 * 发给界面的事件：Claude 吐字很碎（一秒几十段），每段都发一次，界面每段都要重画一次，长对话会追不上，
 * 看起来就是“卡住，过一会儿一下子全蹦出来”。这里把同一站连续的文字攒一小会儿（ms）合成一段再发。
 * 别的事件照常马上发；发之前先把攒着的文字发掉，先后顺序不变。
 */
export function batchEvents(send: (e: BwEvent) => void, ms = 40) {
  const pending = new Map<string, Extract<BwEvent, { type: "stop.delta" }>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const list = [...pending.values()];
    pending.clear();
    for (const e of list) send(e);
  };
  const push = (e: BwEvent) => {
    if (e.type !== "stop.delta") {
      flush();
      send(e);
      return;
    }
    const cur = pending.get(e.stopId);
    pending.set(e.stopId, cur ? { ...cur, text: cur.text + e.text } : e);
    timer ??= setTimeout(flush, ms);
  };
  return Object.assign(push, { flush });
}
