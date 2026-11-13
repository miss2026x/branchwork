import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AskResult, ClaudeClient, ClaudeTool } from "../claude";
import type { Db } from "../db";
import type {
  BwEvent,
  BwListener,
  ChatItem,
  DirectoryInfo,
  FileStat,
  StopContent,
  PermissionDecision,
  PermissionMode,
  Project,
  ProjectSnapshot,
  QueueItem,
  QueueMode,
  Route,
  Stop,
  SyncDirection,
  SyncFile,
  SyncLogEntry,
  SyncOutcomeStatus,
  Terminal,
} from "../shared";
import { createSyncEngine, inspectRepo, type SyncEngine } from "../sync";
import { createTerminals, type TerminalInfo, type Terminals } from "../terminal";

export type CoreErrorCode = "NOT_FOUND" | "ROUTE_BUSY" | "ROUTE_BLOCKED" | "ROUTE_ARCHIVED" | "ROUTE_NOT_BLOCKED" | "CANNOT_FORK" | "DISTILL_FAILED";

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
  /** 给站起名（用小模型，只看提问）。默认开；一次性的命令行调用应关掉 */
  naming?: boolean;
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
  /** 添加项目前看一眼这个文件夹 */
  inspectDirectory(dir: string): Promise<DirectoryInfo>;
  /** 这个项目所有路的同步记录，新的在前 */
  projectLog(projectId: string): SyncLogEntry[];
  listProjects(): Project[];
  snapshot(projectId: string): ProjectSnapshot;
  /**
   * 改这个项目的批准方式，对项目里所有的路立即生效：
   * ask 每次都问；edits 改文件不问；all 全部不问（相当于 --dangerously-skip-permissions）。
   * 正在等批准的请求，按新的方式能自动批准的会立刻批准。
   */
  setPermissionMode(projectId: string, mode: PermissionMode): Project;
  /** 新开一路（从 Local 当前状态建工作区） */
  createRoute(projectId: string, name?: string): Promise<Route>;
  /** 截线：删掉这一路从这一站起的所有站，会话退回到这一站之前；代码不动。返回这一站的提问 */
  truncate(routeId: string, stopId: string): Promise<{ prompt: string }>;
  renameRoute(routeId: string, name: string): Route;
  /** 换线路颜色（1–8）；null 回到按路号自动取 */
  setRouteColor(routeId: string, color: number | null): Route;
  /** 改站名；改过的不再被自动起的名字覆盖 */
  renameStop(stopId: string, name: string): Stop;
  /** 这一路以后用哪个模型（别名或完整名字）；null 用默认的。下一站起生效 */
  setRouteModel(routeId: string, model: string | null): Route;
  /** 这一路的工作区里还没进 Local 的改动，带增删的行数 */
  changes(routeId: string): Promise<FileStat[]>;
  // ── 后台终端：Claude（通过应用提供的工具）开的长时间命令，跑在那一路的工作区里，不随一站结束而停 ──
  terminals(projectId: string): Terminal[];
  terminalOutput(terminalId: string): string;
  /** 还在跑的停掉；已经退出的从列表里拿掉 */
  terminalStop(terminalId: string): Promise<void>;
  /** 在这一路上问一站：站前同步 → Claude 回答 → 正常结束才站后同步 */
  ask(routeId: string, text: string): Promise<AskReport>;
  /**
   * 从某一站开一条新的路：新对话带着到这一站为止的完整历史，新的会话、新的工作区。
   * 代码从 Local 的现在开始，不回到那一站当时的样子。原来那一路不受影响。
   */
  fork(routeId: string, stopId: string, name?: string): Promise<Route>;
  /**
   * 压缩的第一步：把这一路到某一站为止的对话提炼成一份交接摘要。
   * 做法是复制出一个临时会话，在里面请 Claude 写摘要（它在这个临时会话里不能改任何东西），写完就把临时会话删掉。
   * 原来那一路不受影响。可能要等一会儿；cancelDistill 可以中止。
   */
  distill(routeId: string, stopId: string, keep?: string): Promise<string>;
  cancelDistill(routeId: string): void;
  /**
   * 压缩的第二步：带着摘要开一条快线。快线是全新的对话（新会话、新工作区，代码从 Local 的现在开始），
   * 它的第一站是这份摘要；第一个问题会连同摘要一起交给 Claude。
   */
  createExpress(routeId: string, stopId: string, summary: string, name?: string): Promise<Route>;
  /**
   * 让这一路的 Claude 解决同步冲突：把 Local 的版本带着冲突标记合进工作区，
   * 在这一路上开一站请 Claude 改好，这一站正常结束后再同步一次。
   */
  resolveConflict(routeId: string): Promise<AskReport>;
  /** 归档：从线路图上收起来，对话和工作区都保留，可以恢复 */
  archiveRoute(routeId: string): Route;
  unarchiveRoute(routeId: string): Route;
  /**
   * 删除一路：工作区、对话记录一起删，不能恢复。
   * 工作区里还有没进 Local 的改动时不删，返回这些文件；force 为 true 才会连它们一起删。
   */
  deleteRoute(routeId: string, force?: boolean): Promise<{ status: "deleted" } | { status: "has-unsynced"; files: SyncFile[] }>;
  // ── 候车区：准备好的问题先放着 ──
  /** 放一个问题进候车区。给了 routeId 就是派给那一路（默认自动登车）；那一路空着的话自动登车的会马上发出 */
  queueAdd(projectId: string, text: string, routeId?: string | null, mode?: QueueMode): QueueItem;
  /** 派车 / 改派 / 撤回：routeId 为空表示撤回到“未派车” */
  queueAssign(itemId: string, routeId: string | null, mode?: QueueMode): QueueItem;
  queueRemove(itemId: string): void;
  /** 登车：现在就在它派给的那一路上发出（那一路要空着） */
  queueBoard(itemId: string): Promise<AskReport>;
  /** 开新车：为这个问题新开一路并发出 */
  queueStartNew(itemId: string): Promise<Route>;
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
  /** 应用退出时调：关掉提前启动的 Claude 和所有后台终端 */
  dispose(): void;
}

export function createCore(opts: CoreOptions): Core {
  const { db, claude } = opts;
  const makeEngine = opts.createEngine ?? ((localDir, worktreesDir) => createSyncEngine({ localDir, worktreesDir }));

  const listeners = new Set<BwListener>();
  const engines = new Map<string, Promise<SyncEngine>>();
  const running = new Map<string, AbortController>();
  /** 各路正在回答的是哪一站 */
  const runningStop = new Map<string, string>();
  const distilling = new Map<string, AbortController>();
  const pendingPermissions = new Map<string, { routeId: string; tool: string; resolve: (d: PermissionDecision) => void }>();

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
        // 清掉没有主的工作区目录：上次删除时目录被占用没删干净的
        const dir = path.join(opts.worktreesRoot, project.id);
        const known = new Set(db.routes.listByProject(project.id).map((r2) => r2.id));
        for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
          if (!known.has(name)) void engine.removeWorktree(name, { force: true }).catch(() => {});
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

  const emitQueue = (projectId: string) => emit({ type: "queue.updated", projectId, items: db.queue.listByProject(projectId) });
  const mustItem = (itemId: string): QueueItem => {
    const q = db.queue.get(itemId);
    if (!q) throw new CoreError("NOT_FOUND", `候车区里没有这个问题：${itemId}`);
    return q;
  };
  const canBoard = (route: Route) => route.status === "idle" || route.status === "interrupted";
  /** 把候车的问题发出去；没发成（站前冲突）就放回候车区等你处理，不弄丢 */
  const board = async (item: QueueItem, routeId: string): Promise<AskReport> => {
    db.queue.delete(item.id);
    emitQueue(item.projectId);
    const putBack = () => {
      db.queue.insert({ ...item, routeId, mode: "manual" });
      emitQueue(item.projectId);
    };
    try {
      const report = await runStop(routeId, item.text);
      if (report.kind === "blocked") putBack();
      return report;
    } catch (e) {
      putBack();
      throw e;
    }
  };
  /** 这一路空下来了：有自动登车的就发下一个。只在正常到站、没有冲突时才发 */
  const dispatchNext = (routeId: string) => {
    try {
      const route = db.routes.get(routeId);
      if (!route || route.status !== "idle") return;
      const next = db.queue.listByProject(route.projectId).find((q) => q.routeId === routeId && q.mode === "auto");
      if (next) void board(next, routeId).catch(() => {});
    } catch {
      // 这是在一站结束后稍晚一点才跑的；应用正在退出、数据库已经关了的话就算了
    }
  };
  /** 这一路没了（归档、删除）：派给它的问题撤回到未派车 */
  const releaseQueue = (route: Route) => {
    const mine = db.queue.listByProject(route.projectId).filter((q) => q.routeId === route.id);
    for (const q of mine) db.queue.update(q.id, { routeId: null, mode: "unassigned" });
    if (mine.length > 0) emitQueue(route.projectId);
  };

  const prewarm = opts.prewarm ?? true;
  const warmRoute = (route: Route) => {
    if (prewarm && route.status !== "archived") claude.warm(route.worktreePath, route.sessionId ?? undefined, route.model ?? undefined);
  };

  // ── 后台终端 ──
  const toTerminal = (t: TerminalInfo): Terminal => ({ id: t.id, ...t.owner, name: t.name, command: t.command, cwd: t.cwd, status: t.status, exitCode: t.exitCode, port: t.port, startedAt: t.startedAt, endedAt: t.endedAt });
  const terminals: Terminals = createTerminals({
    onEvent: (e) => {
      if (e.type === "updated") emit({ type: "terminal.updated", terminal: toTerminal(e.terminal) });
      else if (e.type === "output") emit({ type: "terminal.output", terminalId: e.id, text: e.text });
      else emit({ type: "terminal.removed", terminalId: e.terminal.id, projectId: e.terminal.owner.projectId });
    },
  });
  /** 是哪一路的 Claude 在调用工具：按它所在的目录找 */
  const routeAt = (cwd: string): Route => {
    const at = path.resolve(cwd);
    for (const p of db.projects.list()) {
      const r = db.routes.listByProject(p.id).find((x) => path.resolve(x.worktreePath) === at);
      if (r) return r;
    }
    throw new CoreError("NOT_FOUND", "找不到这个目录对应的路");
  };
  const mine = (cwd: string, terminalId: unknown): TerminalInfo => {
    const t = terminals.get(String(terminalId ?? ""));
    if (!t || t.owner.routeId !== routeAt(cwd).id) throw new CoreError("NOT_FOUND", `这一路没有编号是 ${String(terminalId)} 的后台终端。用 terminal_list 看看现在有哪些。`);
    return t;
  };
  const describe = (t: TerminalInfo) => `${t.id}  ${t.status === "running" ? "运行中" : `已退出（退出码 ${t.exitCode ?? "未知"}）`}${t.port ? `  端口 ${t.port}` : ""}  ${t.name}：${t.command}`;
  const lastLines = (text: string, n: number) => text.split("\n").slice(-n).join("\n").trim() || "（还没有输出）";
  const tools: ClaudeTool[] = [
    {
      name: "terminal_start",
      title: "后台终端",
      description:
        "在后台启动一条长时间运行的命令（开发服务器、监听构建、定时任务等）。命令在当前工作区里运行，这次回答结束后它还会继续运行，用户能在界面上看到它、看它的输出、停掉它。" +
        "需要一直运行的命令都用这个工具启动，不要用 Bash 的后台运行（那样启动的命令在这次回答结束时会被关掉）。命令不能要求键盘输入。返回终端的编号和开头几秒的输出。",
      params: { command: { type: "string", description: "要运行的命令，例如 npm run dev" }, name: { type: "string", description: "给用户看的短名字，例如“开发服务器”", optional: true } },
      async run(input, { cwd }) {
        const route = routeAt(cwd);
        const t = terminals.start({ owner: { projectId: route.projectId, routeId: route.id, stopId: runningStop.get(route.id) ?? null }, cwd: route.worktreePath, command: String(input.command ?? ""), name: typeof input.name === "string" ? input.name : undefined });
        // 等一小会儿，把开头的输出（或者一启动就失败的报错）带回去
        const until = Date.now() + 3000;
        while (Date.now() < until && terminals.get(t.id)?.status === "running" && terminals.get(t.id)?.port == null) await terminals.settle(t.id, until - Date.now());
        const now = terminals.get(t.id)!;
        return `${now.status === "running" ? "已在后台启动" : "启动后马上就退出了"}，编号 ${t.id}。\n${describe(now)}\n\n到目前为止的输出：\n${lastLines(terminals.output(t.id), 40)}`;
      },
    },
    {
      name: "terminal_output",
      title: "看后台终端的输出",
      description: "读一个后台终端最近的输出，以及它还在不在运行。",
      params: { id: { type: "string", description: "终端的编号" }, lines: { type: "number", description: "要最后多少行，默认 60", optional: true } },
      readonly: true,
      async run(input, { cwd }) {
        const t = mine(cwd, input.id);
        return `${describe(t)}\n\n${lastLines(terminals.output(t.id), Math.min(Math.max(Number(input.lines) || 60, 1), 400))}`;
      },
    },
    {
      name: "terminal_list",
      title: "列出后台终端",
      description: "列出这一路现在有哪些后台终端（包括已经退出、还没清掉的）。",
      params: {},
      readonly: true,
      async run(_input, { cwd }) {
        const list = terminals.list({ routeId: routeAt(cwd).id });
        return list.length ? list.map(describe).join("\n") : "这一路现在没有后台终端。";
      },
    },
    {
      name: "terminal_stop",
      title: "停掉后台终端",
      description: "停掉这一路的一个后台终端。",
      params: { id: { type: "string", description: "终端的编号" } },
      readonly: true,
      async run(input, { cwd }) {
        const t = mine(cwd, input.id);
        await terminals.stop(t.id);
        return `已停掉 ${t.id}（${t.name}）。`;
      },
    },
  ];
  claude.useTools(tools);

  // ── 给站起名 ──
  const naming = opts.naming ?? true;
  /** 问小模型要一个名字；回来之前站用临时名字，回来之后换掉（你手工改过名字的不动） */
  const nameStop = (stopId: string, routeId: string, prompt: string, tempName: string) => {
    if (!naming) return;
    void claude
      .name(prompt)
      .then((raw) => {
        const name = raw && clampWidth(raw, 20);
        const stop = db.stops.get(stopId);
        if (!name || !stop || stop.nameState !== "temp") return;
        setStop(stopId, { name, nameState: "final" });
        // 这一路的名字如果是跟着这一站的临时名字起的，也一起换
        if (db.routes.get(routeId)?.name === tempName) setRoute(routeId, { name });
      })
      .catch(() => {});
  };

  const tempName = stopName;

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
      // 还没起名的路，用它自己的第一站当名字
      if (route.name === NEW_ROUTE_NAME && !resolving) route = setRoute(routeId, { name: stop.name });
      if (!resolving) nameStop(stop.id, routeId, text, stop.name);
      runningStop.set(routeId, stop.id);

      const stopId = stop.id;
      const stoppedEarly: AskResult = { outcome: "interrupted", sessionId: route.sessionId, text: "", error: null, promptMessageId: null, lastMessageId: null };
      // 还没轮到 Claude 就已经停车了：不启动它
      const result: AskResult = abort.signal.aborted
        ? stoppedEarly
        : await claude
        .ask({
          cwd: route.worktreePath,
          // 快线的第一个问题：连同交接摘要一起交给 Claude（这是个全新的会话，它看不到原来的对话）
          prompt: !route.sessionId && previous[0]?.kind === "summary" ? handover(previous[0].prompt, text) : text,
          sessionId: route.sessionId ?? undefined,
          model: route.model ?? undefined,
          afterMessageId: previous.findLast((s) => s.lastMessageId)?.lastMessageId ?? undefined,
          signal: abort.signal,
          onEvent: (e) => {
            // 停车之后 Claude 进程可能还要几秒才真正停下，这期间它吐出来的内容不再往界面送
            if (abort.signal.aborted) return;
            if (e.type === "started") emit({ type: "stop.started", routeId, stopId });
            else if (e.type === "answered") emit({ type: "stop.answered", routeId, stopId });
            else if (e.type === "text") emit({ type: "stop.delta", routeId, stopId, text: e.text });
            else if (e.type === "tool") emit({ type: "stop.tool", routeId, stopId, tool: e.tool, input: e.input, detail: toolDetail(e.input, route.worktreePath), ...toolStat(e.input) });
          },
          onPermission: (req) =>
            new Promise<PermissionDecision>((resolve) => {
              const requestId = id("q");
              // 这个项目设了自动批准：不问，直接放行
              if (autoApproves(mustProject(route.projectId).permissionMode, req.tool)) return resolve("allow");
              pendingPermissions.set(requestId, { routeId, tool: req.tool, resolve });
              setRoute(routeId, { status: "awaiting_permission" });
              emit({ type: "permission.request", requestId, routeId, stopId, tool: req.tool, input: req.input, canRemember: req.canRemember });
            }),
        })
        .catch((e: unknown) => ({ outcome: "failed" as const, sessionId: null, text: "", error: e instanceof Error ? e.message : String(e), promptMessageId: null, lastMessageId: null }));
      running.delete(routeId);
      runningStop.delete(routeId);
      dropPermissions(routeId);
      route = mustRoute(routeId); // 回答期间名字、模型可能被改过
      if (typeof result.contextTokens === "number") route = setRoute(routeId, { contextTokens: result.contextTokens });

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
        setImmediate(() => dispatchNext(routeId));
      } else if (pushed.status === "ok") {
        for (const s of earlier) setStop(s.id, { syncState: "synced" });
        stop = setStop(stopId, { syncState: "synced" });
        setRoute(routeId, { status: "idle" });
        setImmediate(() => dispatchNext(routeId));
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
      const project: Project = { id: id("p"), name: name?.trim() || path.basename(dir), localDir: dir, permissionMode: "ask", createdAt: Date.now() };
      await makeEngine(dir, path.join(opts.worktreesRoot, project.id)); // 不是可用的仓库会在这里报错
      db.projects.insert(project);
      return project;
    },

    async inspectDirectory(localDir) {
      const dir = path.resolve(localDir);
      return { dir, name: path.basename(dir), ...(await inspectRepo(dir)), projectId: db.projects.byLocalDir(dir)?.id ?? null };
    },

    projectLog(projectId) {
      mustProject(projectId);
      return db.syncLog.listByRoutes(db.routes.listByProject(projectId).map((r) => r.id));
    },

    listProjects: () => db.projects.list(),

    snapshot(projectId) {
      return { project: mustProject(projectId), routes: db.routes.listByProject(projectId), stops: db.stops.listByProject(projectId), queue: db.queue.listByProject(projectId) };
    },

    queueAdd(projectId, text, routeId = null, mode) {
      mustProject(projectId);
      const q = text.trim();
      if (!q) throw new CoreError("NOT_FOUND", "问题是空的");
      const route = routeId ? mustRoute(routeId) : null;
      const item: QueueItem = { id: id("w"), projectId, text: q, routeId: route?.id ?? null, mode: route ? (mode === "manual" ? "manual" : "auto") : "unassigned", createdAt: Date.now() };
      db.queue.insert(item);
      emitQueue(projectId);
      if (route && item.mode === "auto") setImmediate(() => dispatchNext(route.id));
      return item;
    },

    queueAssign(itemId, routeId, mode) {
      const item = mustItem(itemId);
      const route = routeId ? mustRoute(routeId) : null;
      if (route && route.projectId !== item.projectId) throw new CoreError("NOT_FOUND", "只能派给同一个项目里的路");
      if (route?.status === "archived") throw new CoreError("ROUTE_ARCHIVED", "这一路已归档");
      const updated = db.queue.update(itemId, { routeId: route?.id ?? null, mode: route ? (mode === "manual" ? "manual" : "auto") : "unassigned" });
      emitQueue(item.projectId);
      if (route && updated.mode === "auto") setImmediate(() => dispatchNext(route.id));
      return updated;
    },

    queueRemove(itemId) {
      const item = db.queue.get(itemId);
      if (!item) return;
      db.queue.delete(itemId);
      emitQueue(item.projectId);
    },

    async queueBoard(itemId) {
      const item = mustItem(itemId);
      if (!item.routeId) throw new CoreError("NOT_FOUND", "这个问题还没派车");
      const route = mustRoute(item.routeId);
      if (!canBoard(route)) throw new CoreError(route.status === "conflict" ? "ROUTE_BLOCKED" : "ROUTE_BUSY", route.status === "conflict" ? "这一路有同步冲突，解决后才能登车" : "这一路还没到站");
      return board(item, route.id);
    },

    async queueStartNew(itemId) {
      const item = mustItem(itemId);
      const route = await this.createRoute(item.projectId);
      void board(item, route.id).catch(() => {});
      return route;
    },

    setPermissionMode(projectId, mode) {
      mustProject(projectId);
      const project = db.projects.update(projectId, { permissionMode: mode });
      emit({ type: "project.updated", project });
      // 正在等批准的：按新的方式能放行的现在就放行
      for (const [requestId, p] of pendingPermissions) {
        if (db.routes.get(p.routeId)?.projectId !== projectId || !autoApproves(mode, p.tool)) continue;
        pendingPermissions.delete(requestId);
        setRoute(p.routeId, { status: "answering" });
        p.resolve("allow");
      }
      return project;
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
        express: null,
        name: name?.trim() || NEW_ROUTE_NAME,
        status: "idle",
        sessionId: null,
        worktreePath,
        parentRouteId: null,
        forkStopId: null,
        model: null,
        color: null,
        contextTokens: null,
        createdAt: Date.now(),
        archivedAt: null,
      };
      db.routes.insert(route);
      emit({ type: "route.updated", route });
      warmRoute(route);
      return route;
    },

    async truncate(routeId, stopId) {
      let route = mustRoute(routeId);
      if (route.status === "answering" || route.status === "awaiting_permission") throw new CoreError("ROUTE_BUSY", "这一路还在回答，等它到站再截线");
      if (distilling.has(routeId)) throw new CoreError("ROUTE_BUSY", "这一路正在提炼摘要，等它好了再截线");
      const all = db.stops.listByRoute(routeId);
      const target = all.find((s) => s.id === stopId);
      if (!target) throw new CoreError("NOT_FOUND", "找不到这一站");
      if (target.kind === "summary") throw new CoreError("NOT_FOUND", "摘要站是这条快线的起点，不能截掉");
      const prev = all.filter((s) => s.seq < target.seq).at(-1);

      // 会话退回到这一站之前：复制到上一站的最后一条消息为止，得到新的会话，旧的删掉
      let sessionId: string | null = null;
      if (route.sessionId) {
        let upTo = prev?.lastMessageId ?? null;
        if (!prev && route.parentRouteId) {
          // 分叉出来的路截第一站：留下从父路带来的那一段，也就是这一站提问之前的部分
          const messages = await claude.history(route.sessionId);
          const at = messages.findIndex((m) => m.id === target.messageId);
          upTo = at > 0 ? messages[at - 1]!.id : null;
          if (!upTo) throw new CoreError("NOT_FOUND", "这一站没留下对话记录，没法从这里截线");
        } else if (prev && !upTo) {
          throw new CoreError("NOT_FOUND", "上一站没留下对话记录，没法从这里截线");
        }
        if (upTo) sessionId = await claude.fork(route.sessionId, upTo);
      }
      claude.cool(route.worktreePath);
      const old = route.sessionId;
      const removed = all.filter((s) => s.seq >= target.seq).map((s) => s.id);
      db.stops.deleteFrom(routeId, target.seq);
      emit({ type: "stops.removed", routeId, stopIds: removed });
      // 没答完的那一站被截掉了，这一路就不再是“没答完”
      route = setRoute(routeId, { sessionId, contextTokens: null, status: route.status === "interrupted" ? "idle" : route.status });
      if (old && old !== sessionId) await claude.deleteSession(old).catch(() => {});
      warmRoute(route);
      return { prompt: target.prompt };
    },

    renameRoute(routeId, name) {
      mustRoute(routeId);
      const next = name.replace(/\s+/g, " ").trim().slice(0, 40);
      if (!next) throw new CoreError("NOT_FOUND", "名字不能是空的");
      return setRoute(routeId, { name: next });
    },

    setRouteColor(routeId, color) {
      mustRoute(routeId);
      if (color !== null && !(Number.isInteger(color) && color >= 1 && color <= 8)) throw new CoreError("NOT_FOUND", "没有这个颜色");
      return setRoute(routeId, { color });
    },

    renameStop(stopId, name) {
      const stop = db.stops.get(stopId);
      if (!stop) throw new CoreError("NOT_FOUND", "找不到这一站");
      const next = name.replace(/\s+/g, " ").trim().slice(0, 40);
      if (!next) throw new CoreError("NOT_FOUND", "名字不能是空的");
      return setStop(stopId, { name: next, nameState: "manual" });
    },

    setRouteModel(routeId, model) {
      const before = mustRoute(routeId);
      const next = model?.trim() || null;
      if (before.model === next) return before;
      const route = setRoute(routeId, { model: next });
      // 提前启动好的那个用的是旧模型：换一个（正在回答时不动，这一站结束后自然会按新的准备）
      if (route.status !== "answering" && route.status !== "awaiting_permission") warmRoute(route);
      return route;
    },

    async changes(routeId) {
      const route = mustRoute(routeId);
      const engine = await engineFor(mustProject(route.projectId));
      return engine.changes(routeId);
    },

    terminals: (projectId) => terminals.list({ projectId }).map(toTerminal),
    terminalOutput: (terminalId) => (terminals.get(terminalId) ? terminals.output(terminalId) : ""),
    async terminalStop(terminalId) {
      const t = terminals.get(terminalId);
      if (!t) return;
      if (t.status === "running") await terminals.stop(terminalId);
      else await terminals.remove(terminalId);
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
        express: null,
        name: name?.trim() || NEW_ROUTE_NAME,
        status: "idle",
        sessionId,
        worktreePath,
        parentRouteId: parent.id,
        forkStopId: stop.id,
        model: parent.model,
        color: null,
        contextTokens: null,
        createdAt: Date.now(),
        archivedAt: null,
      };
      db.routes.insert(route);
      emit({ type: "route.updated", route });
      warmRoute(route);
      return route;
    },

    archiveRoute(routeId) {
      const route = mustRoute(routeId);
      if (route.status === "answering" || route.status === "awaiting_permission") throw new CoreError("ROUTE_BUSY", "这一路正在回答，到站或停车后才能归档");
      if (route.status === "archived") return route;
      claude.cool(route.worktreePath);
      void terminals.removeAll({ routeId });
      releaseQueue(route);
      return setRoute(routeId, { status: "archived", archivedAt: Date.now() });
    },

    unarchiveRoute(routeId) {
      const route = mustRoute(routeId);
      if (route.status !== "archived") return route;
      const stops = db.stops.listByRoute(routeId);
      // 归档前如果有冲突或没答完，恢复后还是那个状态：下一站前要先处理
      const status = stops.some((s) => s.syncState === "conflict") ? "conflict" : stops.at(-1)?.status === "interrupted" ? "interrupted" : "idle";
      const restored = setRoute(routeId, { status, archivedAt: null });
      warmRoute(restored);
      return restored;
    },

    async deleteRoute(routeId, force = false) {
      const route = mustRoute(routeId);
      if (route.status === "answering" || route.status === "awaiting_permission") throw new CoreError("ROUTE_BUSY", "这一路正在回答，到站或停车后才能删除");
      const engine = await engineFor(mustProject(route.projectId));
      claude.cool(route.worktreePath); // 提前启动好的 Claude 占着这个目录，先关掉才删得了
      if (force || (await engine.status(routeId).then((s) => s.unsynced.length === 0, () => false))) await terminals.removeAll({ routeId }); // 后台终端也占着目录
      const removed = await engine.removeWorktree(routeId, { force });
      if (removed.status === "has-unsynced") return { status: "has-unsynced", files: removed.files.map((f) => ({ path: f.path, note: f.kind })) };
      if (route.sessionId) await claude.deleteSession(route.sessionId).catch(() => {});
      releaseQueue(route);
      db.routes.delete(routeId);
      emit({ type: "route.deleted", routeId, projectId: route.projectId });
      return { status: "deleted" };
    },

    async distill(routeId, stopId, keep) {
      const route = mustRoute(routeId);
      const stop = db.stops.get(stopId);
      if (!stop || stop.routeId !== routeId) throw new CoreError("NOT_FOUND", `这一路上没有这一站：${stopId}`);
      if (stop.status === "answering") throw new CoreError("CANNOT_FORK", "这一站还在回答，到站后才能压缩");
      if (!route.sessionId || !stop.lastMessageId) throw new CoreError("CANNOT_FORK", "这一站没有留下对话记录，不能从它压缩");
      if (distilling.has(routeId)) throw new CoreError("ROUTE_BUSY", "这一路正在提炼摘要");

      const abort = new AbortController();
      distilling.set(routeId, abort);
      let temp: string | null = null;
      try {
        temp = await claude.fork(route.sessionId, stop.lastMessageId);
        const result = await claude.ask({
          cwd: route.worktreePath,
          prompt: distillPrompt(keep),
          sessionId: temp,
          signal: abort.signal,
          // 临时会话是只读的：不管项目的批准方式是什么，这里什么都不放行
          onPermission: async () => "deny",
        });
        if (abort.signal.aborted) throw new CoreError("DISTILL_FAILED", "已取消");
        if (result.outcome !== "completed" || !result.text.trim()) throw new CoreError("DISTILL_FAILED", `摘要没有写出来${result.error ? `：${result.error}` : ""}`);
        return result.text.trim();
      } finally {
        distilling.delete(routeId);
        if (temp) await claude.deleteSession(temp).catch(() => {});
      }
    },

    cancelDistill(routeId) {
      distilling.get(routeId)?.abort();
    },

    async createExpress(routeId, stopId, summary, name) {
      const source = mustRoute(routeId);
      const stop = db.stops.get(stopId);
      if (!stop || stop.routeId !== routeId) throw new CoreError("NOT_FOUND", `这一路上没有这一站：${stopId}`);
      const project = mustProject(source.projectId);
      const engine = await engineFor(project);
      const newId = id("r");
      const { path: worktreePath } = await engine.createWorktree(newId);
      const express = db.routes.nextExpress(project.id);
      const route: Route = {
        id: newId,
        projectId: project.id,
        number: db.routes.nextNumber(project.id),
        express,
        name: name?.trim() || `${source.name} · 续`,
        status: "idle",
        sessionId: null,
        worktreePath,
        parentRouteId: source.id,
        forkStopId: stop.id,
        model: source.model,
        color: null,
        contextTokens: null,
        createdAt: Date.now(),
        archivedAt: null,
      };
      db.routes.insert(route);
      // 第一站就是这份摘要
      const head: Stop = {
        id: id("s"),
        routeId: newId,
        seq: 1,
        kind: "summary",
        name: "交接摘要",
        nameState: "final",
        prompt: summary.trim(),
        status: "done",
        syncState: "none",
        messageId: null,
        lastMessageId: null,
        error: null,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      db.stops.insert(head);
      emit({ type: "route.updated", route });
      emit({ type: "stop.created", stop: head });
      emit({ type: "stop.updated", stop: head });
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
            if (b.type === "tool_use" && typeof b.name === "string") items.push({ kind: "tool", tool: b.name, ...toolStat((b.input as Record<string, unknown>) ?? {}), detail: toolDetail((b.input as Record<string, unknown>) ?? {}, route.worktreePath) });
          }
        }
        return { stopId: stop.id, items };
      });
    },

    warm: (routeId) => warmRoute(mustRoute(routeId)),

    dispose() {
      claude.dispose();
      void terminals.dispose();
    },
  };
}

function pushText(items: ChatItem[], text: string): void {
  const last = items.at(-1);
  if (last?.kind === "text") last.text += "\n\n" + text;
  else items.push({ kind: "text", text });
}

/** 改文件的工具这一次增、删了多少行（从它的输入里数出来；不是改文件的工具返回空） */
function toolStat(input: Record<string, unknown>): { added?: number; removed?: number } {
  const lines = (v: unknown) => (typeof v === "string" && v ? v.replace(/\n$/, "").split("\n").length : 0);
  if (typeof input.old_string === "string" || typeof input.new_string === "string") return { added: lines(input.new_string), removed: lines(input.old_string) };
  if (typeof input.file_path === "string" && typeof input.content === "string") return { added: lines(input.content), removed: 0 };
  return {};
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

/** 还没问过的路叫这个；第一站出发时改成第一站的名字 */
export const NEW_ROUTE_NAME = "新对话";

/**
 * 站的临时名字：取提问的第一句（至少 4 个字才在标点处断开），
 * 再按显示宽度截到 8 个汉字宽（英文字母算半个）。
 */
export function stopName(prompt: string): string {
  const text = prompt.replace(/\s+/g, " ").trim();
  // 英文的句号和逗号只有后面是空格或结尾时才算断句（b.txt、1,000 里的不算）
  const cut = text.slice(4).search(/[，。？！；?!;]|[.,](?=\s|$)/);
  const clause = cut < 0 ? text : text.slice(0, cut + 4);
  let width = 0;
  let out = "";
  for (const ch of clause) {
    width += /[\u0000-\u00ff]/.test(ch) ? 1 : 2;
    if (width > 16) break;
    out += ch;
  }
  return out.trim() || "新的一站";
}

/** 按显示宽度截断：汉字算 2，英文字母算 1 */
function clampWidth(text: string, max: number): string {
  let width = 0;
  let out = "";
  for (const ch of text.trim()) {
    width += /[\u0000-\u00ff]/.test(ch) ? 1 : 2;
    if (width > max) break;
    out += ch;
  }
  return out.trim();
}

/** 改文件的工具。“改文件不问”时只放行这些 */
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function autoApproves(mode: PermissionMode, tool: string): boolean {
  return mode === "all" || (mode === "edits" && EDIT_TOOLS.has(tool));
}

/** 请 Claude 写交接摘要的提示。keep：用户特别要求保留的内容 */
function distillPrompt(keep?: string): string {
  return [
    "请把到目前为止的整段对话提炼成一份交接摘要。读它的是一个全新的 Claude：它看不到这段对话，只能看到这份摘要和当前的代码。",
    "",
    "不要调用任何工具，不要改任何文件，只输出摘要本身，不要开场白和结束语。用 Markdown，按下面的小节写，没有内容的小节省略：",
    "",
    "## 目标",
    "用户到底想做成什么，一两句话。不要按先后复述用户问过什么。",
    "## 做完了",
    "已经完成并确认过的事，一条一行。",
    "## 改过的文件",
    "路径照原样写，每个文件一句话说明改了什么。",
    "## 定下的事",
    "做过的决定和理由，尤其是被否定掉的方案，免得再走一遍。",
    "## 还没定 / 还没做",
    "按该做的先后列出。",
    "## 要注意的",
    "约定、踩过的坑、用户的偏好。",
    "",
    "写具体：文件路径、函数名、命令、数字都照原样写。不要复述对话的经过。",
    "只写这段对话里用户和你实际讨论过、决定过、做过的事。下面这些不要写，新的对话自己就有：系统提示里的规则和约定（比如提交信息怎么写、怎么用工具）、运行环境的信息（操作系统、shell、当前分支、git 状态）、Branchwork 工作区的机制。",
    "这条“请写摘要”的请求本身不是对话的一部分：不要把它写进目标，也不要写“本次只输出摘要、没有调用工具”这类关于你此刻在做什么的话。",
    "不要把 git status 里看到的未提交改动、未跟踪文件当成待办，除非用户在对话里提到过要处理它们。",
    "篇幅和对话的分量相称：对话简单就只写几行，不要为了填满小节而凑内容。",
    ...(keep?.trim() ? ["", `用户特别要求保留：${keep.trim()}`] : []),
  ].join("\n");
}

/** 快线的第一个问题：摘要 + 问题 */
function handover(summary: string, question: string): string {
  return [
    "下面是之前一段对话的交接摘要。那段对话你看不到，这份摘要就是它留下的全部上下文。代码以当前工作区里的为准；摘要和代码不一致时相信代码，并告诉用户。",
    "",
    "<交接摘要>",
    summary,
    "</交接摘要>",
    "",
    "现在的问题：",
    question,
  ].join("\n");
}
