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

/** 放到后台的导入：左下角一枚小条，点开回到进度窗口 */
export function ImportPill({ progress, onOpen }: { progress: ImportProgress; onOpen(): void }) {
  const running = progress.items.find((i) => i.state === "running");
  return (
    <button type="button" className={own.pill} onClick={onOpen} aria-label="正在导入，点开看进度">
      <i className={own.spin} />
      <b>
        正在导入 {Math.min(doneCount(progress) + 1, progress.items.length)} / {progress.items.length}
      </b>
      {running && (
        <span className="ell">
          {running.title} · {running.step ?? "准备"}
        </span>
      )}
      <em>查看</em>
    </button>
  );
}
