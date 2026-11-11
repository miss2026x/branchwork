import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { Route, Stop } from "../../shared";
import { BusMark, IconFit, IconMinus, IconPlus } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import { layoutMap, type Lane } from "./layout";
import css from "./RouteMap.module.css";

interface Props {
  routes: Route[];
  stops: Stop[];
  selectedRouteId: string | null;
  onSelectRoute(routeId: string): void;
}

const MIN = 0.3;
const MAX = 1.5;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

/**
 * 线路图。只收路和站的数据、发出“点了哪一路”；自己不取数据。
 * 线用 SVG 画，站和路牌是叠在上面的普通元素；整体放在一个可平移缩放的层里。
 */
export function RouteMap({ routes, stops, selectedRouteId, onSelectRoute }: Props) {
  const layout = useMemo(() => layoutMap(routes, stops), [routes, stops]);
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const zoomAt = (k: number, cx: number, cy: number) =>
    setView((v) => {
      const next = clamp(k);
      const f = next / v.k;
      return { k: next, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    });
  const zoomBy = (f: number) => {
    const r = viewport.current!.getBoundingClientRect();
    zoomAt(view.k * f, r.width / 2, r.height / 2);
  };
  const fit = () => {
    const r = viewport.current!.getBoundingClientRect();
    const k = clamp(Math.min(1, (r.width - 48) / layout.width, (r.height - 96) / layout.height));
    setView({ k, x: Math.max(24, (r.width - layout.width * k) / 2), y: 56 });
  };

  // 选中的路上最新的一站跑到视野外了，就把它带回来
  const selected = layout.lanes.find((l) => l.route.id === selectedRouteId);
  const focus = selected ? (selected.stops.at(-1) ?? { x: selected.from.x, y: selected.y }) : null;
  const focusKey = selected ? `${selected.route.id}:${selected.stops.length}` : "";
  useEffect(() => {
    const el = viewport.current;
    if (!el || !focus) return;
    const r = el.getBoundingClientRect();
    setView((v) => {
      const sx = focus.x * v.k + v.x;
      const sy = focus.y * v.k + v.y;
      let { x, y } = v;
      if (sx > r.width - 150) x -= sx - (r.width - 190);
      if (sx < 120) x += 160 - sx;
      if (sy > r.height - 90) y -= sy - (r.height - 140);
      if (sy < 110) y += 150 - sy;
      return x === v.x && y === v.y ? v : { ...v, x, y };
    });
    // 只在“选中的路或它的站数变了”时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  const onWheel = (e: WheelEvent) => {
    const r = viewport.current!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(view.k * Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
    else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };
  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
  };

  // 缩得很小时只留线和站点，不显示站名
  const detail = view.k >= 0.6 ? "full" : view.k >= 0.4 ? "dots" : "lines";

  return (
    <div className={css.map}>
      <div className={css.tabs}>
        {routes.map((r) => (
          <button key={r.id} className={css.tab} aria-current={r.id === selectedRouteId} style={r.id === selectedRouteId ? { borderColor: routeColors(r).line, boxShadow: `0 0 0 1px ${routeColors(r).line}` } : undefined} onClick={() => onSelectRoute(r.id)}>
            <Plate route={r} />
            <span className="ell">{r.name}</span>
          </button>
        ))}
      </div>

      <div className={css.zoom}>
        <button aria-label="缩小" onClick={() => zoomBy(1 / 1.2)}>
          <IconMinus size={14} />
        </button>
        <span>{Math.round(view.k * 100)}%</span>
        <button aria-label="放大" onClick={() => zoomBy(1.2)}>
          <IconPlus size={14} />
        </button>
        <i />
        <button aria-label="全部显示" title="全部显示" onClick={fit}>
          <IconFit size={14} />
        </button>
      </div>

      <div ref={viewport} className={css.viewport} data-detail={detail} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
        <div className={css.world} style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg width={layout.width} height={layout.height} className={css.lines}>
            {/* 选中的路最后画，压在别的线上面 */}
            {[...layout.lanes]
              .sort((a, b) => Number(a.route.id === selectedRouteId) - Number(b.route.id === selectedRouteId))
              .map((lane) => {
                const on = lane.route.id === selectedRouteId;
                const colors = routeColors(lane.route);
                const c = on ? colors.line : colors.faded;
                const last = lane.stops.at(-1);
                const tailFrom = last ? last.x : lane.from.x;
                return (
                  <g key={lane.route.id}>
                    <path d={lane.path} fill="none" stroke={c} strokeWidth={on ? 10 : 8} strokeLinecap="round" strokeLinejoin="round" />
                    {on && lane.route.status !== "answering" && lane.route.status !== "awaiting_permission" && (
                      <path d={`M ${tailFrom + 20} ${lane.y} H ${lane.end.x - 12}`} stroke={c} strokeWidth={3} strokeDasharray="5 7" strokeLinecap="round" fill="none" />
                    )}
                  </g>
                );
              })}
          </svg>

          {layout.lanes.map((lane) => (
            <LaneNodes key={lane.route.id} lane={lane} on={lane.route.id === selectedRouteId} onSelect={() => onSelectRoute(lane.route.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LaneNodes({ lane, on, onSelect }: { lane: Lane; on: boolean; onSelect(): void }) {
  const colors = routeColors(lane.route);
  const line = on ? colors.line : colors.faded;
  const tag = colors.tag;
  const busy = lane.route.status === "answering" || lane.route.status === "awaiting_permission";
  return (
    <div className={css.lane} data-on={on}>
      <button className={css.plate} style={{ left: lane.plate.x, top: lane.plate.y, borderColor: on ? tag : "var(--line)" }} onClick={onSelect}>
        <Plate route={lane.route} />
        <span className="ell">{lane.route.name}</span>
      </button>

      {lane.stops.map(({ stop, x, y, junction }, i) => {
        const answering = stop.status === "answering";
        const latest = i === lane.stops.length - 1;
        return (
          <button key={stop.id} className={css.stop} style={{ left: x, top: y }} data-status={stop.status} data-latest={on && latest} data-junction={junction} onClick={onSelect} title={stop.prompt}>
            {answering && (
              <span className={css.bus}>
                <em>{lane.route.status === "awaiting_permission" ? "等你批准" : "回答中"}</em>
                <BusMark size={34} color={line} />
              </span>
            )}
            {stop.status === "interrupted" && <em className={css.flagAmber}>没答完</em>}
            <span className={css.node} style={{ borderColor: stop.status === "interrupted" ? "var(--amber)" : answering || junction ? "var(--text-1)" : line }}>
              {answering && <i style={{ background: line }} />}
            </span>
            {stop.syncState === "conflict" && <b className={css.badgeRed}>!</b>}
            {stop.syncState === "unsynced" && <b className={css.badgeAmber} title="改动还没进 Local" />}
            <span className={css.name}>{stop.name}</span>
          </button>
        );
      })}

      {on && !busy && (
        <span className={css.next} style={{ left: lane.end.x, top: lane.end.y }}>
          <span className={css.ghost} style={{ borderColor: line }} />
          <span className={css.name}>下一站</span>
        </span>
      )}
    </div>
  );
}
