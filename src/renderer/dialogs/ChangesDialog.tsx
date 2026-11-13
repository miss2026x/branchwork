import { useEffect } from "react";
import type { FileStat, Route } from "../../shared";
import { IconClose } from "../ui/icons";
import { Plate } from "../ui/Plate";
import css from "./Dialog.module.css";
import own from "./ChangesDialog.module.css";

interface Props {
  route: Route;
  /** 还在读时为 null */
  files: FileStat[] | null;
  onClose(): void;
}

const KIND: Record<FileStat["kind"], string> = { added: "新增", modified: "修改", deleted: "删除" };

/** “看改了什么”：这一路的工作区里还没进 Local 的改动。只列文件和增删的行数 */
export function ChangesDialog({ route, files, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const label = route.express ? `快${route.express}` : `${route.number}路`;
  const added = files?.reduce((n, f) => n + (f.added ?? 0), 0) ?? 0;
  const removed = files?.reduce((n, f) => n + (f.removed ?? 0), 0) ?? 0;

  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${css.dialog} ${css.wide}`} role="dialog" aria-modal aria-label={`${label} 改了什么`}>
        <header>
          <Plate route={route} />
          <h2 className="ell">「{route.name}」改了什么</h2>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <IconClose />
          </button>
        </header>
        <p className={css.sub}>这一路的工作区里还没进 Local 的改动。Local 里现在没有这些；这一路下一站正常到站后会一起带过去。</p>
        {files === null ? (
          <p className={own.empty}>正在看…</p>
        ) : files.length === 0 ? (
          <p className={own.empty}>没有。这一路的改动都已经进 Local 了。</p>
        ) : (
          <>
            <p className={own.total}>
              {files.length} 个文件 <b className={own.plus}>+{added}</b> <b className={own.minus}>−{removed}</b>
            </p>
            <ul className={own.files}>
              {files.map((f) => {
                const cut = f.path.lastIndexOf("/");
                return (
                  <li key={f.path} data-kind={f.kind}>
                    <span className={own.kind}>{KIND[f.kind]}</span>
                    <code title={f.path}>
                      {cut >= 0 && <i>{f.path.slice(0, cut + 1)}</i>}
                      {f.path.slice(cut + 1)}
                    </code>
                    {f.added === null ? (
                      <span className={own.binary}>二进制</span>
                    ) : (
                      <>
                        <b className={own.plus}>+{f.added}</b>
                        <b className={own.minus}>−{f.removed ?? 0}</b>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
