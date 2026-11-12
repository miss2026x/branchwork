import type { BwEvent, QueueItem, Route, Stop, SyncFile } from "../../shared";

/**
 * 通知：只提醒要你处理的事。
 * 这里是纯函数：给它“现在有哪些通知、来了什么事件、事件之前的数据”，它算出新的通知列表。
 * 不取数据、不计时，方便单独测试。
 */
export type Notice =
  /** 后台提炼的摘要好了 */
  | { id: string; kind: "summary"; routeId: string; stopId: string }
  /** 改动没法自动合进 Local */
  | { id: string; kind: "conflict"; routeId: string; stopId: string | null; files: SyncFile[] }
  /** 不是你停的，却没答完 */
  | { id: string; kind: "interrupted"; routeId: string; stopId: string; reason: string; waiting: number }
  /** 答完一站，候车区里的下一个问题已自动发出 */
  | { id: string; kind: "arrived"; routeId: string; stopId: string; nextStopId: string; nextText: string }
  /** 到站了，有一个设成手动登车的问题在等 */
  | { id: string; kind: "board"; routeId: string; itemId: string; text: string }
  /** 同步出错（不是冲突） */
  | { id: string; kind: "sync-error"; routeId: string; message: string };

/** 事件发生之前的数据 */
export interface NoticeContext {
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
  queue: Record<string, QueueItem[]>;
  /** 正在看的那一路：它的冲突、中断在右边面板里已经看得到，不再弹通知 */
  selectedRouteId: string | null;
  /** 各路刚从候车区自动发出的问题（候车区的更新比新站的出现早到） */
  boarded: Record<string, string>;
}

const busy = (r: Route | undefined) => r?.status === "answering" || r?.status === "awaiting_permission";
/** 用户自己点的停车，不用再提醒他 */
export const STOPPED_BY_USER = "已停车";

const put = (list: Notice[], n: Notice) => [...list.filter((x) => x.id !== n.id), n];

export function reduceNotices(list: Notice[], e: BwEvent, s: NoticeContext): Notice[] {
  switch (e.type) {
    case "route.updated": {
      const r = e.route;
      let next = list.filter((n) => {
        if (n.routeId !== r.id) return true;
        if (n.kind === "conflict") return r.status === "conflict";
        if (n.kind === "interrupted") return r.status === "interrupted";
        if (n.kind === "sync-error") return !busy(r);
        if (n.kind === "board") return !busy(r) && r.status !== "archived";
        return r.status !== "archived";
      });
      // 刚到站：有设成手动登车的问题在等这一路
      if (busy(s.routes[r.id]) && (r.status === "idle" || r.status === "interrupted")) {
        const item = (s.queue[r.projectId] ?? []).find((q) => q.routeId === r.id && q.mode === "manual");
        if (item) next = put(next, { id: `board:${item.id}`, kind: "board", routeId: r.id, itemId: item.id, text: item.text });
      }
      return next;
    }
    case "route.deleted":
      return list.filter((n) => n.routeId !== e.routeId);
    case "stop.created": {
      const stop = e.stop;
      const route = s.routes[stop.routeId];
      // 新的一站出发了：上一条“已自动发出”的通知就过时了
      let next = list.filter((n) => !(n.kind === "arrived" && n.routeId === stop.routeId));
      if (stop.status !== "answering" || !route || stop.routeId === s.selectedRouteId) return next;
      const auto = s.boarded[stop.routeId] === stop.prompt || (s.queue[route.projectId] ?? []).some((q) => q.routeId === stop.routeId && q.mode === "auto" && q.text === stop.prompt);
      const prev = Object.values(s.stops)
        .filter((x) => x.routeId === stop.routeId && x.seq < stop.seq)
        .sort((a, b) => b.seq - a.seq)[0];
      if (auto && prev?.status === "done") next = put(next, { id: `arrived:${stop.id}`, kind: "arrived", routeId: stop.routeId, stopId: prev.id, nextStopId: stop.id, nextText: stop.prompt });
      return next;
    }
    case "stop.updated": {
      const stop = e.stop;
      // 自动发出的那一站也结束了
      let next = stop.status === "answering" ? list : list.filter((n) => !(n.kind === "arrived" && n.nextStopId === stop.id));
      const before = s.stops[stop.id];
      if (stop.status === "interrupted" && before?.status === "answering" && stop.error !== STOPPED_BY_USER && stop.routeId !== s.selectedRouteId) {
        const route = s.routes[stop.routeId];
        const waiting = route ? (s.queue[route.projectId] ?? []).filter((q) => q.routeId === route.id).length : 0;
        next = put(next, { id: `interrupted:${stop.id}`, kind: "interrupted", routeId: stop.routeId, stopId: stop.id, reason: stop.error ?? "没有正常结束", waiting });
      }
      return next;
    }
    case "sync.result": {
      const entry = e.entry;
      if (entry.status === "conflict" && entry.routeId !== s.selectedRouteId) return put(list, { id: `conflict:${entry.routeId}`, kind: "conflict", routeId: entry.routeId, stopId: entry.stopId, files: entry.files });
      if (entry.status === "error") return put(list, { id: `sync-error:${entry.routeId}`, kind: "sync-error", routeId: entry.routeId, message: entry.message ?? "同步没有成功" });
      if (entry.status === "ok" || entry.status === "noop") return list.filter((n) => !(n.routeId === entry.routeId && (n.kind === "sync-error" || (n.kind === "conflict" && entry.direction !== "pull"))));
      return list;
    }
    case "queue.updated":
      // 只看这个项目的：别的项目的候车区没变
      return list.filter((n) => n.kind !== "board" || s.routes[n.routeId]?.projectId !== e.projectId || e.items.some((q) => q.id === n.itemId && q.mode === "manual" && q.routeId === n.routeId));
    default:
      return list;
  }
}

/** 点开了某一路：它的冲突、中断、到站通知不用再留着 */
export function noticesAfterSelecting(list: Notice[], routeId: string): Notice[] {
  return list.filter((n) => n.routeId !== routeId || n.kind === "board" || n.kind === "summary" || n.kind === "sync-error");
}
