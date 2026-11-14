import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { QueueItem, QueueMode, Route, Stop, SyncFile } from "../../shared";
import { BusMark, IconArrow, IconClose, IconCompress, IconCopy, IconCut, IconEdit, IconFit, IconFork, IconMinus, IconMore, IconPlus, IconWait, IconWarn } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import { firstStops } from "../stores/numbering";
import { estimateTokens, parseSummary } from "../ui/summary-items";
import { nameRepeat, repeatMark } from "../stores/numbering";
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
  /** 正在看的以前的某一站 */
  viewingStopId: string | null;
  /** 点了一站：看它的记录；null 回到最新 */
  onViewStop(stop: Stop | null): void;
  /** 悬停卡片里要显示的回答摘要和工具次数；还没读回来时返回 null */
  preview(stop: Stop): { answer: string; tools: number } | null;
  /** 鼠标停到了一站上：外面可以趁机把这一路的回答读回来 */
  onHoverStop(stop: Stop): void;
  /** 截线（requeue：把提问放回输入框，也就是改站） */
  onTruncate(stop: Stop, requeue: boolean): void;
  /** 把这一站的回答放进候车区 */
  onParkAnswer(stop: Stop): void;
  onQueueMode(item: QueueItem, mode: QueueMode): void;
  onQueueEdit(item: QueueItem): void;
  onQueueRemove(item: QueueItem): void;
  /** 正从候车区拖出来的问题 */
  dragging: QueueItem | null;
  /** 松手落在某一路末尾 */
  onDropItem(item: QueueItem, routeId: string, mode: QueueMode): void;
  /** 要带到视野中间的那一站（从搜索、通知跳过来） */
  focus?: { stopId: string; n: number } | null;
  /** 正开着“压缩成快线”或“从这站开新对话”的弹窗：在图上标出会带上哪几站 */
  range?: { stopId: string; kind: "compress" | "fork" } | null;
  /** 正在提炼、或摘要已经好了还没开出的快线：画在来源站上方的虚线牌 */
  building?: { stopId: string; express: number; name: string; ready: boolean }[];
  onOpenBuilding?(stopId: string): void;
  /** 跳到另一站（摘要站的来源站） */
  onJumpStop?(stopId: string): void;
  /** 有同步冲突的路：冲突了哪些文件 */
  conflicts?: Record<string, SyncFile[]>;
  whoChanged?: (by: NonNullable<SyncFile["by"]>) => string;
  onResolve?(routeId: string): void;
}

const MIN = 0.3;
const MAX = 1.5;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

/**
 * 线路图。只收路和站的数据、发出“点了哪一路”；自己不取数据。
 * 线用 SVG 画，站和路牌是叠在上面的普通元素；整体放在一个可平移缩放的层里。
 */
export function RouteMap({ routes, stops, queue = [], selectedRouteId, onSelectRoute, stopNumber, onFork, onCompress, onRenameStop, focus: jump, viewingStopId, onViewStop, preview, onHoverStop, onTruncate, onParkAnswer, onQueueMode, onQueueEdit, onQueueRemove, dragging, onDropItem, range, building = [], onOpenBuilding, onJumpStop, conflicts = {}, whoChanged, onResolve }: Props) {
  /** 正在改名的那一站和输入框里的字 */
  const [renaming, setRenaming] = useState<string | null>(null);
  const layout = useMemo(() => layoutMap(routes, stops), [routes, stops]);
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  /** 点开了哪一站的菜单 */
  const [menuStopId, setMenuStopId] = useState<string | null>(null);
  useEffect(() => setRenaming(null), [menuStopId]);
  /** 鼠标停在哪一站或哪个候车的问题上（停一小会儿才出卡片） */
  const [hover, setHover] = useState<{ kind: "stop" | "queue"; id: string } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hoverOn = (next: { kind: "stop" | "queue"; id: string } | null, delay = 350) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(next), next ? delay : 180);
  };
  const allSpots = layout.lanes.flatMap((l) => l.stops.map((spot) => ({ spot, route: l.route })));
  const hoverStop = hover?.kind === "stop" && !menuStopId ? allSpots.find((m) => m.spot.stop.id === hover.id) : undefined;
  const hoverQueue = hover?.kind === "queue" ? layout.lanes.flatMap((l) => queue.filter((q) => q.routeId === l.route.id).map((q, i) => ({ item: q, lane: l, i }))).find((m) => m.item.id === hover.id) : undefined;
  useEffect(() => {
    if (hoverStop) onHoverStop(hoverStop.spot.stop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverStop?.spot.stop.id]);
  const viewing = viewingStopId ? allSpots.find((m) => m.spot.stop.id === viewingStopId) : undefined;
  const menu = menuStopId ? layout.lanes.flatMap((l) => l.stops.map((spot) => ({ spot, route: l.route }))).find((m) => m.spot.stop.id === menuStopId) : undefined;
  useEffect(() => {
    if (!menuStopId) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") return setMenuStopId(null);
      if (!menu || (e.target as HTMLElement).tagName === "INPUT" || e.ctrlKey || e.metaKey || e.altKey) return;
      const stop = menu.spot.stop;
      const ready = stop.status !== "answering" && !!stop.lastMessageId;
      const key = e.key.toLowerCase();
      if (key === "enter") onViewStop(stop);
      else if (key === "b" && ready) onFork(stop);
      else if (key === "c" && ready) onCompress(stop);
      else if (key === "f2" && stop.kind !== "summary") return setRenaming(stop.name);
      else return;
      e.preventDefault();
      setMenuStopId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuStopId, menu]);

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
  const detail = view.k >= 0.6 ? "full" : view.k >= 0.3 ? "dots" : "lines";

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
                        {on && detail === "full" && (
                          <text x={lane.from.x + 12} y={(lane.from.y + lane.y) / 2 + 4} fontSize={12} fontWeight={700} fill={c}>
                            压缩后发车
                          </text>
                        )}
                        <path d={lane.run} fill="none" stroke={c} strokeWidth={on ? 10 : 8} strokeLinecap="round" />
                      </>
                    ) : (
                      <path d={lane.path} fill="none" stroke={c} strokeWidth={on ? 10 : 8} strokeLinecap="round" strokeLinejoin="round" />
                    )}
                    {/* 父路被删掉了：在线头上方标一下它是从哪开出来的 */}
                    {lane.route.orphanOf && !lane.link && detail !== "lines" && (
                      <g opacity={on ? 1 : 0.7}>
                        <path d={`M ${lane.from.x + 14} ${lane.y - 48} V ${lane.y - 12}`} stroke="var(--line-strong)" strokeWidth={2.5} strokeDasharray="4 5" strokeLinecap="round" fill="none" />
                        <circle cx={lane.from.x + 14} cy={lane.y - 60} r={12} fill="var(--canvas)" stroke="var(--line-strong)" strokeWidth={1.5} strokeDasharray="3 3" />
                        <path d={`M ${lane.from.x + 10} ${lane.y - 64} l 8 8 M ${lane.from.x + 18} ${lane.y - 64} l -8 8`} stroke="var(--text-3)" strokeWidth={1.5} strokeLinecap="round" />
                        <text x={lane.from.x + 36} y={lane.y - 56} fontSize={12} fill="var(--text-2)">
                          从已删除的 {lane.route.orphanOf} 开出
                        </text>
                      </g>
                    )}
                    {/* 选中的路：从父路带来的那几站，用它自己的颜色在父路的线下面再描一遍 */}
                    {on && !lane.route.express && inherited(lane, layout.lanes).map((d, i) => <path key={i} d={d} fill="none" stroke={colors.line} strokeWidth={5} strokeLinecap="round" />)}
                    {(() => {
                      const waiting = queue.filter((q) => q.routeId === lane.route.id).length;
                      const idle = lane.route.status !== "answering" && lane.route.status !== "awaiting_permission";
                      if (waiting === 0 && !(on && idle)) return null;
                      return <path d={`M ${tailFrom + 20} ${lane.y} H ${lane.end.x + Math.max(0, waiting - 1) * 76 - 12}`} stroke={c} strokeWidth={3} strokeDasharray="5 7" strokeLinecap="round" fill="none" />;
                    })()}
                  </g>
                );
              })}
            {/* 弹窗开着时：标出会带上的那几站 */}
            {(() => {
              const lane = range && layout.lanes.find((l) => l.stops.some((s) => s.stop.id === range.stopId));
              if (!range || !lane) return null;
              const at = lane.stops.findIndex((s) => s.stop.id === range.stopId);
              const first = lane.stops[0]!;
              const upto = lane.stops[at]!;
              const last = lane.stops.at(-1)!;
              const n = stopNumber(upto.stop);
              if (range.kind === "compress")
                return (
                  <g>
                    <rect x={first.x - 30} y={lane.y - 26} width={upto.x - first.x + 60} height={52} rx={26} fill="color-mix(in srgb, var(--express) 12%, transparent)" stroke="var(--express)" strokeWidth={2} strokeDasharray="6 5" />
                    <text x={upto.x + 30} y={lane.y - 56} textAnchor="end" fontSize={12} fontWeight={700} fill="var(--express)">
                      压缩范围：起点到第 {n} 站
                    </text>
                  </g>
                );
              return (
                <g fontSize={12} fontWeight={700}>
                  <path d={`M ${first.x - 16} ${lane.y - 50} H ${upto.x + 16}`} stroke="var(--text-1)" strokeWidth={2} strokeLinecap="round" />
                  <text x={(first.x + upto.x) / 2} y={lane.y - 58} textAnchor="middle" fill="var(--text-1)">
                    会带上{n > 1 ? `第 1–${n} 站` : "第 1 站"}
                  </text>
                  {at < lane.stops.length - 1 && (
                    <>
                      <path d={`M ${upto.x + 34} ${lane.y - 50} H ${last.x + 16}`} stroke="var(--line-strong)" strokeWidth={2} strokeLinecap="round" strokeDasharray="2 5" />
                      <text x={(upto.x + 50 + last.x) / 2} y={lane.y - 58} textAnchor="middle" fill="var(--text-3)" fontWeight={500}>
                        {stopNumber(last.stop) > n + 1 ? `第 ${n + 1}–${stopNumber(last.stop)} 站不带` : `第 ${n + 1} 站不带`}
                      </text>
                    </>
                  )}
                </g>
              );
            })()}
            {/* 在建的快线：从来源站往上拐出去的虚线 */}
            {building.map((b) => {
              const spot = allSpots.find((m) => m.spot.stop.id === b.stopId)?.spot;
              return spot ? <path key={b.stopId} d={`M ${spot.x} ${spot.y - 14} V ${spot.y - 52} H ${spot.x + 64}`} fill="none" stroke="var(--express)" strokeWidth={3} strokeDasharray="5 6" strokeLinecap="round" /> : null;
            })}
          </svg>

          {building.map((b) => {
            const spot = allSpots.find((m) => m.spot.stop.id === b.stopId)?.spot;
            if (!spot) return null;
            return (
              <button key={b.stopId} className={css.building} style={{ left: spot.x + 68, top: spot.y - 52 }} data-ready={b.ready} onClick={() => onOpenBuilding?.(b.stopId)} title={b.name}>
                <b>快{b.express}</b>
                {b.ready ? "摘要好了" : "提炼中"}
                {!b.ready && <i />}
              </button>
            );
          })}

          {layout.lanes.map((lane) => (
            <LaneNodes
              key={lane.route.id}
              lane={lane}
              waiting={queue.filter((q) => q.routeId === lane.route.id)}
              on={lane.route.id === selectedRouteId}
              ringed={ringed}
              onSelect={() => onSelectRoute(lane.route.id)}
              viewingStopId={viewingStopId}
              number={stopNumber}
              detail={detail}
              onStop={(stop) => {
                setMenuStopId(null);
                setHover(null);
                // 点最新的一站就是回到最新
                onViewStop(lane.stops.at(-1)?.stop.id === stop.id ? null : stop);
                onSelectRoute(lane.route.id);
              }}
              onStopMenu={(stop) => {
                setHover(null);
                onSelectRoute(lane.route.id);
                setMenuStopId((cur) => (cur === stop.id ? null : stop.id));
              }}
              onHover={hoverOn}
              dragging={dragging}
              onDropItem={onDropItem}
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
                <kbd>F2</kbd>
              </button>
            )}
            <button role="menuitem" onClick={() => (onViewStop(menu.spot.stop), setMenuStopId(null))}>
              <IconArrow /> <span>打开这站</span>
              <kbd>↵</kbd>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                void navigator.clipboard?.writeText(menu.spot.stop.prompt);
                setMenuStopId(null);
              }}
            >
              <IconCopy /> <span>复制提问</span>
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
              <kbd>B</kbd>
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
              <kbd>C</kbd>
            </button>
            {menu.spot.stop.kind !== "summary" && (
              <>
                <button role="menuitem" disabled={menu.spot.stop.status === "answering"} onClick={() => (onParkAnswer(menu.spot.stop), setMenuStopId(null))}>
                  <IconWait /> <span>把回答放进候车区</span>
                </button>
                <hr />
                <button role="menuitem" disabled={menu.route.status === "answering" || menu.route.status === "awaiting_permission"} onClick={() => (onTruncate(menu.spot.stop, true), setMenuStopId(null))}>
                  <IconEdit />
                  <span>
                    改站
                    <small>改写后重问，这一站和后面的站会删掉</small>
                  </span>
                </button>
                <button role="menuitem" className={css.dangerItem} disabled={menu.route.status === "answering" || menu.route.status === "awaiting_permission"} onClick={() => (onTruncate(menu.spot.stop, false), setMenuStopId(null))}>
                  <IconCut />
                  <span>
                    截线
                    <small>删掉第 {stopNumber(menu.spot.stop)} 站和后面所有站，代码不动</small>
                  </span>
                </button>
              </>
            )}
            <i hidden />
          </div>
        )}

        {hoverStop && hoverStop.spot.stop.kind === "summary" && (
          <div className={css.card} style={cardPlace(hoverStop.spot.x * view.k + view.x, hoverStop.spot.y * view.k + view.y, view.k, viewport.current)} onPointerEnter={() => hoverOn(hover, 0)} onPointerLeave={() => hoverOn(null)}>
            {(() => {
              const stop = hoverStop.spot.stop;
              const source = allSpots.find((m) => m.spot.stop.id === hoverStop.route.forkStopId);
              const items = parseSummary(stop.prompt).flatMap((g) => g.items);
              return (
                <>
                  <header>
                    <Plate route={hoverStop.route} />
                    <b>摘要站</b>
                    {source && (
                      <span className={css.cardFrom}>
                        来自 <Plate route={source.route} /> 第 1–{stopNumber(source.spot.stop)} 站
                      </span>
                    )}
                  </header>
                  <ul className={css.cardList}>
                    {items.slice(0, 3).map((it, i) => (
                      <li key={i}>{clip(it, 60)}</li>
                    ))}
                  </ul>
                  <p className={css.cardMeta}>
                    <span>这一站不是提问，是 Claude 提炼的交接摘要，约 {estimateTokens(stop.prompt) >= 1000 ? `${(estimateTokens(stop.prompt) / 1000).toFixed(1)}k` : estimateTokens(stop.prompt)}。</span>
                  </p>
                  <footer>
                    <button className={css.cardPrimary} onClick={() => (onViewStop(stop), setHover(null))}>
                      看完整摘要
                    </button>
                    {source && (
                      <button onClick={() => (onJumpStop?.(source.spot.stop.id), setHover(null))}>
                        跳到 {source.route.express ? `快${source.route.express}` : `${source.route.number}路`} 第 {stopNumber(source.spot.stop)} 站
                      </button>
                    )}
                  </footer>
                </>
              );
            })()}
          </div>
        )}
        {hoverStop && hoverStop.spot.stop.syncState === "conflict" && conflicts[hoverStop.route.id] && (
          <div className={`${css.card} ${css.cardConflict}`} style={cardPlace(hoverStop.spot.x * view.k + view.x, hoverStop.spot.y * view.k + view.y, view.k, viewport.current)} onPointerEnter={() => hoverOn(hover, 0)} onPointerLeave={() => hoverOn(null)}>
            {(() => {
              const files = conflicts[hoverStop.route.id]!;
              const label = hoverStop.route.express ? `快${hoverStop.route.express}` : `${hoverStop.route.number}路`;
              return (
                <>
                  <header>
                    <IconWarn size={16} />
                    <Plate route={hoverStop.route} />
                    <b>第 {stopNumber(hoverStop.spot.stop)} 站没法自动合进 Local</b>
                  </header>
                  {files.slice(0, 3).map((f) => (
                    <div key={f.path} className={css.cardFile}>
                      <code>{f.path}</code>
                      <span>
                        {f.lines && `第 ${f.lines[0]}${f.lines[1] > f.lines[0] ? `–${f.lines[1]}` : ""} 行附近：`}
                        {label} 和 Local 改的是同一处{f.by && whoChanged ? `。${whoChanged(f.by)}` : ""}。
                      </span>
                    </div>
                  ))}
                  {files.length > 3 && <p className={css.cardMeta}>还有 {files.length - 3} 个文件</p>}
                  <p className={css.cardAnswer}>
                    <b>这一站还算没同步完</b>，改动留在 {label} 的工作区里；Local 和其他线路都照常。
                  </p>
                  <button className={css.cardResolve} onClick={() => (onResolve?.(hoverStop.route.id), setHover(null))}>
                    让 {label} 的 Claude 解决
                    <small>在 {label} 开一站“解决同步冲突”，带上 Local 和这边的两段代码；改好后自动再同步一次</small>
                  </button>
                  <p className={css.cardMeta}>先不管也行。{label} 照样能看历史、切走、归档，只是解决之前不能开始下一站。</p>
                </>
              );
            })()}
          </div>
        )}
        {hoverStop && hoverStop.spot.stop.kind !== "summary" && !(hoverStop.spot.stop.syncState === "conflict" && conflicts[hoverStop.route.id]) && (
          <div className={css.card} style={cardPlace(hoverStop.spot.x * view.k + view.x, hoverStop.spot.y * view.k + view.y, view.k, viewport.current)} onPointerEnter={() => hoverOn(hover, 0)} onPointerLeave={() => hoverOn(null)}>
            <header>
              <Plate route={hoverStop.route} />
              <b>第 {stopNumber(hoverStop.spot.stop)} 站</b>
              <time>{new Date(hoverStop.spot.stop.startedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</time>
            </header>
            <p className={css.cardAsk}>{clip(hoverStop.spot.stop.prompt, 90)}</p>
            {(() => {
              const stop = hoverStop.spot.stop;
              const pv = preview(stop);
              return (
                <>
                  {<p className={css.cardAnswer}>{stop.status === "answering" ? "还在回答…" : pv ? clip(pv.answer, 110) || "这一站没有文字回答。" : "正在读取回答…"}</p>}
                  <p className={css.cardMeta}>
                    {pv && pv.tools > 0 && <span>{pv.tools} 次工具调用</span>}
                    {stop.syncState === "synced" && <span className={css.ok}>✓ 改动已进 Local</span>}
                    {stop.syncState === "unsynced" && <span className={css.warn}>改动还没进 Local</span>}
                    {stop.syncState === "conflict" && <span className={css.warn}>和 Local 有冲突</span>}
                    {stop.status === "interrupted" && <span className={css.warn}>没答完</span>}
                  </p>
                </>
              );
            })()}
            <footer>
              <button className={css.cardPrimary} onClick={() => (onViewStop(hoverStop.spot.stop), setHover(null))}>
                打开这站
              </button>
              <button disabled={hoverStop.spot.stop.status === "answering" || !hoverStop.spot.stop.lastMessageId} onClick={() => (onFork(hoverStop.spot.stop), setHover(null))}>
                从这站开新对话
              </button>
              <button onClick={() => void navigator.clipboard?.writeText(hoverStop.spot.stop.prompt)}>复制提问</button>
            </footer>
          </div>
        )}

        {hoverQueue && (
          <div
            className={`${css.card} ${css.cardDark}`}
            style={cardPlace((hoverQueue.lane.end.x + hoverQueue.i * 76) * view.k + view.x, hoverQueue.lane.end.y * view.k + view.y, view.k, viewport.current, true)}
            onPointerEnter={() => hoverOn(hover, 0)}
            onPointerLeave={() => hoverOn(null)}
          >
            <header>
              <b>
                第 {hoverQueue.lane.stops.length ? stopNumber(hoverQueue.lane.stops.at(-1)!.stop) + hoverQueue.i + 1 : hoverQueue.i + 1} 站，候车中
              </b>
              <em data-mode={hoverQueue.item.mode}>{hoverQueue.item.mode === "auto" ? "自动登车" : "手动登车"}</em>
            </header>
            <p className={css.cardAsk}>{clip(hoverQueue.item.text, 90)}</p>
            <p className={css.cardMeta}>{hoverQueue.item.mode === "auto" ? "上一站正常答完就发出；被中断就先不发" : "到站后等你点“登车”"}</p>
            <footer>
              <button onClick={() => (onQueueMode(hoverQueue.item, hoverQueue.item.mode === "auto" ? "manual" : "auto"), setHover(null))}>{hoverQueue.item.mode === "auto" ? "改成手动登车" : "改成自动登车"}</button>
              <button onClick={() => (onQueueEdit(hoverQueue.item), setHover(null))}>编辑</button>
              <button className={css.cardDanger} onClick={() => (onQueueRemove(hoverQueue.item), setHover(null))}>
                移出候车
              </button>
            </footer>
          </div>
        )}
      </div>

      {!viewing && selected?.route.status === "conflict" && (
        <div className={css.selectBar}>
          <Plate route={selected.route} />
          <span className={css.spacer}>先解决{conflictStop(selected) ? `第 ${stopNumber(conflictStop(selected)!)} 站的` : ""}同步冲突，再接着问</span>
          <button className={css.solve} onClick={() => onSelectRoute(selected.route.id)}>
            去解决
          </button>
        </div>
      )}
      {viewing && (
        <div className={css.selectBar} role="toolbar" aria-label="选中的站">
          <Plate route={viewing.route} />
          <b>已选第 {stopNumber(viewing.spot.stop)} 站</b>
          <i />
          <button className={css.selectPrimary} disabled={!viewing.spot.stop.lastMessageId || viewing.spot.stop.status === "answering"} onClick={() => onCompress(viewing.spot.stop)}>
            <IconCompress size={14} /> 压缩成快线
          </button>
          <button disabled={!viewing.spot.stop.lastMessageId || viewing.spot.stop.status === "answering"} onClick={() => onFork(viewing.spot.stop)}>
            <IconFork size={14} /> 从第 {stopNumber(viewing.spot.stop)} 站开新对话
          </button>
          <button aria-label="这一站的更多操作" title="更多操作" onClick={() => setMenuStopId(viewing.spot.stop.id)}>
            <IconMore />
          </button>
          <span className={css.spacer} />
          <button aria-label="回到最新" title="回到最新" onClick={() => onViewStop(null)}>
            <IconClose size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

const conflictStop = (lane: Lane) => lane.stops.find((s) => s.stop.syncState === "conflict")?.stop;

const clip = (text: string, n: number) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "……" : t;
};

/** 选中的路从父路带来的那几段：沿着各级父路的线，从父路的起点画到分叉站，略低一点，不盖住父路自己的线 */
function inherited(lane: Lane, lanes: Lane[]): string[] {
  const out: string[] = [];
  let child = lane;
  for (let guard = 0; guard < 20; guard++) {
    const parent = lanes.find((l) => l.route.id === child.route.parentRouteId);
    if (!parent || child.route.express) break;
    out.push(`M ${parent.from.x} ${parent.y + 6} H ${child.from.x}`);
    child = parent;
  }
  return out;
}

/** 悬停卡片放哪：默认在站的上面，上面放不下就放下面；below 为真时反过来 */
function cardPlace(x: number, y: number, k: number, box: HTMLElement | null, below = false): { left: number; top?: number; bottom?: number } {
  const W = 420;
  const H = 230;
  const gap = 26 * Math.max(0.6, k);
  const width = box?.clientWidth ?? Infinity;
  const height = box?.clientHeight ?? Infinity;
  const left = Math.max(8, Math.min(x - 60, width - W - 8));
  const up = below ? y + gap + H > height : y - gap - H > 0;
  return up ? { left, bottom: height - (y - gap) } : { left, top: y + gap + 18 };
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

interface LaneProps {
  lane: Lane;
  waiting: QueueItem[];
  on: boolean;
  ringed: string | null;
  viewingStopId: string | null;
  number(stop: Stop): number;
  detail: "full" | "dots" | "lines";
  onSelect(): void;
  onStop(stop: Stop): void;
  onStopMenu(stop: Stop): void;
  onHover(next: { kind: "stop" | "queue"; id: string } | null): void;
  dragging: QueueItem | null;
  onDropItem(item: QueueItem, routeId: string, mode: QueueMode): void;
}

function LaneNodes({ lane, waiting, on, ringed, viewingStopId, number, detail, onSelect, onStop, onStopMenu, onHover, dragging, onDropItem }: LaneProps) {
  const [over, setOver] = useState<QueueMode | null>(null);
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

      {lane.route.folded && lane.stops.length > 0 && (
        <span className={css.folded} style={{ left: (lane.stops[0]!.x + lane.stops.at(-1)!.x) / 2, top: lane.y }}>
          已折叠 · {lane.stops.filter((s) => s.stop.kind !== "summary").length} 站
        </span>
      )}
      {lane.stops.map(({ stop, x, y, junction }, i) => {
        const laneStops = lane.stops.map((s) => s.stop);
        const answering = stop.status === "answering";
        const latest = i === lane.stops.length - 1;
        // 折叠的路只留分叉站和正在回答的那一站
        if (lane.route.folded && !junction && !answering) return null;
        return (
          <div key={stop.id} className={css.stop} style={{ left: x, top: y }} data-status={stop.status} data-latest={on && latest} data-junction={junction} data-kind={stop.kind} data-name={stop.nameState} data-ringed={ringed === stop.id} data-viewing={viewingStopId === stop.id}>
            {answering && (
              <span className={css.bus}>
                <em>{lane.route.status === "awaiting_permission" ? "等你批准" : "回答中"}</em>
                <BusMark size={34} color={line} />
              </span>
            )}
            {stop.status === "interrupted" && <em className={css.flagAmber}>没答完</em>}
            <button className={css.node} style={{ borderColor: stop.status === "interrupted" ? "var(--amber)" : answering || junction ? "var(--text-1)" : line }} onClick={() => onStop(stop)}
              onContextMenu={(e) => (e.preventDefault(), onStopMenu(stop))}
              onPointerEnter={() => onHover({ kind: "stop", id: stop.id })}
              onPointerLeave={() => onHover(null)}
              aria-label={`${lane.route.name} · ${stop.name}`}
              data-prompt={stop.prompt}>
              {answering && <i style={{ background: line }} />}
            </button>
            {stop.syncState === "conflict" && <b className={css.badgeRed}>!</b>}
            {stop.syncState === "unsynced" && <b className={css.badgeAmber} title="改动还没进 Local" />}
            {viewingStopId === stop.id && <em className={css.viewingFlag}>正在看这一站</em>}
            {stop.nameState === "temp" && latest && detail === "full" && (
              <em className={css.naming}>
                <i /> 起名中
              </em>
            )}
            <span className={css.name} data-command={stop.name.startsWith("/")}>
              {stop.kind === "minor" ? "" : detail === "dots" && stop.kind !== "summary" ? number(stop) : stop.name + repeatMark(nameRepeat(stop, laneStops))}
            </span>
          </div>
        );
      })}

      {/* 候车区里派给这一路的问题：排在末尾的虚线站 */}
      {waiting.map((q, i) => (
        <span key={q.id} className={css.next} style={{ left: lane.end.x + i * 76, top: lane.end.y }} onPointerEnter={() => onHover({ kind: "queue", id: q.id })} onPointerLeave={() => onHover(null)}>
          <span className={css.ghost} style={{ borderColor: line, borderStyle: q.mode === "auto" ? "solid" : "dashed" }} />
          <span className={css.name}>{q.mode === "auto" ? "自动" : "手动"}</span>
        </span>
      ))}
      {/* 从候车区拖一个问题过来：松手落在这一路的末尾，选自动还是手动 */}
      {dragging && lane.route.status !== "archived" && (
        <div className={css.drop} style={{ left: lane.end.x + waiting.length * 76 + 34, top: lane.end.y }}>
          {(["auto", "manual"] as const).map((mode) => (
            <div
              key={mode}
              data-mode={mode}
              data-over={over === mode}
              style={mode === "auto" ? { background: over === mode ? colors.tag : undefined, borderColor: colors.tag } : { borderColor: colors.tag, color: colors.tag }}
              onDragOver={(e) => (e.preventDefault(), setOver(mode))}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => (e.preventDefault(), setOver(null), onDropItem(dragging, lane.route.id, mode))}
            >
              <b>松手：{mode === "auto" ? "自动登车" : "手动登车"}</b>
              <small>{mode === "auto" ? (busy ? "这一站答完就发" : "它空着，马上发") : "到站后等你点"}</small>
            </div>
          ))}
        </div>
      )}
      {on && !busy && waiting.length === 0 && (
        <span className={css.next} style={{ left: lane.end.x, top: lane.end.y }}>
          <span className={css.ghost} style={{ borderColor: line }} />
          <span className={css.name}>下一站</span>
        </span>
      )}
    </div>
  );
}
