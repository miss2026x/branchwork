import { create } from "zustand";
import { noticesAfterSelecting, reduceNotices, type Notice } from "./notices";
import type { BwEvent, ChatItem, ImportProgress, PermissionDecision, PermissionMode, Project, PromptImage, RouteActivity, QueueItem, QueueMode, Route, Stop, SyncFile, SyncLogEntry, DirectoryInfo, FileStat, KeptWorktree, Terminal, Environment, TerminalSession, RemoveProjectResult, Effort, ClaudeOptions, LocalPreset, LocalStatus } from "../../shared";
import { fromPrompt, OBJ, type DraftImage } from "../chat/draft";
import { routeLabel } from "../ui/route-color";

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
  /** Claude 自己写的一句说明（命令的 description），没有就不显示 */
  reason?: string;
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

/** 一路车按什么跑：开新车、分叉、开快线时在弹窗里选的 */
export interface RunSettings {
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode;
}

/** 新开出来的路如果和选的不一样（默认沿用来源那一路），按选的改过来 */
async function applyRun(route: Route, run?: RunSettings): Promise<Route> {
  if (!run) return route;
  if (run.model !== route.model || run.effort !== route.effort) route = await window.bw.setRouteModel(route.id, run.model, run.effort);
  if (run.permissionMode !== route.permissionMode) route = await window.bw.setRoutePermissionMode(route.id, run.permissionMode);
  return route;
}

interface State {
  ready: boolean;
  projects: Project[];
  /**
   * 每个项目能选的模型和批准方式（从这台电脑上的 Claude Code 读的）。没有这一项：还没读过；
   * loading：正在读、手里还没有；failed：没读到（界面上先给几个常见的）
   */
  claudeOptions: Record<string, ClaudeOptions | "loading" | "failed">;
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
  /** 各站的回答内容（到站后的，或从会话文件读回来的） */
  content: Record<string, ChatItem[]>;
  live: Record<string, LiveStop>;
  /** 已经点了发车、站还没出现（正在做站前同步）的提问 */
  pendingAsk: Record<string, string>;
  /** 那个提问带的图片 */
  pendingImages: Record<string, PromptImage[]>;
  /** 每一路此刻在做什么（设计稿 4-8：在想、正在写文件、工具在跑、停车中） */
  activity: Record<string, RouteActivity>;
  /** 正在回答的站：它想的内容 */
  thinking: Record<string, string>;
  /** 导入终端会话的进度，按导入任务 */
  imports: Record<string, ImportProgress>;
  /** 正在显示进度窗口的导入任务；null：在后台（左下角小条） */
  importShown: string | null;
  /** 刚点了导入、进度窗口还没出现：等这个项目的第一条进度来了就打开 */
  importAwaiting: string | null;
  /** 正在开新的一路（开新车、开新对话、压缩成快线）：在开哪一路、做到哪一步、从什么时候开始（设计稿 4-8 的做法） */
  preparing: { label: string; step: string; since: number } | null;
  permissions: Record<string, PendingPermission>;
  lastSync: Record<string, SyncLogEntry>;
  /** 各项目候车区里的问题 */
  queue: Record<string, QueueItem[]>;
  /** 各路输入框里写了一半的问题：文字里每张图占一个 OBJ 字符，图片按顺序在 draftImages 里 */
  drafts: Record<string, string>;
  draftImages: Record<string, DraftImage[]>;
  /** 站或候车问题带的图片（用到时才去取）；loading：正在取 */
  images: Record<string, PromptImage[] | "loading">;
  /** 正在看大图：哪几张、从第几张开始、标题写什么 */
  viewer: { images: PromptImage[]; index: number; title: string } | null;
  /** 正开着的整块弹窗：添加项目、开一路新车、同步记录 */
  dialog:
    | null
    | { kind: "add-project"; dir: string }
    | { kind: "new-route" }
    | { kind: "import"; projectId: string }
    | { kind: "log"; projectId: string; entries: SyncLogEntry[] | null; kept: KeptWorktree[] }
    /** 管理专车的常用提示 */
    | { kind: "local-presets"; projectId: string }
    /** 移除项目；blocked 是第一次确认后发现的没进 Local 的改动和留下的工作区 */
    | { kind: "remove-project"; projectId: string; blocked: Extract<RemoveProjectResult, { status: "has-unsynced" }> | null; error: string | null };
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
  /** 各项目 Local 现在的样子（设计稿 9-10 Local 标签、专车面板） */
  localStatus: Record<string, LocalStatus>;
  /** 各项目专车的常用提示；null 是没改过（用自带的）；没有这一项是还没读 */
  localPresets: Record<string, LocalPreset[] | null>;
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
  /** 打开“移除项目”的确认 */
  openRemoveProject(projectId: string): void;
  /** 确认移除；force：连没进 Local 的改动和留下的工作区一起删 */
  removeProject(force: boolean): Promise<void>;
  importSessions(projectId: string, sessionIds: string[]): Promise<void>;
  /** 进度窗口：打开（看某个导入）、放到后台 */
  showImport(jobId: string | null): void;
  importCancel(jobId: string): void;
  openNewRoute(): void;
  /** 开一路新车：名称、颜色、模型可选；带了第一个问题就直接发车；问题来自候车区时把那一条移走 */
  startRoute(opts: { projectId: string; name?: string; color?: number | null; model?: string | null; effort?: Effort | null; permissionMode?: PermissionMode; question?: string; images?: PromptImage[]; itemId?: string }): Promise<void>;
  /** 看这个项目的同步记录；null 关掉 */
  viewLog(projectId: string | null): void;
  closeDialog(): void;
  setOverview(on: boolean): void;
  openLocal(projectId: string): Promise<void>;
  /** 上 Local 专车：还没有就开一辆，然后选中它 */
  openLocalRoute(projectId: string): Promise<void>;
  /** 重新看一遍 Local 现在的样子 */
  refreshLocal(projectId: string): void;
  loadLocalPresets(projectId: string): void;
  /** 专车重新开始：清掉对话，Local 里的文件不动 */
  resetLocal(routeId: string): Promise<void>;
  /** 打开“管理常用提示” */
  openLocalPresets(projectId: string): void;
  /** 存专车的常用提示；null 恢复自带的 */
  saveLocalPresets(projectId: string, presets: LocalPreset[] | null): void;
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
  setRouteModel(routeId: string, model: string | null, effort?: Effort | null): Promise<void>;
  /** 读这个项目能选的模型和批准方式（每个项目只读一次；先给上次的，新的到了再换） */
  loadClaudeOptions(projectId: string): void;
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
  /** images：带的图片，text 里的“[图 N]”标出位置 */
  ask(routeId: string, text: string, images?: PromptImage[]): Promise<void>;
  /** 取一站或一个候车问题带的图片（取过就不再取） */
  loadImages(ownerId: string): void;
  openViewer(images: PromptImage[], index: number, title: string): void;
  closeViewer(): void;
  fork(routeId: string, stopId: string, name: string, firstQuestion: string, opts?: { color?: number | null; images?: PromptImage[]; itemId?: string; switchTo?: boolean; run?: RunSettings }): Promise<void>;
  /** itemId：第一个问题是从候车区挑的，开出后把它从候车区拿掉 */
  createExpress(routeId: string, stopId: string, summary: string, name: string, firstQuestion: string, itemId?: string, run?: RunSettings, images?: PromptImage[]): Promise<void>;
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
  /** 这一路的批准方式（也记成项目的默认，之后新开的路沿用） */
  setRouteMode(routeId: string, mode: PermissionMode): Promise<void>;
  queueAdd(projectId: string, text: string, routeId?: string | null, mode?: QueueMode, images?: PromptImage[]): Promise<void>;
  queueAssign(itemId: string, routeId: string | null, mode?: QueueMode): Promise<void>;
  queueRemove(itemId: string): Promise<void>;
  queueBoard(itemId: string): Promise<void>;
  queueStartNew(itemId: string): Promise<void>;
  /** images 不传：文字里没有图时清掉草稿的图片，有图时图片不变 */
  setDraft(routeId: string, text: string, images?: DraftImage[]): void;
  /** 候车区里一个问题带的图（没有就是空的） */
  queuedImages(item: QueueItem): Promise<PromptImage[]>;
  /** 候车的问题“改一改”：连同图片放回那一路的输入框，从候车区拿掉 */
  editQueued(item: QueueItem, routeId: string): Promise<void>;
  /** 草稿里一张图处理好了（或处理失败） */
  patchDraftImage(routeId: string, id: string, patch: Partial<DraftImage>): void;
  dismissError(): void;
}

let draftSeq = 0;
/** 草稿里图片的编号（只在这个窗口里用） */
export const draftId = () => `img${++draftSeq}`;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "");

/**
 * 界面拿数据的唯一通道。启动时取一次快照，之后只按事件更新；界面不自己改主进程的数据。
 * 只有这个文件碰 window.bw。
 */
/** 删除之后留多久可以撤销 */
const UNDO_MS = 7000;

export const useStore = create<State>((set, get) => {
  /** 正在读 Local 现状的项目：同时来的几次只读一次 */
const localReading = new Set<string>();
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
          const draftImages = { ...s.draftImages };
          // 这一站没发出去（站前冲突等）：把提问放回输入框，别弄丢
          if (idle && pendingAsk[e.route.id] !== undefined) {
            const back = fromPrompt(pendingAsk[e.route.id]!, s.pendingImages[e.route.id] ?? [], draftId);
            drafts[e.route.id] = back.text;
            draftImages[e.route.id] = back.images;
            delete pendingAsk[e.route.id];
          }
          const permissions = { ...s.permissions };
          if (e.route.status !== "awaiting_permission") delete permissions[e.route.id];
          // 刚删掉、还在等撤销的路：界面上不放回去，只把最新的样子记着
          if (s.pendingDelete?.route.id === e.route.id) return { pendingDelete: { ...s.pendingDelete, route: e.route } };
          return { routes: { ...s.routes, [e.route.id]: e.route }, pendingAsk, drafts, draftImages, permissions };
        });
        break;
      }
      case "project.updated":
        set((s) => ({ projects: s.projects.map((p) => (p.id === e.project.id ? e.project : p)) }));
        break;
      case "claude-options.updated":
        // 读不到时：手里有上次的就继续用上次的
        set((s) => {
          const had = s.claudeOptions[e.projectId];
          return { claudeOptions: { ...s.claudeOptions, [e.projectId]: e.options ?? (typeof had === "object" ? had : "failed") } };
        });
        break;
      case "project.removed": {
        const routeIds = new Set(Object.values(get().routes).filter((r) => r.projectId === e.projectId).map((r) => r.id));
        set((s) => {
          const queue = { ...s.queue };
          delete queue[e.projectId];
          return {
            projects: s.projects.filter((p) => p.id !== e.projectId),
            routes: Object.fromEntries(Object.entries(s.routes).filter(([id]) => !routeIds.has(id))),
            stops: Object.fromEntries(Object.entries(s.stops).filter(([, x]) => !routeIds.has(x.routeId))),
            notices: s.notices.filter((n) => !routeIds.has(n.routeId)),
            viewing: s.viewing && s.stops[s.viewing] && routeIds.has(s.stops[s.viewing]!.routeId) ? null : s.viewing,
            queue,
          };
        });
        if (get().selectedProjectId === e.projectId) {
          const next = get().projects[0];
          if (next) get().selectProject(next.id);
          else set({ selectedProjectId: null, selectedRouteId: null });
        }
        break;
      }
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
      case "local.status":
        set((s) => ({ localStatus: { ...s.localStatus, [e.status.projectId]: e.status } }));
        break;
      case "route.activity":
        set((s) => {
          const activity = { ...s.activity };
          if (e.activity) activity[e.routeId] = e.activity;
          else delete activity[e.routeId];
          return { activity };
        });
        break;
      case "stop.thinking":
        set((s) => ({ thinking: { ...s.thinking, [e.stopId]: (s.thinking[e.stopId] ?? "") + e.text } }));
        break;
      case "route.preparing":
        if (e.step) set((s) => (s.preparing ? { preparing: { ...s.preparing, step: e.step! } } : {}));
        break;
      case "import.progress": {
        const p = e.progress;
        set((s) => ({
          imports: { ...s.imports, [p.jobId]: p },
          // 刚点了导入（或添加项目时勾了导入）：第一条进度来了就打开进度窗口
          ...(s.importAwaiting === p.projectId && !p.finished ? { importShown: p.jobId, importAwaiting: null, dialog: s.dialog?.kind === "import" ? null : s.dialog } : {}),
        }));
        break;
      }
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
          permissions: { ...s.permissions, [e.routeId]: { requestId: e.requestId, stopId: e.stopId, tool: e.tool, detail: summarize(e.input), reason: typeof e.input.command === "string" && typeof e.input.description === "string" ? e.input.description : undefined, canRemember: e.canRemember } },
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
    claudeOptions: {},
    routes: {},
    stops: {},
    content: {},
    live: {},
    pendingAsk: {},
    pendingImages: {},
    activity: {},
    thinking: {},
    imports: {},
    importShown: null,
    importAwaiting: null,
    preparing: null,
    permissions: {},
    lastSync: {},
    queue: {},
    drafts: {},
    draftImages: {},
    images: {},
    viewer: null,
    dialog: null,
    archiveAsk: null,
    archiveWhenDone: [],
    toast: null,
    pendingDelete: null,
    overview: false,
    viewing: null,
    terminals: {},
    localStatus: {},
    localPresets: {},
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
          const route = snaps[0]!.routes.find((r) => r.status !== "archived" && !r.local);
          if (route) get().selectRoute(route.id);
        }
      } catch (e) {
        set({ ready: true, error: message(e) });
      }
    },

    selectProject(projectId) {
      const route = Object.values(get().routes)
        .filter((r) => r.projectId === projectId && r.status !== "archived" && !r.local)
        .sort((a, b) => a.number - b.number)[0];
      set({ selectedProjectId: projectId, selectedRouteId: route?.id ?? null });
      get().loadClaudeOptions(projectId);
      if (route) get().selectRoute(route.id);
    },

    selectRoute(routeId) {
      const route = get().routes[routeId];
      if (!route) return;
      set((s) => ({ overview: false, viewing: s.viewing && s.stops[s.viewing]?.routeId === routeId ? s.viewing : null, selectedRouteId: routeId, selectedProjectId: route.projectId, notices: noticesAfterSelecting(s.notices, routeId) }));
      get().loadClaudeOptions(route.projectId);
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

    openRemoveProject(projectId) {
      set({ dialog: { kind: "remove-project", projectId, blocked: null, error: null } });
    },

    async removeProject(force) {
      const d = get().dialog;
      if (d?.kind !== "remove-project") return;
      const project = get().projects.find((p) => p.id === d.projectId);
      // 还在等撤销的删除如果是这个项目的，先做掉，免得它过几秒再去删一个已经没了的路
      if (get().pendingDelete?.route.projectId === d.projectId) await get().flushDelete();
      try {
        const r = await window.bw.removeProject(d.projectId, force);
        if (r.status === "has-unsynced") return set({ dialog: { ...d, blocked: r, error: null } });
        set({ dialog: null });
        get().showToast({ title: `已移除 ${project?.name ?? "项目"}`, detail: "Local 文件夹没动；想再用时重新添加就行" });
      } catch (e) {
        set({ dialog: { ...d, error: message(e) } });
      }
    },

    async importSessions(projectId, sessionIds) {
      set({ importAwaiting: projectId });
      try {
        const routes = await window.bw.importSessions(projectId, sessionIds);
        const job = Object.values(get().imports).find((p) => p.projectId === projectId && p.finished && p.items.length === sessionIds.length);
        const failed = job?.items.some((i) => i.state === "failed");
        // 全导好了：进度窗口自己关掉；有没导成的，窗口留着让人看原因
        set((s) => ({ dialog: s.dialog?.kind === "import" ? null : s.dialog, importAwaiting: null, importShown: failed ? s.importShown : null }));
        await loadProject(projectId);
        if (routes[0]) get().selectRoute(routes[0].id);
        if (routes.length > 0) get().showToast({ title: `导入了 ${routes.length} 个会话`, detail: "每个会话画成了一路；终端里原来的会话没动" });
      } catch (e) {
        set({ error: message(e), importAwaiting: null });
      }
    },
    showImport: (jobId) => set({ importShown: jobId }),
    importCancel: (jobId) => void window.bw.importCancel(jobId),

    openNewRoute() {
      if (get().projects.length > 0) set({ dialog: { kind: "new-route" } });
    },

    async startRoute({ projectId, name, color, model, effort, permissionMode, question, images = [], itemId }) {
      if (get().preparing) return; // 已经在开了：别点两下开出两路
      const next = Math.max(0, ...Object.values(get().routes).filter((r) => r.projectId === projectId).map((r) => r.number)) + 1;
      set({ preparing: { label: `开出 ${next}路`, step: "准备", since: Date.now() } });
      try {
        let route = await window.bw.createRoute(projectId, name?.trim() || undefined);
        if (color) route = await window.bw.setRouteColor(route.id, color);
        route = await applyRun(route, { model: model ?? null, effort: effort ?? null, permissionMode: permissionMode ?? route.permissionMode });
        set((s) => ({ dialog: null, routes: { ...s.routes, [route.id]: route } }));
        get().selectRoute(route.id);
        if (itemId) await window.bw.queueRemove(itemId).catch(() => {});
        if (question?.trim() || images.length) void get().ask(route.id, question ?? "", images);
      } catch (e) {
        set({ error: message(e) });
      } finally {
        set({ preparing: null });
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
    async openLocalRoute(projectId) {
      const found = Object.values(get().routes).find((r) => r.projectId === projectId && r.local);
      try {
        const route = found ?? (await window.bw.localRoute(projectId));
        set((s) => ({ routes: { ...s.routes, [route.id]: route } }));
        get().selectRoute(route.id);
        get().refreshLocal(projectId);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    refreshLocal(projectId) {
      if (localReading.has(projectId)) return; // 正在读了
      localReading.add(projectId);
      void window.bw
        .localStatus(projectId)
        .then(
          (status) => set((s) => ({ localStatus: { ...s.localStatus, [projectId]: status } })),
          () => {},
        )
        .finally(() => localReading.delete(projectId));
    },

    async resetLocal(routeId) {
      try {
        const route = await window.bw.resetLocal(routeId);
        set((s) => ({ routes: { ...s.routes, [route.id]: route } }));
      } catch (e) {
        set({ error: message(e) });
      }
    },

    openLocalPresets(projectId) {
      get().loadLocalPresets(projectId);
      set({ dialog: { kind: "local-presets", projectId } });
    },

    loadLocalPresets(projectId) {
      if (projectId in get().localPresets) return;
      void window.bw.localPresets(projectId).then(
        (list) => set((s) => ({ localPresets: { ...s.localPresets, [projectId]: list } })),
        () => {},
      );
    },

    saveLocalPresets(projectId, presets) {
      set((s) => ({ localPresets: { ...s.localPresets, [projectId]: presets } }));
      void window.bw.setLocalPresets(projectId, presets).catch((e) => set({ error: message(e) }));
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

    async ask(routeId, text, images = []) {
      const q = text.trim();
      if (!q && images.length === 0) return;
      set((s) => ({ pendingAsk: { ...s.pendingAsk, [routeId]: q }, pendingImages: { ...s.pendingImages, [routeId]: images }, drafts: { ...s.drafts, [routeId]: "" }, draftImages: { ...s.draftImages, [routeId]: [] } }));
      try {
        await window.bw.ask(routeId, q, images.length > 0 ? images : undefined);
      } catch (e) {
        set((s) => {
          const pendingAsk = { ...s.pendingAsk };
          delete pendingAsk[routeId];
          const back = fromPrompt(q, images, draftId);
          return { pendingAsk, drafts: { ...s.drafts, [routeId]: back.text }, draftImages: { ...s.draftImages, [routeId]: back.images }, error: message(e) };
        });
      }
    },

    loadImages(ownerId) {
      if (get().images[ownerId]) return;
      set((s) => ({ images: { ...s.images, [ownerId]: "loading" } }));
      window.bw.images(ownerId).then(
        (list) => set((s) => ({ images: { ...s.images, [ownerId]: list } })),
        () =>
          set((s) => {
            const images = { ...s.images };
            delete images[ownerId];
            return { images };
          }),
      );
    },
    openViewer: (images, index, title) => set({ viewer: { images, index, title } }),
    closeViewer: () => set({ viewer: null }),

    async fork(routeId, stopId, name, firstQuestion, opts = {}) {
      if (get().preparing) return;
      set({ preparing: { label: "开新对话", step: "准备", since: Date.now() } });
      try {
        let route = await window.bw.fork(routeId, stopId, name);
        set({ preparing: null });
        if (opts.color) route = await window.bw.setRouteColor(route.id, opts.color);
        route = await applyRun(route, opts.run);
        set((s) => ({ routes: { ...s.routes, [route.id]: route } }));
        if (opts.itemId) void window.bw.queueRemove(opts.itemId).catch(() => {});
        const images = opts.images ?? [];
        const asking = !!firstQuestion.trim() || images.length > 0;
        if (opts.switchTo === false) get().showToast({ title: `已开出 ${route.number}路 ${route.name}`, detail: asking ? "第一个问题已发出" : "停在分叉站，等你提问", route, action: { label: "去看看", run: () => get().selectRoute(route.id) } });
        else get().selectRoute(route.id);
        if (asking) await get().ask(route.id, firstQuestion, images);
      } catch (e) {
        set({ error: message(e) });
      } finally {
        set({ preparing: null });
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
      // 在地图上点的，站就在眼前：不挪地图、不闪；对话栏自己滚到这一站的末尾
      get().selectRoute(stop.routeId);
      set({ viewing: stopId });
    },

    async truncate(routeId, stopId, requeue) {
      try {
        const { prompt, images } = await window.bw.truncate(routeId, stopId);
        if (requeue) {
          const back = fromPrompt(prompt, images, draftId);
          set((s) => ({ drafts: { ...s.drafts, [routeId]: back.text }, draftImages: { ...s.draftImages, [routeId]: back.images } }));
        }
      } catch (e) {
        set({ error: message(e) });
      }
    },

    async renameStop(stopId, name) {
      await window.bw.renameStop(stopId, name).catch((e) => set({ error: message(e) }));
    },
    loadClaudeOptions(projectId) {
      if (get().claudeOptions[projectId]) return;
      set((s) => ({ claudeOptions: { ...s.claudeOptions, [projectId]: "loading" } }));
      void window.bw
        .claudeOptions(projectId)
        .then((o) => o && set((s) => ({ claudeOptions: { ...s.claudeOptions, [projectId]: s.claudeOptions[projectId] === "loading" ? o : s.claudeOptions[projectId]! } })))
        .catch(() => set((s) => ({ claudeOptions: { ...s.claudeOptions, [projectId]: "failed" } })));
    },

    async setRouteModel(routeId, model, effort) {
      try {
        const route = await window.bw.setRouteModel(routeId, model, effort);
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

    async createExpress(routeId, stopId, summary, name, firstQuestion, itemId, run, images = []) {
      if (get().preparing) return;
      set({ preparing: { label: "开出快线", step: "准备", since: Date.now() } });
      try {
        const route = await applyRun(await window.bw.createExpress(routeId, stopId, summary, name), run);
        set({ preparing: null });
        if (itemId) void window.bw.queueRemove(itemId).catch(() => {});
        get().dropDistill(stopId);
        set((s) => ({ routes: { ...s.routes, [route.id]: route } }));
        get().selectRoute(route.id);
        const source = get().routes[routeId];
        const from = source ? `${routeLabel(source)} 照常` : "";
        const asking = !!firstQuestion.trim() || images.length > 0;
        get().showToast({ title: `已开出 快${route.express} ${route.name}`, detail: [asking ? "第一个问题已发出" : "停在摘要站，等你提问", from].filter(Boolean).join("，"), route });
        if (asking) await get().ask(route.id, firstQuestion, images);
      } catch (e) {
        set({ error: message(e) });
      } finally {
        set({ preparing: null });
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
      const label = routeLabel(route);
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

    async setRouteMode(routeId, mode) {
      try {
        const route = await window.bw.setRoutePermissionMode(routeId, mode);
        set((s) => ({ routes: { ...s.routes, [route.id]: route } }));
      } catch (e) {
        set({ error: message(e) });
      }
    },

    // 候车区的操作：结果都通过 queue.updated 事件回来，这里只管发出和报错
    async queuedImages(item) {
      return item.images ? await window.bw.images(item.id).catch(() => []) : [];
    },

    async editQueued(item, routeId) {
      const images = await get().queuedImages(item);
      const back = fromPrompt(item.text, images, draftId);
      get().setDraft(routeId, back.text, back.images);
      await get().queueRemove(item.id);
      get().selectRoute(routeId);
    },
    async queueAdd(projectId, text, routeId, mode, images) {
      await window.bw.queueAdd(projectId, text, routeId, mode, images && images.length > 0 ? images : undefined).catch((e) => set({ error: message(e) }));
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

    setDraft: (routeId, text, images) =>
      set((s) => ({ drafts: { ...s.drafts, [routeId]: text }, draftImages: { ...s.draftImages, [routeId]: images ?? (text.includes(OBJ) ? (s.draftImages[routeId] ?? []) : []) } })),
    patchDraftImage: (routeId, id, patch) => set((s) => ({ draftImages: { ...s.draftImages, [routeId]: (s.draftImages[routeId] ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i)) } })),
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

/** 当前项目里没归档的路，按路号。不含 Local 专车（它不在左栏、地图上，只在路线标签最左） */
export function useRoutes(projectId: string | null): Route[] {
  const routes = useStore((s) => s.routes);
  return Object.values(routes)
    .filter((r) => r.projectId === projectId && r.status !== "archived" && !r.local)
    .sort((a, b) => a.number - b.number);
}

export function useStops(routeId: string | null): Stop[] {
  const stops = useStore((s) => s.stops);
  return Object.values(stops)
    .filter((s) => s.routeId === routeId)
    .sort((a, b) => a.seq - b.seq);
}
