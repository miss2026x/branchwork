import { useEffect, useState } from "react";
import type { Route, SyncFile } from "../../shared";
import { IconClose, IconWarn } from "../ui/icons";
import { Plate } from "../ui/Plate";
import css from "./Dialog.module.css";
import own from "./Extra.module.css";

interface Props {
  route: Route;
  stopCount: number;
  /** 第一次确认后发现还有没进 Local 的改动：这些文件 */
  unsynced: SyncFile[] | null;
  onCancel(): void;
  /** force：连没进 Local 的改动一起删；keep：只删对话，工作区的文件夹留着 */
  onConfirm(force: boolean, keep: boolean): Promise<void>;
  /** 改成归档 */
  onArchive(): void;
}

const KIND: Record<string, string> = { added: "新增", modified: "修改", deleted: "删除" };

/** 删除一路。有没进 Local 的改动时要再确认一次 */
export function DeleteDialog({ route, stopCount, unsynced, onCancel, onConfirm, onArchive }: Props) {
  const [working, setWorking] = useState(false);
  const [choice, setChoice] = useState<"archive" | "keep" | "all">("archive");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const confirm = async () => {
    if (choice === "archive" && unsynced === null) return onArchive();
    setWorking(true);
    await onConfirm(unsynced !== null, choice === "keep");
    setWorking(false);
  };

  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={css.dialog} role="alertdialog" aria-modal aria-label={`删除 ${route.number}路`}>
        <header>
          <Plate route={route} />
          <h2 className="ell">删除「{route.name}」</h2>
          <button type="button" aria-label="关闭" onClick={onCancel}>
            <IconClose />
          </button>
        </header>

        {unsynced === null ? (
          <>
            <p className={css.sub}>这一路有 {stopCount} 站。已经进了 Local 的改动不受影响。你想怎么处理？</p>
            <div className={own.options} role="radiogroup" aria-label="怎么处理">
              {(
                [
                  ["archive", "改成归档", "推荐", "对话和工作区都留着，收进“已归档”，随时能恢复"],
                  ["keep", "删掉对话，留下工作区", "", "对话没了；工作区的文件夹留着，之后在“同步记录”里能找到它"],
                  ["all", "全部删掉", "", "对话和工作区一起删除，不能恢复；有没进 Local 的改动时会再问一次"],
                ] as const
              ).map(([key, title, tag, note]) => (
                <label key={key} data-on={choice === key} data-danger={key === "all"}>
                  <input type="radio" name="delete-choice" checked={choice === key} onChange={() => setChoice(key)} />
                  <span>
                    <b>
                      {title}
                      {tag && <em>{tag}</em>}
                    </b>
                    <small>{note}</small>
                  </span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className={css.warn}>
              <IconWarn /> 这一路还有 {unsynced.length} 个文件的改动没进 Local，删除后就没了。
            </p>
            <ul className={css.files}>
              {unsynced.map((f) => (
                <li key={f.path}>
                  <span>{KIND[f.note] ?? f.note}</span>
                  <code>{f.path}</code>
                </li>
              ))}
            </ul>
          </>
        )}

        <footer>
          <button type="button" className={css.ghost} onClick={onCancel} autoFocus>
            取消
          </button>
          <button type="button" className={choice === "archive" && unsynced === null ? css.confirm : css.destroy} style={choice === "archive" && unsynced === null ? { background: "var(--text-1)" } : undefined} disabled={working} onClick={() => void confirm()}>
            {unsynced !== null ? "不要这些改动了，删除" : choice === "archive" ? "归档" : choice === "keep" ? "删掉对话" : "全部删掉"}
          </button>
        </footer>
      </div>
    </div>
  );
}
