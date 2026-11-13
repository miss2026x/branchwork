import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { QueueItem, QueueMode, Route } from "../../shared";
import { IconClose, IconMore, IconWait } from "../ui/icons";
import { Plate } from "../ui/Plate";
import css from "./WaitingArea.module.css";

interface Props {
  items: QueueItem[];
  /** 这个项目里没归档的路 */
  routes: Route[];
  onAdd(text: string): void;
  onAssign(itemId: string, routeId: string | null, mode?: QueueMode): void;
  onRemove(itemId: string): void;
  onBoard(itemId: string): void;
  onStartNew(itemId: string): void;
  /** 每次变化就把浮窗打开（从搜索跳过来时用） */
  openSignal?: number;
}

const busy = (r: Route) => r.status === "answering" || r.status === "awaiting_permission";
const canBoard = (r: Route) => r.status === "idle" || r.status === "interrupted";

/** 候车区：准备好的问题先放着。右上角一个按钮，点开是浮窗。只收数据、发出操作 */
export function WaitingArea({ items, routes, onAdd, onAssign, onRemove, onBoard, onStartNew, openSignal = 0 }: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);
  const [text, setText] = useState("");
  /** 哪个问题正展开着“派给谁”或“更多操作” */
  const [expanded, setExpanded] = useState<string | null>(null);
  const byId = new Map(routes.map((r) => [r.id, r]));

  const groups = { ready: [] as QueueItem[], auto: [] as QueueItem[], manual: [] as QueueItem[], none: [] as QueueItem[] };
  for (const it of items) {
    const route = it.routeId ? byId.get(it.routeId) : undefined;
    if (!route) groups.none.push(it);
    else if (it.mode === "manual" && canBoard(route)) groups.ready.push(it);
    else if (it.mode === "manual") groups.manual.push(it);
    else groups.auto.push(it);
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd(text);
    setText("");
  };

  const row = (it: QueueItem, sub: string, action?: ReactNode) => {
    const route = it.routeId ? byId.get(it.routeId) : undefined;
    return (
      <li key={it.id} className={css.item} data-kind={route ? "assigned" : "none"}>
        <div className={css.line}>
          {route && <Plate route={route} />}
          <div className={css.text}>
            <b title={it.text}>{it.text}</b>
            {sub && <span>{sub}</span>}
          </div>
          {action}
          <button className={css.icon} aria-label={`「${it.text}」的更多操作`} aria-expanded={expanded === it.id} onClick={() => setExpanded(expanded === it.id ? null : it.id)}>
            <IconMore />
          </button>
        </div>
        {expanded === it.id && (
          <div className={css.more}>
            <p>派给哪一路</p>
            {routes.map((r) => (
              <div key={r.id} className={css.target} aria-current={r.id === it.routeId}>
                <Plate route={r} />
                <span className="ell">{r.name}</span>
                <button
                  aria-pressed={r.id === it.routeId && it.mode === "auto"}
                  title="那一路正常到站后自动发出"
                  onClick={() => {
                    onAssign(it.id, r.id, "auto");
                    setExpanded(null);
                  }}
                >
                  自动登车
                </button>
                <button
                  aria-pressed={r.id === it.routeId && it.mode === "manual"}
                  title="到站后等你点“登车”"
                  onClick={() => {
                    onAssign(it.id, r.id, "manual");
                    setExpanded(null);
                  }}
                >
                  手动登车
                </button>
              </div>
            ))}
            <div className={css.moreActions}>
              {route && (
                <button
                  onClick={() => {
                    onAssign(it.id, null);
                    setExpanded(null);
                  }}
                >
                  撤回到未派车
                </button>
              )}
              <button
                className={css.danger}
                onClick={() => {
                  onRemove(it.id);
                  setExpanded(null);
                }}
              >
                删除这个问题
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

  const autoNote = (it: QueueItem) => {
    const r = byId.get(it.routeId!)!;
    if (busy(r)) return "这一站正常答完就自动发";
    if (r.status === "interrupted") return "上一站没答完，不会自动发";
    if (r.status === "conflict") return "这一路有冲突，解决后才会发";
    return "马上发出";
  };

  /** 手动登车、那一路已经到站的：现在就能登车 */
  const ready = items.filter((it) => it.mode === "manual" && it.routeId && byId.get(it.routeId) && !busy(byId.get(it.routeId)!)).length;
  const unassigned = items.filter((it) => !it.routeId).length;

  return (
    <div className={css.wrap}>
      <button className={css.fab} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? (
          <IconClose size={14} />
        ) : (
          <span className={css.fabIcon} data-alert={ready > 0}>
            <IconWait size={16} />
          </span>
        )}
        <span className={css.fabText}>
          候车 {items.length}
          {!open && items.length > 0 && <small>{ready > 0 ? `${ready} 条可以登车了` : unassigned > 0 && unassigned === items.length ? `${unassigned} 条还没派车` : "到站后发出"}</small>}
        </span>
      </button>

      {open && (
        <section className={css.panel} aria-label="候车区">
          <header>
            <h2>候车区</h2>
            <span>准备好的问题先放着，按去向分组</span>
          </header>

          <div className={css.scroll}>
            {items.length === 0 && <p className={css.empty}>还没有候车的问题。想到什么先写在下面，不用等当前这一站答完。</p>}

            {groups.ready.length > 0 && (
              <>
                <h3 data-tone="go">可以登车了</h3>
                <ul>
                  {groups.ready.map((it) =>
                    row(
                      it,
                      `${byId.get(it.routeId!)!.name} 已到站`,
                      <button className={css.board} onClick={() => onBoard(it.id)}>
                        登车
                      </button>,
                    ),
                  )}
                </ul>
              </>
            )}
            {groups.auto.length > 0 && (
              <>
                <h3 data-tone="auto">自动登车</h3>
                <ul>
                  {groups.auto.map((it) =>
                    row(
                      it,
                      autoNote(it),
                      byId.get(it.routeId!)!.status === "interrupted" ? (
                        <button className={css.small} onClick={() => onBoard(it.id)}>
                          现在发
                        </button>
                      ) : undefined,
                    ),
                  )}
                </ul>
              </>
            )}
            {groups.manual.length > 0 && (
              <>
                <h3>到站后等你登车</h3>
                <ul>{groups.manual.map((it) => row(it, byId.get(it.routeId!)!.status === "conflict" ? "这一路有冲突，解决后才能登车" : "这一路还在路上"))}</ul>
              </>
            )}
            {groups.none.length > 0 && (
              <>
                <h3>未派车</h3>
                <ul>
                  {groups.none.map((it) =>
                    row(
                      it,
                      "",
                      <>
                        <button className={css.small} onClick={() => onStartNew(it.id)} title="为它新开一路并发出">
                          开新车
                        </button>
                        <button className={css.small} onClick={() => setExpanded(expanded === it.id ? null : it.id)}>
                          派车
                        </button>
                      </>,
                    ),
                  )}
                </ul>
              </>
            )}
          </div>

          <form className={css.add} onSubmit={submit}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="写个问题，先放着" aria-label="放一个问题进候车区" />
            <button type="submit" disabled={!text.trim()}>
              放进来
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
