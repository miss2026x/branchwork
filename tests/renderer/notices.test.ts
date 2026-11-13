import { describe, expect, it } from "vitest";
import type { BwEvent, QueueItem, Route, Stop, SyncLogEntry } from "../../src/shared";
import { noticesAfterSelecting, reduceNotices, type Notice, type NoticeContext } from "../../src/renderer/stores/notices";

const route = (id: string, patch: Partial<Route> = {}): Route => ({ id, projectId: "p1", number: 1, express: null, name: id, status: "idle", sessionId: null, worktreePath: "", parentRouteId: null, forkStopId: null, model: null, color: null, contextTokens: null, createdAt: 0, archivedAt: null, ...patch });
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
