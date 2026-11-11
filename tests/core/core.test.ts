import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCore, type Core } from "../../src/core";
import { openDb, type Db } from "../../src/db";
import type { BwEvent, Project } from "../../src/shared";
import { FakeClaude } from "../support/fake-claude";
import { dump, has, LINES, makeLab, read, replaceLine, write, type Lab } from "../sync/helpers";

let lab: Lab;
let db: Db;
let claude: FakeClaude;
let core: Core;
let project: Project;
let events: BwEvent[];

const boot = () => {
  core = createCore({ db, claude, worktreesRoot: path.join(lab.worktrees, "..", "bw-worktrees") });
  events = [];
  core.on((e) => events.push(e));
};
const types = () => events.map((e) => e.type);
/** 等到某种事件出现（不靠猜时间：慢机器上站前同步就要好几秒） */
const until = (type: BwEvent["type"]) =>
  new Promise<void>((resolve) => {
    if (events.some((e) => e.type === type)) return resolve();
    const off = core.on((e) => {
      if (e.type !== type) return;
      off();
      resolve();
    });
  });
const stopsOf = (routeId: string) => core.snapshot(project.id).stops.filter((s) => s.routeId === routeId);
const routeOf = (routeId: string) => core.snapshot(project.id).routes.find((r) => r.id === routeId)!;

beforeEach(async () => {
  lab = await makeLab();
  db = openDb(":memory:");
  claude = new FakeClaude();
  boot();
  project = await core.addProject(lab.local);
});
afterEach(() => {
  db.close();
  lab.cleanup();
});

describe("问一站", () => {
  it("在一路上连续问两站：第二站接着同一个会话，每站结束后改动进 Local", async () => {
    const route = await core.createRoute(project.id);
    expect(route).toMatchObject({ number: 1, name: "1 路", status: "idle", sessionId: null });

    claude.script = (t) => {
      t.say("改好了 b");
      write(t.cwd, "b.txt", "stop one\n");
    };
    const first = await core.ask(route.id, "把 b.txt 改成 stop one，谢谢");
    expect(first).toMatchObject({ kind: "answered", text: "改好了 b", stop: { seq: 1, status: "done", syncState: "synced", name: "把 b.tx", nameState: "temp" } });
    expect(read(lab.local, "b.txt")).toBe("stop one\n");

    claude.script = (t) => {
      expect(t.earlierPrompts).toEqual(["把 b.txt 改成 stop one，谢谢"]); // 记得上一站
      write(t.cwd, "c.txt", "stop two\n");
    };
    const second = await core.ask(route.id, "再加一个 c.txt");
    expect(second).toMatchObject({ kind: "answered", stop: { seq: 2, status: "done", syncState: "synced" } });
    expect(read(lab.local, "c.txt")).toBe("stop two\n");

    // 会话和消息 ID 都记下来了，第二站是接着问的
    const [s1, s2] = stopsOf(route.id);
    expect(claude.asks[0]!.sessionId).toBeUndefined();
    expect(claude.asks[1]!.sessionId).toBe(routeOf(route.id).sessionId);
    expect(claude.asks[1]!.afterMessageId).toBe(s1!.lastMessageId);
    expect(claude.asks[1]!.cwd).toBe(route.worktreePath);
    expect(s1!.messageId && s1!.lastMessageId && s2!.messageId && s2!.lastMessageId).toBeTruthy();
    expect(routeOf(route.id).status).toBe("idle");
    expect(core.syncLog(route.id).map((e) => [e.direction, e.status, e.files.map((f) => f.path)])).toEqual([
      ["push", "ok", ["c.txt"]],
      ["push", "ok", ["b.txt"]],
    ]);
  });

  it("事件的先后：这一路开始回答 → 站出现 → 文字流出 → 到站 → 同步结果 → 这一路空闲", async () => {
    const route = await core.createRoute(project.id);
    events.length = 0;
    claude.script = (t) => {
      t.say("第一");
      t.tool("Edit", { file_path: "b.txt" });
      t.say("第二");
      write(t.cwd, "b.txt", "x\n");
    };
    await core.ask(route.id, "改一下");
    expect(types()).toEqual(["route.updated", "stop.created", "stop.delta", "stop.tool", "stop.delta", "route.updated", "stop.updated", "sync.result", "stop.updated", "route.updated"]);
    const done = events.find((e) => e.type === "stop.updated")!;
    expect(done).toMatchObject({ stop: { status: "done", syncState: "none" } }); // 先到站，同步在后
    expect(events.at(-1)).toMatchObject({ route: { status: "idle" } });
  });

  it("Claude 没改文件：这一站不产生同步记录", async () => {
    const route = await core.createRoute(project.id);
    claude.script = (t) => t.say("这个函数的作用是……");
    const r = await core.ask(route.id, "解释一下 app.ts");
    expect(r).toMatchObject({ kind: "answered", sync: null, stop: { status: "done", syncState: "none" } });
    expect(core.syncLog(route.id)).toEqual([]);
  });

  it("站前把 Local 的新变化带进工作区，Claude 看得到", async () => {
    const route = await core.createRoute(project.id);
    write(lab.local, "notes.md", "用户刚写的\n");
    claude.script = (t) => {
      expect(read(t.cwd, "notes.md")).toBe("用户刚写的\n");
    };
    await core.ask(route.id, "看一下 notes");
    expect(core.syncLog(route.id)[0]).toMatchObject({ direction: "pull", status: "ok", stopId: null });
  });

  it("同一路正在回答时不能再问；两路可以同时回答，各自同步", async () => {
    const [a, b] = [await core.createRoute(project.id), await core.createRoute(project.id)];
    expect(b).toMatchObject({ number: 2, name: "2 路" });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    claude.script = async (t) => {
      await gate;
      write(t.cwd, t.prompt.includes("A") ? "a.txt" : "b.txt", t.prompt.includes("A") ? replaceLine(LINES, 2, "by A") : "by B\n");
    };
    const pa = core.ask(a.id, "A 的任务");
    const pb = core.ask(b.id, "B 的任务");
    await expect(core.ask(a.id, "再问一句")).rejects.toMatchObject({ code: "ROUTE_BUSY" });
    release();
    const [ra, rb] = await Promise.all([pa, pb]);
    expect([ra.kind, rb.kind]).toEqual(["answered", "answered"]);
    expect(read(lab.local, "a.txt")).toBe(replaceLine(LINES, 2, "by A"));
    expect(read(lab.local, "b.txt")).toBe("by B\n");
    expect(claude.asks[0]!.cwd).not.toBe(claude.asks[1]!.cwd);
  });
});

describe("没答完", () => {
  it("停车：不同步，工作区保留，这一站标记没答完；接着问，下一站正常结束后一起进 Local", async () => {
    const route = await core.createRoute(project.id);
    claude.script = async (t) => {
      write(t.cwd, "b.txt", "half done\n");
      t.say("正在改……");
      await new Promise<void>((r) => t.signal.addEventListener("abort", () => r()));
    };
    const asking = core.ask(route.id, "改两个文件");
    await until("stop.delta");
    core.stop(route.id);
    const r = await asking;
    expect(r).toMatchObject({ kind: "answered", sync: null, stop: { status: "interrupted", syncState: "unsynced", error: "已停车" } });
    expect(routeOf(route.id).status).toBe("interrupted");
    expect(read(lab.local, "b.txt")).toBe("bee\n");
    expect(read(route.worktreePath, "b.txt")).toBe("half done\n");

    claude.script = (t) => write(t.cwd, "c.txt", "finished\n");
    const next = await core.ask(route.id, "继续");
    expect(next).toMatchObject({ kind: "answered", stop: { status: "done", syncState: "synced" } });
    expect(read(lab.local, "b.txt")).toBe("half done\n");
    expect(read(lab.local, "c.txt")).toBe("finished\n");
    expect(stopsOf(route.id).map((s) => [s.status, s.syncState])).toEqual([
      ["interrupted", "synced"],
      ["done", "synced"],
    ]);
    expect(routeOf(route.id).status).toBe("idle");
  });

  it("刚问出去、Claude 还没开始就停车：也算数，不启动 Claude，提问留在这一站里", async () => {
    const route = await core.createRoute(project.id);
    claude.script = () => {
      throw new Error("不该被调用");
    };
    const asking = core.ask(route.id, "问完马上后悔");
    core.stop(route.id); // 此刻还在做站前同步
    const r = await asking;
    expect(r).toMatchObject({ kind: "answered", stop: { status: "interrupted", error: "已停车", prompt: "问完马上后悔" } });
    expect(claude.asks).toHaveLength(0);
    expect(routeOf(route.id).status).toBe("interrupted");
    // 之后还能正常问
    claude.script = (t) => write(t.cwd, "b.txt", "ok\n");
    expect(await core.ask(route.id, "重新问")).toMatchObject({ stop: { status: "done", syncState: "synced" } });
  });

  it("Claude 报错结束：同样不同步，并记下原因", async () => {
    const route = await core.createRoute(project.id);
    claude.script = (t) => {
      write(t.cwd, "b.txt", "broken\n");
      throw new Error("error_max_turns");
    };
    const r = await core.ask(route.id, "做一件很长的事");
    expect(r).toMatchObject({ kind: "answered", stop: { status: "interrupted", syncState: "unsynced", error: "error_max_turns" } });
    expect(read(lab.local, "b.txt")).toBe("bee\n");
  });

  it("应用在回答途中退出：重启后那一站算没答完，可以接着问", async () => {
    const route = await core.createRoute(project.id);
    claude.script = () => new Promise(() => {}); // 永远不结束
    void core.ask(route.id, "改一下");
    await until("stop.created");
    expect(routeOf(route.id).status).toBe("answering");

    boot(); // 同一个数据库，重新启动
    expect(routeOf(route.id).status).toBe("interrupted");
    expect(stopsOf(route.id)[0]).toMatchObject({ status: "interrupted" });
    claude.script = (t) => write(t.cwd, "b.txt", "after restart\n");
    expect(await core.ask(route.id, "继续")).toMatchObject({ kind: "answered", stop: { seq: 2, syncState: "synced" } });
    expect(read(lab.local, "b.txt")).toBe("after restart\n");
  });
});

/** 两路同时回答、都改 b.txt；A 先到站，B 后到站 */
async function bothEditSameLine(a: string, b: string) {
  let releaseB!: () => void;
  const gateB = new Promise<void>((r) => (releaseB = r));
  claude.script = async (t) => {
    if (t.prompt === "B") await gateB;
    write(t.cwd, "b.txt", `by ${t.prompt}\n`);
  };
  const pb = core.ask(b, "B");
  await core.ask(a, "A");
  releaseB();
  return pb;
}

describe("冲突", () => {
  it("站后冲突：Local 不动，这一站和这一路标记冲突，下一站被拦住；别的路不受影响", async () => {
    const [a, b] = [await core.createRoute(project.id), await core.createRoute(project.id)];
    const r = await bothEditSameLine(a.id, b.id);
    const before = dump(lab.local);
    expect(read(lab.local, "b.txt")).toBe("by A\n");
    expect(r).toMatchObject({ kind: "answered", stop: { status: "done", syncState: "conflict" }, sync: { status: "conflict", files: [{ path: "b.txt", note: "both-modified" }] } });
    expect(dump(lab.local)).toEqual(before);
    expect(routeOf(b.id).status).toBe("conflict");
    await expect(core.ask(b.id, "再问")).rejects.toMatchObject({ code: "ROUTE_BLOCKED" });
    claude.script = (t) => write(t.cwd, "c.txt", "a goes on\n");
    expect(await core.ask(a.id, "A2")).toMatchObject({ stop: { syncState: "synced" } });
  });

  it("站前冲突：这一站不发出，Claude 没被调用", async () => {
    const route = await core.createRoute(project.id);
    claude.script = async (t) => {
      write(t.cwd, "b.txt", "wt version\n");
      return "interrupted" as const;
    };
    await core.ask(route.id, "先留下没同步的改动");
    write(lab.local, "b.txt", "local version\n");
    const calls = claude.asks.length;
    const r = await core.ask(route.id, "接着问");
    expect(r).toMatchObject({ kind: "blocked", sync: { direction: "pull", status: "conflict" } });
    expect(claude.asks.length).toBe(calls);
    expect(stopsOf(route.id)).toHaveLength(1);
    expect(routeOf(route.id).status).toBe("conflict");
  });

  it("手工处理好冲突后重新同步：改动进 Local，这一路恢复可用", async () => {
    const [a, b] = [await core.createRoute(project.id), await core.createRoute(project.id)];
    await bothEditSameLine(a.id, b.id);
    expect((await core.resync(b.id)).at(-1)).toMatchObject({ status: "conflict" }); // 没处理就重试：还是冲突
    write(b.worktreePath, "b.txt", "by A\n"); // 用户在工作区里把这个文件改回和 Local 一样
    write(b.worktreePath, "extra.txt", "kept\n");
    const entries = await core.resync(b.id);
    expect(entries.at(-1)).toMatchObject({ direction: "push", status: "ok" });
    expect(read(lab.local, "extra.txt")).toBe("kept\n");
    expect(routeOf(b.id).status).toBe("idle");
    expect(stopsOf(b.id)[0]!.syncState).toBe("synced");
    claude.script = () => {};
    expect((await core.ask(b.id, "又能问了")).kind).toBe("answered");
  });
});

describe("等你批准", () => {
  it("请求作为事件发出；这一路显示等待批准；回答后继续", async () => {
    const route = await core.createRoute(project.id);
    const decisions: string[] = [];
    claude.script = async (t) => {
      decisions.push(await t.askPermission("Bash", { command: "npm test" }));
      decisions.push(await t.askPermission("Write", { file_path: "x" }, false));
    };
    core.on((e) => {
      if (e.type !== "permission.request") return;
      expect(routeOf(route.id).status).toBe("awaiting_permission");
      setTimeout(() => core.answerPermission(e.requestId, e.tool === "Bash" ? "allow-always" : "deny"), 10);
    });
    await core.ask(route.id, "跑一下测试");
    expect(decisions).toEqual(["allow-always", "deny"]);
    const reqs = events.filter((e) => e.type === "permission.request");
    expect(reqs).toMatchObject([
      { tool: "Bash", input: { command: "npm test" }, canRemember: true, routeId: route.id },
      { tool: "Write", canRemember: false },
    ]);
    expect(routeOf(route.id).status).toBe("idle");
  });

  it("等批准时停车：按拒绝处理，这一站算没答完", async () => {
    const route = await core.createRoute(project.id);
    let decision = "";
    claude.script = async (t) => {
      decision = await t.askPermission("Bash", { command: "rm -rf build" });
    };
    core.on((e) => {
      if (e.type === "permission.request") setTimeout(() => core.stop(route.id), 10);
    });
    const r = await core.ask(route.id, "清理一下");
    expect(decision).toBe("deny");
    expect(r).toMatchObject({ kind: "answered", stop: { status: "interrupted" } });
    expect(routeOf(route.id).status).toBe("interrupted");
  });
});

describe("项目", () => {
  it("同一个目录加两次得到同一个项目；不是仓库的目录加不进来", async () => {
    expect((await core.addProject(lab.local)).id).toBe(project.id);
    expect(core.listProjects()).toHaveLength(1);
    const plain = path.join(lab.worktrees, "..", "plain");
    fs.mkdirSync(plain);
    await expect(core.addProject(plain)).rejects.toMatchObject({ code: "NOT_A_REPO" });
    expect(core.listProjects()).toHaveLength(1);
  });

  it("重启后项目、路、站都还在，接着问还是同一个会话", async () => {
    const route = await core.createRoute(project.id);
    claude.script = (t) => write(t.cwd, "b.txt", "one\n");
    await core.ask(route.id, "第一站");
    const session = routeOf(route.id).sessionId;
    boot();
    expect(core.snapshot(project.id)).toMatchObject({ project: { id: project.id }, routes: [{ id: route.id, sessionId: session }], stops: [{ seq: 1 }] });
    claude.script = (t) => write(t.cwd, "b.txt", "two\n");
    await core.ask(route.id, "第二站");
    expect(claude.asks.at(-1)!.sessionId).toBe(session);
    expect(read(lab.local, "b.txt")).toBe("two\n");
    expect(has(lab.local, "b.txt")).toBe(true);
  });
});
