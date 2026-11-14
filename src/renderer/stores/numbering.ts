import type { Route, Stop } from "../../shared";

/**
 * 站在界面上显示的序号。分叉出来的路带着父路到分叉站为止的历史，
 * 所以它自己的第 1 站显示成“父路分叉站的序号 + 1”。
 */
export function stopOffset(route: Route | undefined, routes: Record<string, Route>, stops: Record<string, Stop>): number {
  let offset = 0;
  const seen = new Set<string>();
  // 快线是全新的对话，不带父路的站，序号从头数
  for (let r = route; r?.forkStopId && !r.express && !seen.has(r.id); ) {
    seen.add(r.id);
    const origin = stops[r.forkStopId];
    if (!origin) break;
    offset += ordinal(origin, stops);
    r = routes[origin.routeId];
  }
  return offset;
}

/** “第 1 站”或“第 1–3 站” */
export function firstStops(n: number): string {
  return n <= 1 ? "第 1 站" : `第 1–${n} 站`;
}

/** 这一站在它那一路里排第几：短确认（小点）不占站号 */
export function ordinal(stop: Stop, stops: Record<string, Stop> | Stop[]): number {
  let n = 0;
  for (const s of Array.isArray(stops) ? stops : Object.values(stops)) if (s.routeId === stop.routeId && s.seq <= stop.seq && s.kind !== "minor") n++;
  return Math.max(n, 1);
}

/** 同一路里前面已经有同名的站：这是第几个（1 表示前面没有同名的） */
export function nameRepeat(stop: Stop, stops: Stop[]): number {
  return stops.filter((s) => s.routeId === stop.routeId && s.seq <= stop.seq && s.kind === stop.kind && s.name === stop.name).length;
}

/** 站名后面的 ②③：同名的第 2 个起才加 */
export function repeatMark(n: number): string {
  return n >= 2 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : n > 20 ? `(${n})` : "";
}
