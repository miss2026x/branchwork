import { describe, expect, it } from "vitest";
import type { BwEvent, QueueItem, Route, Stop, SyncLogEntry } from "../../src/shared";
import { answerLead, noticesAfterSelecting, reduceNotices, type Notice, type NoticeContext } from "../../src/renderer/stores/notices";

const route = (id: string, patch: Partial<Route> = {}): Route => ({ id, projectId: "p1", number: 1, express: null, name: id, status: "idle", sessionId: null, worktreePath: "", parentRouteId: null, forkStopId: null, model: null, effort: null, permissionMode: "ask", color: null, contextTokens: null, pinned: false, folded: false, orphanOf: null, createdAt: 0, archivedAt: null, ...patch });
const stop = (id: string, routeId: string, seq: number, patch: Partial<Stop> = {}): Stop => ({ id, routeId, seq, kind: "normal", name: id, nameState: "final", prompt: id, status: "done", syncState: "synced", messageId: null, lastMessageId: null, error: null, startedAt: 0, endedAt: 0, ...patch });
const item = (id: string, routeId: string | null, mode: QueueItem["mode"], text = id, projectId = "p1"): QueueItem => ({ id, projectId, text, mode, routeId, createdAt: 0 });
const sync = (routeId: string, status: SyncLogEntry["status"], patch: Partial<SyncLogEntry> = {}): BwEvent => ({ type: "sync.result", entry: { id: "y", routeId, stopId: null, direction: "push", status, files: [{ path: "a.ts", note: "both-modified" }], message: null, at: 0, ...patch } });
const ctx = (patch: Partial<NoticeContext> = {}): NoticeContext => ({ routes: { r1: route("r1"), r2: route("r2", { number: 2 }) }, stops: {}, queue: {}, selectedRouteId: "r1", boarded: {}, ...patch });
const kinds = (list: Notice[]) => list.map((n) => n.kind);

describe("通知：只提醒要你处理的", () => {
  it("别的路冲突了要提醒；正在看的那一路不提醒（右边面板里已经有）", () => {
    expect(kinds(reduceNotices([], sync("r2", "conflict"), ctx()))).toEqual(["conflict"]);
    expect(reduceNotices([], sync("r1", "conflict"), ctx())).toEqual([]);
  });

  it("冲突解决后通知自己消失", () => {
    const list = reduceNotices([], sync("r2", "conflict"), ctx());
    expect(reduceNotices(list, { type: "route.updated", route: route("r2", { status: "conflict" }) }, ctx())).toHaveLength(1);
    expect(reduceNotices(list, { type: "route.updated", route: route("r2", { status: "idle" }) }, ctx())).toEqual([]);
  });

  it("同步出错总是提醒，哪怕是正在看的这一路；下次同步成功后消失", () => {
    const list = reduceNotices([], sync("r1", "error", { message: "磁盘满了" }), ctx());
    expect(list).toMatchObject([{ kind: "sync-error", message: "磁盘满了" }]);
    expect(reduceNotices(list, sync("r1", "ok"), ctx())).toEqual([]);
  });

  it("不是你停的却没答完，要提醒；你自己点的停车不提醒", () => {
    const before = ctx({ stops: { s1: stop("s1", "r2", 1, { status: "answering" }) }, queue: { p1: [item("w1", "r2", "auto")] } });
    const broken: BwEvent = { type: "stop.updated", stop: stop("s1", "r2", 1, { status: "interrupted", error: "网络断了" }) };
    expect(reduceNotices([], broken, before)).toMatchObject([{ kind: "interrupted", reason: "网络断了", waiting: 1 }]);
    const byUser: BwEvent = { type: "stop.updated", stop: stop("s1", "r2", 1, { status: "interrupted", error: "已停车" }) };
    expect(reduceNotices([], byUser, before)).toEqual([]);
  });

  it("到站时有设成手动登车的问题：提醒登车；问题被发走或撤掉后消失", () => {
    const before = ctx({ routes: { r2: route("r2", { status: "answering" }) }, queue: { p1: [item("w1", "r2", "manual", "跑测试")] } });
    const list = reduceNotices([], { type: "route.updated", route: route("r2") }, before);
    expect(list).toMatchObject([{ kind: "board", itemId: "w1", text: "跑测试" }]);
    // 本来就停着的路，不因为别的更新再提醒
    expect(reduceNotices([], { type: "route.updated", route: route("r2") }, ctx({ queue: before.queue }))).toEqual([]);
    const after = ctx({ routes: { r2: route("r2") } });
    expect(reduceNotices(list, { type: "queue.updated", projectId: "p1", items: [] }, after)).toEqual([]);
    // 别的项目的候车区变了，不影响这条
    expect(reduceNotices(list, { type: "queue.updated", projectId: "p2", items: [] }, after)).toHaveLength(1);
  });

  it("候车区里自动登车的问题发出去了：告诉你上一站答完、下一站已发出", () => {
    const before = ctx({ stops: { s1: stop("s1", "r2", 1) }, boarded: { r2: "下一个问题" } });
    const created: BwEvent = { type: "stop.created", stop: stop("s2", "r2", 2, { status: "answering", prompt: "下一个问题" }) };
    const list = reduceNotices([], created, before);
    expect(list).toMatchObject([{ kind: "arrived", stopId: "s1", nextStopId: "s2", nextText: "下一个问题" }]);
    // 你自己发的问题不提醒
    expect(reduceNotices([], created, ctx({ stops: before.stops }))).toEqual([]);
    // 那一站也结束了，通知就过时了
    expect(reduceNotices(list, { type: "stop.updated", stop: stop("s2", "r2", 2, { prompt: "下一个问题" }) }, before)).toEqual([]);
  });

  it("你没在看的那一路答完了：提示一下，带上回答的头一两句；正看着、Lanes 又在最前面的不提示", () => {
    const live = { s1: { items: [{ kind: "text" as const, text: "改好了：\n\n- `callback()` 里先比对 **state**\n- 清掉 `oauth_tmp`" }] } };
    const before = ctx({ stops: { s1: stop("s1", "r2", 1, { status: "answering" }), s0: stop("s0", "r1", 1, { status: "answering" }) }, live });
    const done: BwEvent = { type: "stop.updated", stop: stop("s1", "r2", 1) };
    expect(reduceNotices([], done, before)).toEqual([{ id: "done:r2", kind: "done", routeId: "r2", stopId: "s1", text: "改好了： callback() 里先比对 state 清掉 oauth_tmp" }]);
    const mine: BwEvent = { type: "stop.updated", stop: stop("s0", "r1", 1) };
    expect(reduceNotices([], mine, before)).toEqual([]);
    // Lanes 不在最前面：正看着的那一路答完也提示
    expect(kinds(reduceNotices([], mine, { ...before, focused: false }))).toEqual(["done"]);
    // 摘要站、本来就不是在答的，不提示
    expect(reduceNotices([], { type: "stop.updated", stop: stop("s1", "r2", 1, { kind: "summary" }) }, before)).toEqual([]);
    expect(reduceNotices([], done, ctx({ stops: { s1: stop("s1", "r2", 1) } }))).toEqual([]);
    // 这一路又发了新的一站：上一条“答完了”过时了
    const list = reduceNotices([], done, before);
    expect(reduceNotices(list, { type: "stop.created", stop: stop("s2", "r2", 2, { status: "answering" }) }, before)).toEqual([]);
  });

  it("没找到 Chrome（设计稿 9-15）：Claude 想用时提示一条；下好后换成“下好了”", () => {
    const missing = reduceNotices([], { type: "chrome.missing", routeId: "r2" }, ctx());
    expect(missing).toEqual([{ id: "chrome:r2", kind: "chrome-missing", routeId: "r2" }]);
    // 同一路再试一次不重复
    expect(reduceNotices(missing, { type: "chrome.missing", routeId: "r2" }, ctx())).toHaveLength(1);
    const st = { status: "downloading" as const, version: "147.0.1.2", received: 1, total: 2, error: null };
    expect(reduceNotices(missing, { type: "chrome.download", state: st }, ctx())).toBe(missing);
    expect(reduceNotices(missing, { type: "chrome.download", state: { ...st, status: "done" } }, ctx())).toEqual([{ id: "chrome-ready", kind: "chrome-ready", routeId: "", version: "147.0.1.2" }]);
  });

  it("回答的头一两句：去掉 Markdown 记号，太长截断", () => {
    expect(answerLead([{ kind: "text", text: "## 结论\n\n> 引用\n\n| a | b |" }])).toBe("结论 引用 a b");
    expect(answerLead([{ kind: "text", text: "看 [文档](https://x.y) 第 3 节" }])).toBe("看 文档 第 3 节");
    expect(answerLead([{ kind: "text", text: "字".repeat(100) }])).toBe("字".repeat(90) + "…");
    expect(answerLead(undefined)).toBe("");
  });

  it("点开某一路后，它的冲突和中断通知不用留着；等你登车的还留着", () => {
    const list: Notice[] = [
      { id: "a", kind: "conflict", routeId: "r2", stopId: null, files: [] },
      { id: "b", kind: "board", routeId: "r2", itemId: "w1", text: "x" },
      { id: "c", kind: "conflict", routeId: "r1", stopId: null, files: [] },
    ];
    expect(noticesAfterSelecting(list, "r2").map((n) => n.id)).toEqual(["b", "c"]);
  });

  it("路被删掉，它的通知一起消失", () => {
    const list = reduceNotices([], sync("r2", "conflict"), ctx());
    expect(reduceNotices(list, { type: "route.deleted", routeId: "r2", projectId: "p1" }, ctx())).toEqual([]);
  });
});
