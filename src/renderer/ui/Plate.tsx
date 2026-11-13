import type { Route } from "../../shared";
import { routeColors } from "./route-color";
import css from "./ui.module.css";

/** 路牌：1路、2路…；快线是 快1、快2… */
export function Plate({ route, size = "s" }: { route: Pick<Route, "number" | "express"> & { color?: number | null }; size?: "s" | "l" }) {
  return (
    <span className={size === "l" ? css.plateL : css.plate} style={{ background: routeColors(route).tag }}>
      {route.express ? (
        <>
          <small className={css.kuai}>快</small>
          {route.express}
        </>
      ) : (
        <>
          {route.number}
          <small>路</small>
        </>
      )}
    </span>
  );
}
