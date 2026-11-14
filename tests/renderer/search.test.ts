import { describe, expect, it } from "vitest";
import type { Project, QueueItem, Route, Stop } from "../../src/shared";
import { dayLabel, excerpt, highlight, search, type SearchInput } from "../../src/renderer/palette/search";

const project = (id: string): Project => ({ id, name: id, localDir: "", permissionMode: "ask", createdAt: 0 });
const route = (id: string, projectId: string, patch: Partial<Route> = {}): Route => ({ id, projectId, number: 1, express: null, name: id, status: "idle", sessionId: null, worktreePath: "", parentRouteId: null, forkStopId: null, model: null, color: null, contextTokens: null, pinned: false, folded: false, orphanOf: null, createdAt: 0, archivedAt: null, ...patch });
const stop = (id: string, routeId: string, prompt: string, startedAt: number, name = prompt.slice(0, 6)): Stop => ({ id, routeId, seq: 1, kind: "normal", name, nameState: "final", prompt, status: "done", syncState: "synced", messageId: null, lastMessageId: null, error: null, startedAt, endedAt: 0 });
const queued = (id: string, projectId: string, text: string): QueueItem => ({ id, projectId, text, mode: "unassigned", routeId: null, createdAt: 0 });

const data: SearchInput = {
  projects: [project("auth"), project("web")],
  routes: { r1: route("r1", "auth"), r2: route("r2", "web"), r3: route("r3", "auth", { status: "archived" }) },
  stops: {
    s1: stop("s1", "r1", "实现 JWT 中间件，令牌签发和校验", 1),
    s2: stop("s2", "r2", "请求头里的令牌过期了怎么刷新", 2),
    s3: stop("s3", "r1", "补上单元测试", 3),
    s4: stop("s4", "r3", "归档的路里也提到令牌", 4),
  },
  queue: { auth: [queued("w1", "auth", "refresh 令牌要不要做滑动续期")], web: [queued("w2", "web", "换首屏图")] },
};

describe("命令面板的搜索", () => {
  it("搜提问和候车区，新的在前；归档的路不搜", () => {
    const r = search(data, "令牌", null);
    expect(r.stops.map((h) => h.stop.id)).toEqual(["s2", "s1"]);
    expect(r.queue.map((h) => h.item.id)).toEqual(["w1"]);
    expect(r.commands.map((h) => h.command)).toEqual(["new-route", "queue-add"]);
    expect(r.all).toHaveLength(5);
  });

  it("可以只看一个项目", () => {
    const r = search(data, "令牌", "web");
    expect(r.stops.map((h) => h.stop.id)).toEqual(["s2"]);
    expect(r.queue).toEqual([]);
  });

  it("多个词都要出现，不分大小写", () => {
    expect(search(data, "jwt 校验", null).stops.map((h) => h.stop.id)).toEqual(["s1"]);
    expect(search(data, "jwt 刷新", null).stops).toEqual([]);
  });

  it("> 开头只搜命令", () => {
    const r = search(data, "> 令牌", null);
    expect(r.stops).toEqual([]);
    expect(r.queue).toEqual([]);
    expect(r.commands[0]).toMatchObject({ command: "new-route", text: "令牌" });
  });

  it("什么都没输入：列出最近的站，只有“开一路新车”这个命令", () => {
    const r = search(data, "", null);
    expect(r.stops.map((h) => h.stop.id)).toEqual(["s3", "s2", "s1"]);
    expect(r.commands.map((h) => h.command)).toEqual(["new-route"]);
  });

  it("高亮：把匹配到的词切出来", () => {
    expect(highlight("令牌签发，换令牌", ["令牌"])).toEqual([
      { text: "令牌", hit: true },
      { text: "签发，换", hit: false },
      { text: "令牌", hit: true },
    ]);
    expect(highlight("abc", [])).toEqual([{ text: "abc", hit: false }]);
  });

  it("摘录：取匹配处前后的一段", () => {
    const text = "一".repeat(100) + "令牌" + "二".repeat(300);
    const cut = excerpt(text, ["令牌"], 60);
    expect(cut.startsWith("…")).toBe(true);
    expect(cut).toContain("令牌");
    expect(cut.endsWith("……")).toBe(true);
    expect(excerpt("短的", ["没有"])).toBe("短的");
  });

  it("日期：今天、昨天、周几、几月几日", () => {
    const now = new Date(2026, 10, 12, 15).getTime(); // 周四
    expect(dayLabel(new Date(2026, 10, 12, 1).getTime(), now)).toBe("今天");
    expect(dayLabel(new Date(2026, 10, 11, 23).getTime(), now)).toBe("昨天");
    expect(dayLabel(new Date(2026, 10, 9, 9).getTime(), now)).toBe("周一");
    expect(dayLabel(new Date(2026, 9, 1).getTime(), now)).toBe("10月1日");
  });
});
