import { create } from "zustand";
import { noticesAfterSelecting, reduceNotices, type Notice } from "./notices";
import type { BwEvent, ChatItem, PermissionDecision, PermissionMode, Project, QueueItem, QueueMode, Route, Stop, SyncFile, SyncLogEntry } from "../../shared";

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
export interface Distill {
  routeId: string;
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
  createRoute(name?: string): Promise<void>;
  /** 跳到某一站：选中它那一路，地图和对话都带过去 */
  jumpToStop(stopId: string): void;
  openCompress(stopId: string | null): void;
  /** 开始提炼（已有摘要时是重新生成）。立即返回，结果写进 distills */
  startDistill(routeId: string, stopId: string, keep: string): void;
  /** 取消提炼；已有的摘要留着 */
  cancelDistill(stopId: string): void;
  setSummary(stopId: string, summary: string): void;
  /** 不要这份摘要了 */
  dropDistill(stopId: string): void;
  dismissNotice(id: string): void;
  /** 把这一路各站的回答读回来（已经读过就不再读） */
  ensureHistory(routeId: string): void;
  ask(routeId: string, text: string): Promise<void>;
  fork(routeId: string, stopId: string, name: string, firstQuestion: string): Promise<void>;
  createExpress(routeId: string, stopId: string, summary: string, name: string, firstQuestion: string): Promise<void>;
  resolveConflict(routeId: string): Promise<void>;
  resync(routeId: string): Promise<void>;
  archiveRoute(routeId: string): Promise<void>;
  unarchiveRoute(routeId: string): Promise<void>;
  /** 返回 null 表示已删除；返回文件列表表示还有没进 Local 的改动，没有删 */
  deleteRoute(routeId: string, force: boolean): Promise<SyncFile[] | null>;
  stop(routeId: string): void;
  answerPermission(routeId: string, decision: PermissionDecision): void;
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
export const useStore = create<State>((set, get) => {
  let started = false;
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
          return { live: { ...s.live, [e.stopId]: { ...cur, items: [...cur.items, { kind: "tool", tool: e.tool, detail: e.detail }] } } };
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
        set((s) => ({ lastSync: { ...s.lastSync, [e.entry.routeId]: e.entry } }));
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
    const snap = await window.bw.snapshot(projectId);
    set((s) => ({
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
      set((s) => ({ selectedRouteId: routeId, selectedProjectId: route.projectId, notices: noticesAfterSelecting(s.notices, routeId) }));
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

    async fork(routeId, stopId, name, firstQuestion) {
      try {
        const route = await window.bw.fork(routeId, stopId, name);
        set((s) => ({ routes: { ...s.routes, [route.id]: route } }));
        get().selectRoute(route.id);
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

    startDistill(routeId, stopId, keep) {
      const before = get().distills[stopId];
      if (before?.status === "running") return;
      const startedAt = Date.now();
      const mine = () => get().distills[stopId]?.startedAt === startedAt;
      set((s) => ({ distills: { ...s.distills, [stopId]: { routeId, status: "running", summary: before?.summary ?? "", error: null, startedAt } } }));
      window.bw.distill(routeId, stopId, keep.trim() || undefined).then(
        (summary) => {
          if (!mine()) return; // 已取消或丢掉
          set((s) => ({
            distills: { ...s.distills, [stopId]: { routeId, status: "ready", summary, error: null, startedAt } },
            // 弹窗没开着：提醒一下
            notices: s.compressStopId === stopId ? s.notices : [...s.notices.filter((n) => n.id !== `summary:${stopId}`), { id: `summary:${stopId}`, kind: "summary", routeId, stopId }],
          }));
        },
        (e) => {
          if (!mine()) return;
          set((s) => ({ distills: { ...s.distills, [stopId]: { routeId, status: before?.summary ? "ready" : "failed", summary: before?.summary ?? "", error: message(e), startedAt } } }));
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

    dismissNotice(id) {
      set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
    },

    async createExpress(routeId, stopId, summary, name, firstQuestion) {
      try {
        const route = await window.bw.createExpress(routeId, stopId, summary, name);
        get().dropDistill(stopId);
        set((s) => ({ routes: { ...s.routes, [route.id]: route } }));
        get().selectRoute(route.id);
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
        get().selectRoute(routeId);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    async deleteRoute(routeId, force) {
      try {
        const r = await window.bw.deleteRoute(routeId, force);
        return r.status === "has-unsynced" ? r.files : null;
      } catch (e) {
        set({ error: message(e) });
        return null;
      }
    },

    stop(routeId) {
      void window.bw.stop(routeId);
    },

    answerPermission(routeId, decision) {
      const p = get().permissions[routeId];
      if (!p) return;
      set((s) => {
        const permissions = { ...s.permissions };
        delete permissions[routeId];
        return { permissions };
      });
      void window.bw.answerPermission(p.requestId, decision);
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
