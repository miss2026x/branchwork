import { useRef, type ReactNode } from "react";
import { IconClose, IconGrip, IconPaneChat, IconPaneMap, IconPaneRail } from "../ui/icons";
import { isMac } from "../ui/keys";
import { PANES, canHide, type Layout, type PaneId } from "./layout";
import css from "./Panes.module.css";

const ICON: Record<PaneId, (p: { size?: number }) => ReactNode> = { rail: IconPaneRail, map: IconPaneMap, chat: IconPaneChat };
const NAME: Record<PaneId, string> = { rail: "项目列表", map: "地图", chat: "对话" };
export const paneShortcut = (id: PaneId) => `${isMac ? "⌘⌥" : "Ctrl+Alt+"}${PANES[id].key}`;

/** 顶栏右边的三个开关：显示哪几个面板（设计稿 9-7） */
export function PaneToggles({ layout, onToggle }: { layout: Layout; onToggle(id: PaneId): void }) {
  return (
    <div className={css.toggles} role="group" aria-label="显示哪些面板">
      {(["rail", "map", "chat"] as const).map((id) => {
        const on = !layout.hidden.includes(id);
        const Icon = ICON[id];
        const locked = on && !canHide(layout, id);
        return (
          <button key={id} aria-pressed={on} aria-label={NAME[id]} title={locked ? `${NAME[id]}（至少留一个面板）` : `${on ? "收起" : "打开"}${NAME[id]}（${paneShortcut(id)}）`} disabled={locked} onClick={() => onToggle(id)}>
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

export interface DragHandlers {
  onDragStart(id: PaneId, x: number, y: number): void;
  onDragMove(x: number, y: number): void;
  onDragEnd(commit: boolean): void;
}

/**
 * 面板顶上那一条：按住 ⠿（或标题）左右拖换位置，右边 × 收起。
 * compact 时（窄的图标栏）只放把手和 ×
 */
export function PaneHeader({ id, layout, compact, extra, drag, onHide }: { id: PaneId; layout: Layout; compact?: boolean; extra?: ReactNode; drag: DragHandlers; onHide(): void }) {
  const moved = useRef(false);
  const hideable = canHide(layout, id);
  return (
    <div className={css.head} data-compact={compact || undefined}>
      <span
        className={css.grip}
        role="button"
        tabIndex={-1}
        aria-label={`拖动${NAME[id]}换位置`}
        title="按住左右拖，换位置"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          moved.current = false;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.onDragStart(id, e.clientX, e.clientY);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && ((moved.current = true), drag.onDragMove(e.clientX, e.clientY))}
        onPointerUp={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && drag.onDragEnd(moved.current)}
        onPointerCancel={() => drag.onDragEnd(false)}
      >
        <IconGrip />
        {!compact && <b>{PANES[id].label}</b>}
      </span>
      {!compact && <span className={css.spacer} />}
      {!compact && extra}
      <button className={css.hide} aria-label={`收起${NAME[id]}`} title={hideable ? `收起（右上角可以再打开，${paneShortcut(id)}）` : "至少留一个面板"} disabled={!hideable} onClick={onHide}>
        <IconClose size={12} />
      </button>
    </div>
  );
}

/** 拖动时：落点那条竖线，和跟着鼠标的面板名 */
export function PaneDragOverlay({ id, x, y, lineX, hint }: { id: PaneId; x: number; y: number; lineX: number | null; hint: string | null }) {
  return (
    <>
      {lineX !== null && <div className={css.dropLine} style={{ left: lineX - 2 }} />}
      <div className={css.ghost} style={{ left: x + 12, top: y + 8 }}>
        <IconGrip />
        <b>{NAME[id]}</b>
        {hint && <span>{hint}</span>}
      </div>
    </>
  );
}
