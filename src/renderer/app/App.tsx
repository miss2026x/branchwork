import { useEffect, useRef, useState } from "react";
import type { Stop, SyncFile } from "../../shared";
import { CompressDialog } from "../dialogs/CompressDialog";
import { DeleteDialog } from "../dialogs/DeleteDialog";
import { ForkDialog } from "../dialogs/ForkDialog";
import { stopOffset } from "../stores/numbering";
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
  const allRoutes = useStore((s) => s.routes);
  const fork = useStore((s) => s.fork);
  const setPermissionMode = useStore((s) => s.setPermissionMode);
  const [forkFrom, setForkFrom] = useState<Stop | null>(null);
  const deleteRoute = useStore((s) => s.deleteRoute);
  const distill = useStore((s) => s.distill);
  const cancelDistill = useStore((s) => s.cancelDistill);
  const createExpress = useStore((s) => s.createExpress);
  const [compressFrom, setCompressFrom] = useState<Stop | null>(null);
  /** 提炼好但还没用掉的摘要，按站记着：弹窗关了再打开还在 */
  const summaries = useRef(new Map<string, string>());
  const [deleting, setDeleting] = useState<{ routeId: string; unsynced: SyncFile[] | null } | null>(null);
  const stopNumber = (stop: Stop) => stopOffset(allRoutes[stop.routeId], allRoutes, allStops) + stop.seq;

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
        <ProjectRail onDelete={(id) => setDeleting({ routeId: id, unsynced: null })} />

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
            <RouteMap routes={routes} stops={projectStops} selectedRouteId={routeId} onSelectRoute={selectRoute} stopNumber={stopNumber} onFork={setForkFrom} onCompress={setCompressFrom} />
          )}
        </main>

        {route && <ChatPanel key={route.id} route={route} stops={stops} offset={stopOffset(route, allRoutes, allStops)} parent={route.parentRouteId ? allRoutes[route.parentRouteId] : undefined} onGoToRoute={selectRoute} permissionMode={project?.permissionMode ?? "ask"} projectName={project?.name ?? ""} onPermissionMode={(mode) => project && void setPermissionMode(project.id, mode)} />}
      </div>

      {deleting && allRoutes[deleting.routeId] && (
        <DeleteDialog
          route={allRoutes[deleting.routeId]!}
          stopCount={Object.values(allStops).filter((s) => s.routeId === deleting.routeId).length}
          unsynced={deleting.unsynced}
          onCancel={() => setDeleting(null)}
          onConfirm={async (force) => {
            const left = await deleteRoute(deleting.routeId, force);
            setDeleting(left ? { routeId: deleting.routeId, unsynced: left } : null);
          }}
        />
      )}

      {compressFrom && allRoutes[compressFrom.routeId] && (
        <CompressDialog
          source={allRoutes[compressFrom.routeId]!}
          stop={compressFrom}
          stopNumber={stopNumber(compressFrom)}
          nextExpress={Math.max(0, ...Object.values(allRoutes).filter((r) => r.projectId === allRoutes[compressFrom.routeId]!.projectId).map((r) => r.express ?? 0)) + 1}
          distill={(keep) => distill(compressFrom.routeId, compressFrom.id, keep)}
          cancelDistill={() => cancelDistill(compressFrom.routeId)}
          onClose={() => setCompressFrom(null)}
          savedSummary={summaries.current.get(compressFrom.id)}
          onSummaryChange={(text) => (text ? summaries.current.set(compressFrom.id, text) : summaries.current.delete(compressFrom.id))}
          onCreate={(summary, name, question) => {
            void createExpress(compressFrom.routeId, compressFrom.id, summary, name, question);
            setCompressFrom(null);
          }}
        />
      )}

      {forkFrom && allRoutes[forkFrom.routeId] && (
        <ForkDialog
          parent={allRoutes[forkFrom.routeId]!}
          stop={forkFrom}
          stopNumber={stopNumber(forkFrom)}
          nextNumber={Math.max(0, ...Object.values(allRoutes).filter((r) => r.projectId === allRoutes[forkFrom.routeId]!.projectId).map((r) => r.number)) + 1}
          onCancel={() => setForkFrom(null)}
          onConfirm={(name, question) => {
            void fork(forkFrom.routeId, forkFrom.id, name, question);
            setForkFrom(null);
          }}
        />
      )}

      {error && (
        <div className={css.toast} role="alert">
          <span>{error}</span>
          <button onClick={dismissError}>知道了</button>
        </div>
      )}
    </div>
  );
}
