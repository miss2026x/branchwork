import { useEffect, useState } from "react";
import type { ImportProgress } from "../../shared";
import { IconClose } from "../ui/icons";
import css from "./Dialog.module.css";
import own from "./ImportProgress.module.css";

const doneCount = (p: ImportProgress) => p.items.filter((i) => i.state === "done" || i.state === "failed" || i.state === "skipped").length;

/** 导入终端会话的进度（设计稿 4-8）：每个会话一行，正在做哪一步；可以放到后台、可以停止 */
export function ImportProgressDialog({ progress, onBackground, onCancel, onClose }: { progress: ImportProgress; onBackground(): void; onCancel(): void; onClose(): void }) {
  const n = progress.items.length;
  const done = doneCount(progress);
  const failed = progress.items.filter((i) => i.state === "failed").length;
  return (
    <div className={css.scrim}>
      <div className={css.dialog} role="dialog" aria-modal aria-label="正在导入">
        <header>
          <h2>
            {progress.finished ? (failed > 0 ? "导入结束" : "导入完成") : "正在导入"} <span className={own.count}>{done} / {n}</span>
          </h2>
          <button type="button" aria-label={progress.finished ? "关闭" : "关掉窗口，导入在后台继续"} onClick={progress.finished ? onClose : onBackground}>
            <IconClose />
          </button>
        </header>
        <div className={own.bar} role="progressbar" aria-valuemin={0} aria-valuemax={n} aria-valuenow={done}>
          <i style={{ width: `${(done / Math.max(1, n)) * 100}%` }} />
        </div>
        <ul className={own.list}>
          {progress.items.map((it) => (
            <li key={it.sessionId} data-state={it.state}>
              <span className={own.mark} aria-hidden />
              <span className={own.text}>
                <b className="ell">{it.title}</b>
                <small>{it.state === "failed" ? it.error : it.prompts !== null ? `${it.prompts} 个提问` : it.state === "skipped" ? "没导（停止了）" : " "}</small>
              </span>
              <em>{it.state === "running" ? `${it.step ?? "准备"}…` : it.state === "done" ? "已导入" : it.state === "failed" ? "没导成" : it.state === "skipped" ? "跳过" : ""}</em>
            </li>
          ))}
        </ul>
        <p className={css.sub}>每个会话三步：复制会话 → 读出每一站 → 建工作区。导好的已经画在地图上了；终端里原来的会话不动。</p>
        <footer>
          {progress.finished ? (
            <button type="button" className={css.confirm} style={{ background: "var(--fg-1)" }} onClick={onClose}>
              好
            </button>
          ) : (
            <>
              <button type="button" className={css.ghost} onClick={onCancel}>
                停止导入
              </button>
              <button type="button" className={css.confirm} style={{ background: "var(--fg-1)" }} onClick={onBackground}>
                放到后台
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

/** 左下角叠在一起的几枚小条（设计稿 9-16）：导入、开新车，往上排，不再压在一起 */
export function PillStack({ children }: { children: React.ReactNode }) {
  return <div className={own.stack}>{children}</div>;
}

/** 放到后台的导入：左下角一枚小条，两行，底下一道进度；点开回到进度窗口（设计稿 9-16） */
export function ImportPill({ progress, onOpen }: { progress: ImportProgress; onOpen(): void }) {
  const running = progress.items.find((i) => i.state === "running");
  const done = doneCount(progress);
  const n = progress.items.length;
  return (
    <button type="button" className={own.pill} onClick={onOpen} aria-label={`正在导入 ${done} / ${n}，点开看进度`}>
      <span className={own.pillTop}>
        <i className={own.spin} />
        <b>正在导入</b>
        <code>
          {done} / {n}
        </code>
        <em>查看 ›</em>
      </span>
      {running && (
        <span className={`${own.pillSub} ell`}>
          {running.title} · {running.step ?? "准备"}
        </span>
      )}
      <span className={own.pillBar}>
        <i style={{ width: `${Math.max(6, (done / Math.max(1, n)) * 100)}%` }} />
      </span>
    </button>
  );
}

/** 每秒走一下的“N 秒” */
function useSecs(since: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return Math.round((now - since) / 1000);
}

/** 正在开新的一路（开新对话、压缩成快线、后台开的新车）：左下角一枚小条，写着在做哪一步、多久了 */
export function PreparingPill({ label, step, since, error, onRetry, onDrop }: { label: string; step: string; since: number; error?: string | null; onRetry?(): void; onDrop?(): void }) {
  const secs = useSecs(since);
  if (error)
    return (
      <div className={own.pill} data-error role="alert">
        <span className={own.pillTop}>
          <b>{label}没成</b>
          <em>
            {onRetry && (
              <button type="button" onClick={onRetry}>
                再试
              </button>
            )}
            {onDrop && (
              <button type="button" onClick={onDrop}>
                不开了
              </button>
            )}
          </em>
        </span>
        <span className={own.pillSub}>{error}</span>
      </div>
    );
  return (
    <div className={own.pill} role="status">
      <span className={own.pillTop}>
        <i className={own.spin} />
        <b>正在{label}</b>
      </span>
      <span className={`${own.pillSub} ell`}>
        {step}
        {secs >= 2 ? ` · ${secs} 秒` : ""}
      </span>
    </div>
  );
}
