import { useEffect, useMemo, useState } from "react";
import type { QueueItem, Stop, SyncFile } from "../../shared";
import { CompressDialog } from "../dialogs/CompressDialog";
import { DeleteDialog } from "../dialogs/DeleteDialog";
import { AddProjectDialog } from "../dialogs/AddProjectDialog";
import { ChangesDialog } from "../dialogs/ChangesDialog";
import { NewRouteDialog } from "../dialogs/NewRouteDialog";
import { SyncLogDialog } from "../dialogs/SyncLogDialog";
import { Overview } from "../overview/Overview";
import { ForkDialog } from "../dialogs/ForkDialog";
import { TerminalDialog } from "../terminal/TerminalDialog";
import { stopOffset } from "../stores/numbering";
import { ChatPanel } from "../chat/ChatPanel";
import { Notices } from "../notices/Notices";
import { CommandPalette } from "../palette/CommandPalette";
import { RouteMap } from "../map/RouteMap";
import { WaitingArea } from "../panels/WaitingArea";
import { ProjectRail } from "../rail/ProjectRail";
import { useRoutes, useStops, useStore } from "../stores/store";
import { BusMark, IconChat, IconFolder, IconSearch } from "../ui/icons";
import { Plate } from "../ui/Plate";
import css from "./App.module.css";
import { useTier } from "./use-tier";

const EMPTY_QUEUE: QueueItem[] = [];

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
  const createExpress = useStore((s) => s.createExpress);
  const compressStopId = useStore((s) => s.compressStopId);
  const openCompress = useStore((s) => s.openCompress);
  const distills = useStore((s) => s.distills);
  const startDistill = useStore((s) => s.startDistill);
  const cancelDistill = useStore((s) => s.cancelDistill);
  const setSummary = useStore((s) => s.setSummary);
  const dropDistill = useStore((s) => s.dropDistill);
  const compressFrom = compressStopId ? allStops[compressStopId] : undefined;
  const notices = useStore((s) => s.notices);
  const dismissNotice = useStore((s) => s.dismissNotice);
  const jumpToStop = useStore((s) => s.jumpToStop);
  const focus = useStore((s) => s.focus);
  const allQueues = useStore((s) => s.queue);
  const content = useStore((s) => s.content);
  const ask = useStore((s) => s.ask);
  const stopRoute = useStore((s) => s.stop);
  const resync = useStore((s) => s.resync);
  const setDraft = useStore((s) => s.setDraft);
  const ensureHistory = useStore((s) => s.ensureHistory);
  const terminals = useStore((s) => s.terminals);
  const terminalView = useStore((s) => s.terminalView);
  const viewTerminal = useStore((s) => s.viewTerminal);
  const stopTerminal = useStore((s) => s.stopTerminal);
  const changesView = useStore((s) => s.changesView);
  const viewChanges = useStore((s) => s.viewChanges);
  const setRouteModel = useStore((s) => s.setRouteModel);
  const renameStop = useStore((s) => s.renameStop);
  const routeTerminals = useMemo(() => Object.values(terminals).filter((t) => t.routeId === routeId).sort((a, b) => a.startedAt - b.startedAt), [terminals, routeId]);
  const viewed = terminalView ? terminals[terminalView.id] : undefined;
  const dialog = useStore((s) => s.dialog);
  const pickDirectory = useStore((s) => s.pickDirectory);
  const inspectDirectory = useStore((s) => s.inspectDirectory);
  const closeDialog = useStore((s) => s.closeDialog);
  const openAddProject = useStore((s) => s.openAddProject);
  const addProjectAt = useStore((s) => s.addProjectAt);
  const openNewRoute = useStore((s) => s.openNewRoute);
  const startRoute = useStore((s) => s.startRoute);
  const overview = useStore((s) => s.overview);
  const setOverview = useStore((s) => s.setOverview);
  const selectProject = useStore((s) => s.selectProject);
  const [palette, setPalette] = useState(false);
  const [waitingSignal, setWaitingSignal] = useState(0);
  const tier = useTier();
  /** 窄窗口里对话栏是抽屉：开着没有 */
  const [drawer, setDrawer] = useState(false);
  // 窗口刚变窄时对话栏先收着，把地图让出来
  useEffect(() => {
    if (tier === "narrow") setDrawer(false);
  }, [tier]);
  const searchData = useMemo(() => ({ projects, routes: allRoutes, stops: allStops, queue: allQueues }), [projects, allRoutes, allStops, allQueues]);
  const queue = useStore((s) => (projectId ? s.queue[projectId] : undefined)) ?? EMPTY_QUEUE;
  const queueAdd = useStore((s) => s.queueAdd);
  const queueAssign = useStore((s) => s.queueAssign);
  const queueRemove = useStore((s) => s.queueRemove);
  const queueBoard = useStore((s) => s.queueBoard);
  const queueStartNew = useStore((s) => s.queueStartNew);
  const [deleting, setDeleting] = useState<{ routeId: string; unsynced: SyncFile[] | null } | null>(null);
  const stopNumber = (stop: Stop) => stopOffset(allRoutes[stop.routeId], allRoutes, allStops) + stop.seq;

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (key === "n" && !document.querySelector('[aria-modal="true"]')) {
        e.preventDefault();
        openNewRoute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNewRoute]);

  /** 去某一路 / 某一站；窄窗口里顺便把对话栏滑出来 */
  const goToRoute = (id: string) => {
    selectRoute(id);
    setDrawer(true);
  };
  const goToStop = (id: string) => {
    jumpToStop(id);
    setDrawer(true);
  };
  const isMac = /Mac/.test(navigator.platform);

  const projectStops = Object.values(allStops).filter((s) => routes.some((r) => r.id === s.routeId));

  return (
    <div className={css.app}>
      <header className={css.top}>
        <div className={css.brand}>
          <BusMark />
          <b>Branchwork</b>
        </div>
        <nav className={css.crumbs} aria-label="位置">
          <button className={css.crumbLink} aria-current={overview ? "page" : undefined} onClick={() => setOverview(true)}>
            全部项目
          </button>
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
        <button className={css.search} data-compact={tier === "narrow"} onClick={() => setPalette(true)} aria-label="搜索" title={`搜索（${isMac ? "⌘" : "Ctrl+"}K）`}>
          <IconSearch size={16} />
          <span>搜索提问、候车区、命令</span>
          <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
      </header>

      <div className={css.body} data-tier={tier} data-overview={overview}>
        {overview && (
          <Overview
            projects={projects}
            routes={allRoutes}
            stops={allStops}
            queue={allQueues}
            currentProjectId={projectId}
            onOpenProject={(id) => (selectProject(id), setOverview(false))}
            onOpenRoute={goToRoute}
            onNewRoute={(id) => (selectProject(id), setOverview(false), openNewRoute())}
            onAddProject={() => void openAddProject()}
          />
        )}
        <ProjectRail compact={tier !== "wide"} onDelete={(id) => setDeleting({ routeId: id, unsynced: null })} />

        <main className={css.center}>
          {!ready ? null : projects.length === 0 ? (
            <div className={css.empty}>
              <BusMark size={56} />
              <h1>先加一个项目</h1>
              <p>选一个有提交记录的 git 仓库目录。Branchwork 会把它当作 Local：你真正运行代码的地方。每条对话在自己的工作区里改，到站后再把改动带回这里。</p>
              <button className={css.primary} onClick={() => void openAddProject()}>
                <IconFolder /> 选择项目目录
              </button>
            </div>
          ) : routes.length === 0 ? (
            <div className={css.empty}>
              <BusMark size={56} />
              <h1>开出第一路</h1>
              <p>一路就是一条和 Claude 的对话，每问一次是一站。</p>
              <button className={css.primary} onClick={() => openNewRoute()}>
                新对话
              </button>
            </div>
          ) : (
            <>
              <RouteMap routes={routes} stops={projectStops} queue={queue} selectedRouteId={routeId} onSelectRoute={selectRoute} stopNumber={stopNumber} onFork={setForkFrom} onCompress={(stop) => openCompress(stop.id)} onRenameStop={(stop, name) => void renameStop(stop.id, name)} focus={focus} />
              <WaitingArea
                items={queue}
                routes={routes}
                onAdd={(text) => projectId && void queueAdd(projectId, text)}
                onAssign={(itemId, toRoute, mode) => void queueAssign(itemId, toRoute, mode)}
                onRemove={(itemId) => void queueRemove(itemId)}
                onBoard={(itemId) => void queueBoard(itemId)}
                onStartNew={(itemId) => void queueStartNew(itemId)}
                openSignal={waitingSignal}
              />
              {tier === "narrow" && route && !drawer && (
                <button className={css.drawerButton} onClick={() => setDrawer(true)}>
                  <IconChat size={14} /> 对话
                </button>
              )}
            </>
          )}
          {/* 窄窗口里对话栏盖在地图上：点地图收回 */}
          {tier === "narrow" && drawer && route && <div className={css.drawerBackdrop} onPointerDown={() => setDrawer(false)} />}
          <Notices
            notices={notices}
            routes={allRoutes}
            stops={allStops}
            projects={projects}
            currentProjectId={projectId}
            stopNumber={stopNumber}
            onDismiss={dismissNotice}
            onViewSummary={openCompress}
            onGoToRoute={goToRoute}
            onContinue={(id) => {
              goToRoute(id);
              void ask(id, "接着上一站没做完的地方继续，把它做完。");
            }}
            onResync={(id) => void resync(id)}
            onViewChanges={viewChanges}
            onJump={goToStop}
            onStop={stopRoute}
            onBoard={(itemId) => void queueBoard(itemId)}
            onEditFirst={(itemId, id, text) => {
              setDraft(id, text);
              void queueRemove(itemId);
              goToRoute(id);
            }}
          />
        </main>

        {route && (tier !== "narrow" || drawer) && <ChatPanel key={route.id} onModel={(model) => void setRouteModel(route.id, model)} terminals={routeTerminals} onOpenTerminal={viewTerminal} onStopTerminal={(id) => void stopTerminal(id)} onViewChanges={() => viewChanges(route.id)} focus={focus} onCollapse={tier === "narrow" ? () => setDrawer(false) : undefined} route={route} stops={stops} offset={stopOffset(route, allRoutes, allStops)} parent={route.parentRouteId ? allRoutes[route.parentRouteId] : undefined} onGoToRoute={selectRoute} permissionMode={project?.permissionMode ?? "ask"} projectName={project?.name ?? ""} onPermissionMode={(mode) => project && void setPermissionMode(project.id, mode)} waiting={queue.filter((q) => q.routeId === route.id)} onOpenWaiting={() => setWaitingSignal((n) => n + 1)} onQueue={(text, mode) => void queueAdd(route.projectId, text, mode === "unassigned" ? null : route.id, mode)} />}
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
          key={compressFrom.id}
          source={allRoutes[compressFrom.routeId]!}
          stop={compressFrom}
          stopNumber={stopNumber(compressFrom)}
          nextExpress={Math.max(0, ...Object.values(allRoutes).filter((r) => r.projectId === allRoutes[compressFrom.routeId]!.projectId).map((r) => r.express ?? 0)) + 1}
          distill={distills[compressFrom.id]}
          onStart={(keep) => startDistill(compressFrom.routeId, compressFrom.id, keep)}
          onCancel={() => cancelDistill(compressFrom.id)}
          onSummaryChange={(text) => setSummary(compressFrom.id, text)}
          onDiscard={() => {
            dropDistill(compressFrom.id);
            openCompress(null);
          }}
          onClose={() => openCompress(null)}
          onCreate={(summary, name, question) => {
            void createExpress(compressFrom.routeId, compressFrom.id, summary, name, question);
            openCompress(null);
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

      {dialog?.kind === "add-project" && <AddProjectDialog dir={dialog.dir} onPick={pickDirectory} onInspect={inspectDirectory} onAdd={(dir, name) => void addProjectAt(dir, name)} onCancel={closeDialog} />}
      {dialog?.kind === "new-route" && projectId && (
        <NewRouteDialog
          projects={projects}
          projectId={projectId}
          nextNumber={(id) => Math.max(0, ...Object.values(allRoutes).filter((r) => r.projectId === id).map((r) => r.number)) + 1}
          parked={(id) => (allQueues[id] ?? []).filter((q) => !q.routeId)}
          onAddProject={() => void openAddProject()}
          onCreate={(o) => void startRoute(o)}
          onCancel={closeDialog}
        />
      )}
      {dialog?.kind === "log" && projects.find((p) => p.id === dialog.projectId) && (
        <SyncLogDialog project={projects.find((p) => p.id === dialog.projectId)!} entries={dialog.entries} routes={allRoutes} stops={allStops} stopNumber={stopNumber} onViewRoute={goToRoute} onClose={closeDialog} />
      )}

      {changesView && allRoutes[changesView.routeId] && <ChangesDialog route={allRoutes[changesView.routeId]!} files={changesView.files} onClose={() => viewChanges(null)} />}

      {viewed && terminalView && allRoutes[viewed.routeId] && (
        <TerminalDialog
          terminal={viewed}
          route={allRoutes[viewed.routeId]!}
          output={terminalView.output}
          stopLabel={viewed.stopId && allStops[viewed.stopId] ? `第 ${stopNumber(allStops[viewed.stopId]!)} 站` : null}
          onStop={() => void stopTerminal(viewed.id)}
          onClose={() => viewTerminal(null)}
        />
      )}

      {palette && (
        <CommandPalette
          data={searchData}
          content={content}
          currentProject={project}
          stopNumber={stopNumber}
          onPreview={ensureHistory}
          onJump={(stop) => goToStop(stop.id)}
          onFork={setForkFrom}
          onOpenQueue={(item) => {
            if (item.routeId) goToRoute(item.routeId);
            else {
              useStore.getState().selectProject(item.projectId);
              setWaitingSignal((n) => n + 1);
            }
          }}
          onNewRoute={(name) => void createRoute(name)}
          onQueueAdd={(text) => {
            if (!projectId) return;
            void queueAdd(projectId, text);
            setWaitingSignal((n) => n + 1);
          }}
          onClose={() => setPalette(false)}
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
