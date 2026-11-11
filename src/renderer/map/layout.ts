import type { Route, Stop } from "../../shared";

/** 线路图的排版尺寸（像素，100% 缩放时） */
export const MAP = {
  /** 相邻两站的间距 */
  dx: 100,
  /** 相邻两路的行距 */
  row: 150,
  /** 第一路的线从哪里开始 */
  left: 168,
  top: 110,
  /** 分叉拐弯的圆角半径 */
  bend: 44,
  /** 线头到第一站的距离 */
  lead: 52,
  /** 最后一站之后留的一段线 */
  tail: 50,
};

export interface StopSpot {
  stop: Stop;
  x: number;
  y: number;
  /** 有别的路从这一站分叉出去 */
  junction: boolean;
}

export interface Lane {
  route: Route;
  y: number;
  /** 线的起点。分叉出来的路，起点在父路的分叉站上 */
  from: { x: number; y: number };
  /** SVG 路径 */
  path: string;
  /** 路牌右边缘贴着的位置 */
  plate: { x: number; y: number };
  stops: StopSpot[];
  /** 线的终点，“下一站”画在这里 */
  end: { x: number; y: number };
}

export interface MapLayout {
  lanes: Lane[];
  width: number;
  height: number;
}

/**
 * 排版：输入路和站，输出每个站的坐标和每条线的路径。纯函数，不碰界面。
 * 规则：每一路占一行，按路号从上到下；站从左到右等距；
 * 分叉出来的路从父路的分叉站出发，拐一个圆角到自己那一行。
 */
export function layoutMap(routes: Route[], stops: Stop[]): MapLayout {
  const ordered = routes.filter((r) => r.status !== "archived").sort((a, b) => a.number - b.number);
  const byRoute = new Map<string, Stop[]>();
  for (const s of [...stops].sort((a, b) => a.seq - b.seq)) {
    const list = byRoute.get(s.routeId) ?? [];
    list.push(s);
    byRoute.set(s.routeId, list);
  }

  const spots = new Map<string, StopSpot>();
  const lanes: Lane[] = [];
  const pending = [...ordered];
  let row = 0;
  // 父路要先排好，子路才知道从哪出发；排不出来的（父路不在了）当作独立的路
  while (pending.length > 0) {
    const i = pending.findIndex((r) => !r.forkStopId || spots.has(r.forkStopId) || !pending.some((p) => p.id === r.parentRouteId));
    const route = pending.splice(i < 0 ? 0 : i, 1)[0]!;
    const y = MAP.top + row++ * MAP.row;
    const origin = route.forkStopId ? spots.get(route.forkStopId) : undefined;

    let from: Lane["from"];
    let firstX: number;
    let path: string;
    let plate: Lane["plate"];
    if (origin) {
      const down = y > origin.y;
      const r = Math.min(MAP.bend, Math.abs(y - origin.y));
      from = { x: origin.x, y: origin.y };
      firstX = origin.x + MAP.dx;
      path = `M ${origin.x} ${origin.y} V ${y - (down ? r : -r)} Q ${origin.x} ${y} ${origin.x + r} ${y}`;
      plate = { x: origin.x - 28, y };
    } else {
      from = { x: MAP.left, y };
      firstX = MAP.left + MAP.lead;
      path = `M ${MAP.left} ${y}`;
      plate = { x: MAP.left - 12, y };
    }

    const laneStops = (byRoute.get(route.id) ?? []).map((stop, n): StopSpot => ({ stop, x: firstX + n * MAP.dx, y, junction: false }));
    if (origin) origin.junction = true;
    for (const s of laneStops) spots.set(s.stop.id, s);
    const lastX = laneStops.at(-1)?.x ?? firstX - MAP.dx;
    const end = { x: lastX + MAP.dx, y };
    path += ` H ${lastX + (laneStops.length > 0 ? MAP.tail : MAP.dx - 20)}`;
    lanes.push({ route, y, from, path, plate, stops: laneStops, end });
  }

  const width = Math.max(MAP.left + 400, ...lanes.map((l) => l.end.x + 160));
  const height = MAP.top + Math.max(1, lanes.length) * MAP.row;
  return { lanes, width, height };
}
