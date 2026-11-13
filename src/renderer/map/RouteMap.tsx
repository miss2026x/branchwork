import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { QueueItem, Route, Stop } from "../../shared";
import { BusMark, IconCompress, IconCopy, IconFit, IconFork, IconMinus, IconPlus, IconEdit } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import { firstStops } from "../stores/numbering";
import { layoutMap, type Lane } from "./layout";
import css from "./RouteMap.module.css";

interface Props {
  routes: Route[];
  stops: Stop[];
  /** 候车区里的问题：派给某一路的，在那一路的末尾画成虚线的站 */
  queue?: QueueItem[];
  selectedRouteId: string | null;
  onSelectRoute(routeId: string): void;
  /** 站在界面上显示的序号（分叉出来的路接着父路往下数） */
  stopNumber(stop: Stop): number;
  /** 用户选了“从这站开新对话” */
  onFork(stop: Stop): void;
  /** 用户选了“压缩成快线” */
  onCompress(stop: Stop): void;
  onRenameStop(stop: Stop, name: string): void;
  /** 要带到视野中间的那一站（从搜索、通知跳过来） */
  focus?: { stopId: string; n: number } | null;
}

const MIN = 0.3;
const MAX = 1.5;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

/**
 * 线路图。只收路和站的数据、发出“点了哪一路”；自己不取数据。
 * 线用 SVG 画，站和路牌是叠在上面的普通元素；整体放在一个可平移缩放的层里。
 */
export function RouteMap({ routes, stops, queue = [], selectedRouteId, onSelectRoute, stopNumber, onFork, onCompress, onRenameStop, focus: jump }: Props) {
  /** 正在改名的那一站和输入框里的字 */
  const [renaming, setRenaming] = useState<string | null>(null);
  const layout = useMemo(() => layoutMap(routes, stops), [routes, stops]);
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  /** 点开了哪一站的菜单 */
  const [menuStopId, setMenuStopId] = useState<string | null>(null);
  useEffect(() => setRenaming(null), [menuStopId]);
  const menu = menuStopId ? layout.lanes.flatMap((l) => l.stops.map((spot) => ({ spot, route: l.route }))).find((m) => m.spot.stop.id === menuStopId) : undefined;
  useEffect(() => {
    if (!menuStopId) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setMenuStopId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuStopId]);

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

  // 跳到某一站：把它放到视野中间，圈一下
  const [ringed, setRinged] = useState<string | null>(null);
  useEffect(() => {
    const el = viewport.current;
    const spot = jump && layout.lanes.flatMap((l) => l.stops).find((x) => x.stop.id === jump.stopId);
    if (!el || !spot) return;
    const r = el.getBoundingClientRect();
    setView((v) => {
      const k = Math.max(v.k, 0.6);
      return { k, x: r.width / 2 - spot.x * k, y: r.height / 2 - spot.y * k };
    });
    setRinged(spot.stop.id);
    const t = setTimeout(() => setRinged(null), 1800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.n]);

  const onWheel = (e: WheelEvent) => {
    const r = viewport.current!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(view.k * Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
    else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };
  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    setMenuStopId(null);
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
                    {lane.route.express && lane.link ? (
                      <>
                        {/* 快线不是原来那段对话的延续：从来源站过来的这一段画成虚线 */}
                        <path d={lane.link} fill="none" stroke={c} strokeWidth={3} strokeDasharray="5 7" strokeLinecap="round" />
                        <path d={lane.run} fill="none" stroke={c} strokeWidth={on ? 10 : 8} strokeLinecap="round" />
                      </>
                    ) : (
                      <path d={lane.path} fill="none" stroke={c} strokeWidth={on ? 10 : 8} strokeLinecap="round" strokeLinejoin="round" />
                    )}
                    {(() => {
                      const waiting = queue.filter((q) => q.routeId === lane.route.id).length;
                      const idle = lane.route.status !== "answering" && lane.route.status !== "awaiting_permission";
                      if (waiting === 0 && !(on && idle)) return null;
                      return <path d={`M ${tailFrom + 20} ${lane.y} H ${lane.end.x + Math.max(0, waiting - 1) * 76 - 12}`} stroke={c} strokeWidth={3} strokeDasharray="5 7" strokeLinecap="round" fill="none" />;
                    })()}
                  </g>
                );
              })}
          </svg>

          {layout.lanes.map((lane) => (
            <LaneNodes
              key={lane.route.id}
              lane={lane}
              waiting={queue.filter((q) => q.routeId === lane.route.id)}
              on={lane.route.id === selectedRouteId}
              ringed={ringed}
              onSelect={() => onSelectRoute(lane.route.id)}
              onStop={(stop) => {
                onSelectRoute(lane.route.id);
                setMenuStopId((cur) => (cur === stop.id ? null : stop.id));
              }}
            />
          ))}
        </div>

        {menu && (
          <div className={css.menu} role="menu" style={menuPlace(menu.spot.x * view.k + view.x, menu.spot.y * view.k + view.y, view.k, viewport.current)}>
            <header>
              <Plate route={menu.route} />
              <b>第 {stopNumber(menu.spot.stop)} 站</b>
              {renaming === null ? (
                <span className="ell">{menu.spot.stop.name}</span>
              ) : (
                <input
                  autoFocus
                  aria-label="站名"
                  value={renaming}
                  maxLength={40}
                  onChange={(e) => setRenaming(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "Enter") {
                      if (renaming.trim() && renaming.trim() !== menu.spot.stop.name) onRenameStop(menu.spot.stop, renaming);
                      setRenaming(null);
                      setMenuStopId(null);
                    } else if (e.key === "Escape") setRenaming(null);
                  }}
                />
              )}
            </header>
            {menu.spot.stop.kind !== "summary" && (
              <button role="menuitem" onClick={() => setRenaming(renaming === null ? menu.spot.stop.name : null)}>
                <IconEdit /> <span>重命名站点{renaming !== null && <small>写好后按 Enter</small>}</span>
              </button>
            )}
            <button
              role="menuitem"
              onClick={() => {
                void navigator.clipboard?.writeText(menu.spot.stop.prompt);
                setMenuStopId(null);
              }}
            >
              <IconCopy /> 复制提问
            </button>
            <button
              role="menuitem"
              disabled={menu.spot.stop.status === "answering" || !menu.spot.stop.lastMessageId}
              onClick={() => {
                onFork(menu.spot.stop);
                setMenuStopId(null);
              }}
            >
              <IconFork />
              <span>
                从这站开新对话
                <small>{menu.spot.stop.status === "answering" ? "到站后才能分叉" : !menu.spot.stop.lastMessageId ? "这一站没留下对话记录" : `新对话带着${firstStops(stopNumber(menu.spot.stop))}的历史出发`}</small>
              </span>
            </button>
            <button
              role="menuitem"
              disabled={menu.spot.stop.status === "answering" || !menu.spot.stop.lastMessageId}
              onClick={() => {
                onCompress(menu.spot.stop);
                setMenuStopId(null);
              }}
            >
              <IconCompress />
              <span>
                压缩成快线
                <small>{!menu.spot.stop.lastMessageId || menu.spot.stop.status === "answering" ? "这一站还不能压缩" : `把${firstStops(stopNumber(menu.spot.stop))}提炼成摘要，带着摘要开全新的对话`}</small>
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 站的菜单放哪：默认在站的下面；下面放不下就放上面，也不超出左右两边 */
function menuPlace(x: number, y: number, k: number, box: HTMLElement | null): { left: number; top?: number; bottom?: number } {
  const W = 280;
  const H = 230;
  const gap = 44 * Math.max(0.6, k);
  const width = box?.clientWidth ?? Infinity;
  const height = box?.clientHeight ?? Infinity;
  const left = Math.max(8, Math.min(x - 24, width - W - 8));
  if (y + gap + H > height && y - gap - H > 0) return { left, bottom: height - (y - gap) };
  return { left, top: y + gap };
}

function LaneNodes({ lane, waiting, on, ringed, onSelect, onStop }: { lane: Lane; waiting: QueueItem[]; on: boolean; ringed: string | null; onSelect(): void; onStop(stop: Stop): void }) {
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
          <div key={stop.id} className={css.stop} style={{ left: x, top: y }} data-status={stop.status} data-latest={on && latest} data-junction={junction} data-kind={stop.kind} data-ringed={ringed === stop.id}>
            {answering && (
              <span className={css.bus}>
                <em>{lane.route.status === "awaiting_permission" ? "等你批准" : "回答中"}</em>
                <BusMark size={34} color={line} />
              </span>
            )}
            {stop.status === "interrupted" && <em className={css.flagAmber}>没答完</em>}
            <button className={css.node} style={{ borderColor: stop.status === "interrupted" ? "var(--amber)" : answering || junction ? "var(--text-1)" : line }} onClick={() => onStop(stop)} title={stop.prompt} aria-label={`${lane.route.name} · ${stop.name}`}>
              {answering && <i style={{ background: line }} />}
            </button>
            {stop.syncState === "conflict" && <b className={css.badgeRed}>!</b>}
            {stop.syncState === "unsynced" && <b className={css.badgeAmber} title="改动还没进 Local" />}
            <span className={css.name}>{stop.name}</span>
          </div>
        );
      })}

      {/* 候车区里派给这一路的问题：排在末尾的虚线站 */}
      {waiting.map((q, i) => (
        <span key={q.id} className={css.next} style={{ left: lane.end.x + i * 76, top: lane.end.y }} title={q.text}>
          <span className={css.ghost} style={{ borderColor: line, borderStyle: q.mode === "auto" ? "solid" : "dashed" }} />
          <span className={css.name}>{q.mode === "auto" ? "自动" : "手动"}</span>
        </span>
      ))}
      {on && !busy && waiting.length === 0 && (
        <span className={css.next} style={{ left: lane.end.x, top: lane.end.y }}>
          <span className={css.ghost} style={{ borderColor: line }} />
          <span className={css.name}>下一站</span>
        </span>
      )}
    </div>
  );
}
