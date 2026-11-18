import { useEffect, useRef, useState } from "react";
import type { LocalStatus, Route, Terminal } from "../../shared";
import { ordinal, stopOffset } from "../stores/numbering";
import { useStore } from "../stores/store";
import { agoFine } from "../ui/ago";
import { IconMore, IconWarn } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeLabel } from "../ui/route-color";
import { useFit } from "../ui/useFit";
import { presetChips, type PresetChip } from "./local-presets";
import css from "./LocalCar.module.css";

/**
 * Local 专车面板里多出来的几块（设计稿 9-10）：“Local 现在”、第一次打开的说明、
 * 常用提示、有路在等专车。都只读 store，不改东西；点了做什么由 ChatPanel 决定
 */

/** Local 里的开发服务器（专车开的、还在跑的后台终端） */
export function runningDev(terminals: Terminal[]): Terminal | undefined {
  return terminals.find((t) => t.status === "running");
}

/** “Local 现在”：分支、和远端差多少、几处没提交（各是哪一路的）、开发服务器 */
export function LocalNow({ status, dev, compact, dir }: { status: LocalStatus | undefined; dev?: Terminal; compact?: boolean; dir: string }) {
  const routes = useStore((s) => s.routes);
  if (!status) {
    return (
      <section className={css.now} aria-label="Local 现在">
        <header>
          <b>Local 现在</b>
          <span>正在看…</span>
        </header>
      </section>
    );
  }
  if (status.missing) {
    return (
      <section className={css.now} data-tone="red" role="alert" aria-label="Local 现在">
        <p className={css.row}>
          <IconWarn size={14} /> 找不到 <code>{dir}</code>。文件夹被移走或改名了？放回原处后再来。
        </p>
      </section>
    );
  }
  const conflicts = status.files.filter((f) => f.state === "conflict");
  const changed = status.files.filter((f) => f.state !== "conflict");
  // 没提交的改动按是哪一路带进来的分组：1路 3 · 2路 2 · 你自己改的 1
  const groups = new Map<string, number>();
  let mine = 0;
  for (const f of changed) {
    if (f.by && routes[f.by.routeId]) groups.set(f.by.routeId, (groups.get(f.by.routeId) ?? 0) + 1);
    else mine++;
  }
  return (
    <section className={css.now} data-tone={conflicts.length ? "red" : undefined} aria-label="Local 现在">
      <header>
        <b>Local 现在</b>
        <span>{agoFine(status.at)}看过</span>
      </header>
      <p className={css.row}>
        <BranchIcon />
        {status.branch ? <code className={css.branch}>{status.branch}</code> : <span>没在任何分支上</span>}
        <span className={css.dim}>{!status.upstream ? "没有跟踪远端分支" : status.ahead || status.behind ? `比 ${status.upstream.split("/")[0]} ${[status.behind ? `落后 ${status.behind}` : "", status.ahead ? `领先 ${status.ahead}` : ""].filter(Boolean).join(" · ")}` : `和 ${status.upstream} 一致`}</span>
      </p>
      {conflicts.length > 0 && (
        <p className={css.row} data-tone="red">
          <IconWarn size={14} />
          <span className="ell">
            {conflicts.length} 处冲突：<code>{conflicts.map((f) => f.path).join("、")}</code>
          </span>
        </p>
      )}
      <p className={css.row}>
        <i className={css.dot} data-tone={changed.length ? "amber" : "none"} />
        <span>{changed.length ? `${changed.length} 处没提交` : "没有没提交的改动"}</span>
        {[...groups].map(([routeId, n]) => (
          <span key={routeId} className={css.by} title={`${routeLabel(routes[routeId]!)} 带进来的`}>
            <Plate route={routes[routeId]!} />
            {n}
          </span>
        ))}
        {mine > 0 && groups.size > 0 && <span className={css.dim}>你自己改的 {mine}</span>}
      </p>
      {(dev || status.commands.dev) && (
        <p className={css.row}>
          <i className={css.dot} data-tone={dev ? "green" : "none"} />
          {dev ? (
            <>
              <span>
                <code>{dev.command}</code> 在跑
              </span>
              {dev.port !== null && <span className={css.port}>localhost:{dev.port}</span>}
            </>
          ) : (
            <>
              <span className={css.dim}>开发服务器没开</span>
              <code className={css.dim}>{status.commands.dev}</code>
            </>
          )}
        </p>
      )}
      {!compact && <small className={css.foot}>每一站开始时，这份现状会一起交给 Claude</small>}
    </section>
  );
}

function BranchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="7" r="2" />
      <path d="M6 7v10M18 9c0 5-7 4-11 8" />
    </svg>
  );
}

/** 专车还没有站：说清它改的是哪个文件夹、适合做什么 */
export function LocalIntro({ dir }: { dir: string }) {
  return (
    <div className={css.intro}>
      <b>这辆车直接在 Local 里干活</b>
      <p>
        没有自己的工作区，Claude 改的就是 <code>{dir}</code> 本身。适合只能在 Local 里做的事：启动项目、拉主分支、提交、推送、解决冲突。
      </p>
      <p className={css.dim}>它回答的时候，别的路到站先排队，这一站做完再进 Local。</p>
    </div>
  );
}

/** 最多直接摆几个，其余收进“⋯” */
const SHOWN = 6;

/** 常用提示（设计稿 9-10）：点一下填进输入框；再点一次撤回；按住 Alt 点直接发车 */
export function LocalPresetBar({ route, status, dev, activeId, onPick, onManage }: { route: Route; status: LocalStatus | undefined; dev?: Terminal; activeId: string | null; onPick(chip: PresetChip, direct: boolean): void; onManage(): void }) {
  const saved = useStore((s) => s.localPresets[route.projectId]);
  const load = useStore((s) => s.loadLocalPresets);
  useEffect(() => load(route.projectId), [load, route.projectId]);
  const [more, setMore] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useFit(menu, [more]);
  useEffect(() => {
    if (!more) return;
    const close = (e: PointerEvent) => !menu.current?.parentElement?.contains(e.target as Node) && setMore(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [more]);
  const chips = presetChips(saved, status, !!dev);
  const chip = (c: PresetChip, inMenu = false) => (
    <button
      key={c.preset.id}
      className={inMenu ? css.menuItem : css.chip}
      data-urgent={c.urgent || undefined}
      aria-pressed={inMenu ? undefined : activeId === c.preset.id}
      title={c.text}
      onClick={(e) => (setMore(false), onPick(c, e.altKey))}
    >
      <span className={css.icon} aria-hidden>
        {c.icon}
      </span>
      {c.label}
      {c.extra && <small className="ell">{c.extra}</small>}
    </button>
  );
  return (
    <div className={css.presets}>
      <div className={css.presetHead}>
        <span>常用</span>
        <small>{activeId ? "已填进输入框 · 再点一次撤回 · 按住 Alt 点直接发车" : "点一下填进输入框"}</small>
      </div>
      <div className={css.chips}>
        {chips.slice(0, SHOWN).map((c) => chip(c))}
        <span className={css.moreWrap}>
          <button className={css.more} aria-label="更多常用提示" aria-expanded={more} onClick={() => setMore(!more)}>
            <IconMore size={14} />
          </button>
          {more && (
            <div ref={menu} className={css.menu} role="menu">
              {chips.slice(SHOWN).map((c) => chip(c, true))}
              {chips.length > SHOWN && <i className={css.menuDivider} />}
              <button className={css.menuItem} role="menuitem" onClick={() => (setMore(false), onManage())}>
                管理常用提示…
              </button>
            </div>
          )}
        </span>
      </div>
    </div>
  );
}

/** 有路到站了在等专车：“1路 第 5 站到站了，在等专车这一站做完，马上进 Local” */
export function LocalWaiting({ projectId }: { projectId: string }) {
  const activity = useStore((s) => s.activity);
  const routes = useStore((s) => s.routes);
  const stops = useStore((s) => s.stops);
  const waiting = Object.values(routes).filter((r) => r.projectId === projectId && activity[r.id]?.kind === "waiting-local");
  if (waiting.length === 0) return null;
  return (
    <div className={css.waiting} role="status">
      {waiting.map((r) => {
        const last = Object.values(stops)
          .filter((s) => s.routeId === r.id)
          .sort((a, b) => a.seq - b.seq)
          .at(-1);
        const n = last ? stopOffset(r, routes, stops) + ordinal(last, stops) : null;
        return (
          <p key={r.id}>
            <Plate route={r} />
            <span>{n ? `第 ${n} 站` : ""}到站了，在等专车这一站做完，马上进 Local</span>
          </p>
        );
      })}
    </div>
  );
}

/** 专车车头右边“⋯”（设计稿 9-11）：重新开始、导出对话 */
export function LocalMenu({ busy, onReset, onExport, onClose }: { busy: boolean; onReset(): void; onExport(): void; onClose(): void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest("[data-local-menu]") && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => (window.removeEventListener("pointerdown", onDown), window.removeEventListener("keydown", onKey));
  }, [onClose]);
  return (
    <div ref={box} className={css.headMenu} role="menu" aria-label="专车的更多操作">
      <button role="menuitem" disabled={busy} onClick={onReset}>
        <b>重新开始…</b>
        <small>{busy ? "专车正在回答，到站或停车后再重新开始" : "清掉专车的对话，从第 1 站重来。Local 里的文件不动"}</small>
      </button>
      <button role="menuitem" onClick={onExport}>
        <b>导出对话…</b>
      </button>
    </div>
  );
}

/** 重新开始之前问一句 */
export function LocalResetConfirm({ stops, onYes, onNo }: { stops: number; onYes(): void; onNo(): void }) {
  return (
    <div className={css.confirm} role="alertdialog" aria-label="清掉专车的对话">
      <b>专车的 {stops} 站对话都清掉？</b>
      <span>Claude 不再记得之前在 Local 里做过什么。Local 里的文件、提交都不动。</span>
      <div>
        <button className={css.yes} onClick={onYes}>
          清掉，重新开始
        </button>
        <button className={css.no} onClick={onNo}>
          不了
        </button>
      </div>
    </div>
  );
}
