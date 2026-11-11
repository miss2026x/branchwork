import { useEffect } from "react";
import { ChatPanel } from "../chat/ChatPanel";
import { RouteMap } from "../map/RouteMap";
import { ProjectRail } from "../rail/ProjectRail";
import { useRoutes, useStops, useStore } from "../stores/store";
import { BusMark, IconFolder } from "../ui/icons";
import { Plate } from "../ui/Plate";
import css from "./App.module.css";

export function App() {
  const init = useStore((s) => s.init);
  const ready = useStore((s) => s.ready);
  const projects = useStore((s) => s.projects);
  const projectId = useStore((s) => s.selectedProjectId);
  const routeId = useStore((s) => s.selectedRouteId);
  const route = useStore((s) => (routeId ? s.routes[routeId] : undefined));
  const allStops = useStore((s) => s.stops);
  const selectRoute = useStore((s) => s.selectRoute);
  const addProject = useStore((s) => s.addProject);
  const createRoute = useStore((s) => s.createRoute);
  const error = useStore((s) => s.error);
  const dismissError = useStore((s) => s.dismissError);
  const routes = useRoutes(projectId);
  const stops = useStops(routeId);
  const project = projects.find((p) => p.id === projectId);

  useEffect(() => {
    void init();
  }, [init]);

  const projectStops = Object.values(allStops).filter((s) => routes.some((r) => r.id === s.routeId));

  return (
    <div className={css.app}>
      <header className={css.top}>
        <div className={css.brand}>
          <BusMark />
          <b>Branchwork</b>
        </div>
        <nav className={css.crumbs} aria-label="位置">
          <span>全部项目</span>
          {project && (
            <>
              <i>›</i>
              <span className="ell">{project.name}</span>
            </>
          )}
          {route && (
            <>
              <i>›</i>
              <Plate route={route} />
              <b className="ell">{route.name}</b>
            </>
          )}
        </nav>
      </header>

      <div className={css.body}>
        <ProjectRail />

        <main className={css.center}>
          {!ready ? null : projects.length === 0 ? (
            <div className={css.empty}>
              <BusMark size={56} />
              <h1>先加一个项目</h1>
              <p>选一个有提交记录的 git 仓库目录。Branchwork 会把它当作 Local：你真正运行代码的地方。每条对话在自己的工作区里改，到站后再把改动带回这里。</p>
              <button className={css.primary} onClick={() => void addProject()}>
                <IconFolder /> 选择项目目录
              </button>
            </div>
          ) : routes.length === 0 ? (
            <div className={css.empty}>
              <BusMark size={56} />
              <h1>开出第一路</h1>
              <p>一路就是一条和 Claude 的对话，每问一次是一站。</p>
              <button className={css.primary} onClick={() => void createRoute()}>
                新对话
              </button>
            </div>
          ) : (
            <RouteMap routes={routes} stops={projectStops} selectedRouteId={routeId} onSelectRoute={selectRoute} />
          )}
        </main>

        {route && <ChatPanel key={route.id} route={route} stops={stops} />}
      </div>

      {error && (
        <div className={css.toast} role="alert">
          <span>{error}</span>
          <button onClick={dismissError}>知道了</button>
        </div>
      )}
    </div>
  );
}
