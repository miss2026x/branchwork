import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../../src/db";
import type { Project, Route, Stop } from "../../src/shared";

const project: Project = { id: "p1", name: "demo", localDir: "/tmp/demo", createdAt: 1 };
const route = (id: string, number: number): Route => ({
  id,
  projectId: "p1",
  number,
  name: `${number} 路`,
  status: "idle",
  sessionId: null,
  worktreePath: `/tmp/wt/${id}`,
  parentRouteId: null,
  forkStopId: null,
  createdAt: number,
  archivedAt: null,
});
const stop = (id: string, routeId: string, seq: number): Stop => ({
  id,
  routeId,
  seq,
  kind: "normal",
  name: "修登录",
  nameState: "temp",
  prompt: "修一下登录页的报错",
  status: "answering",
  syncState: "none",
  messageId: null,
  lastMessageId: null,
  error: null,
  startedAt: seq,
  endedAt: null,
});

describe("数据库", () => {
  it("存进去的和取出来的一样；更新只改传入的字段", () => {
    const db = openDb(":memory:");
    db.projects.insert(project);
    db.routes.insert(route("r1", 1));
    db.stops.insert(stop("s1", "r1", 1));
    expect(db.projects.get("p1")).toEqual(project);
    expect(db.projects.byLocalDir("/tmp/demo")).toEqual(project);
    expect(db.routes.get("r1")).toEqual(route("r1", 1));
    expect(db.stops.get("s1")).toEqual(stop("s1", "r1", 1));

    const r = db.routes.update("r1", { status: "answering", sessionId: "abc" });
    expect(r).toEqual({ ...route("r1", 1), status: "answering", sessionId: "abc" });
    const s = db.stops.update("s1", { status: "done", lastMessageId: "m9", endedAt: 5 });
    expect(s).toEqual({ ...stop("s1", "r1", 1), status: "done", lastMessageId: "m9", endedAt: 5 });
    expect(db.stops.update("s1", { error: null }).error).toBeNull();
    expect(db.routes.get("nope")).toBeNull();
    expect(() => db.routes.update("nope", { name: "x" })).toThrow();
  });

  it("路号和站序自动递增；列表按次序返回", () => {
    const db = openDb(":memory:");
    db.projects.insert(project);
    expect(db.routes.nextNumber("p1")).toBe(1);
    db.routes.insert(route("r2", 2));
    db.routes.insert(route("r1", 1));
    expect(db.routes.nextNumber("p1")).toBe(3);
    expect(db.routes.listByProject("p1").map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(db.stops.nextSeq("r1")).toBe(1);
    db.stops.insert(stop("s2", "r1", 2));
    db.stops.insert(stop("s1", "r1", 1));
    db.stops.insert(stop("s3", "r2", 1));
    expect(db.stops.nextSeq("r1")).toBe(3);
    expect(db.stops.listByRoute("r1").map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(db.stops.listByProject("p1")).toHaveLength(3);
    expect(() => db.stops.insert(stop("dup", "r1", 2))).toThrow(); // 同一路上站序不能重复
  });

  it("同步记录带文件列表；删除一路时它的站和记录一起删", () => {
    const db = openDb(":memory:");
    db.projects.insert(project);
    db.routes.insert(route("r1", 1));
    db.stops.insert(stop("s1", "r1", 1));
    db.syncLog.insert({ id: "y1", routeId: "r1", stopId: "s1", direction: "push", status: "ok", files: [{ path: "a 文件.ts", note: "modified" }], message: null, at: 1 });
    db.syncLog.insert({ id: "y2", routeId: "r1", stopId: null, direction: "pull", status: "conflict", files: [], message: "x", at: 2 });
    expect(db.syncLog.listByRoute("r1").map((e) => e.id)).toEqual(["y2", "y1"]);
    expect(db.syncLog.listByRoute("r1")[1]!.files).toEqual([{ path: "a 文件.ts", note: "modified" }]);
    db.routes.delete("r1");
    expect(db.stops.get("s1")).toBeNull();
    expect(db.syncLog.listByRoute("r1")).toEqual([]);
  });

  it("关掉再打开，数据还在，建表不会重复执行", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-db-"));
    const file = path.join(dir, "bw.sqlite");
    const a = openDb(file);
    a.projects.insert(project);
    a.close();
    const b = openDb(file);
    expect(b.projects.list()).toEqual([project]);
    b.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
});
