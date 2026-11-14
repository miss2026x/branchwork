import { DatabaseSync } from "node:sqlite";
import type { Project, QueueItem, Route, Stop, SyncLogEntry, KeptWorktree } from "../shared";
import { MIGRATIONS } from "./schema";

type Row = Record<string, unknown>;

/** 存取接口。别的模块只认识这个，不知道底下是 SQLite。 */
export interface Db {
  projects: {
    insert(p: Project): void;
    get(id: string): Project | null;
    byLocalDir(localDir: string): Project | null;
    list(): Project[];
    update(id: string, patch: Partial<Omit<Project, "id">>): Project;
  };
  routes: {
    insert(r: Route): void;
    get(id: string): Route | null;
    listByProject(projectId: string): Route[];
    update(id: string, patch: Partial<Omit<Route, "id" | "projectId">>): Route;
    nextNumber(projectId: string): number;
    nextExpress(projectId: string): number;
    delete(id: string): void;
  };
  stops: {
    insert(s: Stop): void;
    get(id: string): Stop | null;
    listByRoute(routeId: string): Stop[];
    listByProject(projectId: string): Stop[];
    update(id: string, patch: Partial<Omit<Stop, "id" | "routeId">>): Stop;
    nextSeq(routeId: string): number;
    /** 删掉这一路上从第 seq 站起的所有站 */
    deleteFrom(routeId: string, seq: number): void;
  };
  queue: {
    insert(q: QueueItem): void;
    get(id: string): QueueItem | null;
    /** 按放进来的先后 */
    listByProject(projectId: string): QueueItem[];
    update(id: string, patch: Partial<Omit<QueueItem, "id" | "projectId">>): QueueItem;
    delete(id: string): void;
  };
  syncLog: {
    insert(e: SyncLogEntry): void;
    listByRoute(routeId: string, limit?: number): SyncLogEntry[];
    listByRoutes(routeIds: string[], limit?: number): SyncLogEntry[];
  };
  kept: {
    insert(k: KeptWorktree): void;
    get(id: string): KeptWorktree | undefined;
    listByProject(projectId: string): KeptWorktree[];
    delete(id: string): void;
  };
  close(): void;
}

/** 打开数据库；file 传 ":memory:" 得到只在内存里的库（测试用） */
export function openDb(file: string): Db {
  const sql = new DatabaseSync(file);
  sql.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(sql);

  const all = (q: string, ...p: unknown[]) => sql.prepare(q).all(...(p as never[])) as Row[];
  const one = (q: string, ...p: unknown[]) => (sql.prepare(q).get(...(p as never[])) as Row | undefined) ?? null;
  const run = (q: string, ...p: unknown[]) => void sql.prepare(q).run(...(p as never[]));

  /** 按“字段名 → 列名”的对照表生成 insert / update，免得每张表手写一遍 */
  const table = <T extends object>(name: string, cols: Record<string, string>, decode: (r: Row) => T) => {
    const keys = Object.keys(cols);
    return {
      insert(obj: T) {
        const o = obj as Record<string, unknown>;
        run(`INSERT INTO ${name} (${keys.map((k) => cols[k]).join(",")}) VALUES (${keys.map(() => "?").join(",")})`, ...keys.map((k) => encode(o[k])));
      },
      get(id: string): T | null {
        const r = one(`SELECT * FROM ${name} WHERE id = ?`, id);
        return r ? decode(r) : null;
      },
      update(id: string, patch: Record<string, unknown>): T {
        const ks = Object.keys(patch).filter((k) => k in cols && patch[k] !== undefined);
        if (ks.length > 0) run(`UPDATE ${name} SET ${ks.map((k) => `${cols[k]} = ?`).join(",")} WHERE id = ?`, ...ks.map((k) => encode(patch[k])), id);
        const r = one(`SELECT * FROM ${name} WHERE id = ?`, id);
        if (!r) throw new Error(`${name} 里没有 id 为 ${id} 的记录`);
        return decode(r);
      },
      where(clause: string, ...p: unknown[]): T[] {
        return all(`SELECT * FROM ${name} WHERE ${clause}`, ...p).map(decode);
      },
    };
  };

  const projects = table<Project>("project", { id: "id", name: "name", localDir: "local_dir", permissionMode: "permission_mode", createdAt: "created_at" }, (r) => ({
    id: r.id as string,
    name: r.name as string,
    localDir: r.local_dir as string,
    permissionMode: r.permission_mode as Project["permissionMode"],
    createdAt: r.created_at as number,
  }));

  const routes = table<Route>(
    "route",
    {
      id: "id",
      projectId: "project_id",
      number: "number",
      express: "express_no",
      name: "name",
      status: "status",
      sessionId: "session_id",
      worktreePath: "worktree_path",
      parentRouteId: "parent_route_id",
      forkStopId: "fork_stop_id",
      model: "model",
      color: "color",
      contextTokens: "context_tokens",
      createdAt: "created_at",
      archivedAt: "archived_at",
    },
    (r) => ({
      id: r.id as string,
      projectId: r.project_id as string,
      number: r.number as number,
      express: (r.express_no as number | null) ?? null,
      name: r.name as string,
      status: r.status as Route["status"],
      sessionId: r.session_id as string | null,
      worktreePath: r.worktree_path as string,
      parentRouteId: r.parent_route_id as string | null,
      forkStopId: r.fork_stop_id as string | null,
      model: (r.model as string | null) ?? null,
      color: (r.color as number | null) ?? null,
      contextTokens: (r.context_tokens as number | null) ?? null,
      createdAt: r.created_at as number,
      archivedAt: r.archived_at as number | null,
    }),
  );

  const stops = table<Stop>(
    "stop",
    {
      id: "id",
      routeId: "route_id",
      seq: "seq",
      kind: "kind",
      name: "name",
      nameState: "name_state",
      prompt: "prompt",
      status: "status",
      syncState: "sync_state",
      messageId: "message_id",
      lastMessageId: "last_message_id",
      error: "error",
      startedAt: "started_at",
      endedAt: "ended_at",
    },
    (r) => ({
      id: r.id as string,
      routeId: r.route_id as string,
      seq: r.seq as number,
      kind: r.kind as Stop["kind"],
      name: r.name as string,
      nameState: r.name_state as Stop["nameState"],
      prompt: r.prompt as string,
      status: r.status as Stop["status"],
      syncState: r.sync_state as Stop["syncState"],
      messageId: r.message_id as string | null,
      lastMessageId: r.last_message_id as string | null,
      error: r.error as string | null,
      startedAt: r.started_at as number,
      endedAt: r.ended_at as number | null,
    }),
  );

  const queue = table<QueueItem>("queue_item", { id: "id", projectId: "project_id", text: "text", mode: "mode", routeId: "route_id", createdAt: "created_at" }, (r) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    text: r.text as string,
    mode: r.mode as QueueItem["mode"],
    routeId: r.route_id as string | null,
    createdAt: r.created_at as number,
  }));

  const kept = table<KeptWorktree>("kept_worktree", { id: "id", projectId: "project_id", path: "path", label: "label", at: "at" }, (r) => ({ id: r.id as string, projectId: r.project_id as string, path: r.path as string, label: r.label as string, at: r.at as number }));
  const syncLog = table<SyncLogEntry>(
    "sync_log",
    { id: "id", routeId: "route_id", stopId: "stop_id", direction: "direction", status: "status", files: "files", message: "message", at: "at" },
    (r) => ({
      id: r.id as string,
      routeId: r.route_id as string,
      stopId: r.stop_id as string | null,
      direction: r.direction as SyncLogEntry["direction"],
      status: r.status as SyncLogEntry["status"],
      files: JSON.parse(r.files as string) as SyncLogEntry["files"],
      message: r.message as string | null,
      at: r.at as number,
    }),
  );

  return {
    projects: {
      insert: projects.insert,
      get: projects.get,
      byLocalDir: (d) => projects.where("local_dir = ?", d)[0] ?? null,
      list: () => projects.where("1 = 1 ORDER BY created_at"),
      update: (id, patch) => projects.update(id, patch),
    },
    routes: {
      insert: routes.insert,
      get: routes.get,
      listByProject: (pid) => routes.where("project_id = ? ORDER BY number", pid),
      update: (id, patch) => routes.update(id, patch),
      nextNumber: (pid) => ((one("SELECT MAX(number) AS n FROM route WHERE project_id = ?", pid)?.n as number | null) ?? 0) + 1,
      nextExpress: (pid) => ((one("SELECT MAX(express_no) AS n FROM route WHERE project_id = ?", pid)?.n as number | null) ?? 0) + 1,
      delete: (id) => run("DELETE FROM route WHERE id = ?", id),
    },
    stops: {
      insert: stops.insert,
      get: stops.get,
      listByRoute: (rid) => stops.where("route_id = ? ORDER BY seq", rid),
      listByProject: (pid) => stops.where("route_id IN (SELECT id FROM route WHERE project_id = ?) ORDER BY started_at, seq", pid),
      update: (id, patch) => stops.update(id, patch),
      nextSeq: (rid) => ((one("SELECT MAX(seq) AS n FROM stop WHERE route_id = ?", rid)?.n as number | null) ?? 0) + 1,
      deleteFrom: (rid, seq) => run("DELETE FROM stop WHERE route_id = ? AND seq >= ?", rid, seq),
    },
    queue: {
      insert: queue.insert,
      get: queue.get,
      listByProject: (pid) => queue.where("project_id = ? ORDER BY created_at, rowid", pid),
      update: (id, patch) => queue.update(id, patch),
      delete: (id) => run("DELETE FROM queue_item WHERE id = ?", id),
    },
    syncLog: {
      insert: syncLog.insert,
      listByRoute: (rid, limit = 100) => syncLog.where("route_id = ? ORDER BY at DESC, rowid DESC LIMIT ?", rid, limit),
      listByRoutes: (rids, limit = 200) => (rids.length ? syncLog.where(`route_id IN (${rids.map(() => "?").join(",")}) ORDER BY at DESC, rowid DESC LIMIT ?`, ...rids, limit) : []),
    },
    kept: {
      insert: kept.insert,
      get: (id) => kept.where("id = ?", id)[0],
      listByProject: (pid) => kept.where("project_id = ? ORDER BY at DESC", pid),
      delete: (id) => run("DELETE FROM kept_worktree WHERE id = ?", id),
    },
    close: () => sql.close(),
  };
}

function encode(v: unknown): unknown {
  if (v === undefined) return null;
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}

function migrate(sql: DatabaseSync): void {
  const current = (sql.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    sql.exec("BEGIN");
    try {
      sql.exec(MIGRATIONS[v]!);
      sql.exec(`PRAGMA user_version = ${v + 1}`);
      sql.exec("COMMIT");
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
  }
}
