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
    offset += origin.seq;
    r = routes[origin.routeId];
  }
  return offset;
}

/** “第 1 站”或“第 1–3 站” */
export function firstStops(n: number): string {
  return n <= 1 ? "第 1 站" : `第 1–${n} 站`;
}
