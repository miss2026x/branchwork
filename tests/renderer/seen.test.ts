import { describe, expect, it } from "vitest";
import type { Route, Stop } from "../../src/shared";
import { lastActive, markSeen, unreadIds, type Seen } from "../../src/renderer/stores/seen";
import { lastTime } from "../../src/renderer/ui/ago";

const route = (id: string, patch: Partial<Route> = {}): Route => ({ id, projectId: "p1", number: 1, express: null, name: id, status: "idle", sessionId: null, worktreePath: "", parentRouteId: null, forkStopId: null, model: null, effort: null, permissionMode: "ask", color: null, contextTokens: null, pinned: false, folded: false, orphanOf: null, createdAt: 0, archivedAt: null, ...patch });
const stop = (id: string, routeId: string, patch: Partial<Stop> = {}): Stop => ({ id, routeId, seq: 1, kind: "normal", name: id, nameState: "final", prompt: id, status: "done", syncState: "synced", messageId: null, lastMessageId: null, error: null, startedAt: 0, endedAt: 0, ...patch });

describe("答完了还没看（设计稿 9-14）", () => {
  const seen: Seen = { since: 100, at: { r2: 500 } };
  it("最近答完的一站比看过的时候晚，就是没看过；没记过的按第一次用的时候算", () => {
    const routes = { r1: route("r1"), r2: route("r2"), r3: route("r3"), r4: route("r4", { status: "answering" }) };
    const stops = {
      a: stop("a", "r1", { endedAt: 200 }),
      b: stop("b", "r2", { endedAt: 400 }),
      c: stop("c", "r3", { endedAt: 50 }),
      d: stop("d", "r4", { endedAt: 900 }),
      // 摘要站、中断的不算
      e: stop("e", "r3", { kind: "summary", endedAt: 900 }),
      f: stop("f", "r3", { status: "interrupted", endedAt: 900 }),
    };
    expect([...unreadIds(routes, stops, seen)]).toEqual(["r1"]);
    expect([...unreadIds(routes, stops, markSeen(seen, "r1", 300))]).toEqual([]);
  });

  it("最近一次对话：最后一站答完的时候；还在答就是开始的时候", () => {
    expect(lastActive([stop("a", "r1", { startedAt: 10, endedAt: 20 }), stop("b", "r1", { startedAt: 30, endedAt: null })], "r1")).toBe(30);
    expect(lastActive([], "r1")).toBeNull();
  });

  it("时间怎么写", () => {
    const now = new Date(2026, 10, 14, 15, 0).getTime();
    expect(lastTime(now - 20_000, now)).toBe("刚刚");
    expect(lastTime(now - 3 * 60_000, now)).toBe("3 分钟前");
    expect(lastTime(new Date(2026, 10, 14, 9, 5).getTime(), now)).toBe("09:05");
    expect(lastTime(new Date(2026, 10, 13, 23, 0).getTime(), now)).toBe("昨天");
    expect(lastTime(new Date(2026, 10, 12, 8, 0).getTime(), now)).toBe("11月12日");
    expect(lastTime(new Date(2025, 10, 12, 8, 0).getTime(), now)).toBe("2025/11/12");
  });
});
