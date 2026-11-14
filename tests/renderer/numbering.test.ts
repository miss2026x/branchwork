import { describe, expect, it } from "vitest";
import type { Stop } from "../../src/shared";
import { nameRepeat, ordinal, repeatMark } from "../../src/renderer/stores/numbering";
import { conflictLines } from "../../src/sync/merge";

const stop = (seq: number, name: string, kind: Stop["kind"] = "normal", routeId = "r1"): Stop => ({ id: `${routeId}-${seq}`, routeId, seq, kind, name, nameState: "final", prompt: name, status: "done", syncState: "none", messageId: null, lastMessageId: null, error: null, startedAt: seq, endedAt: seq });

describe("站号和同名的站", () => {
  const stops = [stop(1, "看结构"), stop(2, "继续", "minor"), stop(3, "跑测试"), stop(4, "跑测试"), stop(5, "跑测试"), stop(1, "跑测试", "normal", "r2")];

  it("短确认不占站号", () => {
    expect(stops.filter((s) => s.routeId === "r1").map((s) => ordinal(s, stops))).toEqual([1, 1, 2, 3, 4]);
  });

  it("同一路里同名的站，第二个起标 ②③；别的路不算", () => {
    expect(stops.map((s) => repeatMark(nameRepeat(s, stops)))).toEqual(["", "", "", "②", "③", ""]);
  });
});

describe("冲突在第几行", () => {
  it("按“我方”那一份数：冲突标记和对方的行不算", () => {
    const text = ["a", "<<<<<<< ours", "b1", "b2", "=======", "x", ">>>>>>> theirs", "c", "<<<<<<< ours", "d", "||||||| base", "o", "=======", "y", "z", ">>>>>>> theirs", "e"].join("\n");
    expect(conflictLines(text)).toEqual([
      [2, 3],
      [5, 5],
    ]);
  });
});
