import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AskResult, ClaudeClient } from "../claude";
import type { Db } from "../db";
import type {
  BwEvent,
  BwListener,
  PermissionDecision,
  Project,
  ProjectSnapshot,
  Route,
  Stop,
  SyncDirection,
  SyncFile,
  SyncLogEntry,
  SyncOutcomeStatus,
} from "../shared";
import { createSyncEngine, type SyncEngine } from "../sync";

export type CoreErrorCode = "NOT_FOUND" | "ROUTE_BUSY" | "ROUTE_BLOCKED" | "ROUTE_ARCHIVED";

export class CoreError extends Error {
  constructor(
    public readonly code: CoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CoreError";
  }
}

export interface CoreOptions {
  db: Db;
  claude: ClaudeClient;
  /** 放所有工作区的目录；每个项目一个子目录，每一路再一个子目录 */
  worktreesRoot: string;
  /** 测试里换成假的同步引擎工厂；默认用真的 */
  createEngine?: (localDir: string, worktreesDir: string) => Promise<SyncEngine>;
}

export type AskReport =
  /** 站前同步有冲突，这一站没有发出 */
  | { kind: "blocked"; sync: SyncLogEntry }
  /** 这一站已结束（正常或没答完）；sync 是站后同步的记录，没做同步时为空 */
  | { kind: "answered"; stop: Stop; text: string; sync: SyncLogEntry | null };

export interface Core {
  /** 订阅事件，返回取消订阅的函数 */
  on(listener: BwListener): () => void;
  addProject(localDir: string, name?: string): Promise<Project>;
  listProjects(): Project[];
  snapshot(projectId: string): ProjectSnapshot;
  /** 新开一路（从 Local 当前状态建工作区） */
  createRoute(projectId: string, name?: string): Promise<Route>;
  /** 在这一路上问一站：站前同步 → Claude 回答 → 正常结束才站后同步 */
  ask(routeId: string, text: string): Promise<AskReport>;
  /** 停车：中止这一路正在进行的回答 */
  stop(routeId: string): void;
  answerPermission(requestId: string, decision: PermissionDecision): void;
  /** 重新同步一次（比如你手工处理了冲突之后）。成功则解除这一路的冲突状态 */
  resync(routeId: string): Promise<SyncLogEntry[]>;
  syncLog(routeId: string): SyncLogEntry[];
}

export function createCore(opts: CoreOptions): Core {
  const { db, claude } = opts;
  const makeEngine = opts.createEngine ?? ((localDir, worktreesDir) => createSyncEngine({ localDir, worktreesDir }));

  const listeners = new Set<BwListener>();
  const engines = new Map<string, Promise<SyncEngine>>();
  const running = new Map<string, AbortController>();
  const pendingPermissions = new Map<string, { routeId: string; resolve: (d: PermissionDecision) => void }>();

  const emit = (e: BwEvent) => {
    for (const l of listeners) l(e);
  };
  const id = (prefix: string) => prefix + randomUUID().replace(/-/g, "").slice(0, 12);

  // 上次应用是在回答途中退出的：那些站算没答完
  for (const project of db.projects.list()) {
    for (const route of db.routes.listByProject(project.id)) {
      if (route.status !== "answering" && route.status !== "awaiting_permission") continue;
      for (const s of db.stops.listByRoute(route.id)) {
        if (s.status === "answering") db.stops.update(s.id, { status: "interrupted", syncState: "unsynced", endedAt: Date.now(), error: "应用在回答途中退出" });
      }
      db.routes.update(route.id, { status: "interrupted" });
    }
  }

  const mustRoute = (routeId: string): Route => {
    const r = db.routes.get(routeId);
    if (!r) throw new CoreError("NOT_FOUND", `没有这一路：${routeId}`);
    return r;
  };
  const mustProject = (projectId: string): Project => {
    const p = db.projects.get(projectId);
    if (!p) throw new CoreError("NOT_FOUND", `没有这个项目：${projectId}`);
    return p;
  };
  const setRoute = (routeId: string, patch: Parameters<Db["routes"]["update"]>[1]): Route => {
    const route = db.routes.update(routeId, patch);
    emit({ type: "route.updated", route });
    return route;
  };
  const setStop = (stopId: string, patch: Parameters<Db["stops"]["update"]>[1]): Stop => {
    const stop = db.stops.update(stopId, patch);
    emit({ type: "stop.updated", stop });
    return stop;
  };

  const engineFor = (project: Project): Promise<SyncEngine> => {
    let e = engines.get(project.id);
    if (!e) {
      e = (async () => {
        const engine = await makeEngine(project.localDir, path.join(opts.worktreesRoot, project.id));
        // 上次如果在写 Local 途中退出，这里补写完
        const r = await engine.recover();
        if (r.status !== "clean" && db.routes.get(r.routeId)) {
          log(r.routeId, null, "recover", r.status === "recovered" ? "ok" : "conflict", [
            ...r.changed.map((c) => ({ path: c.path, note: c.kind })),
            ...(r.status === "needs-attention" ? r.skipped.map((p) => ({ path: p, note: "中断后被改过，没有覆盖" })) : []),
          ]);
        }
        return engine;
      })();
      engines.set(project.id, e);
      e.catch(() => engines.delete(project.id));
    }
    return e;
  };

  const log = (routeId: string, stopId: string | null, direction: SyncDirection, status: SyncOutcomeStatus, files: SyncFile[], message: string | null = null): SyncLogEntry => {
    const entry: SyncLogEntry = { id: id("y"), routeId, stopId, direction, status, files, message, at: Date.now() };
    db.syncLog.insert(entry);
    emit({ type: "sync.result", entry });
    return entry;
  };

  /** 跑一次同步并记下来；noop 不记。引擎抛错也记成一条，不往外抛 */
  const sync = async (routeId: string, stopId: string | null, direction: "pull" | "push", run: () => ReturnType<SyncEngine["pullBeforeStop"]>): Promise<SyncLogEntry | null> => {
    try {
      const r = await run();
      if (r.status === "noop") return null;
      if (r.status === "ok") return log(routeId, stopId, direction, "ok", r.changed.map((c) => ({ path: c.path, note: c.kind })));
      return log(routeId, stopId, direction, "conflict", r.files.map((f) => ({ path: f.path, note: f.reason })));
    } catch (e) {
      return log(routeId, stopId, direction, "error", [], e instanceof Error ? e.message : String(e));
    }
  };

  /** 这一路上还没回答的批准请求一律按拒绝处理 */
  const dropPermissions = (routeId: string) => {
    for (const [requestId, p] of pendingPermissions) {
      if (p.routeId !== routeId) continue;
      pendingPermissions.delete(requestId);
      p.resolve("deny");
    }
  };

  const tempName = (prompt: string) => Array.from(prompt.replace(/\s+/g, " ").trim()).slice(0, 6).join("") || "新的一站";

  return {
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async addProject(localDir, name) {
      const dir = path.resolve(localDir);
      const existing = db.projects.byLocalDir(dir);
      if (existing) return existing;
      const project: Project = { id: id("p"), name: name ?? path.basename(dir), localDir: dir, createdAt: Date.now() };
      await makeEngine(dir, path.join(opts.worktreesRoot, project.id)); // 不是可用的仓库会在这里报错
      db.projects.insert(project);
      return project;
    },

    listProjects: () => db.projects.list(),

    snapshot(projectId) {
      return { project: mustProject(projectId), routes: db.routes.listByProject(projectId), stops: db.stops.listByProject(projectId) };
    },

    async createRoute(projectId, name) {
      const project = mustProject(projectId);
      const engine = await engineFor(project);
      const routeId = id("r");
      const { path: worktreePath } = await engine.createWorktree(routeId);
      const number = db.routes.nextNumber(projectId);
      const route: Route = {
        id: routeId,
        projectId,
        number,
        name: name ?? `${number} 路`,
        status: "idle",
        sessionId: null,
        worktreePath,
        parentRouteId: null,
        forkStopId: null,
        createdAt: Date.now(),
        archivedAt: null,
      };
      db.routes.insert(route);
      emit({ type: "route.updated", route });
      return route;
    },

    async ask(routeId, text) {
      let route = mustRoute(routeId);
      if (route.status === "answering" || route.status === "awaiting_permission") throw new CoreError("ROUTE_BUSY", "这一路正在回答，等它到站或先停车");
      if (route.status === "conflict") throw new CoreError("ROUTE_BLOCKED", "这一路有同步冲突，解决后才能问下一站");
      if (route.status === "archived") throw new CoreError("ROUTE_ARCHIVED", "这一路已归档");
      const before = route.status;
      // 先占住这一路，再做任何要等的事，避免同一路被同时问两次。
      // 停车的开关也从这一刻起就有效：站前同步、启动 Claude 期间按停车都算数
      route = setRoute(routeId, { status: "answering" });
      const abort = new AbortController();
      running.set(routeId, abort);

      let engine: SyncEngine;
      try {
        engine = await engineFor(mustProject(route.projectId));
      } catch (e) {
        running.delete(routeId);
        setRoute(routeId, { status: before });
        throw e;
      }

      // ── 站前：Local → 工作区 ──
      const pulled = await sync(routeId, null, "pull", () => engine.pullBeforeStop(routeId));
      if (pulled && pulled.status !== "ok") {
        running.delete(routeId);
        setRoute(routeId, { status: pulled.status === "conflict" ? "conflict" : before });
        return { kind: "blocked", sync: pulled };
      }

      // ── 回答 ──
      const previous = db.stops.listByRoute(routeId);
      let stop: Stop = {
        id: id("s"),
        routeId,
        seq: db.stops.nextSeq(routeId),
        kind: "normal",
        name: tempName(text),
        nameState: "temp",
        prompt: text,
        status: "answering",
        syncState: "none",
        messageId: null,
        lastMessageId: null,
        error: null,
        startedAt: Date.now(),
        endedAt: null,
      };
      db.stops.insert(stop);
      emit({ type: "stop.created", stop });

      const stopId = stop.id;
      const stoppedEarly: AskResult = { outcome: "interrupted", sessionId: route.sessionId, text: "", error: null, promptMessageId: null, lastMessageId: null };
      // 还没轮到 Claude 就已经停车了：不启动它
      const result: AskResult = abort.signal.aborted
        ? stoppedEarly
        : await claude
        .ask({
          cwd: route.worktreePath,
          prompt: text,
          sessionId: route.sessionId ?? undefined,
          afterMessageId: previous.findLast((s) => s.lastMessageId)?.lastMessageId ?? undefined,
          signal: abort.signal,
          onEvent: (e) => {
            // 停车之后 Claude 进程可能还要几秒才真正停下，这期间它吐出来的内容不再往界面送
            if (abort.signal.aborted) return;
            if (e.type === "started") emit({ type: "stop.started", routeId, stopId });
            else if (e.type === "text") emit({ type: "stop.delta", routeId, stopId, text: e.text });
            else emit({ type: "stop.tool", routeId, stopId, tool: e.tool, input: e.input });
          },
          onPermission: (req) =>
            new Promise<PermissionDecision>((resolve) => {
              const requestId = id("q");
              pendingPermissions.set(requestId, { routeId, resolve });
              setRoute(routeId, { status: "awaiting_permission" });
              emit({ type: "permission.request", requestId, routeId, stopId, tool: req.tool, input: req.input, canRemember: req.canRemember });
            }),
        })
        .catch((e: unknown) => ({ outcome: "failed" as const, sessionId: null, text: "", error: e instanceof Error ? e.message : String(e), promptMessageId: null, lastMessageId: null }));
      running.delete(routeId);
      dropPermissions(routeId);

      if (result.sessionId && result.sessionId !== route.sessionId) route = setRoute(routeId, { sessionId: result.sessionId });
      const ended = { endedAt: Date.now(), messageId: result.promptMessageId, lastMessageId: result.lastMessageId };

      // ── 没答完：不同步，工作区保留 ──
      if (result.outcome !== "completed") {
        const left = await engine.status(routeId).then(
          (s) => s.unsynced.length > 0,
          () => true,
        );
        stop = setStop(stopId, { ...ended, status: "interrupted", syncState: left ? "unsynced" : "none", error: result.error ?? (result.outcome === "interrupted" ? "已停车" : "没有正常结束") });
        setRoute(routeId, { status: "interrupted" });
        return { kind: "answered", stop, text: result.text, sync: null };
      }

      // ── 正常结束：先让这一站显示“已到站”，再做站后同步 ──
      stop = setStop(stopId, { ...ended, status: "done" });
      const pushed = await sync(routeId, stopId, "push", () => engine.pushAfterStop(routeId));
      const earlier = previous.filter((s) => s.syncState === "unsynced");
      if (!pushed) {
        for (const s of earlier) setStop(s.id, { syncState: "none" });
        setRoute(routeId, { status: "idle" });
      } else if (pushed.status === "ok") {
        for (const s of earlier) setStop(s.id, { syncState: "synced" });
        stop = setStop(stopId, { syncState: "synced" });
        setRoute(routeId, { status: "idle" });
      } else if (pushed.status === "conflict") {
        stop = setStop(stopId, { syncState: "conflict" });
        setRoute(routeId, { status: "conflict" });
      } else {
        stop = setStop(stopId, { syncState: "unsynced" });
        setRoute(routeId, { status: "idle" });
      }
      return { kind: "answered", stop, text: result.text, sync: pushed };
    },

    stop(routeId) {
      running.get(routeId)?.abort();
      dropPermissions(routeId); // 正在等批准的话，按拒绝处理，让回答能结束
    },

    answerPermission(requestId, decision) {
      const p = pendingPermissions.get(requestId);
      if (!p) return;
      pendingPermissions.delete(requestId);
      setRoute(p.routeId, { status: "answering" });
      p.resolve(decision);
    },

    async resync(routeId) {
      const route = mustRoute(routeId);
      if (route.status === "answering" || route.status === "awaiting_permission") throw new CoreError("ROUTE_BUSY", "这一路正在回答");
      const engine = await engineFor(mustProject(route.projectId));
      const entries: SyncLogEntry[] = [];
      const stops = db.stops.listByRoute(routeId);
      const last = stops.at(-1);

      const pulled = await sync(routeId, null, "pull", () => engine.pullBeforeStop(routeId));
      if (pulled) entries.push(pulled);
      if (pulled && pulled.status !== "ok") {
        if (pulled.status === "conflict") setRoute(routeId, { status: "conflict" });
        return entries;
      }
      // 最后一站没答完的话不往 Local 写：异常结束不同步
      if (last && last.status === "done") {
        const pushed = await sync(routeId, last.id, "push", () => engine.pushAfterStop(routeId));
        if (pushed) entries.push(pushed);
        if (pushed && pushed.status !== "ok") {
          if (pushed.status === "conflict") setRoute(routeId, { status: "conflict" });
          return entries;
        }
        for (const s of stops) if (s.syncState === "conflict" || s.syncState === "unsynced") setStop(s.id, { syncState: pushed ? "synced" : "none" });
      }
      if (route.status === "conflict") setRoute(routeId, { status: last?.status === "interrupted" ? "interrupted" : "idle" });
      return entries;
    },

    syncLog: (routeId) => db.syncLog.listByRoute(routeId),
  };
}
