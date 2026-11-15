import { useEffect, useState } from "react";
import type { Project, RemoveProjectResult } from "../../shared";
import { IconClose, IconWarn } from "../ui/icons";
import css from "./Dialog.module.css";
import own from "./RemoveProject.module.css";

interface Props {
  project: Project;
  /** 这个项目有几路（含已归档）、其中几路已归档、候车区里几个问题 */
  routeCount: number;
  archivedCount: number;
  queueCount: number;
  /** 正在回答的路（“3路 修复 CI”）：有的话先不能移除 */
  busy: string[];
  /** 第一次确认后发现的：没进 Local 的改动、留下的工作区 */
  blocked: Extract<RemoveProjectResult, { status: "has-unsynced" }> | null;
  error: string | null;
  onCancel(): void;
  onConfirm(force: boolean): Promise<void>;
}

const KIND: Record<string, string> = { added: "新增", modified: "修改", deleted: "删除" };

/** 从 Branchwork 里移除一个项目。Local 文件夹不动；有没进 Local 的改动时要再确认一次 */
export function RemoveProjectDialog({ project, routeCount, archivedCount, queueCount, busy, blocked, error, onCancel, onConfirm }: Props) {
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const confirm = async () => {
    setWorking(true);
    await onConfirm(blocked !== null);
    setWorking(false);
  };

  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={css.dialog} role="alertdialog" aria-modal aria-label={`移除 ${project.name}`}>
        <header>
          <h2 className="ell">从 Branchwork 移除「{project.name}」</h2>
          <button type="button" aria-label="关闭" onClick={onCancel}>
            <IconClose />
          </button>
        </header>

        {error && <p className={css.error}>{error}</p>}

        {blocked === null ? (
          <>
            <p className={own.keep}>
              <b>Local 文件夹不会动</b>
              <code>{project.localDir}</code>
              <span>里面的代码和 git 记录都还在。</span>
            </p>
            <p className={css.sub}>会一起删掉，不能撤销：</p>
            <ul className={own.gone}>
              <li>{routeCount > 0 ? `${routeCount} 路对话${archivedCount > 0 ? `（其中 ${archivedCount} 路已归档）` : ""}和它们的工作区` : "这个项目还没有路"}</li>
              {queueCount > 0 && <li>候车区里的 {queueCount} 个问题</li>}
              <li>同步记录</li>
            </ul>
            <p className={own.note}>想再用时，重新添加这个文件夹就行；以前的路找不回来。没进 Local 的改动会先拦下来给你看。</p>
            {busy.length > 0 && (
              <p className={css.warn}>
                <IconWarn /> {busy.join("、")} 正在回答，到站或停车后才能移除。
              </p>
            )}
          </>
        ) : (
          <>
            {blocked.routes.length > 0 && (
              <>
                <p className={css.warn}>
                  <IconWarn /> 这些改动还没进 Local，移除后就没了。
                </p>
                <div className={own.groups}>
                  {blocked.routes.map((r) => (
                    <section key={r.routeId}>
                      <h3>{r.label}</h3>
                      <ul className={css.files}>
                        {r.files.map((f) => (
                          <li key={f.path}>
                            <span>{KIND[f.note] ?? f.note}</span>
                            <code>{f.path}</code>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </>
            )}
            {blocked.kept.length > 0 && (
              <p className={own.note}>
                之前删除时留下的 {blocked.kept.length} 个工作区（{blocked.kept.join("、")}）也会一起删掉。要留什么，先去“同步记录”里打开它拷出来。
              </p>
            )}
          </>
        )}

        <footer>
          <button type="button" className={css.ghost} onClick={onCancel} autoFocus>
            取消
          </button>
          <button type="button" className={css.destroy} disabled={working || busy.length > 0} onClick={() => void confirm()}>
            {blocked ? "不要这些了，移除" : "移除项目"}
          </button>
        </footer>
      </div>
    </div>
  );
}
