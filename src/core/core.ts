import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AskResult, ClaudeClient } from "../claude";
import type { Db } from "../db";
import type {
  BwEvent,
  BwListener,
  ChatItem,
  StopContent,
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

export type CoreErrorCode = "NOT_FOUND" | "ROUTE_BUSY" | "ROUTE_BLOCKED" | "ROUTE_ARCHIVED" | "ROUTE_NOT_BLOCKED" | "CANNOT_FORK";

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
  /**
   * 提前在后台启动 Claude（新开一路后、每一站结束后），下一站就不用等启动。默认开。
   * 一次性的命令行调用应关掉：进程马上就退出，提前启动只是白费。
   */
  prewarm?: boolean;
  /** 测试里换成假的同步引擎工厂；默认用真的 */
  createEngine?: (localDir: string, worktreesDir: string) => Promise<SyncEngine>;
}

export type AskReport =
  /** 站前同步有冲突，这一站没有发出 */
  | { kind: "blocked"; sync: SyncLogEntry }
  /** 解决冲突时发现其实能自动合并：没有问 Claude，直接同步了 */
  | { kind: "synced"; sync: SyncLogEntry | null }
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
  /**
   * 从某一站开一条新的路：新对话带着到这一站为止的完整历史，新的会话、新的工作区。
   * 代码从 Local 的现在开始，不回到那一站当时的样子。原来那一路不受影响。
   */
  fork(routeId: string, stopId: string, name?: string): Promise<Route>;
  /**
   * 让这一路的 Claude 解决同步冲突：把 Local 的版本带着冲突标记合进工作区，
   * 在这一路上开一站请 Claude 改好，这一站正常结束后再同步一次。
   */
  resolveConflict(routeId: string): Promise<AskReport>;
  /** 停车：中止这一路正在进行的回答 */
  stop(routeId: string): void;
  answerPermission(requestId: string, decision: PermissionDecision): void;
  /** 重新同步一次（比如你手工处理了冲突之后）。成功则解除这一路的冲突状态 */
  resync(routeId: string): Promise<SyncLogEntry[]>;
  syncLog(routeId: string): SyncLogEntry[];
  /** 这一路各站的回答内容，从 Claude 的会话文件里按站切出来 */
  history(routeId: string): Promise<StopContent[]>;
  /** 为这一路提前启动 Claude（比如用户点开这一路时） */
  warm(routeId: string): void;
  /** 应用退出时调：关掉提前启动的 Claude */
  dispose(): void;
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

  const prewarm = opts.prewarm ?? true;
  const warmRoute = (route: Route) => {
    if (prewarm && route.status !== "archived") claude.warm(route.worktreePath, route.sessionId ?? undefined);
  };

  const tempName = (prompt: string) => Array.from(prompt.replace(/\s+/g, " ").trim()).slice(0, 6).join("") || "新的一站";

  /** 在一路上跑一站。resolving：这一站是在解决冲突，这一路此刻已经被占住了 */
  const runStop = async (routeId: string, text: string, resolving?: { name: string }): Promise<AskReport> => {
      let route = mustRoute(routeId);
      if (!resolving) {
        if (route.status === "answering" || route.status === "awaiting_permission") throw new CoreError("ROUTE_BUSY", "这一路正在回答，等它到站或先停车");
        if (route.status === "conflict") throw new CoreError("ROUTE_BLOCKED", "这一路有同步冲突，解决后才能问下一站");
        if (route.status === "archived") throw new CoreError("ROUTE_ARCHIVED", "这一路已归档");
      }
      const before = resolving ? "conflict" : route.status;
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
        name: resolving?.name ?? tempName(text),
        nameState: resolving ? "final" : "temp",
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
            else if (e.type === "answered") emit({ type: "stop.answered", routeId, stopId });
            else if (e.type === "text") emit({ type: "stop.delta", routeId, stopId, text: e.text });
            else if (e.type === "tool") emit({ type: "stop.tool", routeId, stopId, tool: e.tool, input: e.input, detail: toolDetail(e.input, route.worktreePath) });
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
      warmRoute(route); // 这一站一结束就为下一站把 Claude 启动好

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
      const earlier = previous.filter((s) => s.syncState === "unsynced" || s.syncState === "conflict");
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
  };

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
      warmRoute(route);
      return route;
    },

    ask: (routeId, text) => runStop(routeId, text),

    async fork(routeId, stopId, name) {
      const parent = mustRoute(routeId);
      const stop = db.stops.get(stopId);
      if (!stop || stop.routeId !== routeId) throw new CoreError("NOT_FOUND", `这一路上没有这一站：${stopId}`);
      if (stop.status === "answering") throw new CoreError("CANNOT_FORK", "这一站还在回答，到站后才能从它开新对话");
      if (!parent.sessionId || !stop.lastMessageId) throw new CoreError("CANNOT_FORK", "这一站没有留下对话记录（还没开始回答就停车了），不能从它开新对话");
      const project = mustProject(parent.projectId);
      const engine = await engineFor(project);

      // 对话：复制到这一站的最后一条消息为止，得到新的会话；原会话不变
      const sessionId = await claude.fork(parent.sessionId, stop.lastMessageId);
      // 代码：新的工作区，从 Local 的现在开始
      const newId = id("r");
      let worktreePath: string;
      try {
        worktreePath = (await engine.createWorktree(newId)).path;
      } catch (e) {
        await claude.deleteSession(sessionId).catch(() => {});
        throw e;
      }
      const number = db.routes.nextNumber(project.id);
      const route: Route = {
        id: newId,
        projectId: project.id,
        number,
        name: name?.trim() || `${number} 路`,
        status: "idle",
        sessionId,
        worktreePath,
        parentRouteId: parent.id,
        forkStopId: stop.id,
        createdAt: Date.now(),
        archivedAt: null,
      };
      db.routes.insert(route);
      emit({ type: "route.updated", route });
      warmRoute(route);
      return route;
    },

    async resolveConflict(routeId) {
      const route = mustRoute(routeId);
      if (route.status !== "conflict") throw new CoreError("ROUTE_NOT_BLOCKED", "这一路现在没有同步冲突");
      const engine = await engineFor(mustProject(route.projectId));
      setRoute(routeId, { status: "answering" }); // 占住这一路
      const stops = db.stops.listByRoute(routeId);
      const last = stops.at(-1);

      let merged: Awaited<ReturnType<SyncEngine["mergeForResolve"]>>;
      try {
        merged = await engine.mergeForResolve(routeId);
      } catch (e) {
        const entry = log(routeId, null, "resolve", "error", [], e instanceof Error ? e.message : String(e));
        setRoute(routeId, { status: "conflict" });
        return { kind: "blocked", sync: entry };
      }

      if (merged.status === "ok") {
        // Local 那边已经变得能自动合并了：不用问 Claude，直接同步
        log(routeId, null, "resolve", "ok", merged.changed.map((c) => ({ path: c.path, note: c.kind })));
        const pushed = last?.status === "done" ? await sync(routeId, last.id, "push", () => engine.pushAfterStop(routeId)) : null;
        if (pushed && pushed.status !== "ok") {
          setRoute(routeId, { status: pushed.status === "conflict" ? "conflict" : "idle" });
          return pushed.status === "conflict" ? { kind: "blocked", sync: pushed } : { kind: "synced", sync: pushed };
        }
        if (last?.status === "done") for (const s of stops) if (s.syncState === "conflict" || s.syncState === "unsynced") setStop(s.id, { syncState: pushed ? "synced" : "none" });
        setRoute(routeId, { status: last?.status === "interrupted" ? "interrupted" : "idle" });
        return { kind: "synced", sync: pushed };
      }

      log(routeId, null, "resolve", "conflict", merged.files.map((f) => ({ path: f.path, note: f.reason })));
      const lines = merged.files.map((f) => `- ${f.path}${f.reason === "modify-delete" ? "（一边修改、另一边删除：文件现在是修改后的版本，没有冲突标记，请判断该保留还是删除）" : ""}`);
      const prompt = [
        "把项目目录（Local）里的最新改动合并进这个工作区时，下面这些文件有冲突：",
        "",
        ...lines,
        "",
        "文件里已经带上了冲突标记：`<<<<<<<` 到 `=======` 之间是这个工作区里的版本，`=======` 到 `>>>>>>>` 之间是 Local 里的版本。",
        "请逐个打开这些文件，结合两边各自想做的事，合并成正确的内容，并去掉所有冲突标记。只改这些文件，不要做别的改动。改完后简要说明每一处是怎么取舍的。",
      ].join("\n");
      return runStop(routeId, prompt, { name: "解决同步冲突" });
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

    async history(routeId) {
      const route = mustRoute(routeId);
      if (!route.sessionId) return [];
      const messages = await claude.history(route.sessionId).catch(() => []);
      const at = new Map(messages.map((m, i) => [m.id, i]));
      return db.stops.listByRoute(routeId).map((stop): StopContent => {
        const from = stop.messageId ? at.get(stop.messageId) : undefined;
        const to = stop.lastMessageId ? at.get(stop.lastMessageId) : undefined;
        if (from === undefined || to === undefined) return { stopId: stop.id, items: [] };
        const items: ChatItem[] = [];
        for (const m of messages.slice(from, to + 1)) {
          if (m.role !== "assistant") continue;
          if (typeof m.content === "string") {
            if (m.content) pushText(items, m.content);
            continue;
          }
          for (const b of Array.isArray(m.content) ? (m.content as { type?: string; text?: unknown; name?: unknown; input?: unknown }[]) : []) {
            if (b.type === "text" && typeof b.text === "string" && b.text) pushText(items, b.text);
            if (b.type === "tool_use" && typeof b.name === "string") items.push({ kind: "tool", tool: b.name, detail: toolDetail((b.input as Record<string, unknown>) ?? {}, route.worktreePath) });
          }
        }
        return { stopId: stop.id, items };
      });
    },

    warm: (routeId) => warmRoute(mustRoute(routeId)),

    dispose: () => claude.dispose(),
  };
}

function pushText(items: ChatItem[], text: string): void {
  const last = items.at(-1);
  if (last?.kind === "text") last.text += "\n\n" + text;
  else items.push({ kind: "text", text });
}

/** 工具调用的一行说明：改的是哪个文件、跑的是什么命令 */
function toolDetail(input: Record<string, unknown>, cwd = ""): string {
  for (const key of ["file_path", "path", "command", "pattern", "query", "url", "description", "prompt"]) {
    const v = input[key];
    if (typeof v !== "string" || !v) continue;
    // 文件路径显示成相对这一路工作区的写法：工作区的完整路径又长又没有信息量
    if ((key === "file_path" || key === "path") && cwd && path.isAbsolute(v)) {
      const rel = path.relative(cwd, v);
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
    }
    return v.replace(/\s+/g, " ").slice(0, 200);
  }
  return "";
}
