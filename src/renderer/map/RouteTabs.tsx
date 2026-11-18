import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Route } from "../../shared";
import { Plate } from "../ui/Plate";
import { routeColors, routeLabel } from "../ui/route-color";
import css from "./RouteTabs.module.css";

/** 一路此刻的状态点：等你批准、冲突、回答中 */
function tone(r: Route): "amber" | "red" | "blue" | undefined {
  if (r.status === "awaiting_permission") return "amber";
  if (r.status === "conflict") return "red";
  if (r.status === "answering") return "blue";
  return undefined;
}

interface Props {
  routes: Route[];
  selectedRouteId: string | null;
  onSelectRoute(routeId: string): void;
  /** 最左、固定不滚的那一格（Local 专车） */
  leading?: ReactNode;
}

/**
 * 地图顶部的路线标签（设计稿 9-11）：标签一直是全名，放不下就左右滚——
 * 两边渐隐、出现“‹ ›”；滚轮、触控板都能横着滚；选中的那一路自动滚到看得见的地方；
 * 看不见的那一边有路在等你批准或有冲突，箭头上出一个点
 */
export function RouteTabs({ routes, selectedRouteId, onSelectRoute, leading }: Props) {
  const strip = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  /** 看不见的标签里要你处理的：在左边还是右边 */
  const [hiddenUrgent, setHiddenUrgent] = useState<{ left?: "amber" | "red"; right?: "amber" | "red" }>({});

  const check = () => {
    const el = strip.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }));
    // 哪些标签在看得见的范围外，而且要你处理
    const box = el.getBoundingClientRect();
    const found: { left?: "amber" | "red"; right?: "amber" | "red" } = {};
    for (const b of el.querySelectorAll<HTMLElement>("[data-urgent]")) {
      const r = b.getBoundingClientRect();
      const side = r.right <= box.left + 24 ? "left" : r.left >= box.right - 24 ? "right" : null;
      if (side && found[side] !== "red") found[side] = b.dataset.urgent as "amber" | "red";
    }
    setHiddenUrgent((h) => (h.left === found.left && h.right === found.right ? h : found));
  };

  useLayoutEffect(() => {
    check();
    const el = strip.current;
    if (!el) return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes]);

  // 选中的那一路滚到看得见的地方（留出箭头和渐隐的位置）
  useEffect(() => {
    const el = strip.current;
    const tab = el?.querySelector<HTMLElement>(`[data-route="${selectedRouteId}"]`);
    if (!el || !tab) return;
    const pad = 36;
    const left = tab.offsetLeft - el.offsetLeft;
    if (left - pad < el.scrollLeft) el.scrollTo({ left: Math.max(0, left - pad), behavior: "smooth" });
    else if (left + tab.offsetWidth + pad > el.scrollLeft + el.clientWidth) el.scrollTo({ left: left + tab.offsetWidth + pad - el.clientWidth, behavior: "smooth" });
  }, [selectedRouteId, routes.length]);

  const scrollBy = (dir: 1 | -1) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.7, behavior: "smooth" });

  return (
    <div className={css.bar}>
      {leading}
      {leading && <i className={css.divider} aria-hidden />}
      <div className={css.scroller}>
        {edge.left && (
          <button className={css.arrow} data-side="left" aria-label="往左看看别的路" onClick={() => scrollBy(-1)}>
            ‹{hiddenUrgent.left && <i className={css.dot} data-tone={hiddenUrgent.left} aria-hidden />}
          </button>
        )}
        <div
          ref={strip}
          className={css.tabs}
          data-fade-left={edge.left || undefined}
          data-fade-right={edge.right || undefined}
          onScroll={check}
          onWheel={(e) => {
            // 普通滚轮是上下滚：放不下时换成左右滚
            const el = e.currentTarget;
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
          }}
        >
          {routes.map((r) => {
            const on = r.id === selectedRouteId;
            const t = tone(r);
            return (
              <button
                key={r.id}
                data-route={r.id}
                data-urgent={t === "amber" || t === "red" ? t : undefined}
                className={css.tab}
                aria-current={on}
                title={`${routeLabel(r)} ${r.name}`}
                style={on ? { borderColor: routeColors(r).line, boxShadow: `0 0 0 1px ${routeColors(r).line}` } : undefined}
                onClick={() => onSelectRoute(r.id)}
              >
                <Plate route={r} />
                <span className={css.name}>{r.name}</span>
                {t && <i className={css.dot} data-tone={t} aria-hidden />}
              </button>
            );
          })}
        </div>
        {edge.right && (
          <button className={css.arrow} data-side="right" aria-label="往右看看别的路" onClick={() => scrollBy(1)}>
            ›{hiddenUrgent.right && <i className={css.dot} data-tone={hiddenUrgent.right} aria-hidden />}
          </button>
        )}
      </div>
    </div>
  );
}
