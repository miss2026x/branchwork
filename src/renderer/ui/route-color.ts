import type { Route } from "../../shared";

const LINE = ["var(--route-1)", "var(--route-2)", "var(--route-3)", "var(--route-4)", "var(--route-5)", "var(--route-6)", "var(--route-7)"];
const TAG = ["var(--route-1)", "var(--route-2-tag)", "var(--route-3)", "var(--route-4)", "var(--route-5)", "var(--route-6)", "var(--route-7)"];

/** 一路的线色、路牌色（路牌上有白字，2 路用深一档的橙）和浅底色 */
export function routeColors(route: Pick<Route, "number">) {
  const i = (route.number - 1) % LINE.length;
  return {
    line: LINE[i]!,
    tag: TAG[i]!,
    tint: `color-mix(in srgb, ${LINE[i]} 13%, white)`,
    /** 没选中时线和站的颜色：往画布底色上靠，但不透明（透明的话叠在别的线上会透出来） */
    faded: `color-mix(in srgb, ${LINE[i]} 34%, var(--canvas))`,
  };
}
