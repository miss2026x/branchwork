import { create } from "zustand";
import type { BwEvent, ChatItem, PermissionDecision, PermissionMode, Project, Route, Stop, SyncFile, SyncLogEntry } from "../../shared";

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
  drafts: Record<string, string>;
  historyLoaded: Record<string, boolean>;
  error: string | null;
  selectedProjectId: string | null;
  selectedRouteId: string | null;

  init(): Promise<void>;
  selectProject(projectId: string): void;
  selectRoute(routeId: string): void;
  addProject(): Promise<void>;
  createRoute(): Promise<void>;
  ask(routeId: string, text: string): Promise<void>;
  fork(routeId: string, stopId: string, name: string, firstQuestion: string): Promise<void>;
  resolveConflict(routeId: string): Promise<void>;
  resync(routeId: string): Promise<void>;
  archiveRoute(routeId: string): Promise<void>;
  unarchiveRoute(routeId: string): Promise<void>;
  /** 返回 null 表示已删除；返回文件列表表示还有没进 Local 的改动，没有删 */
  deleteRoute(routeId: string, force: boolean): Promise<SyncFile[] | null>;
  stop(routeId: string): void;
  answerPermission(routeId: string, decision: PermissionDecision): void;
  setPermissionMode(projectId: string, mode: PermissionMode): Promise<void>;
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
          return { stops: { ...s.stops, [e.stop.id]: e.stop }, pendingAsk, live: { ...s.live, [e.stop.id]: { phase: "starting", items: [] } } };
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
    drafts: {},
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
      set({ selectedRouteId: routeId, selectedProjectId: route.projectId });
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

    async createRoute() {
      const projectId = get().selectedProjectId;
      if (!projectId) return;
      try {
        const route = await window.bw.createRoute(projectId);
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
