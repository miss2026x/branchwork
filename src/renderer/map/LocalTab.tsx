import { useEffect, useState } from "react";
import { useStore } from "../stores/store";
import { useUnread } from "../stores/useUnread";
import { LocalNow, runningDev } from "../chat/LocalCar";
import css from "./LocalTab.module.css";

/**
 * 路线标签最左的 Local 专车（设计稿 9-10）：固定不随各路标签滚动。
 * 标签上只写“L Local”，要你注意的事用右上角一个点；悬停看完整的现状
 */
export function LocalTab({ projectId, selected }: { projectId: string; selected: boolean }) {
  const route = useStore((s) => Object.values(s.routes).find((r) => r.projectId === projectId && r.local));
  const status = useStore((s) => s.localStatus[projectId]);
  const terminals = useStore((s) => s.terminals);
  const refresh = useStore((s) => s.refreshLocal);
  const open = useStore((s) => s.openLocalRoute);
  const dir = useStore((s) => s.projects.find((p) => p.id === projectId)?.localDir ?? "");
  const [hover, setHover] = useState(false);
  const unread = useUnread();

  // 换了项目、回到窗口时重新看一遍（你可能在终端里提交过、切过分支）
  useEffect(() => {
    refresh(projectId);
    const onFocus = () => refresh(projectId);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [projectId, refresh]);

  const dev = route ? runningDev(Object.values(terminals).filter((t) => t.routeId === route.id)) : undefined;
  const conflicts = status?.files.filter((f) => f.state === "conflict").length ?? 0;
  // 标签上只写“L Local”；要你注意的事用右上角一个点，和各路标签一样：红=冲突或找不到文件夹、黄=等你批准、蓝=回答中、绿=答完了还没看（设计稿 9-14）。细节悬停看
  const fresh = !!route && !selected && unread.has(route.id);
  const dot = status?.missing || conflicts ? "red" : route?.status === "awaiting_permission" ? "amber" : route?.status === "answering" ? "blue" : fresh ? "green" : undefined;

  return (
    <span className={css.wrap} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <button className={css.tab} aria-current={selected} onClick={() => (setHover(false), void open(projectId))} aria-label={`Local 专车：直接在 Local 里干活${fresh ? "（答完了，还没看）" : ""}`}>
        <b className={css.l}>L</b>
        <span className={css.name}>Local</span>
        {dot && <i className={css.dot} data-tone={dot} aria-hidden />}
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
