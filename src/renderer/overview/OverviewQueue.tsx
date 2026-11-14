import { useState, type FormEvent } from "react";
import type { Project, QueueItem, QueueMode, Route } from "../../shared";
import { Plate } from "../ui/Plate";
import css from "./OverviewQueue.module.css";

interface Props {
  projects: Project[];
  routes: Record<string, Route>;
  queue: Record<string, QueueItem[]>;
  /** 新放进来的问题归到哪个项目 */
  currentProjectId: string | null;
  onAdd(projectId: string, text: string): void;
  onAssign(itemId: string, routeId: string | null, mode: QueueMode): void;
  onBoard(itemId: string): void;
  onStartNew(itemId: string): void;
  onRemove(itemId: string): void;
}

const busy = (r: Route) => r.status === "answering" || r.status === "awaiting_permission";

/** “全部项目”页右边的候车区：所有项目候车的问题放在一起看，在这里就能派车、登车 */
export function OverviewQueue({ projects, routes, queue, currentProjectId, onAdd, onAssign, onBoard, onStartNew, onRemove }: Props) {
  const [text, setText] = useState("");
  /** 正在派车的那一条，以及选好的去向和方式 */
  const [dispatch, setDispatch] = useState<{ id: string; target: string | null; mode: "auto" | "manual" } | null>(null);
  const items = projects.flatMap((p) => queue[p.id] ?? []);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const several = projects.length > 1;
  const auto = items.filter((q) => q.routeId && q.mode === "auto");
  const manual = items.filter((q) => q.routeId && q.mode === "manual");
  const loose = items.filter((q) => !q.routeId);
  const target = currentProjectId ?? projects[0]?.id ?? null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !target) return;
    onAdd(target, text.trim());
    setText("");
  };

  const assigned = (q: QueueItem) => {
    const route = routes[q.routeId!];
    if (!route) return null;
    const ready = q.mode === "manual" && !busy(route) && route.status !== "conflict";
    const where = several ? `${names.get(q.projectId)} · ` : "";
    return (
      <div key={q.id} className={css.item} data-ready={ready}>
        <Plate route={route} />
        <div>
          <b>{q.text}</b>
          <span>
            {where}
            {ready ? `${route.name} 已到站，可以登车了` : busy(route) ? (q.mode === "auto" ? `${route.name} 回答中，答完自动发出` : `${route.name} 回答中，到站后等你点`) : q.mode === "auto" ? "马上发出" : `排在 ${route.name}`}
          </span>
        </div>
        {ready ? (
          <button className={css.board} onClick={() => onBoard(q.id)}>
            登车
          </button>
        ) : (
          <button className={css.x} aria-label="放回未派车" title="放回未派车" onClick={() => onAssign(q.id, null, "unassigned")}>
            ↩
          </button>
        )}
      </div>
    );
  };

  return (
    <aside className={css.panel} aria-label="候车区" data-ov>
      <header>
        <h2>候车区</h2>
        <i>{items.length}</i>
      </header>
      <p>准备好的问题。派给某一路后，等它答完当前这站再登车。</p>
      <div className={css.scroll}>
        {items.length === 0 && <p className={css.empty}>还没有候车的问题。想到什么先写在下面。</p>}
        {auto.length > 0 && (
          <>
            <h3>
              自动登车 <small>答完就发</small>
            </h3>
            {auto.map(assigned)}
          </>
        )}
        {manual.length > 0 && (
          <>
            <h3>
              到站后手动登车 <small>答完等你点</small>
            </h3>
            {manual.map(assigned)}
          </>
        )}
        {loose.length > 0 && (
          <>
            <h3>
              未派车 <small>先放着</small>
            </h3>
            {loose.map((q) => {
              const open = dispatch?.id === q.id;
              const choices = Object.values(routes)
                .filter((r) => r.projectId === q.projectId && r.status !== "archived")
                .sort((a, b) => a.number - b.number);
              return (
                <div key={q.id} className={css.loose} data-open={open}>
                  <div>
                    <b>{q.text}</b>
                    {!open && (
                      <>
                        <button onClick={() => setDispatch({ id: q.id, target: choices[0]?.id ?? null, mode: "manual" })}>派车</button>
                        <button className={css.x} aria-label="删除这个问题" onClick={() => onRemove(q.id)}>
                          ×
                        </button>
                      </>
                    )}
                  </div>
                  {several && !open && <span>{names.get(q.projectId)}</span>}
                  {open && dispatch && (
                    <>
                      <h4>派给哪一路</h4>
                      <div role="radiogroup" aria-label="派给哪一路">
                        {choices.map((r) => (
                          <label key={r.id} data-on={dispatch.target === r.id}>
                            <input type="radio" name={`to-${q.id}`} checked={dispatch.target === r.id} onChange={() => setDispatch({ ...dispatch, target: r.id })} />
                            <Plate route={r} />
                            <span className="ell">{r.name}</span>
                            <small>{busy(r) ? "回答中" : r.status === "conflict" ? "有冲突" : r.status === "interrupted" ? "没答完" : "空闲"}</small>
                          </label>
                        ))}
                        <label data-on={dispatch.target === null}>
                          <input type="radio" name={`to-${q.id}`} checked={dispatch.target === null} onChange={() => setDispatch({ ...dispatch, target: null })} />
                          <span className="ell">在 {names.get(q.projectId)} 开一路新车</span>
                        </label>
                      </div>
                      {dispatch.target !== null && (
                        <div className={css.modes} role="radiogroup" aria-label="怎么登车">
                          <button role="radio" aria-checked={dispatch.mode === "auto"} onClick={() => setDispatch({ ...dispatch, mode: "auto" })}>
                            自动登车
                          </button>
                          <button role="radio" aria-checked={dispatch.mode === "manual"} onClick={() => setDispatch({ ...dispatch, mode: "manual" })}>
                            到站后手动登车
                          </button>
                        </div>
                      )}
                      <footer>
                        <button onClick={() => setDispatch(null)}>先不派</button>
                        <button
                          className={css.go}
                          onClick={() => {
                            if (dispatch.target === null) onStartNew(q.id);
                            else onAssign(q.id, dispatch.target, dispatch.mode);
                            setDispatch(null);
                          }}
                        >
                          {dispatch.target === null ? "开新车" : "派车"}
                        </button>
                      </footer>
                    </>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
      <form onSubmit={submit}>
        <span>放一条进来{several && target ? `（进 ${names.get(target)}）` : ""}</span>
        <div>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="写个问题，先放着" aria-label="写个问题，先放着" disabled={!target} />
          <button type="submit" disabled={!text.trim() || !target}>
            放进来
          </button>
        </div>
      </form>
    </aside>
  );
}
