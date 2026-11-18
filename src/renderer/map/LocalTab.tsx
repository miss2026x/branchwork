import { useEffect, useState } from "react";
import { useStore } from "../stores/store";
import { IconWarn } from "../ui/icons";
import { routeLabel } from "../ui/route-color";
import { LocalNow, runningDev } from "../chat/LocalCar";
import css from "./LocalTab.module.css";

/**
 * 路线标签最左的 Local 专车（设计稿 9-10）：固定不随各路标签滚动。
 * 标签上只带最要紧的一项：冲突 → 回答中（有路在等时带上）→ 开发服务器 → 几处没提交 → 分支名；悬停看完整的现状
 */
export function LocalTab({ projectId, selected, compact = false }: { projectId: string; selected: boolean; compact?: boolean }) {
  const route = useStore((s) => Object.values(s.routes).find((r) => r.projectId === projectId && r.local));
  const status = useStore((s) => s.localStatus[projectId]);
  const activity = useStore((s) => s.activity);
  const routes = useStore((s) => s.routes);
  const terminals = useStore((s) => s.terminals);
  const refresh = useStore((s) => s.refreshLocal);
  const open = useStore((s) => s.openLocalRoute);
  const dir = useStore((s) => s.projects.find((p) => p.id === projectId)?.localDir ?? "");
  const [hover, setHover] = useState(false);

  // 换了项目、回到窗口时重新看一遍（你可能在终端里提交过、切过分支）
  useEffect(() => {
    refresh(projectId);
    const onFocus = () => refresh(projectId);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [projectId, refresh]);

  const dev = route ? runningDev(Object.values(terminals).filter((t) => t.routeId === route.id)) : undefined;
  const conflicts = status?.files.filter((f) => f.state === "conflict").length ?? 0;
  const changed = (status?.files.length ?? 0) - conflicts;
  const busy = route?.status === "answering" || route?.status === "awaiting_permission";
  const waiting = Object.values(routes).filter((r) => r.projectId === projectId && activity[r.id]?.kind === "waiting-local");

  let tone: string | undefined;
  let meta: React.ReactNode;
  if (status?.missing) {
    tone = "red";
    meta = <em className={css.badge} data-tone="red">找不到文件夹</em>;
  } else if (conflicts) {
    tone = "red";
    meta = (
      <em className={css.badge} data-tone="red">
        <IconWarn size={11} /> 冲突
      </em>
    );
  } else if (busy) {
    meta = (
      <>
        <i className={css.spin} />
        {route?.status === "awaiting_permission" ? <em className={css.badge} data-tone="amber">等你批准</em> : waiting.length ? <em className={css.badge} data-tone="amber">{waiting.map((r) => routeLabel(r)).join("、")}在等</em> : <span className={css.dim}>回答中</span>}
      </>
    );
  } else {
    meta = (
      <>
        {status?.branch && <code className={css.branch}>{status.branch}</code>}
        {dev ? (
          <em className={css.badge} data-tone="green">
            <i className={css.pulse} />
            {dev.port !== null ? `:${dev.port}` : "在跑"}
          </em>
        ) : changed > 0 ? (
          <em className={css.badge} data-tone="amber" title={`${changed} 处没提交`}>
            {changed}
          </em>
        ) : null}
      </>
    );
  }

  // 挤的时候（设计稿 9-11）：只剩“L”，右上角一个点：红冲突、蓝回答中、绿开发服务器、黄有没提交的改动
  const dotTone = status?.missing || conflicts ? "red" : busy ? (route?.status === "awaiting_permission" ? "amber" : "blue") : dev ? "green" : changed > 0 ? "amber" : undefined;
  if (compact) {
    return (
      <span className={css.wrap} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
        <button className={css.tab} data-compact aria-current={selected} onClick={() => (setHover(false), void open(projectId))} aria-label="Local 专车：直接在 Local 里干活">
          <b className={css.l}>L</b>
          {dotTone && <i className={css.dot} data-tone={dotTone} aria-hidden />}
        </button>
        {hover && !selected && status && (
          <div className={css.card} role="tooltip">
            <LocalNow status={status} dev={dev} dir={dir} compact />
          </div>
        )}
      </span>
    );
  }
  return (
    <span className={css.wrap} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <button className={css.tab} aria-current={selected} data-tone={tone} onClick={() => (setHover(false), void open(projectId))} aria-label="Local 专车：直接在 Local 里干活">
        <b className={css.l}>L</b>
        <span className={css.name}>Local</span>
        {meta}
      </button>
      {hover && !selected && status && (
        <div className={css.card} role="tooltip">
          <LocalNow status={status} dev={dev} dir={dir} compact />
          <p>点一下上 Local 专车：Claude 直接在 Local 里启动项目、拉代码、提交。</p>
        </div>
      )}
    </span>
  );
}
