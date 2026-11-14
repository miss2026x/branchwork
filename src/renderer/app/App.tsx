import { useEffect, useMemo, useState } from "react";
import type { QueueItem, Stop, SyncFile } from "../../shared";
import { CompressDialog } from "../dialogs/CompressDialog";
import type { Building } from "../panels/WaitingArea";
import { DeleteDialog } from "../dialogs/DeleteDialog";
import { AddProjectDialog } from "../dialogs/AddProjectDialog";
import { ChangesDialog } from "../dialogs/ChangesDialog";
import { NewRouteDialog } from "../dialogs/NewRouteDialog";
import { SyncLogDialog } from "../dialogs/SyncLogDialog";
import { TruncateDialog } from "../dialogs/TruncateDialog";
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
  const toast = useStore((s) => s.toast);
  const dismissToast = useStore((s) => s.dismissToast);
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
  const discardChanges = useStore((s) => s.discardChanges);
  const requestArchive = useStore((s) => s.requestArchive);
  const openKept = useStore((s) => s.openKept);
  const removeKept = useStore((s) => s.removeKept);
  const archiveAsk = useStore((s) => s.archiveAsk);
  const archiveBusy = useStore((s) => s.archiveBusy);
  const viewing = useStore((s) => s.viewing);
  const viewStop = useStore((s) => s.viewStop);
  const truncate = useStore((s) => s.truncate);
  const [truncating, setTruncating] = useState<{ stop: Stop; requeue: boolean } | null>(null);
  /** 正从候车区拖出来的问题 */
  const [dragging, setDragging] = useState<QueueItem | null>(null);
  const [firstQuestion, setFirstQuestion] = useState("");
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
  /** 这个项目里在建的快线：正在提炼的，和摘要好了还没开出的。编号接着已有的快线往下排 */
  const expressBase = Math.max(0, ...Object.values(allRoutes).filter((r) => r.projectId === projectId).map((r) => r.express ?? 0));
  const building: Building[] = Object.entries(distills)
    .filter(([stopId, d]) => allStops[stopId] && routes.some((r) => r.id === d.routeId) && (d.status === "running" || !!d.summary))
    .sort((a, b) => a[1].startedAt - b[1].startedAt)
    .map(([stopId, d], i) => {
      const source = allRoutes[d.routeId]!;
      return { stopId, express: expressBase + 1 + i, name: d.name.trim() || `${source.name} · 续`, ready: d.status !== "running", source, upto: stopNumber(allStops[stopId]!), startedAt: d.startedAt, direct: d.direct };
    });

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
            <form
              className={css.first}
              onSubmit={(e) => {
                e.preventDefault();
                if (projectId) void startRoute({ projectId, question: firstQuestion });
                setFirstQuestion("");
              }}
            >
              <div className={css.firstLine} aria-hidden>
                <span>
                  <b>1路</b>
                  <i>等你发车</i>
                </span>
                <em />
              </div>
              <h1>{project?.name} 还没有车</h1>
              <p>问第一个问题，就开出 1路。之后从任何一站都能分出新的一路。</p>
              <div className={css.firstCard}>
                <label htmlFor="first-stop">第一站</label>
                <textarea
                  id="first-stop"
                  rows={3}
                  value={firstQuestion}
                  onChange={(e) => setFirstQuestion(e.target.value)}
                  placeholder="比如：先帮我梳理一下现在的认证结构"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div>
                  <span>{project?.permissionMode === "all" ? "动手前不问" : project?.permissionMode === "edits" ? "改文件不问，运行命令前问我" : "动手前每次问我"}</span>
                  <button type="button" className={css.firstMore} onClick={() => openNewRoute()}>
                    更多选项…
                  </button>
                  <button type="submit" className={css.firstGo}>
                    {firstQuestion.trim() ? "发车" : "开出 1路"}
                  </button>
                </div>
              </div>
              <p className={css.firstNote}>
                <IconFolder size={16} />
                <span>
                  1路 在自己的工作区里改代码，每站答完，改动自动同步进 <code>{project?.localDir}</code>。
                </span>
              </p>
            </form>
          ) : (
            <>
              <RouteMap routes={routes} stops={projectStops} queue={queue} selectedRouteId={routeId} onSelectRoute={selectRoute} stopNumber={stopNumber} onFork={setForkFrom} onCompress={(stop) => openCompress(stop.id)} onRenameStop={(stop, name) => void renameStop(stop.id, name)}
                viewingStopId={viewing}
                onViewStop={(stop) => viewStop(stop?.id ?? null)}
                preview={(stop) => {
                  const items = content[stop.id];
                  return items ? { answer: items.filter((it) => it.kind === "text").map((it) => it.text).join(" "), tools: items.filter((it) => it.kind === "tool").length } : null;
                }}
                onHoverStop={(stop) => ensureHistory(stop.routeId)}
                onTruncate={(stop, requeue) => setTruncating({ stop, requeue })}
                onParkAnswer={(stop) => {
                  const text = (content[stop.id] ?? []).filter((it) => it.kind === "text").map((it) => it.text).join("\n").trim();
                  if (projectId && text) void queueAdd(projectId, text.slice(0, 4000));
                  setWaitingSignal((n) => n + 1);
                }}
                onQueueMode={(item, mode) => void queueAssign(item.id, item.routeId, mode)}
                onQueueEdit={(item) => {
                  if (!item.routeId) return;
                  setDraft(item.routeId, item.text);
                  void queueRemove(item.id);
                  goToRoute(item.routeId);
                }}
                onQueueRemove={(item) => void queueRemove(item.id)}
                dragging={dragging}
                onDropItem={(item, id, mode) => (setDragging(null), void queueAssign(item.id, id, mode))} focus={focus}
                range={compressFrom && !distills[compressFrom.id]?.summary ? { stopId: compressFrom.id, kind: "compress" } : forkFrom ? { stopId: forkFrom.id, kind: "fork" } : null}
                building={building.map((b) => ({ stopId: b.stopId, express: b.express, name: b.name, ready: b.ready }))}
                onOpenBuilding={(stopId) => openCompress(stopId)}
                onJumpStop={goToStop} />
              <WaitingArea
                items={Object.values(allQueues).flat()}
                routes={Object.values(allRoutes).filter((r) => r.status !== "archived")}
                project={{ id: projectId!, name: projects.find((p) => p.id === projectId)?.name ?? "" }}
                projectNames={Object.fromEntries(projects.map((p) => [p.id, p.name]))}
                selectedRoute={route ?? undefined}
                onAdd={(text) => projectId && void queueAdd(projectId, text)}
                onAssign={(itemId, toRoute, mode) => void queueAssign(itemId, toRoute, mode)}
                onRemove={(itemId) => void queueRemove(itemId)}
                onBoard={(itemId) => void queueBoard(itemId)}
                onStartNew={(itemId) => void queueStartNew(itemId)}
                openSignal={waitingSignal}
                onDrag={setDragging}
                building={building}
                onOpenBuilding={(stopId) => openCompress(stopId)}
                onCancelBuilding={(stopId) => dropDistill(stopId)}
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

        {route && (tier !== "narrow" || drawer) && <ChatPanel key={route.id} viewing={viewing ? allStops[viewing] : undefined} onBackToLatest={() => viewStop(null)} onModel={(model) => void setRouteModel(route.id, model)} terminals={routeTerminals} onOpenTerminal={viewTerminal} onStopTerminal={(id) => void stopTerminal(id)} onViewChanges={() => viewChanges(route.id)} onDiscard={() => void discardChanges(route.id)} focus={focus} onCollapse={tier === "narrow" ? () => setDrawer(false) : undefined} route={route} stops={stops} offset={stopOffset(route, allRoutes, allStops)} parent={route.parentRouteId ? allRoutes[route.parentRouteId] : undefined} onGoToRoute={selectRoute} permissionMode={project?.permissionMode ?? "ask"} projectName={project?.name ?? ""} onPermissionMode={(mode) => project && void setPermissionMode(project.id, mode)} waiting={queue.filter((q) => q.routeId === route.id)} onOpenWaiting={() => setWaitingSignal((n) => n + 1)} onQueue={(text, mode) => void queueAdd(route.projectId, text, mode === "unassigned" ? null : route.id, mode)} />}
      </div>

      {deleting && allRoutes[deleting.routeId] && (
        <DeleteDialog
          route={allRoutes[deleting.routeId]!}
          stopCount={Object.values(allStops).filter((s) => s.routeId === deleting.routeId).length}
          unsynced={deleting.unsynced}
          onCancel={() => setDeleting(null)}
          onArchive={() => {
            requestArchive(deleting.routeId);
            setDeleting(null);
          }}
          onConfirm={async (force, keep) => {
            const left = await deleteRoute(deleting.routeId, force, keep);
            setDeleting(left ? { routeId: deleting.routeId, unsynced: left } : null);
          }}
        />
      )}

      {compressFrom && allRoutes[compressFrom.routeId] && (
        <CompressDialog
          key={compressFrom.routeId}
          source={allRoutes[compressFrom.routeId]!}
          stop={compressFrom}
          stopNumber={stopNumber(compressFrom)}
          nextExpress={building.find((b) => b.stopId === compressFrom.id)?.express ?? expressBase + building.length + 1}
          distill={distills[compressFrom.id]}
          choices={projectStops
            .filter((s) => s.routeId === compressFrom.routeId && s.status !== "answering" && !!s.lastMessageId)
            .sort((a, b) => a.seq - b.seq)
            .map((s) => ({ stop: s, number: stopNumber(s) }))}
          contextTokens={allRoutes[compressFrom.routeId]!.contextTokens}
          waiting={queue.filter((q) => !q.routeId)}
          onRange={(id) => openCompress(id)}
          onStart={(keep, name, direct) => startDistill(compressFrom.routeId, compressFrom.id, keep, name, direct)}
          onSummaryChange={(text) => setSummary(compressFrom.id, text)}
          onDiscard={() => {
            dropDistill(compressFrom.id);
            openCompress(null);
          }}
          onClose={() => openCompress(null)}
          onCreate={(summary, name, question, itemId) => {
            void createExpress(compressFrom.routeId, compressFrom.id, summary, name, question, itemId);
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
          contextTokens={projectStops.filter((s) => s.routeId === forkFrom.routeId).every((s) => s.seq <= forkFrom.seq) ? allRoutes[forkFrom.routeId]!.contextTokens : null}
          waiting={queue.filter((q) => !q.routeId)}
          onCancel={() => setForkFrom(null)}
          onConfirm={(name, question, opts) => {
            void fork(forkFrom.routeId, forkFrom.id, name, question, opts);
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
        <SyncLogDialog project={projects.find((p) => p.id === dialog.projectId)!} entries={dialog.entries} kept={dialog.kept} onOpenKept={openKept} onRemoveKept={(id) => void removeKept(id)} routes={allRoutes} stops={allStops} stopNumber={stopNumber} onViewRoute={goToRoute} onClose={closeDialog} />
      )}

      {archiveAsk && allRoutes[archiveAsk] && (
        <div className={css.askScrim} onMouseDown={(e) => e.target === e.currentTarget && useStore.setState({ archiveAsk: null })}>
          <div className={css.askBox} role="alertdialog" aria-modal aria-label="这一路还在回答">
            <h2>「{allRoutes[archiveAsk]!.name}」还在回答</h2>
            <p>归档会把这一路收进“已归档”。它正在回答，你想怎么办？</p>
            <button onClick={() => archiveBusy(archiveAsk, "later")}>
              <b>答完再归档</b>
              <small>让这一站正常答完、改动进 Local，然后自动归档</small>
            </button>
            <button onClick={() => archiveBusy(archiveAsk, "now")}>
              <b>现在停下并归档</b>
              <small>这一站算没答完，它的改动留在工作区，不进 Local</small>
            </button>
            <button className={css.askCancel} onClick={() => useStore.setState({ archiveAsk: null })}>
              不归档了
            </button>
          </div>
        </div>
      )}

      {truncating && allRoutes[truncating.stop.routeId] && (
        <TruncateDialog
          route={allRoutes[truncating.stop.routeId]!}
          stop={truncating.stop}
          stopNumber={stopNumber(truncating.stop)}
          lastNumber={stopNumber(truncating.stop) + Object.values(allStops).filter((s) => s.routeId === truncating.stop.routeId && s.seq > truncating.stop.seq).length}
          forks={Object.values(allRoutes).filter((r) => r.parentRouteId === truncating.stop.routeId && r.forkStopId && (allStops[r.forkStopId]?.seq ?? 0) >= truncating.stop.seq)}
          requeue={truncating.requeue}
          onCancel={() => setTruncating(null)}
          onConfirm={(requeue) => {
            void truncate(truncating.stop.routeId, truncating.stop.id, requeue);
            setTruncating(null);
          }}
        />
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

      {toast && !error && (
        <div key={toast.id} className={css.done} role="status">
          {toast.route && <Plate route={toast.route} />}
          <div>
            <b>{toast.title}</b>
            {toast.detail && <span>{toast.detail}</span>}
          </div>
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.run();
                dismissToast();
              }}
            >
              {toast.action.label}
            </button>
          )}
          {toast.countdown && <i style={{ animationDuration: `${toast.countdown}ms` }} />}
        </div>
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
