import { describe, expect, it } from "vitest";
import { layoutMap, MAP } from "../../src/renderer/map/layout";
import { stopOffset } from "../../src/renderer/stores/numbering";
import type { Route, Stop } from "../../src/shared";

const route = (id: string, number: number, extra: Partial<Route> = {}): Route => ({
  id,
  projectId: "p",
  number,
  express: null,
  name: `${number} 路`,
  status: "idle",
  sessionId: null,
  worktreePath: "",
  parentRouteId: null,
  forkStopId: null,
  createdAt: number,
  archivedAt: null,
  ...extra,
});
const stop = (id: string, routeId: string, seq: number): Stop => ({
  id,
  routeId,
  seq,
  kind: "normal",
  name: id,
  nameState: "temp",
  prompt: "",
  status: "done",
  syncState: "none",
  messageId: null,
  lastMessageId: null,
  error: null,
  startedAt: seq,
  endedAt: seq,
});

describe("线路图排版", () => {
  it("一路：站从左到右等距排在同一行，按站序而不是传入顺序", () => {
    const { lanes } = layoutMap([route("r1", 1)], [stop("c", "r1", 3), stop("a", "r1", 1), stop("b", "r1", 2)]);
    expect(lanes).toHaveLength(1);
    const xs = lanes[0]!.stops.map((s) => s.x);
    expect(lanes[0]!.stops.map((s) => s.stop.id)).toEqual(["a", "b", "c"]);
    expect(xs).toEqual([MAP.left + MAP.lead, MAP.left + MAP.lead + MAP.dx, MAP.left + MAP.lead + 2 * MAP.dx]);
    expect(new Set(lanes[0]!.stops.map((s) => s.y)).size).toBe(1);
    expect(lanes[0]!.end.x).toBe(xs[2]! + MAP.dx); // “下一站”的位置
  });

  it("多条独立的路：按路号各占一行，都从同一个横坐标出发", () => {
    const { lanes, height } = layoutMap([route("r2", 2), route("r1", 1)], [stop("a", "r1", 1), stop("b", "r2", 1)]);
    expect(lanes.map((l) => l.route.id)).toEqual(["r1", "r2"]);
    expect(lanes[1]!.y - lanes[0]!.y).toBe(MAP.row);
    expect(lanes[0]!.stops[0]!.x).toBe(lanes[1]!.stops[0]!.x);
    expect(height).toBe(MAP.top + 2 * MAP.row);
  });

  it("分叉：子路从父路的分叉站出发，拐到自己那一行，第一站在分叉站右边一格", () => {
    const routes = [route("r1", 1), route("r2", 2, { parentRouteId: "r1", forkStopId: "b" })];
    const stops = [stop("a", "r1", 1), stop("b", "r1", 2), stop("c", "r1", 3), stop("x", "r2", 1)];
    const { lanes } = layoutMap(routes, stops);
    const b = lanes[0]!.stops[1]!;
    const fork = lanes[1]!;
    expect(fork.from).toEqual({ x: b.x, y: b.y });
    expect(fork.stops[0]).toMatchObject({ x: b.x + MAP.dx, y: lanes[0]!.y + MAP.row });
    expect(fork.path.startsWith(`M ${b.x} ${b.y} V`)).toBe(true);
    expect(fork.path).toContain(" Q ");
    expect(fork.path).toBe(`${fork.link} H ${fork.stops[0]!.x + MAP.tail}`); // 整条线 = 拐过来的一段 + 横着的一段
    expect(fork.run).toBe(`M ${b.x + MAP.bend} ${fork.y} H ${fork.stops[0]!.x + MAP.tail}`);
    expect(lanes[0]!.link).toBeNull();
    expect(fork.plate.x).toBeLessThan(b.x); // 路牌在拐角左边
    expect(lanes[0]!.stops.map((s) => s.junction)).toEqual([false, true, false]); // 分叉站画成换乘站
  });

  it("子路的路号比父路小、或者父路已归档：都能排出来，不会卡住", () => {
    const routes = [route("r1", 1, { parentRouteId: "r2", forkStopId: "b" }), route("r2", 2), route("r3", 3, { parentRouteId: "gone", forkStopId: "nope" })];
    const { lanes } = layoutMap(routes, [stop("b", "r2", 1), stop("x", "r1", 1), stop("y", "r3", 1)]);
    expect(lanes.map((l) => l.route.id).sort()).toEqual(["r1", "r2", "r3"]);
    const r1 = lanes.find((l) => l.route.id === "r1")!;
    const r2 = lanes.find((l) => l.route.id === "r2")!;
    expect(r1.from).toEqual({ x: r2.stops[0]!.x, y: r2.y });
    expect(lanes.find((l) => l.route.id === "r3")!.from.x).toBe(MAP.left); // 找不到父路，当独立的路
  });

  it("还没有站的路：有线、有“下一站”的位置；已归档的路不画", () => {
    const { lanes, width } = layoutMap([route("r1", 1), route("r2", 2, { status: "archived" })], []);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.stops).toEqual([]);
    expect(lanes[0]!.end.x).toBe(MAP.left + MAP.lead);
    expect(width).toBeGreaterThan(lanes[0]!.end.x);
  });

  it("同样的输入得到同样的结果", () => {
    const routes = [route("r1", 1), route("r2", 2, { parentRouteId: "r1", forkStopId: "a" })];
    const stops = [stop("a", "r1", 1), stop("x", "r2", 1)];
    expect(layoutMap(routes, stops)).toEqual(layoutMap(routes, stops));
  });
});

describe("站的显示序号", () => {
  it("分叉出来的路接着父路的序号往下数；再分叉就再往下接", () => {
    const routes = { r1: route("r1", 1), r2: route("r2", 2, { parentRouteId: "r1", forkStopId: "b" }), r3: route("r3", 3, { parentRouteId: "r2", forkStopId: "y" }) };
    const stops = Object.fromEntries([stop("a", "r1", 1), stop("b", "r1", 2), stop("c", "r1", 3), stop("x", "r2", 1), stop("y", "r2", 2)].map((s) => [s.id, s]));
    expect(stopOffset(routes.r1, routes, stops)).toBe(0);
    expect(stopOffset(routes.r2, routes, stops)).toBe(2); // r2 的第 1 站显示成第 3 站
    expect(stopOffset(routes.r3, routes, stops)).toBe(4);
    expect(stopOffset(route("r9", 9, { forkStopId: "gone" }), routes, stops)).toBe(0); // 分叉站找不到了
    expect(stopOffset(undefined, routes, stops)).toBe(0);
    expect(stopOffset(route("k1", 4, { parentRouteId: "r1", forkStopId: "c", express: 1 }), routes, stops)).toBe(0); // 快线是全新的对话，从头数
  });
});
