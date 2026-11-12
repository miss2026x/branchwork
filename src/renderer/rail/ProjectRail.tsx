import { useState } from "react";
import type { Route } from "../../shared";
import { useStore } from "../stores/store";
import { IconChevron, IconMore, IconPlus, IconWarn } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import css from "./ProjectRail.module.css";

/** 左栏：项目和每个项目里的路 */
export function ProjectRail({ onDelete }: { onDelete(routeId: string): void }) {
  const archiveRoute = useStore((s) => s.archiveRoute);
  const unarchiveRoute = useStore((s) => s.unarchiveRoute);
  const [menuFor, setMenuFor] = useState<string | null>(null);
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

  return (
    <aside className={css.rail}>
      <div className={css.head}>
        <span>项目</span>
        <button title="添加项目" aria-label="添加项目" onClick={() => void addProject()}>
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
                  if (p.id === projectId) setClosed((c) => ({ ...c, [p.id]: open }));
                  else selectProject(p.id);
                }}
              >
                <IconChevron size={14} open={open} />
                <b className="ell">{p.name}</b>
                {!open && <small>{list.length} 路车</small>}
              </button>
              {open &&
                list.map((r) => (
                  <div key={r.id} className={css.row} aria-current={r.id === routeId} style={r.id === routeId ? { background: routeColors(r).tint } : undefined}>
                    <button className={css.route} onClick={() => selectRoute(r.id)}>
                      <Plate route={r} />
                      <span className={`ell ${css.label}`}>{r.name}</span>
                      <RouteBadge route={r} />
                    </button>
                    <button className={css.more} aria-label={`${r.name} 的更多操作`} aria-expanded={menuFor === r.id} onClick={() => setMenuFor(menuFor === r.id ? null : r.id)}>
                      <IconMore />
                    </button>
                    {menuFor === r.id && (
                      <>
                        <div className={css.backdrop} onClick={() => setMenuFor(null)} />
                        <div className={css.menu} role="menu">
                          <button
                            role="menuitem"
                            onClick={() => {
                              setMenuFor(null);
                              void archiveRoute(r.id);
                            }}
                          >
                            归档
                            <small>收起来，对话和改动都留着，随时恢复</small>
                          </button>
                          <button
                            role="menuitem"
                            className={css.danger}
                            onClick={() => {
                              setMenuFor(null);
                              onDelete(r.id);
                            }}
                          >
                            删除…
                            <small>对话记录和工作区一起删，不能恢复</small>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              {open && list.length === 0 && <p className={css.none}>还没有路</p>}
              {open && archived.length > 0 && (
                <>
                  <button className={css.archivedToggle} aria-expanded={!!showArchived[p.id]} onClick={() => setShowArchived((v) => ({ ...v, [p.id]: !v[p.id] }))}>
                    <IconChevron size={12} open={!!showArchived[p.id]} /> 已归档 {archived.length}
                  </button>
                  {showArchived[p.id] &&
                    archived.map((r) => (
                      <div key={r.id} className={css.archived}>
                        <span className="ell">
                          {r.number}路 · {r.name}
                        </span>
                        <button onClick={() => void unarchiveRoute(r.id)}>恢复</button>
                        <button className={css.danger} onClick={() => onDelete(r.id)}>
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

      <button className={css.newChat} disabled={!projectId} onClick={() => void createRoute()}>
        <IconPlus /> 新对话
      </button>
    </aside>
  );
}

function RouteBadge({ route }: { route: Route }) {
  if (route.status === "answering") return <i className={css.dot} style={{ background: routeColors(route).line }} title="回答中" />;
  if (route.status === "awaiting_permission") return <em className={css.amber}>等你批准</em>;
  if (route.status === "interrupted") return <em className={css.amber}>没答完</em>;
  if (route.status === "conflict")
    return (
      <em className={css.red}>
        <IconWarn size={12} /> 冲突
      </em>
    );
  return null;
}
