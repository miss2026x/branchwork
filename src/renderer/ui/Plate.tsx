import type { Route } from "../../shared";
import { routeColors } from "./route-color";
import css from "./ui.module.css";

/** 路牌：1路、2路… */
export function Plate({ route, size = "s" }: { route: Pick<Route, "number">; size?: "s" | "l" }) {
  return (
    <span className={size === "l" ? css.plateL : css.plate} style={{ background: routeColors(route).tag }}>
      {route.number}
      <small>路</small>
    </span>
  );
}
