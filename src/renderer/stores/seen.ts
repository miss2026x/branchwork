import type { Route, Stop } from "../../shared";

/**
 * “看过没有”（设计稿 9-14）：每一路记一个“看到哪个时候了”。
 * 最近答完的一站比它晚，就是答完了还没看。记在这台电脑上，重启后还在。
 * since：第一次用这个功能的时候；之前答完的都当看过了，不然一升级满屏绿点。
 */
export interface Seen {
  since: number;
  at: Record<string, number>;
}

const KEY = "lanes.seen";

export function loadSeen(now = Date.now()): Seen {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Seen> | null;
    if (raw && typeof raw.since === "number" && raw.at && typeof raw.at === "object") return { since: raw.since, at: raw.at };
  } catch {
    // 读不到就从现在算起
  }
  const fresh = { since: now, at: {} };
  saveSeen(fresh);
  return fresh;
}

export function saveSeen(seen: Seen): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    // 存不下就只在这一次里记得
  }
}

/** 这一路看到现在了 */
export function markSeen(seen: Seen, routeId: string, now = Date.now()): Seen {
  return { ...seen, at: { ...seen.at, [routeId]: now } };
}

/** 这一路最近一次正常答完的时候（摘要站不算） */
export function lastDone(stops: Iterable<Stop>, routeId: string): number | null {
  let at: number | null = null;
  for (const s of stops) if (s.routeId === routeId && s.kind !== "summary" && s.status === "done" && s.endedAt !== null && (at === null || s.endedAt > at)) at = s.endedAt;
  return at;
}

/** 这一路最近一次对话的时间：最后一站答完的时候，还在答就是它开始的时候 */
export function lastActive(stops: Iterable<Stop>, routeId: string): number | null {
  let at: number | null = null;
  for (const s of stops) {
    if (s.routeId !== routeId || s.kind === "summary") continue;
    const t = s.endedAt ?? s.startedAt;
    if (at === null || t > at) at = t;
  }
  return at;
}

/** 答完了还没看：正在答、等批准的不算（那时显示的是状态） */
export function isUnread(route: Route, stops: Iterable<Stop>, seen: Seen): boolean {
  if (route.status === "answering" || route.status === "awaiting_permission" || route.status === "archived") return false;
  const done = lastDone(stops, route.id);
  return done !== null && done > (seen.at[route.id] ?? seen.since);
}

/** 各路没看过的 id */
export function unreadIds(routes: Record<string, Route>, stops: Record<string, Stop>, seen: Seen): Set<string> {
  const done: Record<string, number> = {};
  for (const s of Object.values(stops)) if (s.kind !== "summary" && s.status === "done" && s.endedAt !== null && s.endedAt > (done[s.routeId] ?? 0)) done[s.routeId] = s.endedAt;
  const out = new Set<string>();
  for (const r of Object.values(routes)) {
    if (r.status === "answering" || r.status === "awaiting_permission" || r.status === "archived") continue;
    const at = done[r.id];
    if (at !== undefined && at > (seen.at[r.id] ?? seen.since)) out.add(r.id);
  }
  return out;
}
