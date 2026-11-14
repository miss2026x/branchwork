import { useState } from "react";
import type { Route } from "../../shared";
import { ROUTE_COLORS, routeColors } from "../ui/route-color";
import { IconCopy } from "../ui/icons";
import css from "./RouteMenu.module.css";

interface Props {
  route: Route;
  /** 这一路自己问了几站 */
  stopCount: number;
  /** 一句话的同步状态，比如“改动都已进 Local” */
  syncNote: string;
  syncTone: "ok" | "warn";
  onRename(name: string): void;
  onColor(color: number | null): void;
  onArchive(): void;
  /** 压缩整路成快线；这一路还没有能压缩的站时不给 */
  onCompressAll?: () => void;
  onExport(): void;
  onDelete(): void;
  onClose(): void;
  /** 菜单左上角在窗口里的位置（左栏会裁掉超出去的部分，所以菜单浮在窗口这一层） */
  at: { top: number; left: number };
}

export const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** 路的菜单：改名、换颜色、看会话信息、归档、删除。只收数据、发事件 */
export function RouteMenu({ route, stopCount, syncNote, syncTone, onRename, onColor, onArchive, onCompressAll, onExport, onDelete, onClose, at }: Props) {
  const [name, setName] = useState(route.name);
  const [copied, setCopied] = useState(false);
  const commit = () => {
    const next = name.trim();
    if (next && next !== route.name) onRename(next);
    else setName(route.name);
  };
  const current = routeColors(route).line;
  const resume = route.sessionId ? `claude --resume ${route.sessionId}` : null;
  return (
    <>
      <div className={css.backdrop} onClick={() => (commit(), onClose())} />
      <div className={css.menu} role="dialog" aria-label={`${route.name} 的设置`} style={{ top: Math.max(8, Math.min(at.top, window.innerHeight - 470)), left: at.left }}>
        <label htmlFor={`rn-${route.id}`}>线路名称</label>
        <input
          id={`rn-${route.id}`}
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") (commit(), onClose());
            if (e.key === "Escape") onClose();
          }}
        />
        <p className={css.info}>
          {route.sessionId ? `会话 ${route.sessionId.slice(0, 8)}，` : "还没发车，"}
          {stopCount} 站{route.contextTokens ? `，上下文 ${tokens(route.contextTokens)} / 200k` : ""}
        </p>
        <p className={css.sync} data-tone={syncTone}>
          <i />
          {syncNote}
        </p>

        {!route.express && (
          <>
            <hr />
            <span className={css.label}>线路颜色</span>
            <div className={css.colors} role="radiogroup" aria-label="线路颜色">
              {ROUTE_COLORS.map((c, i) => (
                <button key={c} role="radio" aria-checked={c === current} aria-label={`颜色 ${i + 1}`} style={{ background: c }} onClick={() => onColor(i + 1)} />
              ))}
            </div>
          </>
        )}

        <hr />
        <button role="menuitem" className={css.item} onClick={() => (onClose(), onArchive())}>
          归档
          <small>收进“已归档”，对话和工作区都留着</small>
        </button>
        <button role="menuitem" className={css.item} disabled={!onCompressAll} onClick={() => (onClose(), onCompressAll?.())}>
          压缩整路成快线…
          <small>{onCompressAll ? "提炼到最新一站，开出一条上下文更短的快线" : "这一路还没有答完的站"}</small>
        </button>
        <button role="menuitem" className={css.item} onClick={() => (onClose(), onExport())}>
          导出为 Markdown…
        </button>
        {resume && (
          <div className={css.resume}>
            <span>在终端里接着这一路</span>
            <div>
              <code className="ell">{resume}</code>
              <button
                aria-label="复制命令"
                title={copied ? "已复制" : "复制命令"}
                onClick={() => void navigator.clipboard?.writeText(`cd "${route.worktreePath}" && ${resume}`).then(() => setCopied(true))}
              >
                <IconCopy size={14} />
              </button>
            </div>
            <small>{copied ? "已复制（带上了进入这一路工作区的命令）" : "要在这一路的工作区里运行；复制时会带上进入目录的命令"}</small>
          </div>
        )}
        <hr />
        <button role="menuitem" className={`${css.item} ${css.danger}`} onClick={() => (onClose(), onDelete())}>
          删除…
          <small>删掉整条线，其他线路不受影响</small>
        </button>
      </div>
    </>
  );
}
