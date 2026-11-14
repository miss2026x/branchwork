import { useEffect, useState } from "react";
import type { KeptWorktree, Project, Route, Stop, SyncLogEntry } from "../../shared";
import { IconClose, IconWarn } from "../ui/icons";
import { Plate } from "../ui/Plate";
import css from "./Dialog.module.css";
import own from "./Extra.module.css";

interface Props {
  project: Project;
  /** 还在读时为 null */
  entries: SyncLogEntry[] | null;
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
  stopNumber(stop: Stop): number;
  /** 删掉对话时留下来的工作区 */
  kept: KeptWorktree[];
  onOpenKept(id: string): void;
  onRemoveKept(id: string): void;
  onViewRoute(routeId: string): void;
  onClose(): void;
}

const time = (at: number) => new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
const day = (at: number) => new Date(at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });

/** Local 同步记录：哪一路哪一站把哪些文件带进了 Local，哪一路从 Local 拿了更新，哪次冲突了 */
export function SyncLogDialog({ project, entries, routes, stops, stopNumber, kept, onOpenKept, onRemoveKept, onViewRoute, onClose }: Props) {
  const [filter, setFilter] = useState<"all" | "conflict" | string>("all");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // 什么都没发生的同步（没有文件要带）不列出来
  const shown = (entries ?? []).filter((e) => e.status !== "noop" && routes[e.routeId] && (filter === "all" || (filter === "conflict" ? e.status === "conflict" : e.routeId === filter)));
  const involved = [...new Set((entries ?? []).filter((e) => e.status !== "noop").map((e) => e.routeId))].map((id) => routes[id]).filter((r): r is Route => !!r);
  const today = day(Date.now());

  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${css.dialog} ${css.wide}`} role="dialog" aria-modal aria-label="Local 同步记录">
        <header>
          <h2>Local 同步记录</h2>
          <code className={`ell ${own.path}`} title={project.localDir}>
            {project.localDir}
          </code>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <IconClose />
          </button>
        </header>
        <div className={own.filters} role="radiogroup" aria-label="筛选">
          <button role="radio" aria-checked={filter === "all"} onClick={() => setFilter("all")}>
            全部
          </button>
          <button role="radio" aria-checked={filter === "conflict"} onClick={() => setFilter("conflict")}>
            只看冲突
          </button>
          {involved.map((r) => (
            <button key={r.id} role="radio" aria-checked={filter === r.id} onClick={() => setFilter(r.id)}>
              {r.express ? `快${r.express}` : `${r.number}路`}
            </button>
          ))}
        </div>
        <ul className={own.log}>
          {entries === null && <li className={own.empty}>正在读…</li>}
          {entries !== null && shown.length === 0 && <li className={own.empty}>{filter === "all" ? "还没有同步记录。每一站正常答完，改动进 Local 时会记在这里。" : "没有符合的记录。"}</li>}
          {shown.map((e) => {
            const route = routes[e.routeId]!;
            const stop = e.stopId ? stops[e.stopId] : undefined;
            const n = e.files.length;
            return (
              <li key={e.id} data-status={e.status}>
                <time title={new Date(e.at).toLocaleString("zh-CN")}>
                  {day(e.at) !== today && `${day(e.at)} `}
                  {time(e.at)}
                </time>
                <i>{e.status === "conflict" ? <IconWarn size={14} /> : e.direction === "pull" ? "↓" : ""}</i>
                <div>
                  <p>
                    <Plate route={route} /> {stop ? `第 ${stopNumber(stop)} 站` : ""}
                    {e.status === "error" ? (
                      <b> 同步出错：{e.message}</b>
                    ) : e.direction === "pull" ? (
                      <> 开始前 从 Local 拿到 {n} 个文件的更新</>
                    ) : e.status === "conflict" ? (
                      <>
                        {" "}
                        有 <b>{n} 个文件和 Local 冲突</b>，没进 Local
                      </>
                    ) : (
                      <> {n} 个文件进了 Local</>
                    )}
                  </p>
                  {n > 0 && (
                    <pre>
                      {e.files
                        .slice(0, 6)
                        .map((f) => f.path)
                        .join("\n")}
                      {n > 6 ? `\n……还有 ${n - 6} 个` : ""}
                    </pre>
                  )}
                  {e.status === "conflict" && (
                    <button className={own.see} onClick={() => (onClose(), onViewRoute(route.id))}>
                      查看冲突
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {kept.length > 0 && (
          <section className={own.kept} aria-label="留下的工作区">
            <h3>留下的工作区</h3>
            <p>删掉对话时选了“留下工作区”的在这里。它们不会再同步进 Local。</p>
            <ul>
              {kept.map((k) => (
                <li key={k.id}>
                  <span>
                    <b className="ell">{k.label}</b>
                    <code className="ell" title={k.path}>
                      {k.path}
                    </code>
                  </span>
                  <button onClick={() => onOpenKept(k.id)}>打开文件夹</button>
                  <button onClick={() => onRemoveKept(k.id)}>删掉</button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className={own.logNote}>截线删掉的站，记录还在；删掉一整路时，它的同步记录会一起删掉。</p>
      </div>
    </div>
  );
}
