import { useEffect, useState, type FormEvent } from "react";
import type { DirectoryInfo, Project, TerminalSession } from "../../shared";
import { IconClose } from "../ui/icons";
import css from "./Dialog.module.css";
import own from "./Extra.module.css";

interface Props {
  /** 一开始选好的文件夹 */
  dir: string;
  /** 让用户另选一个文件夹；取消返回 null */
  onPick(): Promise<string | null>;
  onInspect(dir: string): Promise<DirectoryInfo>;
  /** 这个文件夹下在终端里开过的会话 */
  loadSessions(dir: string): Promise<TerminalSession[]>;
  /** importIds：勾了要一起导入的会话 */
  onAdd(dir: string, name: string, importIds: string[]): void;
  onCancel(): void;
}

/** 多久以前：今天 / 昨天 / N 天前 / 上周 / 上个月 / 更早 */
function ago(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  if (days < 14) return "上周";
  if (days < 31) return `${Math.floor(days / 7)} 周前`;
  if (days < 62) return "上个月";
  return `${Math.floor(days / 30)} 个月前`;
}

/** 可以勾选的会话列表 */
function SessionList({ sessions, picked, onToggle }: { sessions: TerminalSession[]; picked: string[]; onToggle(id: string): void }) {
  return (
    <ul className={own.sessions}>
      {sessions.map((s) => (
        <li key={s.id}>
          <label>
            <input type="checkbox" checked={picked.includes(s.id)} onChange={() => onToggle(s.id)} />
            <span className="ell">{s.title}</span>
            <small>
              {s.questions} 问 · {ago(s.lastModified)}
            </small>
          </label>
        </li>
      ))}
    </ul>
  );
}

/** 项目菜单里的“导入终端里的会话” */
export function ImportDialog({ project, load, onImport, onCancel }: { project: Project; load(dir: string): Promise<TerminalSession[]>; onImport(ids: string[]): void; onCancel(): void }) {
  const [sessions, setSessions] = useState<TerminalSession[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void load(project.localDir).then(setSessions, () => setSessions([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={css.scrim}>
      <div className={css.dialog} role="dialog" aria-modal aria-label="导入终端里的会话">
        <header>
          <h2>导入终端里的会话</h2>
          <button type="button" aria-label="关闭" onClick={onCancel}>
            <IconClose />
          </button>
        </header>
        <p className={css.sub}>在 {project.name} 的文件夹下用 claude 命令开过的会话。导入后每个会话画成一路，里面每个提问是一站；终端里原来的会话不动。</p>
        <div className={own.importBox}>
          {!sessions && <p>正在找…</p>}
          {sessions?.length === 0 && <p>没有找到可以导入的会话。</p>}
          {sessions && sessions.length > 0 && <SessionList sessions={sessions} picked={picked} onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />}
        </div>
        <footer>
          <button type="button" className={css.ghost} onClick={onCancel}>
            取消
          </button>
          <button type="button" className={css.confirm} style={{ background: "var(--text-1)" }} disabled={picked.length === 0 || busy} onClick={() => (setBusy(true), onImport(picked))}>
            {busy ? "导入中…" : picked.length > 0 ? `导入 ${picked.length} 个` : "导入"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** “添加项目”：看一眼选的文件夹能不能用，起个名字，加进来 */
export function AddProjectDialog({ dir: initial, onPick, onInspect, loadSessions, onAdd, onCancel }: Props) {
  const [dir, setDir] = useState(initial);
  const [info, setInfo] = useState<DirectoryInfo | null>(null);
  const [name, setName] = useState("");
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    setInfo(null);
    setSessions([]);
    setPicked([]);
    const t = setTimeout(() => {
      void onInspect(dir).then((i) => {
        if (!alive) return;
        setInfo(i);
        setName((n) => n || i.name);
        if (i.isRepo && !i.projectId) void loadSessions(i.dir).then((list) => alive && setSessions(list), () => {});
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
    if (ok) onAdd(dir, name, picked);
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
        {ok && sessions.length > 0 && (
          <div className={own.importBox}>
            <b>
              导入终端里开过的会话 <em>可选</em>
            </b>
            <p>在这个文件夹下找到 {sessions.length} 个用 claude 命令开过的会话，导入后会画成线路</p>
            <SessionList sessions={sessions} picked={picked} onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />
          </div>
        )}
        <footer>
          {ok && sessions.length > 0 && <span className={css.ask}>不导入也行，之后可以在项目菜单里再导入</span>}
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
