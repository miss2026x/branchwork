import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { batchEvents } from "../../src/main/event-batch";
import type { BwEvent } from "../../src/shared";

const delta = (stopId: string, text: string): BwEvent => ({ type: "stop.delta", routeId: "r", stopId, text });

describe("发给界面的事件：碎字攒一下再发", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("同一站连续的字合成一段；过了时间才发", () => {
    const sent: BwEvent[] = [];
    const push = batchEvents((e) => sent.push(e), 40);
    push(delta("s1", "你"));
    push(delta("s1", "好"));
    push(delta("s2", "嗯"));
    push(delta("s2", "哦"));
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(40);
    expect(sent).toEqual([delta("s1", "你好"), delta("s2", "嗯哦")]);
  });
  it("在想的内容也攒着发；和回答的字交替时各自成段，顺序不变", () => {
    const sent: BwEvent[] = [];
    const push = batchEvents((e) => sent.push(e), 40);
    const think = (t: string): BwEvent => ({ type: "stop.thinking", routeId: "r", stopId: "s1", text: t });
    push(think("先"));
    push(think("想想"));
    push(delta("s1", "好"));
    push(think("再想"));
    vi.advanceTimersByTime(40);
    expect(sent).toEqual([think("先想想"), delta("s1", "好"), think("再想")]);
  });
  it("别的事件马上发，发之前先把攒着的字发掉，顺序不乱", () => {
    const sent: BwEvent[] = [];
    const push = batchEvents((e) => sent.push(e), 40);
    push(delta("s1", "先读"));
    push({ type: "stop.tool", routeId: "r", stopId: "s1", tool: "Read", input: {}, detail: "a.ts" });
    push(delta("s1", "读完了"));
    expect(sent.map((e) => (e.type === "stop.delta" ? e.text : e.type))).toEqual(["先读", "stop.tool"]);
    vi.advanceTimersByTime(40);
    expect(sent.map((e) => (e.type === "stop.delta" ? e.text : e.type))).toEqual(["先读", "stop.tool", "读完了"]);
  });
});
