import { useState } from "react";
import type { Route } from "../../shared";
import { useStore } from "../stores/store";
import { IconChevron, IconPlus, IconWarn } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import css from "./ProjectRail.module.css";

/** 左栏：项目和每个项目里的路 */
export function ProjectRail() {
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
          const list = Object.values(routes)
            .filter((r) => r.projectId === p.id && r.status !== "archived")
            .sort((a, b) => a.number - b.number);
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
                  <button key={r.id} className={css.route} aria-current={r.id === routeId} style={r.id === routeId ? { background: routeColors(r).tint } : undefined} onClick={() => selectRoute(r.id)}>
                    <Plate route={r} />
                    <span className={`ell ${css.label}`}>{r.name}</span>
                    <RouteBadge route={r} />
                  </button>
                ))}
              {open && list.length === 0 && <p className={css.none}>还没有路</p>}
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
