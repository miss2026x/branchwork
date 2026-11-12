import { useEffect, useState } from "react";
import type { Route, SyncFile } from "../../shared";
import { IconClose, IconWarn } from "../ui/icons";
import { Plate } from "../ui/Plate";
import css from "./Dialog.module.css";

interface Props {
  route: Route;
  stopCount: number;
  /** 第一次确认后发现还有没进 Local 的改动：这些文件 */
  unsynced: SyncFile[] | null;
  onCancel(): void;
  /** force：连没进 Local 的改动一起删 */
  onConfirm(force: boolean): Promise<void>;
}

const KIND: Record<string, string> = { added: "新增", modified: "修改", deleted: "删除" };

/** 删除一路。有没进 Local 的改动时要再确认一次 */
export function DeleteDialog({ route, stopCount, unsynced, onCancel, onConfirm }: Props) {
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const confirm = async () => {
    setWorking(true);
    await onConfirm(unsynced !== null);
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
          <p className={css.sub}>
            这一路的 {stopCount} 站对话记录和它的工作区会一起删除，不能恢复。已经进了 Local 的改动不受影响。只是想收起来的话，用“归档”。
          </p>
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
          <button type="button" className={css.destroy} disabled={working} onClick={() => void confirm()}>
            {unsynced === null ? "删除" : "不要这些改动了，删除"}
          </button>
        </footer>
      </div>
    </div>
  );
}
