import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import type { QueueItem, Stop, SyncFile } from "../../shared";
import { CompressDialog } from "../dialogs/CompressDialog";
import type { Building } from "../panels/WaitingArea";
import { DeleteDialog } from "../dialogs/DeleteDialog";
import { RemoveProjectDialog } from "../dialogs/RemoveProjectDialog";
import { AddProjectDialog, ImportDialog } from "../dialogs/AddProjectDialog";
import { ChangesDialog } from "../dialogs/ChangesDialog";
import { NewRouteDialog } from "../dialogs/NewRouteDialog";
import { SyncLogDialog } from "../dialogs/SyncLogDialog";
import { TruncateDialog } from "../dialogs/TruncateDialog";
import { Overview } from "../overview/Overview";
import { ForkDialog } from "../dialogs/ForkDialog";
import { TerminalDialog } from "../terminal/TerminalDialog";
import { ordinal, stopOffset } from "../stores/numbering";
import { activityText, ChatPanel } from "../chat/ChatPanel";
import { ImageViewer } from "../chat/ImageViewer";
import { StopImages } from "../chat/StopImages";
import { ImportPill, ImportProgressDialog, PreparingPill } from "../dialogs/ImportProgress";
import { Notices } from "../notices/Notices";
import { Settings } from "./Settings";
import { Welcome } from "./Welcome";
import { OverviewQueue } from "../overview/OverviewQueue";
import { CommandPalette } from "../palette/CommandPalette";
import { LocalTab } from "../map/LocalTab";
import { FirstRoute } from "./FirstRoute";
import { LocalPresetsDialog } from "../dialogs/LocalPresetsDialog";
import { RouteMap } from "../map/RouteMap";
import { WaitingArea } from "../panels/WaitingArea";
import { ProjectRail } from "../rail/ProjectRail";
import { useRoutes, useStops, useStore } from "../stores/store";
import { IconChat, IconSearch, IconSliders, LanesMark } from "../ui/icons";
import { Plate } from "../ui/Plate";
import css from "./App.module.css";
import { useTier } from "./use-tier";
import { PANES, dividerTarget, edgeHidden, flexPane, hiddenBetween, loadLayout, saveLayout, setWidth, targetWidths, toggle, visible, type Layout, type PaneId } from "./layout";
import { EdgeOpener, LayoutButton, PaneDivider } from "./Panes";
import { routeLabel } from "../ui/route-color";

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
  const setRouteMode = useStore((s) => s.setRouteMode);
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
  const importSessions = useStore((s) => s.importSessions);
  const activities = useStore((s) => s.activity);
  const imports = useStore((s) => s.imports);
  const importShown = useStore((s) => s.importShown);
  const showImport = useStore((s) => s.showImport);
  const importCancel = useStore((s) => s.importCancel);
  const preparing = useStore((s) => s.preparing);
  const removeProject = useStore((s) => s.removeProject);
  const lastSync = useStore((s) => s.lastSync);
  const openSystemTerminal = useStore((s) => s.openSystemTerminal);
  const resolveConflict = useStore((s) => s.resolveConflict);
  const environment = useStore((s) => s.environment);
  const terminalSessions = useStore((s) => s.terminalSessions);
  const addDropped = useStore((s) => s.addDropped);
  const dismissNotice = useStore((s) => s.dismissNotice);
  const jumpToStop = useStore((s) => s.jumpToStop);
  const focus = useStore((s) => s.focus);
  const allQueues = useStore((s) => s.queue);
  const allOptions = useStore((s) => s.claudeOptions);
  const loadClaudeOptions = useStore((s) => s.loadClaudeOptions);
  const content = useStore((s) => s.content);
  const ask = useStore((s) => s.ask);
  const stopRoute = useStore((s) => s.stop);
  const resync = useStore((s) => s.resync);
  const setDraft = useStore((s) => s.setDraft);
  const editQueued = useStore((s) => s.editQueued);
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
  const localPresets = useStore((s) => s.localPresets);
  const saveLocalPresets = useStore((s) => s.saveLocalPresets);
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
  const [settings, setSettings] = useState(false);
  const [hintGone, setHintGone] = useState(() => {
    try {
      return localStorage.getItem("bw.hint.first") === "1";
    } catch {
      return false;
    }
  });
  /** 三个面板怎么摆：显示哪几个、顺序、拖出来的宽度（设计稿 9-7）。只记在这台机器上 */
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const updateLayout = (f: (l: Layout) => Layout) =>
    setLayout((l) => {
      const next = f(l);
      saveLayout(next);
      return next;
    });
  const bodyRef = useRef<HTMLDivElement>(null);
  const paneEls = useRef<Partial<Record<PaneId, HTMLElement | null>>>({});
  /** 面板现在的宽度（拖分隔条时从这里开始算） */
  const paneWidth = (id: PaneId) => paneEls.current[id]?.getBoundingClientRect().width ?? PANES[id].base;
  const resizePane = (left: PaneId, right: PaneId, dx: number, start: number) => {
    const { pane, sign } = dividerTarget(left, right, flex);
    updateLayout((l) => setWidth(l, pane, start + sign * dx));
  };
  /** “布局”小窗开着没有 */
  const [layoutOpen, setLayoutOpen] = useState(false);
  /** 收起 / 打开时的宽度动画：这段时间里每个面板用固定的像素宽度，从旧的滑到新的（320ms） */
  const [anim, setAnim] = useState<{
    ids: PaneId[];
    widths: Record<string, number>;
    full: Record<string, number>;
    run: boolean;
    /** 动画开始前看得见的面板（第一帧的留白、分隔线按它来，下一帧再过渡到新的） */
    before: PaneId[];
    /** 这次收起 / 打开的是哪个面板 */
    toggled: PaneId | undefined;
  } | null>(null);
  const animTimer = useRef<number>(undefined);
  const [deleting, setDeleting] = useState<{
    routeId: string;
    unsynced: SyncFile[] | null;
  } | null>(null);
  const stopNumber = (stop: Stop) => stopOffset(allRoutes[stop.routeId], allRoutes, allStops) + ordinal(stop, allStops);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Alt+L（Mac 上 ⌘⌥L）：打开“布局”小窗；Ctrl+Alt+1/2/3：收起 / 打开项目列表、地图、对话
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey) {
        if (e.code === "KeyL") {
          e.preventDefault();
          setLayoutOpen((v) => !v);
          return;
        }
        if (/^Digit[123]$/.test(e.code)) {
          e.preventDefault();
          togglePaneRef.current((["rail", "map", "chat"] as const)[Number(e.code.slice(5)) - 1]!);
          return;
        }
      }
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

  /** 冲突的文件在 Local 里上一次是谁改的 */
  const whoChanged = (by: { routeId: string | null; stopId: string | null }) => {
    const r = by.routeId ? allRoutes[by.routeId] : undefined;
    const s = by.stopId ? allStops[by.stopId] : undefined;
    if (!by.routeId) return "Local 里这一处是你自己直接改的";
    if (!r) return "Local 里这一处是一条已经删掉的线路改的";
    return `Local 里这一处刚被 ${routeLabel(r)}${s ? ` 第 ${stopNumber(s)} 站` : ""}改过`;
  };
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

  // 实际摆出来的面板：还没有项目时地图（欢迎页）一定在；没选路时对话只在没有地图时占个位；窄窗口里对话改成从右边滑出
  const flowOf = (l: Layout) => {
    const shown = projects.length === 0 && !visible(l).includes("map") ? l.order.filter((p) => p === "map" || visible(l).includes(p)) : visible(l);
    const asDrawer = tier === "narrow" && shown.includes("map");
    return {
      asDrawer,
      flow: shown.filter((p) => !(p === "chat" && (asDrawer || (!route && shown.includes("map"))))),
    };
  };
  const { asDrawer: chatAsDrawer, flow: flowPanes } = flowOf(layout);
  const flex = flexPane(flowPanes);
  /** 留白、分隔线看哪一组面板：动画第一帧还按旧的，跑起来就按新的（留白跟着宽度一起过渡） */
  const shownFor = () => (anim && !anim.run ? anim.before : flowPanes);
  /** 这个面板贴着窗口哪一边 */
  const outer = (id: PaneId) => {
    const shown = shownFor();
    const at = shown.indexOf(id);
    if (at < 0) return undefined;
    const sides = [at === 0 && "left", at === shown.length - 1 && "right"].filter(Boolean).join(" ");
    return sides || undefined;
  };
  /** 左边挨着的也是白色面板（两个都不是地图）时画分隔线 */
  const seam = (id: PaneId) => {
    const shown = shownFor();
    const at = shown.indexOf(id);
    return at > 0 && id !== "map" && shown[at - 1] !== "map";
  };
  /**
   * 动画里面板内容贴哪边：收起 / 打开的那个面板，第一个往左滑、最后一个往右滑、中间的两边收；
   * 别的面板贴着不动的那条边，比如项目列表收起时地图的右边不动，内容就贴右边，地图上的线路在屏幕上不跑
   */
  const slideOf = (id: PaneId, i: number, list: PaneId[]) => {
    if (!anim) return undefined;
    const t = anim.toggled ? list.indexOf(anim.toggled) : -1;
    if (id !== anim.toggled && t >= 0) return t < i ? "left" : "right";
    return i === 0 && list.length > 1 ? "left" : i === list.length - 1 && list.length > 1 ? "right" : "middle";
  };
  const compactRail = (p: PaneId | undefined) => p === "rail" && tier !== "wide";
  /** 不占剩下宽度时，这个面板在某个布局里该多宽 */
  const ownWidth = (l: Layout, id: PaneId) => (compactRail(id) ? 56 : (l.width[id] ?? (id === "chat" ? (tier === "wide" ? 420 : 380) : PANES[id].base)));

  /**
   * 换布局，收起 / 打开的面板宽度动起来（设计稿 9-7：两边的往两边靠，中间的被两边挤）。
   * 先量现在每个面板多宽，算出新布局里每个面板该多宽，320ms 里从旧的滑到新的；窄窗口、系统要求减少动效时直接换
   */
  const animateTo = (next: Layout) => {
    const body = bodyRef.current;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const { flow: nextFlow } = flowOf(next);
    if (!body || reduce || tier === "narrow" || overview || anim) {
      updateLayout(() => next);
      return;
    }
    const from: Record<string, number> = {};
    for (const id of flowPanes) from[id] = paneWidth(id);
    // 地图那块板靠窗口边的一侧有留白（margin，不算在宽度里），先从总宽里扣掉，动画中总宽才对得上，右边的面板不会被挤出去一下
    const gutter = parseFloat(getComputedStyle(body).getPropertyValue("--sp-8")) || 8;
    const margins = nextFlow.includes("map") ? gutter * (Number(nextFlow[0] === "map") + Number(nextFlow[nextFlow.length - 1] === "map")) : 0;
    const to = targetWidths(nextFlow, flexPane(nextFlow), (id) => ownWidth(next, id), body.clientWidth - margins);
    // 收起的面板也留在原来的位置，宽度滑到 0
    const ids = next.order.filter((p) => nextFlow.includes(p) || flowPanes.includes(p));
    const start = Object.fromEntries(ids.map((p) => [p, from[p] ?? 0]));
    const end = Object.fromEntries(ids.map((p) => [p, to[p] ?? 0]));
    // 动画里每个面板的内容按它“打开时”的宽度排，面板只是在外面收窄 / 放宽，内容不会被挤
    const full = Object.fromEntries(ids.map((p) => [p, Math.max(start[p]!, end[p]!)]));
    updateLayout(() => next);
    const before = flowPanes;
    const toggled = ids.find((p) => nextFlow.includes(p) !== flowPanes.includes(p));
    setAnim({ ids, widths: start, full, run: false, before, toggled });
    requestAnimationFrame(() => requestAnimationFrame(() => setAnim({ ids, widths: end, full, run: true, before, toggled })));
    window.clearTimeout(animTimer.current);
    animTimer.current = window.setTimeout(() => setAnim(null), 340);
  };
  const togglePane = (id: PaneId) => animateTo(toggle(layout, id));
  const togglePaneRef = useRef(togglePane);
  togglePaneRef.current = togglePane;
  /** 现在每个面板的宽度（“布局”小窗里方块按这个比例画） */
  const liveWidths = Object.fromEntries(flowPanes.map((p) => [p, paneEls.current[p]?.getBoundingClientRect().width ?? ownWidth(layout, p)])) as Partial<Record<PaneId, number>>;
  const edges = edgeHidden(layout);

  const waitingArea = (floating: boolean) => (
    <WaitingArea
                buttonOnlyWhenOpen={floating}
                items={Object.values(allQueues).flat()}
                routes={Object.values(allRoutes).filter((r) => r.status !== "archived")}
                project={{ id: projectId!, name: projects.find((p) => p.id === projectId)?.name ?? "" }}
                projectNames={Object.fromEntries(projects.map((p) => [p.id, p.name]))}
                selectedRoute={route ?? undefined}
                onAdd={(text, images) => projectId && void queueAdd(projectId, text, null, undefined, images)}
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
  );
  const noticesEl = (
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
              const item = Object.values(allQueues).flat().find((q) => q.id === itemId);
              if (item) void editQueued(item, id).then(() => setDrawer(true));
              else (setDraft(id, text), void queueRemove(itemId), goToRoute(id));
            }}
          />
  );
  const chatEl = route ? (
    <ChatPanel key={route!.id} whoChanged={whoChanged} viewing={viewing ? allStops[viewing] : undefined} onBackToLatest={() => viewStop(null)} onModel={(model, effort) => void setRouteModel(route.id, model, effort)} claudeOptions={allOptions[route.projectId]} terminals={routeTerminals} onOpenTerminal={viewTerminal} onStopTerminal={(id) => void stopTerminal(id)} onViewChanges={() => viewChanges(route.id)} onDiscard={() => void discardChanges(route.id)} focus={focus} onCollapse={tier === "narrow" ? () => setDrawer(false) : undefined} route={route} stops={stops} offset={stopOffset(route, allRoutes, allStops)} parent={route.parentRouteId ? allRoutes[route.parentRouteId] : undefined} onGoToRoute={selectRoute} permissionMode={route.permissionMode} onPermissionMode={(mode) => void setRouteMode(route.id, mode)} waiting={queue.filter((q) => q.routeId === route.id)} onOpenWaiting={() => setWaitingSignal((n) => n + 1)} onQueue={(text, mode, images) => void queueAdd(route.projectId, text, mode === "unassigned" ? null : route.id, mode, images)} onFork={setForkFrom} />
  ) : null;

  return (
    <div className={css.app}>
      <header className={css.top}>
        <div className={css.brand}>
          <LanesMark size={28} />
          <b>Lanes</b>
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
        {tier !== "narrow" && <LayoutButton layout={layout} widths={liveWidths} open={layoutOpen} onOpen={setLayoutOpen} onChange={(next, animate) => (animate ? animateTo(next) : updateLayout(() => next))} onToggle={togglePane} />}
        <button className={css.gear} aria-label="设置" aria-expanded={settings} onClick={() => setSettings(!settings)}>
          <IconSliders size={18} />
        </button>
      </header>
      {settings && <Settings load={environment} onClose={() => setSettings(false)} />}

      <div ref={bodyRef} className={css.body} data-tier={tier} data-overview={overview} style={layout.width.rail ? ({ "--rail-w": `${layout.width.rail}px` } as React.CSSProperties) : undefined}>
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
        {overview && projects.length > 0 && (
          <OverviewQueue
            projects={projects}
            routes={allRoutes}
            queue={allQueues}
            currentProjectId={projectId}
            onAdd={(pid, text, images) => void queueAdd(pid, text, null, undefined, images)}
            onAssign={(id, routeId, mode) => void queueAssign(id, routeId, mode)}
            onBoard={(id) => void queueBoard(id)}
            onStartNew={(id) => void queueStartNew(id)}
            onRemove={(id) => void queueRemove(id)}
          />
        )}
        {/* 收起 / 打开后看得见的面板：地图那块板靠窗口边的一侧留白，两个白色面板挨着时画分隔线（设计稿 9-8） */}
        {(anim ? anim.ids : flowPanes).map((id, i, list) => {
          const left = list[i - 1];
          const hiddenNow = !flowPanes.includes(id);
          return (
            <Fragment key={id}>
              {left && !overview && (
                <PaneDivider
                  left={left}
                  right={id}
                  between={hiddenBetween(layout, left, id)}
                  layout={layout}
                  resizable={!anim && !compactRail(left) && !compactRail(id)}
                  start={() => paneWidth(dividerTarget(left, id, flex).pane)}
                  onDrag={(dx, start) => resizePane(left, id, dx, start)}
                  onReset={() => updateLayout((l) => setWidth(l, dividerTarget(left, id, flex).pane, null))}
                  onHide={togglePane}
                  onShow={togglePane}
                />
              )}
              <section
                ref={(el) => void (paneEls.current[id] = el)}
                className={css.pane}
                data-pane={id}
                data-first={i === 0 || undefined}
                data-outer={outer(id)}
                data-seam={seam(id) || undefined}
                data-edge={i === list.length - 1 && i > 0 ? "right" : undefined}
                data-flex={(!anim && id === flex) || undefined}
                data-anim={anim ? (anim.run ? "run" : "start") : undefined}
                data-slide={slideOf(id, i, list)}
                aria-hidden={hiddenNow || undefined}
                style={
                  anim
                    ? ({
                        width: anim.widths[id] ?? 0,
                        "--anim-w": `${anim.full[id] ?? 0}px`,
                      } as React.CSSProperties)
                    : id === flex || compactRail(id)
                      ? undefined
                      : { width: ownWidth(layout, id) }
                }
                aria-label={PANES[id].label}
              >
                {id === "rail" && <ProjectRail compact={tier !== "wide"} onDelete={(rid) => setDeleting({ routeId: rid, unsynced: null })} />}
                {id === "map" && (
                  <main className={css.center}>
                    {!ready ? null : projects.length === 0 ? (
                      <Welcome onPick={() => void openAddProject()} onDrop={addDropped} loadEnvironment={environment} />
                    ) : routes.length === 0 ? (
                      <FirstRoute project={project} onStart={(question, images) => projectId && void startRoute({ projectId, question, images })} onMore={() => openNewRoute()} />
                    ) : (
                      <>
                        <RouteMap
                          leading={projectId ? <LocalTab projectId={projectId} selected={!!route?.local} /> : undefined}
                          resizing={!!anim}
                          activityLabel={(routeId) => (activities[routeId] ? activityText(activities[routeId]!) : null)}
                          stopImages={(stop) => <StopImages ownerId={stop.id} count={stop.images ?? 0} title={`第 ${stopNumber(stop)} 站`} />}
                          routes={routes}
                          stops={projectStops}
                          queue={queue}
                          selectedRouteId={routeId}
                          onSelectRoute={selectRoute}
                          stopNumber={stopNumber}
                          onFork={setForkFrom}
                          onCompress={(stop) => openCompress(stop.id)}
                          onRenameStop={(stop, name) => void renameStop(stop.id, name)}
                          viewingStopId={viewing}
                          onViewStop={(stop) => viewStop(stop?.id ?? null)}
                          preview={(stop) => {
                            const items = content[stop.id];
                            return items
                              ? {
                                  answer: items
                                    .filter((it) => it.kind === "text")
                                    .map((it) => it.text)
                                    .join(" "),
                                  tools: items.filter((it) => it.kind === "tool").length,
                                }
                              : null;
                          }}
                          onHoverStop={(stop) => ensureHistory(stop.routeId)}
                          onTruncate={(stop, requeue) => setTruncating({ stop, requeue })}
                          onParkAnswer={(stop) => {
                            const text = (content[stop.id] ?? [])
                              .filter((it) => it.kind === "text")
                              .map((it) => it.text)
                              .join("\n")
                              .trim();
                            if (projectId && text) void queueAdd(projectId, text.slice(0, 4000));
                            setWaitingSignal((n) => n + 1);
                          }}
                          onQueueMode={(item, mode) => void queueAssign(item.id, item.routeId, mode)}
                          onQueueEdit={(item) => item.routeId && void editQueued(item, item.routeId).then(() => setDrawer(true))}
                          onQueueRemove={(item) => void queueRemove(item.id)}
                          dragging={dragging}
                          onDropItem={(item, id, mode) => (setDragging(null), void queueAssign(item.id, id, mode))}
                          focus={focus}
                          range={compressFrom && !distills[compressFrom.id]?.summary ? { stopId: compressFrom.id, kind: "compress" } : forkFrom ? { stopId: forkFrom.id, kind: "fork" } : null}
                          building={building.map((b) => ({
                            stopId: b.stopId,
                            express: b.express,
                            name: b.name,
                            ready: b.ready,
                          }))}
                          onOpenBuilding={(stopId) => openCompress(stopId)}
                          onJumpStop={goToStop}
                          conflicts={Object.fromEntries(routes.filter((r) => r.status === "conflict" && lastSync[r.id]?.status === "conflict").map((r) => [r.id, lastSync[r.id]!.files]))}
                          whoChanged={whoChanged}
                          onResolve={(id) => void resolveConflict(id)}
                          hint={!hintGone && routes.length === 1 && projectStops.length <= 3}
                          onDismissHint={() => {
                            setHintGone(true);
                            try {
                              localStorage.setItem("bw.hint.first", "1");
                            } catch {
                              // 记不住就下次再提示一次
                            }
                          }}
                        />
                        {waitingArea(false)}
                        {chatAsDrawer && route && !drawer && (
                          <button className={css.drawerButton} onClick={() => setDrawer(true)}>
                            <IconChat size={14} /> 对话
                          </button>
                        )}
                      </>
                    )}
                    {/* 窄窗口里对话栏盖在地图上：点地图收回 */}
                    {chatAsDrawer && drawer && route && <div className={css.drawerBackdrop} onPointerDown={() => setDrawer(false)} />}
                    {flowPanes.includes("map") && noticesEl}
                  </main>
                )}
                {id === "chat" && (route ? chatEl : <div className={css.noChat}>在{flowPanes.includes("rail") ? "项目列表" : "左上角"}里选一路车，这里显示它的对话</div>)}
              </section>
            </Fragment>
          );
        })}
        {/* 没有地图时：候车区（从对话栏的“本路候车”打开）和通知浮在整个窗口上 */}
        {!flowPanes.includes("map") && !overview && (
          <div className={css.floatLayer}>
            {waitingArea(true)}
            {noticesEl}
          </div>
        )}
        {/* 收起后贴在窗口最左、最右的面板：鼠标贴到边上才探出打开按钮 */}
        {!overview && !anim && tier !== "narrow" && (
          <>
            <EdgeOpener side="left" panes={edges.left} onShow={togglePane} />
            <EdgeOpener side="right" panes={edges.right} onShow={togglePane} />
          </>
        )}
        {/* 窄窗口：对话从右边滑出盖在地图上 */}
        {chatAsDrawer && route && drawer && (
          <section className={`${css.pane} ${css.drawer}`} data-pane="chat" aria-label="对话">
            {chatEl}
          </section>
        )}
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
          claudeOptions={allOptions[allRoutes[compressFrom.routeId]!.projectId]}
          onCreate={(summary, name, question, itemId, run, images) => {
            void createExpress(compressFrom.routeId, compressFrom.id, summary, name, question, itemId, run, images);
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
          claudeOptions={allOptions[allRoutes[forkFrom.routeId]!.projectId]}
          onCancel={() => setForkFrom(null)}
          onConfirm={(name, question, opts) => {
            void fork(forkFrom.routeId, forkFrom.id, name, question, opts);
            setForkFrom(null);
          }}
        />
      )}

      {dialog?.kind === "add-project" && <AddProjectDialog dir={dialog.dir} onPick={pickDirectory} onInspect={inspectDirectory} loadSessions={terminalSessions} onAdd={(dir, name, ids) => void addProjectAt(dir, name, ids)} onCancel={closeDialog} />}
      {dialog?.kind === "remove-project" && projects.some((p) => p.id === dialog.projectId) && (() => {
        const mine = Object.values(allRoutes).filter((r) => r.projectId === dialog.projectId);
        return (
          <RemoveProjectDialog
            project={projects.find((p) => p.id === dialog.projectId)!}
            routeCount={mine.length}
            archivedCount={mine.filter((r) => r.status === "archived").length}
            queueCount={(allQueues[dialog.projectId] ?? []).length}
            busy={mine.filter((r) => r.status === "answering" || r.status === "awaiting_permission").map((r) => `${routeLabel(r)} ${r.name}`)}
            blocked={dialog.blocked}
            error={dialog.error}
            onCancel={closeDialog}
            onConfirm={removeProject}
          />
        );
      })()}
      {dialog?.kind === "import" && <ImportDialog project={projects.find((p) => p.id === dialog.projectId)!} load={terminalSessions} onImport={(ids) => void importSessions(dialog.projectId, ids)} onCancel={closeDialog} />}
      {dialog?.kind === "new-route" && projectId && (
        <NewRouteDialog
          projects={projects}
          projectId={projectId}
          nextNumber={(id) => Math.max(0, ...Object.values(allRoutes).filter((r) => r.projectId === id).map((r) => r.number)) + 1}
          parked={(id) => (allQueues[id] ?? []).filter((q) => !q.routeId)}
          onAddProject={() => void openAddProject()}
          claudeOptions={(id) => allOptions[id]}
          onLoadClaudeOptions={loadClaudeOptions}
          onCreate={(o) => void startRoute(o)}
          preparing={preparing}
          onCancel={closeDialog}
        />
      )}
      {dialog?.kind === "local-presets" && (
        <LocalPresetsDialog projectName={projects.find((p) => p.id === dialog.projectId)?.name ?? ""} saved={localPresets[dialog.projectId]} onSave={(list) => saveLocalPresets(dialog.projectId, list)} onClose={closeDialog} />
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
          onOpenSystem={() => void openSystemTerminal(viewed.id)}
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
      <ImageViewer />
      {/* 导入终端会话的进度（设计稿 4-8）：窗口，或放到后台时左下角的小条 */}
      {importShown && imports[importShown] && <ImportProgressDialog progress={imports[importShown]!} onBackground={() => showImport(null)} onCancel={() => importCancel(importShown)} onClose={() => showImport(null)} />}
      {/* 开新的一路时窗口已经关了（开新对话、快线、空项目的第一路）：左下角小条显示进度；“开一路新车”的窗口自己显示 */}
      {preparing && dialog?.kind !== "new-route" && <PreparingPill {...preparing} />}
      {Object.values(imports)
        .filter((p) => !p.finished && p.jobId !== importShown)
        .slice(0, 1)
        .map((p) => (
          <ImportPill key={p.jobId} progress={p} onOpen={() => showImport(p.jobId)} />
        ))}
    </div>
  );
}
