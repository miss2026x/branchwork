import type { Route } from "../../shared";

const N = 8;
const v = (n: number, part: "" | "-tag" | "-bg" | "-text") => `var(--route-${n}${part})`;

/** 自动轮着取的只有前 7 种；第 8 种（绿）和快线同色，只在自己挑的时候用 */
const AUTO = 7;
/** 可以给一路挑的颜色：[编号, 颜色]，按设计稿的顺序排（绿色排第四，编号是 8） */
export const ROUTE_COLORS: [number, string][] = [1, 2, 3, 8, 4, 5, 6, 7].map((n) => [n, v(n, "")]);

/**
 * 一路的四个颜色（设计稿“颜色”画板）：线（地图上的线和站）、角标（压白字，2 路用深一档的橙）、
 * 浅底（选中行、提问气泡）、深字（浅底上的字、“回答中”）。自己挑过颜色的用挑的，否则按路号轮着取
 */
export function routeColors(route: Pick<Route, "number" | "express"> & { color?: number | null }) {
  if (route.express) {
    const c = "var(--express)";
    return { line: c, tag: c, tint: "var(--express-bg)", text: "var(--express-text)", faded: `color-mix(in srgb, ${c} 34%, var(--canvas))` };
  }
  const n = (route.color ? (route.color - 1) % N : (route.number - 1) % AUTO) + 1;
  return {
    line: v(n, ""),
    tag: v(n, "-tag"),
    tint: v(n, "-bg"),
    text: v(n, "-text"),
    /** 没选中时线和站的颜色：往画布底色上靠，但不透明（透明的话叠在别的线上会透出来） */
    faded: `color-mix(in srgb, ${v(n, "")} 34%, var(--canvas))`,
  };
}
