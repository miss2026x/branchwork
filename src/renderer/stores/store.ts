import { create } from "zustand";
import { noticesAfterSelecting, reduceNotices, type Notice } from "./notices";
import type { BwEvent, ChatItem, PermissionDecision, PermissionMode, Project, QueueItem, QueueMode, Route, Stop, SyncFile, SyncLogEntry, DirectoryInfo, FileStat, KeptWorktree, Terminal, Environment, TerminalSession } from "../../shared";

/** 正在回答的一站：还没写进会话文件的实时内容 */
export interface LiveStop {
  /** starting：Claude 还在启动；answering：在回答；finishing：已给出结果，进程收尾中 */
  phase: "starting" | "answering" | "finishing";
  items: ChatItem[];
}

export interface PendingPermission {
  requestId: string;
  stopId: string;
  tool: string;
  detail: string;
  canRemember: boolean;
}

/** 一次“压缩成快线”的提炼：在后台跑，弹窗关了也继续，好了再提醒 */
export interface Toast {
  id: number;
  title: string;
  detail?: string;
  /** 左边的路牌 */
  route?: Route;
  action?: { label: string; run(): void };
  /** 下面那条倒计时的线走多久（毫秒）；不给就不画 */
  countdown?: number;
}

export interface PendingDelete {
  route: Route;
  force: boolean;
  keep: boolean;
  /** 撤销时要放回去的东西 */
  children: Route[];
  queue: QueueItem[];
}

export interface Distill {
  routeId: string;
  /** 开始时填的快线名称 */
  name: string;
  /** 提炼好之后不等我看，直接开出 */
  direct: boolean;
  status: "running" | "ready" | "failed";
  summary: string;
  error: string | null;
  startedAt: number;
}

interface State {
  ready: boolean;
  projects: Project[];
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
  /** 各站的回答内容（到站后的，或从会话文件读回来的） */
  content: Record<string, ChatItem[]>;
  live: Record<string, LiveStop>;
  /** 已经点了发车、站还没出现（正在做站前同步）的提问 */
  pendingAsk: Record<string, string>;
  permissions: Record<string, PendingPermission>;
  lastSync: Record<string, SyncLogEntry>;
  /** 各项目候车区里的问题 */
  queue: Record<string, QueueItem[]>;
  drafts: Record<string, string>;
  /** 正开着的整块弹窗：添加项目、开一路新车、同步记录 */
  dialog: null | { kind: "add-project"; dir: string } | { kind: "new-route" } | { kind: "import"; projectId: string } | { kind: "log"; projectId: string; entries: SyncLogEntry[] | null; kept: KeptWorktree[] };
  /** 正在问“这一路还在回答，怎么归档”的那一路 */
  archiveAsk: string | null;
  /** 等到站后要归档的路 */
  archiveWhenDone: string[];
  /** 底部的深色提示条：刚做完的一件事，有的可以撤销或跳过去看 */
  toast: Toast | null;
  /** 刚删掉、还能撤销的那一路：界面上已经拿掉，过几秒才真的删 */
  pendingDelete: PendingDelete | null;
  /** 正在看“全部项目”页 */
  overview: boolean;
  /** 正在看的以前的某一站（不是最新的）；空表示跟着最新 */
  viewing: string | null;
  /** 后台终端，按编号记 */
  terminals: Record<string, Terminal>;
  /** 正在看的那个后台终端和它到现在为止的输出 */
  terminalView: { id: string; output: string } | null;
  /** 正在看“改了什么”的那一路和它的改动；files 为空表示还在读 */
  changesView: { routeId: string; files: FileStat[] | null } | null;
  /** 要你处理的事（右下角的通知） */
  notices: Notice[];
  /** 各路刚从候车区自动发出的问题，通知用 */
  boarded: Record<string, string>;
  /** 各站的摘要提炼，按站记 */
  distills: Record<string, Distill>;
  /** 正开着“压缩成快线”弹窗的那一站 */
  compressStopId: string | null;
  /** 要带到眼前的那一站（地图居中、对话滚到它）；n 每次加一，同一站也能再跳 */
  focus: { stopId: string; n: number } | null;
  historyLoaded: Record<string, boolean>;
  error: string | null;
  selectedProjectId: string | null;
  selectedRouteId: string | null;

  init(): Promise<void>;
  selectProject(projectId: string): void;
  selectRoute(routeId: string): void;
  addProject(): Promise<void>;
  /** 打开“添加项目”弹窗；dir 不给就先让用户选文件夹 */
  openAddProject(dir?: string): Promise<void>;
  /** importIds：顺便把终端里开过的这几个会话导进来 */
  addProjectAt(dir: string, name: string, importIds?: string[]): Promise<void>;
  /** 项目菜单里的“导入终端里的会话” */
  openImport(projectId: string): void;
  importSessions(projectId: string, sessionIds: string[]): Promise<void>;
  openNewRoute(): void;
  /** 开一路新车：名称、颜色、模型可选；带了第一个问题就直接发车；问题来自候车区时把那一条移走 */
  startRoute(opts: { projectId: string; name?: string; color?: number | null; model?: string | null; question?: string; itemId?: string }): Promise<void>;
  /** 看这个项目的同步记录；null 关掉 */
  viewLog(projectId: string | null): void;
  closeDialog(): void;
  setOverview(on: boolean): void;
  openLocal(projectId: string): Promise<void>;
  openSystemTerminal(terminalId: string): Promise<void>;
  /** 让用户选一个文件夹；取消返回 null */
  pickDirectory(): Promise<string | null>;
  inspectDirectory(dir: string): Promise<DirectoryInfo>;
  environment(): Promise<Environment>;
  terminalSessions(dir: string): Promise<TerminalSession[]>;
  /** 拖进来的文件夹：直接打开“添加项目” */
  addDropped(file: File): void;
  createRoute(name?: string): Promise<void>;
  /** 跳到某一站：选中它那一路，地图和对话都带过去 */
  jumpToStop(stopId: string): void;
  openCompress(stopId: string | null): void;
  /** 开始提炼（已有摘要时是重新生成）。立即返回，结果写进 distills */
  startDistill(routeId: string, stopId: string, keep: string, name?: string, direct?: boolean): void;
  /** 取消提炼；已有的摘要留着 */
  cancelDistill(stopId: string): void;
  setSummary(stopId: string, summary: string): void;
  /** 不要这份摘要了 */
  dropDistill(stopId: string): void;
  dismissNotice(id: string): void;
  setRouteModel(routeId: string, model: string | null): Promise<void>;
  renameRoute(routeId: string, name: string): Promise<void>;
  setRouteColor(routeId: string, color: number | null): Promise<void>;
  renameStop(stopId: string, name: string): Promise<void>;
  /** 看以前的某一站；null 回到最新 */
  viewStop(stopId: string | null): void;
  /** 截线；requeue 为真时把那一站的提问放回输入框（改站） */
  truncate(routeId: string, stopId: string, requeue: boolean): Promise<void>;
  /** 打开一个后台终端看输出；null 关掉 */
  viewTerminal(terminalId: string | null): void;
  /** 还在跑的停掉；已退出的从列表里拿掉 */
  stopTerminal(terminalId: string): Promise<void>;
  /** 看这一路改了什么（工作区里还没进 Local 的改动）；null 关掉 */
  viewChanges(routeId: string | null): void;
  /** 把这一路各站的回答读回来（已经读过就不再读） */
  ensureHistory(routeId: string): void;
  ask(routeId: string, text: string): Promise<void>;
  fork(routeId: string, stopId: string, name: string, firstQuestion: string, opts?: { color?: number | null; itemId?: string; switchTo?: boolean }): Promise<void>;
  /** itemId：第一个问题是从候车区挑的，开出后把它从候车区拿掉 */
  createExpress(routeId: string, stopId: string, summary: string, name: string, firstQuestion: string, itemId?: string): Promise<void>;
  resolveConflict(routeId: string): Promise<void>;
  resync(routeId: string): Promise<void>;
  archiveRoute(routeId: string): Promise<void>;
  unarchiveRoute(routeId: string): Promise<void>;
  /** 返回 null 表示已删除；返回文件列表表示还有没进 Local 的改动，没有删 */
  deleteRoute(routeId: string, force: boolean, keepWorktree?: boolean): Promise<SyncFile[] | null>;
  /** 撤销刚才的删除 */
  undoDelete(): void;
  /** 不等了，现在就真的删掉（退出前、又删了另一路时） */
  flushDelete(): Promise<void>;
  showToast(toast: Omit<Toast, "id">, ms?: number): void;
  dismissToast(): void;
  setRouteFlags(routeId: string, flags: { pinned?: boolean; folded?: boolean }): Promise<void>;
  /** 同步记录窗口里：打开或彻底删掉一个留下的工作区 */
  openKept(id: string): void;
  removeKept(id: string): Promise<void>;
  stop(routeId: string): void;
  /** note：不批准时带给 Claude 的一句话 */
  answerPermission(routeId: string, decision: PermissionDecision, note?: string): void;
  discardChanges(routeId: string): Promise<void>;
  exportRoute(routeId: string): Promise<void>;
  /** 归档；这一路正在回答时先问：答完再归档，还是现在停下并归档 */
  requestArchive(routeId: string): void;
  /** mode：later 答完再归档；now 现在停下，停稳后归档 */
  archiveBusy(routeId: string, mode: "later" | "now"): void;
  setPermissionMode(projectId: string, mode: PermissionMode): Promise<void>;
  queueAdd(projectId: string, text: string, routeId?: string | null, mode?: QueueMode): Promise<void>;
  queueAssign(itemId: string, routeId: string | null, mode?: QueueMode): Promise<void>;
  queueRemove(itemId: string): Promise<void>;
  queueBoard(itemId: string): Promise<void>;
  queueStartNew(itemId: string): Promise<void>;
  setDraft(routeId: string, text: string): void;
  dismissError(): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "");

/**
 * 界面拿数据的唯一通道。启动时取一次快照，之后只按事件更新；界面不自己改主进程的数据。
 * 只有这个文件碰 window.bw。
 */
/** 删除之后留多久可以撤销 */
const UNDO_MS = 7000;

export const useStore = create<State>((set, get) => {
  let started = false;
  let toastSeq = 0;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let deleteTimer: ReturnType<typeof setTimeout> | undefined;
  const apply = (e: BwEvent) => {
    // 通知先按“事件之前的数据”算一遍
    set((s) => {
      const notices = reduceNotices(s.notices, e, s);
      let boarded = s.boarded;
      if (e.type === "queue.updated") {
        // 从候车区消失的自动登车的问题：多半是刚发出去了，记一下
        const gone = (s.queue[e.projectId] ?? []).filter((q) => q.mode === "auto" && q.routeId && !e.items.some((x) => x.id === q.id));
        if (gone.length) boarded = { ...boarded, ...Object.fromEntries(gone.map((q) => [q.routeId!, q.text])) };
      } else if (e.type === "stop.created" && boarded[e.stop.routeId] !== undefined) {
        boarded = { ...boarded };
        delete boarded[e.stop.routeId];
      }
      return notices === s.notices && boarded === s.boarded ? {} : { notices, boarded };
    });
    // 说好“答完再归档”的路：一停下来就归档
    if (e.type === "route.updated" && e.route.status !== "answering" && e.route.status !== "awaiting_permission" && e.route.status !== "archived" && get().archiveWhenDone.includes(e.route.id)) {
      set((s) => ({ archiveWhenDone: s.archiveWhenDone.filter((id) => id !== e.route.id) }));
      setTimeout(() => void get().archiveRoute(e.route.id), 0);
    }
    switch (e.type) {
      case "route.updated": {
        const idle = e.route.status !== "answering" && e.route.status !== "awaiting_permission";
        set((s) => {
          const pendingAsk = { ...s.pendingAsk };
          const drafts = { ...s.drafts };
          // 这一站没发出去（站前冲突等）：把提问放回输入框，别弄丢
          if (idle && pendingAsk[e.route.id] !== undefined) {
            drafts[e.route.id] = pendingAsk[e.route.id]!;
            delete pendingAsk[e.route.id];
          }
          const permissions = { ...s.permissions };
          if (e.route.status !== "awaiting_permission") delete permissions[e.route.id];
          // 刚删掉、还在等撤销的路：界面上不放回去，只把最新的样子记着
          if (s.pendingDelete?.route.id === e.route.id) return { pendingDelete: { ...s.pendingDelete, route: e.route } };
          return { routes: { ...s.routes, [e.route.id]: e.route }, pendingAsk, drafts, permissions };
        });
        break;
      }
      case "project.updated":
        set((s) => ({ projects: s.projects.map((p) => (p.id === e.project.id ? e.project : p)) }));
        break;
      case "route.deleted":
        set((s) => {
          const routes = { ...s.routes };
          delete routes[e.routeId];
          const stops = Object.fromEntries(Object.entries(s.stops).filter(([, x]) => x.routeId !== e.routeId));
          return { routes, stops };
        });
        if (get().selectedRouteId === e.routeId) get().selectProject(e.projectId);
        break;
      case "stop.created":
        set((s) => {
          const pendingAsk = { ...s.pendingAsk };
          delete pendingAsk[e.stop.routeId];
          // 摘要站一出现就是到站的，没有实时内容
          const live = e.stop.status === "answering" ? { ...s.live, [e.stop.id]: { phase: "starting" as const, items: [] } } : s.live;
          return { stops: { ...s.stops, [e.stop.id]: e.stop }, pendingAsk, live };
        });
        break;
      case "stop.started":
        set((s) => (s.live[e.stopId] ? { live: { ...s.live, [e.stopId]: { ...s.live[e.stopId]!, phase: "answering" } } } : {}));
        break;
      case "stop.answered":
        set((s) => (s.live[e.stopId] ? { live: { ...s.live, [e.stopId]: { ...s.live[e.stopId]!, phase: "finishing" } } } : {}));
        break;
      case "stop.delta":
        set((s) => {
          const cur = s.live[e.stopId] ?? { phase: "answering" as const, items: [] };
          const items = [...cur.items];
          const last = items.at(-1);
          if (last?.kind === "text") items[items.length - 1] = { kind: "text", text: last.text + e.text };
          else items.push({ kind: "text", text: e.text });
          return { live: { ...s.live, [e.stopId]: { phase: cur.phase === "starting" ? "answering" : cur.phase, items } } };
        });
        break;
      case "stop.tool":
        set((s) => {
          const cur = s.live[e.stopId] ?? { phase: "answering" as const, items: [] };
          return { live: { ...s.live, [e.stopId]: { ...cur, items: [...cur.items, { kind: "tool", tool: e.tool, detail: e.detail, added: e.added, removed: e.removed }] } } };
        });
        break;
      case "stop.updated":
        set((s) => {
          const next: Partial<State> = { stops: { ...s.stops, [e.stop.id]: e.stop } };
          // 到站或没答完：实时内容转成这一站的正式内容
          if (e.stop.status !== "answering" && s.live[e.stop.id]) {
            const live = { ...s.live };
            next.content = { ...s.content, [e.stop.id]: live[e.stop.id]!.items };
            delete live[e.stop.id];
            next.live = live;
          }
          return next;
        });
        break;
      case "permission.request":
        set((s) => ({
          permissions: { ...s.permissions, [e.routeId]: { requestId: e.requestId, stopId: e.stopId, tool: e.tool, detail: summarize(e.input), canRemember: e.canRemember } },
        }));
        break;
      case "queue.updated":
        set((s) => ({ queue: { ...s.queue, [e.projectId]: e.items } }));
        break;
      case "sync.result":
        // “你直接改了 Local”不是这一路的同步结果，只进同步记录
        if (e.entry.direction !== "local") set((s) => ({ lastSync: { ...s.lastSync, [e.entry.routeId]: e.entry } }));
        break;
      case "stops.removed":
        set((s) => {
          const stops = { ...s.stops };
          const content = { ...s.content };
          for (const id of e.stopIds) {
            delete stops[id];
            delete content[id];
          }
          return { stops, content, viewing: s.viewing && e.stopIds.includes(s.viewing) ? null : s.viewing };
        });
        break;
      case "terminal.updated":
        set((s) => ({ terminals: { ...s.terminals, [e.terminal.id]: e.terminal } }));
        break;
      case "terminal.output":
        set((s) => (s.terminalView?.id === e.terminalId ? { terminalView: { id: e.terminalId, output: (s.terminalView.output + e.text).slice(-200_000) } } : {}));
        break;
      case "terminal.removed":
        set((s) => {
          const terminals = { ...s.terminals };
          delete terminals[e.terminalId];
          return { terminals, terminalView: s.terminalView?.id === e.terminalId ? null : s.terminalView };
        });
        break;
    }
  };

  const loadHistory = async (routeId: string) => {
    if (get().historyLoaded[routeId]) return;
    set((s) => ({ historyLoaded: { ...s.historyLoaded, [routeId]: true } }));
    try {
      const contents = await window.bw.history(routeId);
      set((s) => {
        const content = { ...s.content };
        for (const c of contents) if (!s.live[c.stopId] && !content[c.stopId]) content[c.stopId] = c.items;
        return { content };
      });
    } catch {
      set((s) => ({ historyLoaded: { ...s.historyLoaded, [routeId]: false } }));
    }
  };

  const loadProject = async (projectId: string) => {
    const [snap, terms] = await Promise.all([window.bw.snapshot(projectId), window.bw.terminals(projectId).catch(() => [])]);
    set((s) => ({
      terminals: { ...s.terminals, ...Object.fromEntries(terms.map((t) => [t.id, t])) },
      routes: { ...s.routes, ...Object.fromEntries(snap.routes.map((r) => [r.id, r])) },
      stops: { ...s.stops, ...Object.fromEntries(snap.stops.map((x) => [x.id, x])) },
      queue: { ...s.queue, [projectId]: snap.queue },
    }));
    return snap;
  };

  return {
    ready: false,
    projects: [],
    routes: {},
    stops: {},
    content: {},
    live: {},
    pendingAsk: {},
    permissions: {},
    lastSync: {},
    queue: {},
    drafts: {},
    dialog: null,
    archiveAsk: null,
    archiveWhenDone: [],
    toast: null,
    pendingDelete: null,
    overview: false,
    viewing: null,
    terminals: {},
    terminalView: null,
    changesView: null,
    notices: [],
    boarded: {},
    distills: {},
    compressStopId: null,
    focus: null,
    historyLoaded: {},
    error: null,
    selectedProjectId: null,
    selectedRouteId: null,

    async init() {
      if (started) return; // 开发模式下 React 会把初始化跑两遍，事件只能订阅一次
      started = true;
      window.bw.onEvent(apply);
      // 关窗口前：还在等撤销的删除现在就做掉
      window.addEventListener("beforeunload", () => void get().flushDelete());
      try {
        const projects = await window.bw.listProjects();
        set({ projects });
        const snaps = await Promise.all(projects.map((p) => loadProject(p.id)));
        const first = projects[0];
        set({ ready: true });
        if (first) {
          set({ selectedProjectId: first.id });
          const route = snaps[0]!.routes.find((r) => r.status !== "archived");
          if (route) get().selectRoute(route.id);
        }
      } catch (e) {
        set({ ready: true, error: message(e) });
      }
    },

    selectProject(projectId) {
      const route = Object.values(get().routes)
        .filter((r) => r.projectId === projectId && r.status !== "archived")
        .sort((a, b) => a.number - b.number)[0];
      set({ selectedProjectId: projectId, selectedRouteId: route?.id ?? null });
      if (route) get().selectRoute(route.id);
    },

    selectRoute(routeId) {
      const route = get().routes[routeId];
      if (!route) return;
      set((s) => ({ overview: false, viewing: s.viewing && s.stops[s.viewing]?.routeId === routeId ? s.viewing : null, selectedRouteId: routeId, selectedProjectId: route.projectId, notices: noticesAfterSelecting(s.notices, routeId) }));
      void loadHistory(routeId);
      void window.bw.warm(routeId).catch(() => {});
      // 这一路最近一次同步的结果（冲突面板要用）
      void window.bw.syncLog(routeId).then(
        (log) => {
          if (log[0] && !get().lastSync[routeId]) set((s) => ({ lastSync: { ...s.lastSync, [routeId]: log[0]! } }));
        },
        () => {},
      );
    },

    async openAddProject(dir) {
      try {
        const picked = dir ?? (await window.bw.pickDirectory());
        if (picked) set({ dialog: { kind: "add-project", dir: picked } });
      } catch (e) {
        set({ error: message(e) });
      }
    },

    async addProjectAt(dir, name, importIds = []) {
      try {
        const project = await window.bw.addProject(dir, name.trim() || undefined);
        set((s) => ({ dialog: null, projects: s.projects.some((p) => p.id === project.id) ? s.projects : [...s.projects, project] }));
        await loadProject(project.id);
        get().selectProject(project.id);
        if (importIds.length > 0) await get().importSessions(project.id, importIds);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    openImport(projectId) {
      set({ dialog: { kind: "import", projectId } });
    },

    async importSessions(projectId, sessionIds) {
      try {
        const routes = await window.bw.importSessions(projectId, sessionIds);
        set((s) => ({ dialog: s.dialog?.kind === "import" ? null : s.dialog }));
        await loadProject(projectId);
        if (routes[0]) get().selectRoute(routes[0].id);
        if (routes.length > 0) get().showToast({ title: `导入了 ${routes.length} 个会话`, detail: "每个会话画成了一路；终端里原来的会话没动" });
      } catch (e) {
        set({ error: message(e) });
      }
    },

    openNewRoute() {
      if (get().projects.length > 0) set({ dialog: { kind: "new-route" } });
    },

    async startRoute({ projectId, name, color, model, question, itemId }) {
      try {
        let route = await window.bw.createRoute(projectId, name?.trim() || undefined);
        if (color) route = await window.bw.setRouteColor(route.id, color);
        if (model) route = await window.bw.setRouteModel(route.id, model);
        set((s) => ({ dialog: null, routes: { ...s.routes, [route.id]: route } }));
        get().selectRoute(route.id);
        if (itemId) await window.bw.queueRemove(itemId).catch(() => {});
        if (question?.trim()) void get().ask(route.id, question);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    viewLog(projectId) {
      if (!projectId) return set({ dialog: null });
      set({ dialog: { kind: "log", projectId, entries: null, kept: [] } });
      // 刚删掉还在等撤销的那一路：现在就删掉，记录里才看得到它留下的工作区
      void get()
        .flushDelete()
        .then(() => Promise.all([window.bw.projectLog(projectId), window.bw.keptWorktrees(projectId).catch(() => [])]))
        .then(
        ([entries, kept]) => set((s) => (s.dialog?.kind === "log" && s.dialog.projectId === projectId ? { dialog: { kind: "log", projectId, entries, kept } } : {})),
        (e) => set({ error: message(e), dialog: null }),
      );
    },

    closeDialog() {
      set({ dialog: null });
    },

    async openSystemTerminal(terminalId) {
      await window.bw.openSystemTerminal(terminalId).catch((e) => set({ error: message(e) }));
    },
    async openLocal(projectId) {
      await window.bw.openLocal(projectId).catch((e) => set({ error: message(e) }));
    },

    pickDirectory: () => window.bw.pickDirectory().catch(() => null),
    inspectDirectory: (dir) => window.bw.inspectDirectory(dir),
    environment: () => window.bw.environment(),
    terminalSessions: (dir) => window.bw.terminalSessions(dir).catch(() => []),
    addDropped(file) {
      const dir = window.bw.droppedPath(file);
      if (dir) void get().openAddProject(dir);
      else set({ error: "拿不到这个文件夹的位置，点一下自己选吧" });
    },

    setOverview(on) {
      set({ overview: on });
    },

    async addProject() {
      try {
        const dir = await window.bw.pickDirectory();
        if (!dir) return;
        const project = await window.bw.addProject(dir);
        set((s) => ({ projects: s.projects.some((p) => p.id === project.id) ? s.projects : [...s.projects, project] }));
        await loadProject(project.id);
        get().selectProject(project.id);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    async createRoute(name) {
      const projectId = get().selectedProjectId;
      if (!projectId) return;
      try {
        const route = await window.bw.createRoute(projectId, name?.trim() || undefined);
        set((s) => ({ routes: { ...s.routes, [route.id]: route } }));
        get().selectRoute(route.id);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    async ask(routeId, text) {
      const q = text.trim();
      if (!q) return;
      set((s) => ({ pendingAsk: { ...s.pendingAsk, [routeId]: q }, drafts: { ...s.drafts, [routeId]: "" } }));
      try {
        await window.bw.ask(routeId, q);
      } catch (e) {
        set((s) => {
          const pendingAsk = { ...s.pendingAsk };
          delete pendingAsk[routeId];
          return { pendingAsk, drafts: { ...s.drafts, [routeId]: q }, error: message(e) };
        });
      }
    },

    async fork(routeId, stopId, name, firstQuestion, opts = {}) {
      try {
        let route = await window.bw.fork(routeId, stopId, name);
        if (opts.color) route = await window.bw.setRouteColor(route.id, opts.color);
        set((s) => ({ routes: { ...s.routes, [route.id]: route } }));
        if (opts.itemId) void window.bw.queueRemove(opts.itemId).catch(() => {});
        if (opts.switchTo === false) get().showToast({ title: `已开出 ${route.number}路 ${route.name}`, detail: firstQuestion.trim() ? "第一个问题已发出" : "停在分叉站，等你提问", route, action: { label: "去看看", run: () => get().selectRoute(route.id) } });
        else get().selectRoute(route.id);
        if (firstQuestion.trim()) await get().ask(route.id, firstQuestion);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    jumpToStop(stopId) {
      const stop = get().stops[stopId];
      if (!stop) return;
      get().selectRoute(stop.routeId);
      set((s) => ({ focus: { stopId, n: (s.focus?.n ?? 0) + 1 } }));
    },

    openCompress(stopId) {
      set((s) => ({ compressStopId: stopId, notices: stopId ? s.notices.filter((n) => !(n.kind === "summary" && n.stopId === stopId)) : s.notices }));
    },

    startDistill(routeId, stopId, keep, name, direct) {
      const before = get().distills[stopId];
      if (before?.status === "running") return;
      const startedAt = Date.now();
      const mine = () => get().distills[stopId]?.startedAt === startedAt;
      const base = { routeId, name: name ?? before?.name ?? "", direct: direct ?? false };
      set((s) => ({
        distills: { ...s.distills, [stopId]: { ...base, status: "running", summary: before?.summary ?? "", error: null, startedAt } },
        // 第一次提炼：弹窗收起来，进度在线路图和候车区里看
        compressStopId: before?.summary ? s.compressStopId : null,
      }));
      window.bw.distill(routeId, stopId, keep.trim() || undefined).then(
        (summary) => {
          if (!mine()) return; // 已取消或丢掉
          if (base.direct) {
            set((s) => ({ distills: { ...s.distills, [stopId]: { ...base, status: "ready", summary, error: null, startedAt } } }));
            return void get().createExpress(routeId, stopId, summary, base.name, "");
          }
          set((s) => ({
            distills: { ...s.distills, [stopId]: { ...base, status: "ready", summary, error: null, startedAt } },
            // 弹窗没开着：提醒一下
            notices: s.compressStopId === stopId ? s.notices : [...s.notices.filter((n) => n.id !== `summary:${stopId}`), { id: `summary:${stopId}`, kind: "summary", routeId, stopId }],
          }));
        },
        (e) => {
          if (!mine()) return;
          set((s) => ({ distills: { ...s.distills, [stopId]: { ...base, status: before?.summary ? "ready" : "failed", summary: before?.summary ?? "", error: message(e), startedAt } }, error: before?.summary || s.compressStopId === stopId ? s.error : `摘要没有提炼出来：${message(e)}` }));
        },
      );
    },

    cancelDistill(stopId) {
      const d = get().distills[stopId];
      if (d?.status !== "running") return;
      void window.bw.cancelDistill(d.routeId);
      set((s) => {
        const distills = { ...s.distills };
        if (d.summary) distills[stopId] = { ...d, status: "ready", startedAt: 0 };
        else delete distills[stopId];
        return { distills };
      });
    },

    setSummary(stopId, summary) {
      set((s) => (s.distills[stopId] ? { distills: { ...s.distills, [stopId]: { ...s.distills[stopId]!, summary } } } : {}));
    },

    dropDistill(stopId) {
      const d = get().distills[stopId];
      if (d?.status === "running") void window.bw.cancelDistill(d.routeId);
      set((s) => {
        const distills = { ...s.distills };
        delete distills[stopId];
        return { distills, notices: s.notices.filter((n) => !(n.kind === "summary" && n.stopId === stopId)) };
      });
    },

    ensureHistory(routeId) {
      void loadHistory(routeId);
    },

    async renameRoute(routeId, name) {
      await window.bw.renameRoute(routeId, name).then(
        (route) => set((s) => ({ routes: { ...s.routes, [route.id]: route } })),
        (e) => set({ error: message(e) }),
      );
    },
    async setRouteColor(routeId, color) {
      await window.bw.setRouteColor(routeId, color).then(
        (route) => set((s) => ({ routes: { ...s.routes, [route.id]: route } })),
        (e) => set({ error: message(e) }),
      );
    },
    viewStop(stopId) {
      if (!stopId) return set({ viewing: null });
      const stop = get().stops[stopId];
      if (!stop) return;
      get().selectRoute(stop.routeId);
      set((s) => ({ viewing: stopId, focus: { stopId, n: (s.focus?.n ?? 0) + 1 } }));
    },

    async truncate(routeId, stopId, requeue) {
      try {
        const { prompt } = await window.bw.truncate(routeId, stopId);
        if (requeue) set((s) => ({ drafts: { ...s.drafts, [routeId]: prompt } }));
      } catch (e) {
        set({ error: message(e) });
      }
    },

    async renameStop(stopId, name) {
      await window.bw.renameStop(stopId, name).catch((e) => set({ error: message(e) }));
    },
    async setRouteModel(routeId, model) {
      try {
        const route = await window.bw.setRouteModel(routeId, model);
        set((s) => ({ routes: { ...s.routes, [route.id]: route } }));
      } catch (e) {
        set({ error: message(e) });
      }
    },

    viewTerminal(terminalId) {
      if (!terminalId) return set({ terminalView: null });
      set({ terminalView: { id: terminalId, output: "" } });
      // 先读到现在为止的；这之后新的输出由事件接上
      void window.bw.terminalOutput(terminalId).then(
        (output) => set((s) => (s.terminalView?.id === terminalId ? { terminalView: { id: terminalId, output } } : {})),
        (e) => set({ error: message(e) }),
      );
    },

    async stopTerminal(terminalId) {
      try {
        await window.bw.terminalStop(terminalId);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    viewChanges(routeId) {
      if (!routeId) return set({ changesView: null });
      set({ changesView: { routeId, files: null } });
      void window.bw.changes(routeId).then(
        (files) => set((s) => (s.changesView?.routeId === routeId ? { changesView: { routeId, files } } : {})),
        (e) => set({ error: message(e), changesView: null }),
      );
    },

    dismissNotice(id) {
      set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
    },

    async createExpress(routeId, stopId, summary, name, firstQuestion, itemId) {
      try {
        const route = await window.bw.createExpress(routeId, stopId, summary, name);
        if (itemId) void window.bw.queueRemove(itemId).catch(() => {});
        get().dropDistill(stopId);
        set((s) => ({ routes: { ...s.routes, [route.id]: route } }));
        get().selectRoute(route.id);
        const source = get().routes[routeId];
        const from = source ? `${source.express ? `快${source.express}` : `${source.number}路`} 照常` : "";
        get().showToast({ title: `已开出 快${route.express} ${route.name}`, detail: [firstQuestion.trim() ? "第一个问题已发出" : "停在摘要站，等你提问", from].filter(Boolean).join("，"), route });
        if (firstQuestion.trim()) await get().ask(route.id, firstQuestion);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    async resolveConflict(routeId) {
      try {
        await window.bw.resolveConflict(routeId);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    async resync(routeId) {
      try {
        await window.bw.resync(routeId);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    async archiveRoute(routeId) {
      try {
        const route = await window.bw.archiveRoute(routeId);
        set((s) => ({ routes: { ...s.routes, [route.id]: route } }));
        if (get().selectedRouteId === routeId) get().selectProject(route.projectId);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    async unarchiveRoute(routeId) {
      try {
        const route = await window.bw.unarchiveRoute(routeId);
        set((s) => ({ routes: { ...s.routes, [route.id]: route } }));
        get().showToast({ title: `已恢复 ${route.name}`, detail: "下次提问前，先拿 Local 的最新代码", route, action: { label: "去看看", run: () => get().selectRoute(routeId) } });
      } catch (e) {
        set({ error: message(e) });
      }
    },

    openKept(id) {
      void window.bw.openKept(id).catch((e) => set({ error: message(e) }));
    },

    async removeKept(id) {
      try {
        await window.bw.removeKept(id);
        set((s) => (s.dialog?.kind === "log" ? { dialog: { ...s.dialog, kept: s.dialog.kept.filter((k) => k.id !== id) } } : {}));
      } catch (e) {
        set({ error: message(e) });
      }
    },

    async deleteRoute(routeId, force, keepWorktree = false) {
      const route = get().routes[routeId];
      if (!route) return null;
      if (route.status === "answering" || route.status === "awaiting_permission") {
        set({ error: "这一路正在回答，到站或停车后才能删除" });
        return null;
      }
      const files = await window.bw.changes(routeId).catch(() => []);
      if (!force && !keepWorktree && files.length > 0) return files.map((f) => ({ path: f.path, note: f.kind }));
      await get().flushDelete();
      const label = route.express ? `快${route.express}` : `${route.number}路`;
      const waiting = (get().queue[route.projectId] ?? []).filter((q) => q.routeId === routeId);
      const children = Object.values(get().routes).filter((r) => r.parentRouteId === routeId);
      // 界面上先拿掉；过几秒才真的删，这期间可以撤销
      set((s) => {
        const routes = { ...s.routes };
        delete routes[routeId];
        for (const c of children) routes[c.id] = { ...c, orphanOf: label };
        return {
          routes,
          queue: { ...s.queue, [route.projectId]: (s.queue[route.projectId] ?? []).map((q) => (q.routeId === routeId ? { ...q, routeId: null, mode: "unassigned" as const } : q)) },
          pendingDelete: { route, force: force || files.length > 0, keep: keepWorktree, children, queue: s.queue[route.projectId] ?? [] },
        };
      });
      if (get().selectedRouteId === routeId) get().selectProject(route.projectId);
      const parts = ["Local 的代码没动"];
      if (keepWorktree) parts.push(files.length > 0 ? `${files.length} 个没同步的文件留在工作区` : "工作区留着，在“同步记录”里能找到");
      else if (files.length > 0) parts.push(`${files.length} 个没进 Local 的文件一起删了`);
      if (waiting.length > 0) parts.push(`${waiting.length} 条候车回到未派车`);
      get().showToast({ title: `已删除 ${label} ${route.name}`, detail: parts.join("；"), action: { label: "撤销", run: () => get().undoDelete() }, countdown: UNDO_MS }, UNDO_MS);
      clearTimeout(deleteTimer);
      deleteTimer = setTimeout(() => void get().flushDelete(), UNDO_MS);
      return null;
    },

    undoDelete() {
      const p = get().pendingDelete;
      if (!p) return;
      clearTimeout(deleteTimer);
      set((s) => {
        const routes = { ...s.routes, [p.route.id]: p.route };
        for (const c of p.children) if (routes[c.id]) routes[c.id] = { ...routes[c.id]!, orphanOf: c.orphanOf };
        return { routes, queue: { ...s.queue, [p.route.projectId]: p.queue }, pendingDelete: null, toast: null };
      });
      if (p.route.status !== "archived") get().selectRoute(p.route.id);
    },

    async flushDelete() {
      const p = get().pendingDelete;
      if (!p) return;
      clearTimeout(deleteTimer);
      set({ pendingDelete: null });
      const back = (why: string) => set((s) => ({ routes: { ...s.routes, [p.route.id]: p.route }, queue: { ...s.queue, [p.route.projectId]: p.queue }, error: why }));
      try {
        const r = await window.bw.deleteRoute(p.route.id, p.force, p.keep);
        if (r.status === "has-unsynced") back("这一路又有了没进 Local 的改动，没有删");
      } catch (e) {
        back(message(e));
      }
    },

    showToast(toast, ms = 6000) {
      const id = ++toastSeq;
      clearTimeout(toastTimer);
      set({ toast: { ...toast, id } });
      toastTimer = setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : {})), ms);
    },

    dismissToast() {
      clearTimeout(toastTimer);
      set({ toast: null });
    },

    async setRouteFlags(routeId, flags) {
      await window.bw.setRouteFlags(routeId, flags).then(
        (route) => set((s) => ({ routes: { ...s.routes, [route.id]: route } })),
        (e) => set({ error: message(e) }),
      );
    },

    stop(routeId) {
      void window.bw.stop(routeId);
    },

    async discardChanges(routeId) {
      await window.bw.discardChanges(routeId).catch((e) => set({ error: message(e) }));
    },

    async exportRoute(routeId) {
      await window.bw.exportRoute(routeId).catch((e) => set({ error: message(e) }));
    },

    requestArchive(routeId) {
      const route = get().routes[routeId];
      if (!route) return;
      if (route.status === "answering" || route.status === "awaiting_permission") set({ archiveAsk: routeId });
      else void get().archiveRoute(routeId);
    },

    archiveBusy(routeId, mode) {
      set((s) => ({ archiveAsk: null, archiveWhenDone: [...s.archiveWhenDone.filter((id) => id !== routeId), routeId] }));
      if (mode === "now") get().stop(routeId);
    },

    answerPermission(routeId, decision, note) {
      const p = get().permissions[routeId];
      if (!p) return;
      set((s) => {
        const permissions = { ...s.permissions };
        delete permissions[routeId];
        return { permissions };
      });
      void window.bw.answerPermission(p.requestId, decision, note);
    },

    async setPermissionMode(projectId, mode) {
      try {
        const project = await window.bw.setPermissionMode(projectId, mode);
        set((s) => ({ projects: s.projects.map((p) => (p.id === project.id ? project : p)) }));
      } catch (e) {
        set({ error: message(e) });
      }
    },

    // 候车区的操作：结果都通过 queue.updated 事件回来，这里只管发出和报错
    async queueAdd(projectId, text, routeId, mode) {
      await window.bw.queueAdd(projectId, text, routeId, mode).catch((e) => set({ error: message(e) }));
    },
    async queueAssign(itemId, routeId, mode) {
      await window.bw.queueAssign(itemId, routeId, mode).catch((e) => set({ error: message(e) }));
    },
    async queueRemove(itemId) {
      await window.bw.queueRemove(itemId).catch((e) => set({ error: message(e) }));
    },
    async queueBoard(itemId) {
      await window.bw.queueBoard(itemId).catch((e) => set({ error: message(e) }));
    },
    async queueStartNew(itemId) {
      try {
        const route = await window.bw.queueStartNew(itemId);
        set((s) => ({ routes: { ...s.routes, [route.id]: route } }));
        get().selectRoute(route.id);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    setDraft: (routeId, text) => set((s) => ({ drafts: { ...s.drafts, [routeId]: text } })),
    dismissError: () => set({ error: null }),
  };
});

/** 批准卡片上显示的一行：命令、文件名等 */
function summarize(input: Record<string, unknown>): string {
  for (const key of ["command", "file_path", "path", "url", "pattern", "description"]) {
    const v = input[key];
    if (typeof v === "string" && v) return v;
  }
  return JSON.stringify(input).slice(0, 300);
}

/** 当前项目里没归档的路，按路号 */
export function useRoutes(projectId: string | null): Route[] {
  const routes = useStore((s) => s.routes);
  return Object.values(routes)
    .filter((r) => r.projectId === projectId && r.status !== "archived")
    .sort((a, b) => a.number - b.number);
}

export function useStops(routeId: string | null): Stop[] {
  const stops = useStore((s) => s.stops);
  return Object.values(stops)
    .filter((s) => s.routeId === routeId)
    .sort((a, b) => a.seq - b.seq);
}
