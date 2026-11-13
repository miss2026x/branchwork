import { useState } from "react";
import type { Route } from "../../shared";
import { useStore } from "../stores/store";
import { IconChevron, IconMore, IconPlus, IconWarn } from "../ui/icons";
import { RouteMenu } from "./RouteMenu";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import css from "./ProjectRail.module.css";

/** 左栏：项目和每个项目里的路 */
export function ProjectRail({
  onDelete,
  compact = false,
}: {
  onDelete(routeId: string): void;
  /** 窗口窄：收成一列图标，点项目图标展开成浮层 */ compact?: boolean;
}) {
  const [floating, setFloating] = useState(false);
  const archiveRoute = useStore((s) => s.archiveRoute);
  const renameRoute = useStore((s) => s.renameRoute);
  const setRouteColor = useStore((s) => s.setRouteColor);
  const stops = useStore((s) => s.stops);
  const unarchiveRoute = useStore((s) => s.unarchiveRoute);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState({ top: 0, left: 0 });
  const [showArchived, setShowArchived] = useState<Record<string, boolean>>({});
  const projects = useStore((s) => s.projects);
  const routes = useStore((s) => s.routes);
  const projectId = useStore((s) => s.selectedProjectId);
  const routeId = useStore((s) => s.selectedRouteId);
  const selectProject = useStore((s) => s.selectProject);
  const selectRoute = useStore((s) => s.selectRoute);
  const addProject = useStore((s) => s.addProject);
  const createRoute = useStore((s) => s.createRoute);
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const strip = compact && (
    <aside className={css.strip} aria-label="项目和线路">
      <div className={css.stripList}>
        {projects.map((p) => {
          const list = Object.values(routes)
            .filter((r) => r.projectId === p.id && r.status !== "archived")
            .sort((a, b) => a.number - b.number);
          return (
            <section key={p.id}>
              <button
                className={css.avatar}
                aria-current={p.id === projectId}
                title={`${p.name}（点开看全部）`}
                aria-label={`展开项目栏：${p.name}`}
                onClick={() =>
                  p.id === projectId ? setFloating(true) : selectProject(p.id)
                }
              >
                {[...p.name][0]?.toUpperCase()}
              </button>
              {p.id === projectId &&
                list.map((r) => (
                  <button
                    key={r.id}
                    className={css.chip}
                    aria-current={r.id === routeId}
                    title={r.name}
                    aria-label={r.name}
                    style={
                      r.id === routeId
                        ? { background: routeColors(r).tint }
                        : undefined
                    }
                    onClick={() => selectRoute(r.id)}
                  >
                    <Plate route={r} />
                    {r.status === "conflict" ? (
                      <i className={css.pipRed} />
                    ) : r.status === "interrupted" ||
                      r.status === "awaiting_permission" ? (
                      <i className={css.pipAmber} />
                    ) : r.status === "answering" ? (
                      <i
                        className={css.pip}
                        style={{ background: routeColors(r).line }}
                      />
                    ) : null}
                  </button>
                ))}
            </section>
          );
        })}
      </div>
      <button
        className={css.stripNew}
        disabled={!projectId}
        title="新对话"
        aria-label="新对话"
        onClick={() => void createRoute()}
      >
        <IconPlus />
      </button>
    </aside>
  );
  if (compact && !floating) return strip;

  return (
    <>
      {strip}
      {compact && (
        <div className={css.floatBackdrop} onClick={() => setFloating(false)} />
      )}
      <aside className={compact ? `${css.rail} ${css.floating}` : css.rail}>
        <div className={css.head}>
          <span>项目</span>
          <button
            title="添加项目"
            aria-label="添加项目"
            onClick={() => void addProject()}
          >
            <IconPlus />
          </button>
        </div>

        <div className={css.list}>
          {projects.map((p) => {
            const mine = Object.values(routes)
              .filter((r) => r.projectId === p.id)
              .sort((a, b) => a.number - b.number);
            const list = mine.filter((r) => r.status !== "archived");
            const archived = mine.filter((r) => r.status === "archived");
            const open = !closed[p.id];
            return (
              <section key={p.id}>
                <button
                  className={css.project}
                  aria-expanded={open}
                  onClick={() => {
                    if (p.id === projectId)
                      setClosed((c) => ({ ...c, [p.id]: open }));
                    else selectProject(p.id);
                  }}
                >
                  <IconChevron size={14} open={open} />
                  <b className="ell">{p.name}</b>
                  {!open && <small>{list.length} 路车</small>}
                </button>
                {open &&
                  list.map((r) => (
                    <div
                      key={r.id}
                      className={css.row}
                      aria-current={r.id === routeId}
                      style={
                        r.id === routeId
                          ? { background: routeColors(r).tint }
                          : undefined
                      }
                    >
                      <button
                        className={css.route}
                        onClick={() => selectRoute(r.id)}
                      >
                        <Plate route={r} />
                        <span className={`ell ${css.label}`}>{r.name}</span>
                        <RouteBadge route={r} />
                      </button>
                      <button
                        className={css.more}
                        aria-label={`${r.name} 的更多操作`}
                        aria-expanded={menuFor === r.id}
                        onClick={(e) => {
                          const box = e.currentTarget.getBoundingClientRect();
                          setMenuAt({ top: box.bottom + 4, left: Math.max(8, box.right - 240) });
                          setMenuFor(menuFor === r.id ? null : r.id);
                        }}
                      >
                        <IconMore />
                      </button>
                      {menuFor === r.id && (
                        <RouteMenu
                          route={r}
                          stopCount={Object.values(stops).filter((x) => x.routeId === r.id && x.kind !== "summary").length}
                          syncNote={r.status === "conflict" ? "有改动没法自动合进 Local，等你处理" : r.status === "interrupted" ? "上一站没答完，改动留在工作区，没进 Local" : r.status === "answering" || r.status === "awaiting_permission" ? "正在回答，答完后改动同步进 Local" : "自己的工作区，改动都已进 Local"}
                          syncTone={r.status === "conflict" || r.status === "interrupted" ? "warn" : "ok"}
                          onRename={(name) => void renameRoute(r.id, name)}
                          onColor={(color) => void setRouteColor(r.id, color)}
                          onArchive={() => void archiveRoute(r.id)}
                          onDelete={() => onDelete(r.id)}
                          onClose={() => setMenuFor(null)}
                          at={menuAt}
                        />
                      )}
                    </div>
                  ))}
                {open && list.length === 0 && (
                  <p className={css.none}>还没有路</p>
                )}
                {open && archived.length > 0 && (
                  <>
                    <button
                      className={css.archivedToggle}
                      aria-expanded={!!showArchived[p.id]}
                      onClick={() =>
                        setShowArchived((v) => ({ ...v, [p.id]: !v[p.id] }))
                      }
                    >
                      <IconChevron size={12} open={!!showArchived[p.id]} />{" "}
                      已归档 {archived.length}
                    </button>
                    {showArchived[p.id] &&
                      archived.map((r) => (
                        <div key={r.id} className={css.archived}>
                          <span className="ell">
                            {r.number}路 · {r.name}
                          </span>
                          <button onClick={() => void unarchiveRoute(r.id)}>
                            恢复
                          </button>
                          <button
                            className={css.danger}
                            onClick={() => onDelete(r.id)}
                          >
                            删除
                          </button>
                        </div>
                      ))}
                  </>
                )}
              </section>
            );
          })}
        </div>

        <button
          className={css.newChat}
          disabled={!projectId}
          onClick={() => void createRoute()}
        >
          <IconPlus /> 新对话
        </button>
      </aside>
    </>
  );
}

function RouteBadge({ route }: { route: Route }) {
  if (route.status === "answering")
    return (
      <i
        className={css.dot}
        style={{ background: routeColors(route).line }}
        title="回答中"
      />
    );
  if (route.status === "awaiting_permission")
    return <em className={css.amber}>等你批准</em>;
  if (route.status === "interrupted")
    return <em className={css.amber}>没答完</em>;
  if (route.status === "conflict")
    return (
      <em className={css.red}>
        <IconWarn size={12} /> 冲突
      </em>
    );
  return null;
}
