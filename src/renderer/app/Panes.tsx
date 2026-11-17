import { useEffect, useRef, useState } from "react";
import { IconEye, IconEyeOff } from "../ui/icons";
import { isMac } from "../ui/keys";
import {
  DEFAULT_LAYOUT,
  PANES,
  PRESETS,
  applyPreset,
  canHide,
  isPreset,
  moveTo,
  type Layout,
  type PaneId,
} from "./layout";
import css from "./Panes.module.css";

/** 面板的全名（按钮、提示里用） */
export const PANE_NAME: Record<PaneId, string> = {
  rail: "项目列表",
  map: "地图",
  chat: "对话",
};
export const LAYOUT_SHORTCUT = isMac ? "⌘⌥L" : "Ctrl+Alt+L";

const Chevron = ({ dir }: { dir: "l" | "r" }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={dir === "l" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
  </svg>
);
const IconLayout = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16M15 4v16" />
  </svg>
);

/** 鼠标停一会儿才算悬停（分隔处 300ms、窗口边上 150ms），离开稍等一下再收，免得移向按钮时就没了 */
function useHover(delay: number) {
  const [on, setOn] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    on,
    enter: () => (
      window.clearTimeout(timer.current),
      (timer.current = window.setTimeout(() => setOn(true), delay))
    ),
    leave: () => (
      window.clearTimeout(timer.current),
      (timer.current = window.setTimeout(() => setOn(false), 120))
    ),
    off: () => (window.clearTimeout(timer.current), setOn(false)),
  };
}

/* ------------------------------------------------------------------ 布局按钮和小窗 */

const MINI_W = 316;
const HIDDEN_W = 44;
const GAP = 6;
const BLOCK_MIN = 76;

/**
 * 顶栏的“布局”按钮，点开是小窗（设计稿 9-7）：
 * 三个方块按真实宽窄画，拖一个、其余的让开，松手滑到位；方块右下角的眼睛收起 / 打开；下面是常用排列和恢复默认
 */
export function LayoutButton({
  layout,
  widths,
  open,
  onOpen,
  onChange,
  onToggle,
}: {
  layout: Layout;
  widths: Partial<Record<PaneId, number>>;
  open: boolean;
  onOpen(open: boolean): void;
  onChange(next: Layout, animate: boolean): void;
  onToggle(id: PaneId): void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) =>
      wrap.current?.contains(e.target as Node) || onOpen(false);
    const key = (e: KeyboardEvent) =>
      e.key === "Escape" && (e.stopImmediatePropagation(), onOpen(false));
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    return () => (
      window.removeEventListener("pointerdown", down),
      window.removeEventListener("keydown", key, true)
    );
  }, [open, onOpen]);
  return (
    <div ref={wrap} className={css.layoutWrap}>
      <button
        className={css.layoutButton}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`布局（${LAYOUT_SHORTCUT}）`}
        onClick={() => onOpen(!open)}
      >
        <IconLayout />
        布局
      </button>
      {open && (
        <LayoutPopover
          layout={layout}
          widths={widths}
          onChange={onChange}
          onToggle={onToggle}
        />
      )}
    </div>
  );
}

function LayoutPopover({
  layout,
  widths,
  onChange,
  onToggle,
}: {
  layout: Layout;
  widths: Partial<Record<PaneId, number>>;
  onChange(next: Layout, animate: boolean): void;
  onToggle(id: PaneId): void;
}) {
  // 方块宽度：看得见的按真实宽度的比例分，收起的是一个窄虚线框
  const shown = layout.order.filter((p) => !layout.hidden.includes(p));
  const free =
    MINI_W - GAP * (layout.order.length - 1) - HIDDEN_W * layout.hidden.length;
  const total =
    shown.reduce((n, p) => n + (widths[p] ?? PANES[p].base), 0) || 1;
  // 窄的方块至少放得下名字和眼睛；多出来的从最宽的那块里扣
  const raw = Object.fromEntries(
    shown.map((p) => [
      p,
      Math.max(BLOCK_MIN, ((widths[p] ?? PANES[p].base) / total) * free),
    ]),
  ) as Partial<Record<PaneId, number>>;
  const widest = shown.reduce<PaneId | undefined>(
    (a, p) => (a && raw[a]! >= raw[p]! ? a : p),
    undefined,
  );
  if (widest)
    raw[widest] =
      raw[widest]! - (shown.reduce((n, p) => n + raw[p]!, 0) - free);
  const blockW = (p: PaneId) =>
    layout.hidden.includes(p) ? HIDDEN_W : raw[p]!;

  const blocks = useRef<Partial<Record<PaneId, HTMLDivElement | null>>>({});
  const [drag, setDrag] = useState<{
    id: PaneId;
    startX: number;
    dx: number;
    over: number;
  } | null>(null);
  const [settling, setSettling] = useState(false);
  const from = drag ? layout.order.indexOf(drag.id) : -1;
  /** 拖着的时候，别的方块往哪边让 */
  const shift = (p: PaneId) => {
    if (!drag || p === drag.id) return 0;
    const i = layout.order.indexOf(p);
    const w = blockW(drag.id) + GAP;
    if (from < i && i <= drag.over) return -w;
    if (drag.over <= i && i < from) return w;
    return 0;
  };

  return (
    <section className={css.popover} role="dialog" aria-label="布局">
      <header>
        <h2>布局</h2>
        <span>拖方块换位置，点眼睛收起</span>
      </header>
      <div
        className={css.mini}
        role="listbox"
        aria-label="面板的顺序"
        data-settling={settling || undefined}
      >
        {layout.order.map((p) => {
          const hidden = layout.hidden.includes(p);
          const dragging = drag?.id === p;
          return (
            <div
              key={p}
              ref={(el) => void (blocks.current[p] = el)}
              role="option"
              aria-label={PANE_NAME[p]}
              aria-selected={!hidden}
              className={css.block}
              data-pane={p}
              data-hidden={hidden || undefined}
              data-dragging={dragging || undefined}
              style={{
                width: blockW(p),
                transform: dragging
                  ? `translateX(${drag.dx}px) rotate(-2deg)`
                  : `translateX(${shift(p)}px)`,
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setDrag({
                  id: p,
                  startX: e.clientX,
                  dx: 0,
                  over: layout.order.indexOf(p),
                });
              }}
              onPointerMove={(e) => {
                if (!drag || drag.id !== p) return;
                const dx = e.clientX - drag.startX;
                // 拖着的方块中心越过了谁的中线，就排到谁那里
                const me = blocks.current[p]!.getBoundingClientRect();
                const center = me.left - drag.dx + dx + me.width / 2;
                let over = 0;
                for (const q of layout.order) {
                  if (q === p) continue;
                  const r = blocks.current[q]!.getBoundingClientRect();
                  if (center > r.left - shift(q) + r.width / 2) over++;
                }
                setDrag({ ...drag, dx, over });
              }}
              onPointerUp={() => {
                if (!drag || drag.id !== p) return;
                if (drag.over !== from) {
                  // 松手：先不带过渡地换到新顺序，免得方块从让开的位置再滑一次
                  setSettling(true);
                  onChange(moveTo(layout, p, drag.over), false);
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => setSettling(false)),
                  );
                }
                setDrag(null);
              }}
              onPointerCancel={() => setDrag(null)}
            >
              <i className={css.thumb} data-pane={p} aria-hidden />
              <span className={css.blockFoot}>
                <b>{PANES[p].label}</b>
                <button
                  aria-label={`${hidden ? "打开" : "收起"}${PANE_NAME[p]}`}
                  title={
                    !hidden && !canHide(layout, p)
                      ? "至少留一个面板"
                      : hidden
                        ? "打开"
                        : "收起"
                  }
                  disabled={!hidden && !canHide(layout, p)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onToggle(p)}
                >
                  {hidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <div className={css.presets}>
        <span>常用</span>
        <div>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              aria-pressed={isPreset(layout, p)}
              onClick={() => onChange(applyPreset(layout, p), true)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <footer>
        <span>
          也可以在两个面板中间悬停，点箭头收起一边；收起的移到边上才出现
        </span>
        <button onClick={() => onChange(DEFAULT_LAYOUT, true)}>恢复默认</button>
      </footer>
    </section>
  );
}

/* ------------------------------------------------------------------ 分隔处 */

/**
 * 两个面板中间的分隔条：拖动改宽度，双击恢复默认；
 * 悬停 300ms 线变蓝、正中浮出胶囊：‹ 收起左边，› 收起右边。中间夹着收起的面板时，胶囊是“‹ 地图 ›”，点它打开
 */
export function PaneDivider({
  left,
  right,
  between,
  layout,
  resizable,
  start,
  onDrag,
  onReset,
  onHide,
  onShow,
}: {
  left: PaneId;
  right: PaneId;
  between: PaneId[];
  layout: Layout;
  resizable: boolean;
  start(): number;
  onDrag(dx: number, start: number): void;
  onReset(): void;
  onHide(id: PaneId): void;
  onShow(id: PaneId): void;
}) {
  const from = useRef<{ x: number; start: number } | null>(null);
  const hover = useHover(300);
  return (
    <div
      className={css.divider}
      data-resizable={resizable || undefined}
      data-hover={hover.on || undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label={`${PANE_NAME[left]}和${PANE_NAME[right]}之间`}
      title={resizable ? "拖动调整宽度；双击恢复默认" : undefined}
      onPointerEnter={hover.enter}
      onPointerLeave={() => from.current || hover.leave()}
      onPointerDown={(e) => {
        if (!resizable) return;
        from.current = { x: e.clientX, start: start() };
        e.currentTarget.setPointerCapture(e.pointerId);
        hover.off();
      }}
      onPointerMove={(e) =>
        from.current && onDrag(e.clientX - from.current.x, from.current.start)
      }
      onPointerUp={() => (from.current = null)}
      onPointerCancel={() => (from.current = null)}
      onDoubleClick={resizable ? onReset : undefined}
    >
      {hover.on && (
        <div
          className={css.capsuleWrap}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {between.length > 0 ? (
            between.map((p) => (
              <button
                key={p}
                className={css.openPill}
                aria-label={`打开${PANE_NAME[p]}`}
                onClick={() => (hover.off(), onShow(p))}
              >
                <Chevron dir="l" />
                <span>{PANES[p].label}</span>
                <Chevron dir="r" />
              </button>
            ))
          ) : (
            <div
              className={css.capsule}
              role="group"
              aria-label="收起两边的面板"
            >
              <button
                aria-label={`收起${PANE_NAME[left]}`}
                title={
                  canHide(layout, left)
                    ? `收起${PANE_NAME[left]}`
                    : "至少留一个面板"
                }
                disabled={!canHide(layout, left)}
                onClick={() => (hover.off(), onHide(left))}
              >
                <Chevron dir="l" />
              </button>
              <button
                aria-label={`收起${PANE_NAME[right]}`}
                title={
                  canHide(layout, right)
                    ? `收起${PANE_NAME[right]}`
                    : "至少留一个面板"
                }
                disabled={!canHide(layout, right)}
                onClick={() => (hover.off(), onHide(right))}
              >
                <Chevron dir="r" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 窗口边上 */

/** 收起后贴在窗口最左 / 最右的面板：平时什么都没有，鼠标贴到边上才探出“› 项目”“对话 ‹” */
export function EdgeOpener({
  side,
  panes,
  onShow,
}: {
  side: "left" | "right";
  panes: PaneId[];
  onShow(id: PaneId): void;
}) {
  const hover = useHover(150);
  if (panes.length === 0) return null;
  return (
    <div
      className={css.edge}
      data-side={side}
      data-hover={hover.on || undefined}
      onPointerEnter={hover.enter}
      onPointerLeave={hover.leave}
    >
      {hover.on && (
        <div className={css.edgeButtons}>
          {panes.map((p) => (
            <button
              key={p}
              aria-label={`打开${PANE_NAME[p]}`}
              onClick={() => (hover.off(), onShow(p))}
            >
              {side === "left" && <Chevron dir="r" />}
              <span>{PANES[p].label}</span>
              {side === "right" && <Chevron dir="l" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
