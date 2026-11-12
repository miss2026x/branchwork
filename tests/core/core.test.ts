import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCore, stopName, type Core } from "../../src/core";
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
    expect(route).toMatchObject({ number: 1, name: "新对话", status: "idle", sessionId: null });

    claude.script = (t) => {
      t.say("改好了 b");
      write(t.cwd, "b.txt", "stop one\n");
    };
    const first = await core.ask(route.id, "把 b.txt 改成 stop one，谢谢");
    expect(first).toMatchObject({ kind: "answered", text: "改好了 b", stop: { seq: 1, status: "done", syncState: "synced", name: "把 b.txt 改成 st", nameState: "temp" } });
    expect(routeOf(route.id).name).toBe("把 b.txt 改成 st"); // 没起名的路用第一站的名字
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

  it("事件的先后：这一路开始回答 → 站出现 → Claude 已启动 → 文字流出 → 到站 → 同步结果 → 这一路空闲", async () => {
    const route = await core.createRoute(project.id, "已起名");
    events.length = 0;
    claude.script = (t) => {
      t.say("第一");
      t.tool("Edit", { file_path: "b.txt" });
      t.say("第二");
      write(t.cwd, "b.txt", "x\n");
    };
    await core.ask(route.id, "改一下");
    expect(types()).toEqual(["route.updated", "stop.created", "stop.started", "stop.delta", "stop.tool", "stop.delta", "route.updated", "stop.updated", "sync.result", "stop.updated", "route.updated"]);
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
    expect(b).toMatchObject({ number: 2, name: "新对话" });
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

  it("停车后 Claude 没有马上停下、还在往外吐字：这些字不再送给界面", async () => {
    const route = await core.createRoute(project.id);
    claude.script = async (t) => {
      t.say("停车前");
      await new Promise<void>((r) => t.signal.addEventListener("abort", () => r()));
      t.say("停车后还在吐的字");
      t.tool("Edit", {});
    };
    const asking = core.ask(route.id, "数数");
    await until("stop.delta");
    core.stop(route.id);
    await asking;
    const shown = events.filter((e) => e.type === "stop.delta" || e.type === "stop.tool");
    expect(shown).toMatchObject([{ text: "停车前" }]);
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

describe("让当前 Claude 解决冲突", () => {
  it("带着冲突标记开一站；Claude 改好后改动进 Local，这一路恢复可用，之前冲突的那一站也算同步了", async () => {
    const [a, b] = [await core.createRoute(project.id), await core.createRoute(project.id)];
    await bothEditSameLine(a.id, b.id);
    expect(routeOf(b.id).status).toBe("conflict");

    let seenByClaude = "";
    claude.script = (t) => {
      seenByClaude = read(t.cwd, "b.txt");
      expect(t.prompt).toContain("- b.txt");
      write(t.cwd, "b.txt", "by A and B\n");
    };
    const r = await core.resolveConflict(b.id);
    expect(seenByClaude).toContain("<<<<<<< ");
    expect(seenByClaude).toContain("by A");
    expect(seenByClaude).toContain("by B");
    expect(r).toMatchObject({ kind: "answered", stop: { name: "解决同步冲突", nameState: "final", status: "done", syncState: "synced" } });
    expect(read(lab.local, "b.txt")).toBe("by A and B\n");
    expect(routeOf(b.id).status).toBe("idle");
    expect(stopsOf(b.id).map((s) => s.syncState)).toEqual(["synced", "synced"]);
    expect(core.syncLog(b.id).map((e) => [e.direction, e.status])).toEqual([
      ["push", "ok"],
      ["resolve", "conflict"],
      ["push", "conflict"],
    ]);
  });

  it("Claude 没把冲突标记清干净：不进 Local，这一路还是冲突", async () => {
    const [a, b] = [await core.createRoute(project.id), await core.createRoute(project.id)];
    await bothEditSameLine(a.id, b.id);
    claude.script = (t) => t.say("我看了一下，但没改。");
    const r = await core.resolveConflict(b.id);
    expect(r).toMatchObject({ kind: "answered", stop: { syncState: "conflict" }, sync: { status: "conflict", files: [{ path: "b.txt", note: "markers-left" }] } });
    expect(read(lab.local, "b.txt")).toBe("by A\n");
    expect(routeOf(b.id).status).toBe("conflict");
  });

  it("Local 那边已经变得能自动合并：不问 Claude，直接同步", async () => {
    const [a, b] = [await core.createRoute(project.id), await core.createRoute(project.id)];
    await bothEditSameLine(a.id, b.id);
    write(lab.local, "b.txt", "bee\n"); // 用户把 Local 里这个文件改回了原样
    const calls = claude.asks.length;
    const r = await core.resolveConflict(b.id);
    expect(r.kind).toBe("synced");
    expect(claude.asks.length).toBe(calls);
    expect(read(lab.local, "b.txt")).toBe("by B\n");
    expect(routeOf(b.id).status).toBe("idle");
  });

  it("没有冲突的路不能调这个操作", async () => {
    const route = await core.createRoute(project.id);
    await expect(core.resolveConflict(route.id)).rejects.toMatchObject({ code: "ROUTE_NOT_BLOCKED" });
  });
});

describe("从一站开新对话（分叉）", () => {
  it("新的一路带着到那一站为止的历史；新的会话、新的工作区；原来那一路不受影响", async () => {
    const parent = await core.createRoute(project.id);
    claude.script = (t) => write(t.cwd, `${t.prompt}.txt`, "x\n");
    for (const q of ["一", "二", "三"]) await core.ask(parent.id, q);
    const second = stopsOf(parent.id)[1]!;

    events.length = 0;
    const fork = await core.fork(parent.id, second.id, "试另一种做法");
    expect(fork).toMatchObject({ number: 2, name: "试另一种做法", status: "idle", parentRouteId: parent.id, forkStopId: second.id });
    expect(fork.sessionId).toBeTruthy();
    expect(fork.sessionId).not.toBe(routeOf(parent.id).sessionId);
    expect(fork.worktreePath).not.toBe(parent.worktreePath);
    expect(types()).toContain("route.updated");
    expect(claude.warmed.at(-1)).toEqual([fork.worktreePath, fork.sessionId]);
    // 代码从 Local 的现在开始：三站的文件都在（它们已经同步进 Local 了）
    expect(has(fork.worktreePath, "三.txt")).toBe(true);

    let remembered: string[] = [];
    claude.script = (t) => {
      remembered = t.earlierPrompts;
      write(t.cwd, "fork.txt", "from fork\n");
    };
    expect(await core.ask(fork.id, "岔出去的第一问")).toMatchObject({ kind: "answered", stop: { seq: 1, syncState: "synced" } });
    expect(remembered).toEqual(["一", "二"]); // 只记得到分叉那一站
    expect(read(lab.local, "fork.txt")).toBe("from fork\n");

    await core.ask(parent.id, "四");
    expect(remembered).toEqual(["一", "二", "三"]); // 原来那一路的历史没变
    expect(stopsOf(parent.id)).toHaveLength(4);
  });

  it("不给名字的先叫“新对话”，第一站出发后用第一站的名字；可以从分叉出来的路上再分叉", async () => {
    const r1 = await core.createRoute(project.id);
    await core.ask(r1.id, "一");
    const r2 = await core.fork(r1.id, stopsOf(r1.id)[0]!.id);
    expect(r2.name).toBe("新对话");
    await core.ask(r2.id, "二");
    expect(routeOf(r2.id).name).toBe("二");
    const r3 = await core.fork(r2.id, stopsOf(r2.id)[0]!.id, "  ");
    expect(r3).toMatchObject({ name: "新对话", parentRouteId: r2.id });
    let remembered: string[] = [];
    claude.script = (t) => void (remembered = t.earlierPrompts);
    await core.ask(r3.id, "三");
    expect(remembered).toEqual(["一", "二"]);
  });

  it("还在回答的站、没留下对话记录的站、别的路上的站：都不能分叉", async () => {
    const [a, b] = [await core.createRoute(project.id), await core.createRoute(project.id)];
    await core.ask(b.id, "别的路");
    await expect(core.fork(a.id, stopsOf(b.id)[0]!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const early = core.ask(a.id, "马上停");
    core.stop(a.id);
    await early;
    await expect(core.fork(a.id, stopsOf(a.id)[0]!.id)).rejects.toMatchObject({ code: "CANNOT_FORK" });

    claude.script = () => new Promise(() => {});
    events.length = 0;
    void core.ask(b.id, "不结束");
    await until("stop.created");
    const answering = stopsOf(b.id).find((s) => s.status === "answering")!;
    await expect(core.fork(b.id, answering.id)).rejects.toMatchObject({ code: "CANNOT_FORK" });
    expect(core.snapshot(project.id).routes).toHaveLength(2);
  });
});

describe("候车区", () => {
  const queue = () => core.snapshot(project.id).queue;
  /** 等到某一路空下来，且上面正好有 n 站 */
  const settled = (routeId: string, n: number) => expect.poll(() => (routeOf(routeId).status === "idle" ? stopsOf(routeId).length : -1), { timeout: 20000 }).toBe(n);

  it("放进来先不派车；派给一路后按自动或手动登车；撤回、删除", async () => {
    const route = await core.createRoute(project.id);
    claude.script = () => new Promise(() => {}); // 这一路一直在回答
    void core.ask(route.id, "占着");
    await until("stop.created");

    const a = core.queueAdd(project.id, "  问题 A  ");
    expect(a).toMatchObject({ text: "问题 A", mode: "unassigned", routeId: null });
    expect(events.at(-1)).toMatchObject({ type: "queue.updated", projectId: project.id, items: [{ id: a.id }] });
    expect(core.queueAssign(a.id, route.id)).toMatchObject({ mode: "auto", routeId: route.id });
    expect(core.queueAssign(a.id, route.id, "manual")).toMatchObject({ mode: "manual" });
    expect(core.queueAssign(a.id, null)).toMatchObject({ mode: "unassigned", routeId: null });
    const b = core.queueAdd(project.id, "问题 B", route.id);
    expect(b.mode).toBe("auto");
    expect(queue().map((q) => q.text)).toEqual(["问题 A", "问题 B"]);
    await expect(core.queueBoard(b.id)).rejects.toMatchObject({ code: "ROUTE_BUSY" }); // 这一路还没到站
    await expect(core.queueBoard(a.id)).rejects.toMatchObject({ code: "NOT_FOUND" }); // 还没派车
    core.queueRemove(a.id);
    core.queueRemove("nope");
    expect(queue().map((q) => q.text)).toEqual(["问题 B"]);
    expect(() => core.queueAdd(project.id, "   ")).toThrow();
    boot(); // 候车的问题存在数据库里
    expect(queue()).toMatchObject([{ text: "问题 B", mode: "auto", routeId: route.id }]);
  });

  it("自动登车：那一路正常到站后自动发出下一个，按放进来的先后一个一个来", async () => {
    const route = await core.createRoute(project.id);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    claude.script = async (t) => {
      order.push(t.prompt);
      if (t.prompt === "第一站") await gate;
      write(t.cwd, `${order.length}.txt`, "x\n");
    };
    const first = core.ask(route.id, "第一站");
    await until("stop.created");
    core.queueAdd(project.id, "排队一", route.id);
    core.queueAdd(project.id, "排队二", route.id);
    core.queueAdd(project.id, "手动的", route.id, "manual");
    expect(order).toEqual(["第一站"]);
    release();
    await first;
    await settled(route.id, 3);
    expect(order).toEqual(["第一站", "排队一", "排队二"]);
    expect(stopsOf(route.id).map((s) => [s.prompt, s.syncState])).toEqual([
      ["第一站", "synced"],
      ["排队一", "synced"],
      ["排队二", "synced"],
    ]);
    expect(queue()).toMatchObject([{ text: "手动的", mode: "manual" }]); // 手动的不会自己发
    expect(read(lab.local, "3.txt")).toBe("x\n");

    // 手动登车
    const report = await core.queueBoard(queue()[0]!.id);
    expect(report).toMatchObject({ kind: "answered", stop: { prompt: "手动的" } });
    expect(queue()).toEqual([]);
  });

  it("派给一路时它正好空着：自动登车的马上发出", async () => {
    const route = await core.createRoute(project.id);
    claude.script = (t) => t.say("ok");
    core.queueAdd(project.id, "马上发", route.id);
    await settled(route.id, 1);
    expect(stopsOf(route.id)[0]!.prompt).toBe("马上发");
    const later = core.queueAdd(project.id, "先不派");
    core.queueAssign(later.id, route.id);
    await settled(route.id, 2);
    expect(queue()).toEqual([]);
  });

  it("那一站没答完或有冲突：不自动发，问题留在候车区", async () => {
    const [a, b] = [await core.createRoute(project.id), await core.createRoute(project.id)];
    claude.script = async (t) => {
      await new Promise<void>((r) => t.signal.addEventListener("abort", () => r()));
    };
    const asking = core.ask(a.id, "会被停掉");
    await until("stop.created");
    core.queueAdd(project.id, "等着", a.id);
    core.stop(a.id);
    await asking;
    await new Promise((r) => setTimeout(r, 50));
    expect(routeOf(a.id).status).toBe("interrupted");
    expect(queue()).toMatchObject([{ text: "等着", mode: "auto" }]);
    expect(stopsOf(a.id)).toHaveLength(1);
    core.queueRemove(queue()[0]!.id);

    // 冲突的那一路
    await core.deleteRoute(a.id, true);
    const c = await core.createRoute(project.id);
    events.length = 0;
    const pb = bothEditSameLine(c.id, b.id);
    await until("stop.created");
    core.queueAdd(project.id, "冲突后不发", b.id);
    await pb;
    await new Promise((r) => setTimeout(r, 50));
    expect(routeOf(b.id).status).toBe("conflict");
    expect(queue()).toMatchObject([{ text: "冲突后不发", routeId: b.id }]);
    await expect(core.queueBoard(queue()[0]!.id)).rejects.toMatchObject({ code: "ROUTE_BLOCKED" });
  });

  it("登车时站前同步冲突，问题没发出去：放回候车区，不弄丢", async () => {
    const route = await core.createRoute(project.id);
    claude.script = (t) => {
      write(t.cwd, "b.txt", "wt\n");
      return "interrupted" as const;
    };
    await core.ask(route.id, "留下没同步的改动");
    write(lab.local, "b.txt", "local\n");
    const item = core.queueAdd(project.id, "会被拦下", route.id, "manual");
    expect(await core.queueBoard(item.id)).toMatchObject({ kind: "blocked" });
    expect(queue()).toMatchObject([{ text: "会被拦下", mode: "manual", routeId: route.id }]);
  });

  it("开新车：为这个问题新开一路并发出；归档或删除一路时，派给它的问题撤回到未派车", async () => {
    claude.script = (t) => t.say("ok");
    const item = core.queueAdd(project.id, "单独开一路问");
    const route = await core.queueStartNew(item.id);
    await settled(route.id, 1);
    expect(routeOf(route.id).name).toBe("单独开一路问");
    expect(queue()).toEqual([]);

    claude.script = () => new Promise(() => {});
    const other = await core.createRoute(project.id);
    core.queueAdd(project.id, "给归档的", route.id, "manual");
    core.archiveRoute(route.id);
    expect(queue()).toMatchObject([{ text: "给归档的", mode: "unassigned", routeId: null }]);
    expect(() => core.queueAssign(queue()[0]!.id, route.id)).toThrow("已归档");
    core.queueAssign(queue()[0]!.id, other.id, "manual");
    await core.deleteRoute(other.id);
    expect(queue()).toMatchObject([{ mode: "unassigned", routeId: null }]);
  });
});

describe("压缩成快线", () => {
  const threeStops = async () => {
    const route = await core.createRoute(project.id, "登录重构");
    claude.script = (t) => {
      write(t.cwd, `${t.prompt}.txt`, "x\n");
      t.say(`做了${t.prompt}`);
    };
    for (const q of ["一", "二", "三"]) await core.ask(route.id, q);
    return route;
  };

  it("提炼：在临时会话里请 Claude 写摘要，它只看得到选中的站，什么都不能改；写完临时会话就删了，原来那一路不变", async () => {
    core.setPermissionMode(project.id, "all"); // 即使项目设了全部不问，提炼时也不放行
    const route = await threeStops();
    const sessions = claude.sessions.size;
    const before = await core.history(route.id);
    let seen: { prompts: string[]; decision: string; cwd: string; prompt: string } | undefined;
    claude.script = async (t) => {
      seen = { prompts: t.earlierPrompts, decision: await t.askPermission("Write", { file_path: "x" }), cwd: t.cwd, prompt: t.prompt };
      t.say("## 做完了\n- 一和二");
    };
    events.length = 0;
    const summary = await core.distill(route.id, stopsOf(route.id)[1]!.id, "别忘了时区");
    expect(summary).toBe("## 做完了\n- 一和二");
    expect(seen).toMatchObject({ prompts: ["一", "二"], decision: "deny", cwd: route.worktreePath });
    expect(seen!.prompt).toContain("交接摘要");
    expect(seen!.prompt).toContain("用户特别要求保留：别忘了时区");
    expect(claude.sessions.size).toBe(sessions); // 临时会话已删
    expect(await core.history(route.id)).toEqual(before);
    expect(stopsOf(route.id)).toHaveLength(3);
    expect(routeOf(route.id).status).toBe("idle");
    expect(events).toEqual([]); // 这一路在界面上没有任何变化
  });

  it("摘要没写出来或被取消：报错，临时会话照样删掉", async () => {
    const route = await threeStops();
    const sessions = claude.sessions.size;
    const last = stopsOf(route.id)[2]!.id;
    claude.script = () => "failed";
    await expect(core.distill(route.id, last)).rejects.toMatchObject({ code: "DISTILL_FAILED" });
    claude.script = () => {};
    await expect(core.distill(route.id, last)).rejects.toMatchObject({ code: "DISTILL_FAILED" }); // 空的
    claude.script = async (t) => {
      await new Promise<void>((r) => t.signal.addEventListener("abort", () => r()));
    };
    const running = core.distill(route.id, last);
    await expect(core.distill(route.id, last)).rejects.toMatchObject({ code: "ROUTE_BUSY" });
    await new Promise((r) => setTimeout(r, 20));
    core.cancelDistill(route.id);
    await expect(running).rejects.toMatchObject({ code: "DISTILL_FAILED", message: "已取消" });
    expect(claude.sessions.size).toBe(sessions);
  });

  it("开出快线：全新的会话和工作区，第一站是摘要；第一个问题连同摘要一起交给 Claude，之后的问题不再带", async () => {
    const route = await threeStops();
    const third = stopsOf(route.id)[2]!;
    const express = await core.createExpress(route.id, third.id, "## 做完了\n- 一二三\n", "登录收尾");
    expect(express).toMatchObject({ express: 1, number: 2, name: "登录收尾", sessionId: null, status: "idle", parentRouteId: route.id, forkStopId: third.id });
    expect(express.worktreePath).not.toBe(route.worktreePath);
    expect(has(express.worktreePath, "三.txt")).toBe(true); // 代码从 Local 的现在开始
    expect(stopsOf(express.id)).toMatchObject([{ seq: 1, kind: "summary", name: "交接摘要", prompt: "## 做完了\n- 一二三", status: "done" }]);

    const got: { prompt: string; earlier: string[] }[] = [];
    claude.script = (t) => {
      got.push({ prompt: t.prompt, earlier: t.earlierPrompts });
      write(t.cwd, "express.txt", "y\n");
    };
    const first = await core.ask(express.id, "接着做第四件事");
    expect(first).toMatchObject({ kind: "answered", stop: { seq: 2, prompt: "接着做第四件事", name: "接着做第四件事", syncState: "synced" } });
    expect(got[0]!.earlier).toEqual([]); // 新会话，不记得原来的对话
    expect(got[0]!.prompt).toContain("<交接摘要>\n## 做完了\n- 一二三\n</交接摘要>");
    expect(got[0]!.prompt).toContain("现在的问题：\n接着做第四件事");
    expect(routeOf(express.id).sessionId).not.toBe(routeOf(route.id).sessionId);
    expect(routeOf(express.id).name).toBe("登录收尾");
    expect(read(lab.local, "express.txt")).toBe("y\n");

    await core.ask(express.id, "第五件");
    expect(got[1]!.prompt).toBe("第五件");

    const second = await core.createExpress(route.id, third.id, "摘要");
    expect(second).toMatchObject({ express: 2, name: "登录重构 · 续" });
    await expect(core.fork(express.id, stopsOf(express.id)[0]!.id)).rejects.toMatchObject({ code: "CANNOT_FORK" }); // 摘要站没有对话记录
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

  it("全部自动批准：不再发出请求，Claude 直接得到允许", async () => {
    expect(project.permissionMode).toBe("ask");
    expect(core.setPermissionMode(project.id, "all").permissionMode).toBe("all");
    expect(events.at(-1)).toMatchObject({ type: "project.updated", project: { permissionMode: "all" } });
    const route = await core.createRoute(project.id);
    const decisions: string[] = [];
    claude.script = async (t) => {
      decisions.push(await t.askPermission("Bash", { command: "rm -rf dist" }), await t.askPermission("Write", { file_path: "x" }));
    };
    await core.ask(route.id, "随便做");
    expect(decisions).toEqual(["allow", "allow"]);
    expect(events.filter((e) => e.type === "permission.request")).toEqual([]);
    expect(events.some((e) => e.type === "route.updated" && e.route.status === "awaiting_permission")).toBe(false);
    boot(); // 设置存在数据库里，重启后还在
    expect(core.listProjects()[0]!.permissionMode).toBe("all");
  });

  it("改文件不问：Edit、Write 直接放行，运行命令仍然问", async () => {
    core.setPermissionMode(project.id, "edits");
    const route = await core.createRoute(project.id);
    const decisions: string[] = [];
    claude.script = async (t) => {
      decisions.push(await t.askPermission("Edit", { file_path: "a.ts" }), await t.askPermission("Bash", { command: "npm test" }));
    };
    core.on((e) => {
      if (e.type === "permission.request") core.answerPermission(e.requestId, "deny");
    });
    await core.ask(route.id, "改一下再跑测试");
    expect(decisions).toEqual(["allow", "deny"]);
    expect(events.filter((e) => e.type === "permission.request")).toMatchObject([{ tool: "Bash" }]);
  });

  it("正在等批准时改成全部自动批准：等着的请求立刻放行", async () => {
    const route = await core.createRoute(project.id);
    let decision = "";
    claude.script = async (t) => {
      decision = await t.askPermission("Bash", { command: "npm test" });
    };
    events.length = 0;
    const asking = core.ask(route.id, "跑测试");
    await until("permission.request");
    expect(routeOf(route.id).status).toBe("awaiting_permission");
    core.setPermissionMode(project.id, "edits"); // 运行命令在这个方式下仍然要问
    expect(routeOf(route.id).status).toBe("awaiting_permission");
    core.setPermissionMode(project.id, "all");
    await asking;
    expect(decision).toBe("allow");
    expect(routeOf(route.id).status).toBe("idle");
    expect(() => core.setPermissionMode("nope", "all")).toThrow();
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

describe("回答内容", () => {
  it("从会话里按站切出每一站的文字；没答完的站也有；还没问过的路是空的", async () => {
    const route = await core.createRoute(project.id);
    expect(await core.history(route.id)).toEqual([]);
    claude.script = (t) => t.say(`回答：${t.prompt}`);
    await core.ask(route.id, "第一站");
    await core.ask(route.id, "第二站");
    claude.script = (t) => {
      t.say("说到一半");
      return "interrupted" as const;
    };
    await core.ask(route.id, "第三站");
    const h = await core.history(route.id);
    expect(h.map((c) => c.items)).toEqual([[{ kind: "text", text: "回答：第一站" }], [{ kind: "text", text: "回答：第二站" }], [{ kind: "text", text: "说到一半" }]]);
    expect(h.map((c) => c.stopId)).toEqual(stopsOf(route.id).map((s) => s.id));
  });

  it("工具事件带一行说明", async () => {
    const route = await core.createRoute(project.id);
    claude.script = (t) => {
      t.tool("Edit", { file_path: path.join(t.cwd, "src", "a.ts"), old_string: "x" });
      t.tool("Read", { file_path: path.join(lab.local, "outside.ts") });
      t.tool("Bash", { command: "npm  test\n-- auth" });
    };
    await core.ask(route.id, "改");
    expect(events.filter((e) => e.type === "stop.tool")).toMatchObject([{ detail: "src/a.ts" }, { detail: path.join(lab.local, "outside.ts") }, { detail: "npm test -- auth" }]);
  });
});

describe("起名字", () => {
  it("站的临时名字取提问的第一句，按显示宽度截断", () => {
    expect(stopName("当前更改都同步了吗？还有别的吗")).toBe("当前更改都同步了");
    expect(stopName("你好，请顺序输出 1 到 10")).toBe("你好，请顺序输出"); // 太短的第一句不单独成名
    expect(stopName("修复登录页的报错。然后跑一遍测试")).toBe("修复登录页的报错");
    expect(stopName("把 b.txt 改成 v1.2，谢谢")).toBe("把 b.txt 改成 v1"); // 文件名里的点不算断句
    expect(stopName("Fix the login bug. Then run tests")).toBe("Fix the login bu");
    expect(stopName("  \n ")).toBe("新的一站");
  });

  it("自己起过名字的路不会被第一站的名字盖掉；解决冲突那一站不给路改名", async () => {
    const named = await core.createRoute(project.id, "登录重构");
    await core.ask(named.id, "第一个问题");
    expect(routeOf(named.id).name).toBe("登录重构");
  });
});

describe("归档和删除", () => {
  it("归档：从列表里收起来，不能再问，工作区和对话都留着；恢复后接着问", async () => {
    const route = await core.createRoute(project.id);
    claude.script = (t) => write(t.cwd, "b.txt", "one\n");
    await core.ask(route.id, "第一站");
    const archived = core.archiveRoute(route.id);
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBeTruthy();
    expect(claude.cooled).toContain(route.worktreePath);
    await expect(core.ask(route.id, "归档了还问")).rejects.toMatchObject({ code: "ROUTE_ARCHIVED" });
    expect(has(route.worktreePath, "b.txt")).toBe(true);

    expect(core.unarchiveRoute(route.id)).toMatchObject({ status: "idle", archivedAt: null });
    claude.script = (t) => expect(t.earlierPrompts).toEqual(["第一站"]);
    expect((await core.ask(route.id, "第二站")).kind).toBe("answered");
  });

  it("归档前没答完或有冲突的，恢复后还是那个状态", async () => {
    const [a, b, c] = [await core.createRoute(project.id), await core.createRoute(project.id), await core.createRoute(project.id)];
    await bothEditSameLine(a.id, b.id);
    core.archiveRoute(b.id);
    expect(core.unarchiveRoute(b.id).status).toBe("conflict");
    claude.script = () => "interrupted" as const;
    await core.ask(c.id, "停");
    core.archiveRoute(c.id);
    expect(core.unarchiveRoute(c.id).status).toBe("interrupted");
  });

  it("删除：工作区、对话、记录一起删；正在回答的不能删", async () => {
    const route = await core.createRoute(project.id);
    await core.ask(route.id, "第一站");
    const session = routeOf(route.id).sessionId!;
    events.length = 0;
    expect(await core.deleteRoute(route.id)).toEqual({ status: "deleted" });
    expect(has(route.worktreePath, ".")).toBe(false);
    expect(core.snapshot(project.id)).toMatchObject({ routes: [], stops: [] });
    expect(claude.sessions.has(session)).toBe(false);
    expect(events).toEqual([{ type: "route.deleted", routeId: route.id, projectId: project.id }]);
    await expect(core.deleteRoute(route.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const busy = await core.createRoute(project.id);
    claude.script = () => new Promise(() => {});
    void core.ask(busy.id, "不结束");
    await until("stop.created");
    await expect(core.deleteRoute(busy.id)).rejects.toMatchObject({ code: "ROUTE_BUSY" });
    expect(() => core.archiveRoute(busy.id)).toThrow("正在回答");
  });

  it("删除保护：工作区里有没进 Local 的改动时不删，列出文件；确认后才连它们一起删", async () => {
    const route = await core.createRoute(project.id);
    claude.script = (t) => {
      write(t.cwd, "b.txt", "half\n");
      write(t.cwd, "new.txt", "new\n");
      return "interrupted" as const;
    };
    await core.ask(route.id, "改到一半");
    const r = await core.deleteRoute(route.id);
    expect(r).toEqual({
      status: "has-unsynced",
      files: [
        { path: "b.txt", note: "modified" },
        { path: "new.txt", note: "added" },
      ],
    });
    expect(routeOf(route.id)).toBeTruthy();
    expect(read(route.worktreePath, "b.txt")).toBe("half\n");
    expect(await core.deleteRoute(route.id, true)).toEqual({ status: "deleted" });
    expect(read(lab.local, "b.txt")).toBe("bee\n"); // Local 没被碰
    expect(has(lab.local, "new.txt")).toBe(false);
  });

  it("启动时清掉没有主的工作区目录（上次删除时目录被占用留下的）", async () => {
    const route = await core.createRoute(project.id);
    const orphan = path.join(path.dirname(route.worktreePath), "rdeadbeef0000");
    write(orphan, "left.txt", "x\n");
    boot();
    await core.createRoute(project.id); // 第一次用到这个项目时清理
    await expect.poll(() => fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(route.worktreePath)).toBe(true); // 有主的不动
  });

  it("删掉父路后，从它分叉出来的路照常可用", async () => {
    const parent = await core.createRoute(project.id);
    await core.ask(parent.id, "一");
    const child = await core.fork(parent.id, stopsOf(parent.id)[0]!.id);
    await core.deleteRoute(parent.id);
    let remembered: string[] = [];
    claude.script = (t) => void (remembered = t.earlierPrompts);
    expect((await core.ask(child.id, "二")).kind).toBe("answered");
    expect(remembered).toEqual(["一"]);
  });
});

describe("提前启动 Claude", () => {
  it("新开一路后、每一站结束后（不管怎么结束）都为下一站准备好；用的是这一路的目录和最新的会话", async () => {
    const route = await core.createRoute(project.id);
    expect(claude.warmed).toEqual([[route.worktreePath, undefined]]);
    await core.ask(route.id, "第一站");
    const session = routeOf(route.id).sessionId!;
    expect(claude.warmed.at(-1)).toEqual([route.worktreePath, session]);
    claude.script = () => "failed";
    await core.ask(route.id, "第二站");
    expect(claude.warmed).toHaveLength(3);
    core.warm(route.id);
    expect(claude.warmed).toHaveLength(4);
    core.dispose();
    expect(claude.disposed).toBe(true);
  });

  it("关掉这个选项后不提前启动", async () => {
    core = createCore({ db, claude, worktreesRoot: path.join(lab.worktrees, "..", "bw-worktrees"), prewarm: false });
    const route = await core.createRoute(project.id);
    await core.ask(route.id, "第一站");
    expect(claude.warmed).toEqual([]);
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
