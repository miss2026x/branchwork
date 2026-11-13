import { useEffect, useState, type FormEvent } from "react";
import type { DirectoryInfo } from "../../shared";
import { IconClose } from "../ui/icons";
import css from "./Dialog.module.css";
import own from "./Extra.module.css";

interface Props {
  /** 一开始选好的文件夹 */
  dir: string;
  /** 让用户另选一个文件夹；取消返回 null */
  onPick(): Promise<string | null>;
  onInspect(dir: string): Promise<DirectoryInfo>;
  onAdd(dir: string, name: string): void;
  onCancel(): void;
}

/** “添加项目”：看一眼选的文件夹能不能用，起个名字，加进来 */
export function AddProjectDialog({ dir: initial, onPick, onInspect, onAdd, onCancel }: Props) {
  const [dir, setDir] = useState(initial);
  const [info, setInfo] = useState<DirectoryInfo | null>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    let alive = true;
    setInfo(null);
    const t = setTimeout(() => {
      void onInspect(dir).then((i) => {
        if (!alive) return;
        setInfo(i);
        setName((n) => n || i.name);
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const ok = !!info && info.isRepo && !info.projectId;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok) onAdd(dir, name);
  };
  const check = (good: boolean, text: React.ReactNode) => (
    <li data-ok={good}>
      <i>{good ? "✓" : "!"}</i>
      <span>{text}</span>
    </li>
  );

  return (
    <div className={css.scrim}>
      <form className={css.dialog} role="dialog" aria-modal aria-label="添加项目" onSubmit={submit}>
        <header>
          <h2>添加项目</h2>
          <button type="button" aria-label="关闭" onClick={onCancel}>
            <IconClose />
          </button>
        </header>
        <label className={css.field}>
          <span>文件夹</span>
          <div className={own.dirRow}>
            <input className={own.mono} value={dir} onChange={(e) => setDir(e.target.value)} spellCheck={false} aria-label="文件夹" />
            <button
              type="button"
              onClick={() =>
                void onPick().then((d) => {
                  if (!d) return;
                  setName("");
                  setDir(d);
                })
              }
            >
              选择…
            </button>
          </div>
        </label>
        <ul className={own.checks} aria-live="polite">
          {!info && <li data-ok="wait">正在看这个文件夹…</li>}
          {info && !info.exists && check(false, "找不到这个文件夹")}
          {info?.exists && !info.isRepo && check(false, "这不是一个有提交记录的 git 仓库。Branchwork 靠 git 给每一路建独立的工作区，先在这个文件夹里提交一次再来。")}
          {info?.isRepo &&
            check(
              true,
              <>
                git 仓库{info.branch ? (
                  <>
                    ，当前在 <code>{info.branch}</code>
                  </>
                ) : (
                  "，当前不在任何分支上"
                )}
                ，{info.dirty === 0 ? "没有未提交的改动" : `有 ${info.dirty} 个文件的改动没提交（不影响使用，各路会带上它们）`}
              </>,
            )}
          {info?.isRepo && (info.hasClaudeMd ? check(true, "找到 CLAUDE.md，每一路都会带上") : <li data-ok="info"><i>·</i><span>没有 CLAUDE.md（可以没有）</span></li>)}
          {info?.projectId && check(false, "这个文件夹已经是一个项目了")}
        </ul>
        <label className={css.field}>
          <span>项目名称</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="项目名称" />
        </label>
        <footer>
          <button type="button" className={css.ghost} onClick={onCancel}>
            取消
          </button>
          <button type="submit" className={css.confirm} style={{ background: "var(--text-1)" }} disabled={!ok}>
            添加
          </button>
        </footer>
      </form>
    </div>
  );
}
