import type { Route } from "../../shared";
import { routeColors } from "./route-color";
import css from "./ui.module.css";

const CLASS = { s: css.plate, m: css.plateM, l: css.plateL, i: css.plateI } as const;

/**
 * 路牌：1路、2路…；快线是 快1、快2…
 * s 列表里的小角标；m 地图上线路起点；l 对话栏头部；i 深色通知左边的图标位
 */
export function Plate({ route, size = "s" }: { route: Pick<Route, "number" | "express"> & { color?: number | null }; size?: keyof typeof CLASS }) {
  return (
    <span className={CLASS[size]} style={{ background: routeColors(route).tag }}>
      {route.express ? (
        <>
          <small className={css.kuai}>快</small>
          <span className={css.num}>{route.express}</span>
        </>
      ) : (
        <>
          <span className={css.num}>{route.number}</span>
          <small>路</small>
        </>
      )}
    </span>
  );
}
