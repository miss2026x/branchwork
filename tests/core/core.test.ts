import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCore, stopName, type Core } from "../../src/core";
import { openDb, type Db } from "../../src/db";
import type { BwEvent, Project } from "../../src/shared";
import { FakeClaude } from "../support/fake-claude";
import { dump, has, LINES, sh, makeLab, read, replaceLine, write, type Lab } from "../sync/helpers";

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
    // 用了工具以后“工具在跑”，再出字时清掉（设计稿 4-8）
    expect(types()).toEqual(["route.updated", "stop.created", "stop.started", "stop.delta", "stop.tool", "route.activity", "route.activity", "stop.delta", "route.updated", "stop.updated", "sync.result", "stop.updated", "route.updated"]);
    expect(events.filter((e) => e.type === "route.activity").map((e) => (e.type === "route.activity" ? e.activity?.kind ?? null : ""))).toEqual(["running", null]);
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

describe("提问带图片（设计稿 4-7）", () => {
  const png = (data: string) => ({ type: "image/png" as const, data, name: `${data}.png`, width: 800, height: 600 });
  it("图片跟着提问交给 Claude，也跟着这一站存下来；只发了图的站叫“看图”", async () => {
    const route = await core.createRoute(project.id);
    const r = await core.ask(route.id, "按钮被挡住了，看[图 1]", [png("a")]);
    expect(claude.asks[0]!.images).toEqual([png("a")]);
    expect(claude.asks[0]!.prompt).toBe("按钮被挡住了，看[图 1]");
    expect(r).toMatchObject({ kind: "answered", stop: { images: 1, name: "按钮被挡住了" } });
    const stop = stopsOf(route.id)[0]!;
    expect(core.images(stop.id)).toEqual([png("a")]);

    const only = await core.ask(route.id, "[图 1]", [png("b")]);
    expect(only).toMatchObject({ kind: "answered", stop: { name: "看图", nameState: "final" } });
  });
  it("Claude 读不了的格式不收", async () => {
    const route = await core.createRoute(project.id);
    await expect(core.ask(route.id, "看[图 1]", [{ ...png("a"), type: "image/heic" as never }])).rejects.toThrow(/读不了/);
    expect(claude.asks).toHaveLength(0);
  });
  it("候车区的问题带图：登车时图片跟着发出、归到那一站；拿掉问题时图片一起删", async () => {
    const route = await core.createRoute(project.id);
    const item = core.queueAdd(project.id, "[图 1] 这个怎么改", null, undefined, [png("q")]);
    expect(item.images).toBe(1);
    expect(core.images(item.id)).toEqual([png("q")]);
    core.queueAssign(item.id, route.id, "manual");
    await core.queueBoard(item.id);
    expect(claude.asks[0]!.images).toEqual([png("q")]);
    expect(core.images(stopsOf(route.id)[0]!.id)).toEqual([png("q")]);
    expect(core.images(item.id)).toEqual([]);

    const gone = core.queueAdd(project.id, "只放着[图 1]", null, undefined, [png("z")]);
    core.queueRemove(gone.id);
    expect(core.images(gone.id)).toEqual([]);
  });
  it("改站：截掉的那一站的提问和图片一起放回去", async () => {
    const route = await core.createRoute(project.id);
    await core.ask(route.id, "第一站");
    await core.ask(route.id, "看[图 1]", [png("t")]);
    const second = stopsOf(route.id)[1]!;
    expect(await core.truncate(route.id, second.id)).toEqual({ prompt: "看[图 1]", images: [png("t")] });
    expect(core.images(second.id)).toEqual([]);
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

  it("停车：点下去马上发“正在停车”（等 Claude 停下 → 看一眼工作区），停好了清掉；再点不重复发", async () => {
    const route = await core.createRoute(project.id);
    claude.script = async (t) => {
      t.say("正在改……");
      await new Promise<void>((r) => t.signal.addEventListener("abort", () => r()));
    };
    const asking = core.ask(route.id, "改两个文件");
    await until("stop.delta");
    events.length = 0;
    core.stop(route.id);
    core.stop(route.id);
    expect(events.map((e) => (e.type === "route.activity" ? e.activity : e.type))).toEqual([{ kind: "stopping", step: "等 Claude 停下", since: expect.any(Number) }]);
    await asking;
    const steps = events.filter((e) => e.type === "route.activity").map((e) => (e.type === "route.activity" ? (e.activity?.kind === "stopping" ? e.activity.step : e.activity) : ""));
    expect(steps).toEqual(["等 Claude 停下", "看一眼工作区", null]);
  });

  it("站前同步时点停车：显示“同步完就停”，同步完不启动 Claude", async () => {
    const route = await core.createRoute(project.id);
    const asking = core.ask(route.id, "改一下");
    core.stop(route.id);
    expect(events.filter((e) => e.type === "route.activity").at(-1)).toMatchObject({ activity: { kind: "stopping", step: "同步完就停" } });
    expect(await asking).toMatchObject({ stop: { status: "interrupted" } });
    expect(claude.asks).toHaveLength(0);
  });

  it("在做什么（设计稿 4-8）：在想 → 正在写文件（字数跟着涨）→ 工具在跑 → 看结果在想 → 出字时清掉", async () => {
    const route = await core.createRoute(project.id);
    claude.script = (t) => {
      t.emit({ type: "thinking", text: "" });
      t.emit({ type: "thinking", text: "先看看" });
      t.emit({ type: "tool-input", tool: "Write", chars: 0, lines: 0 });
      t.emit({ type: "tool-input", tool: "Write", chars: 800, lines: 20, target: path.join(t.cwd, "src", "a.ts") });
      t.tool("Write", { file_path: path.join(t.cwd, "src", "a.ts"), content: "x" });
      t.emit({ type: "tool-result", error: false });
      t.say("写好了");
    };
    events.length = 0;
    await core.ask(route.id, "写个文件");
    const acts = events.filter((e) => e.type === "route.activity").map((e) => (e.type === "route.activity" ? e.activity : null));
    expect(acts.map((a) => a?.kind ?? null)).toEqual(["thinking", "writing", "writing", "running", "thinking", null]);
    expect(acts[2]).toMatchObject({ kind: "writing", tool: "Write", target: "src/a.ts", chars: 800, lines: 20 });
    expect(acts[3]).toMatchObject({ kind: "running", tool: "Write", detail: "src/a.ts" });
    expect(acts[1]!.since).toBe(acts[2]!.since); // 同一次写文件，计时不重来
    expect(events.filter((e) => e.type === "stop.thinking").map((e) => (e.type === "stop.thinking" ? e.text : ""))).toEqual(["先看看"]);
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
    db.projects.update(project.id, { permissionMode: "all" }); // 即使这一路是全部不问，提炼时也不放行
    const route = await threeStops();
    const sessions = claude.sessions.size;
    const before = await core.history(route.id);
    let seen: { prompts: string[]; decision: string; cwd: string; prompt: string } | undefined;
    claude.script = async (t) => {
      seen = { prompts: t.earlierPrompts, decision: (await t.askPermission("Write", { file_path: "x" })) as string, cwd: t.cwd, prompt: t.prompt };
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
      decisions.push((await t.askPermission("Bash", { command: "npm test" })) as string);
      decisions.push((await t.askPermission("Write", { file_path: "x" }, false)) as string);
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

  it("全部自动批准：只对这一路；不再发出请求，Claude 直接得到允许；之后新开的路沿用", async () => {
    expect(project.permissionMode).toBe("ask");
    const other = await core.createRoute(project.id);
    const route = await core.createRoute(project.id);
    expect(route.permissionMode).toBe("ask");
    expect(core.setRoutePermissionMode(route.id, "all").permissionMode).toBe("all");
    expect(events.some((e) => e.type === "project.updated" && e.project.permissionMode === "all")).toBe(true);
    expect(routeOf(other.id).permissionMode).toBe("ask"); // 别的路不变
    const decisions: string[] = [];
    claude.script = async (t) => {
      decisions.push((await t.askPermission("Bash", { command: "rm -rf dist" })) as string, (await t.askPermission("Write", { file_path: "x" })) as string);
    };
    await core.ask(route.id, "随便做");
    expect(decisions).toEqual(["allow", "allow"]);
    expect(events.filter((e) => e.type === "permission.request")).toEqual([]);
    expect(events.some((e) => e.type === "route.updated" && e.route.status === "awaiting_permission")).toBe(false);
    expect((await core.createRoute(project.id)).permissionMode).toBe("all"); // 新开的路沿用上次选的
    claude.script = () => {};
    await core.ask(other.id, "一");
    expect((await core.fork(other.id, stopsOf(other.id)[0]!.id)).permissionMode).toBe("ask"); // 分叉沿用来源那一路
    boot(); // 设置存在数据库里，重启后还在
    expect(routeOf(route.id).permissionMode).toBe("all");
    expect(core.listProjects()[0]!.permissionMode).toBe("all");
  });

  it("改文件不问：Edit、Write 直接放行，运行命令仍然问", async () => {
    const route = await core.createRoute(project.id);
    core.setRoutePermissionMode(route.id, "edits");
    const decisions: string[] = [];
    claude.script = async (t) => {
      decisions.push((await t.askPermission("Edit", { file_path: "a.ts" })) as string, (await t.askPermission("Bash", { command: "npm test" })) as string);
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
      decision = (await t.askPermission("Bash", { command: "npm test" })) as string;
    };
    events.length = 0;
    const asking = core.ask(route.id, "跑测试");
    await until("permission.request");
    expect(routeOf(route.id).status).toBe("awaiting_permission");
    core.setRoutePermissionMode(route.id, "edits"); // 运行命令在这个方式下仍然要问
    expect(routeOf(route.id).status).toBe("awaiting_permission");
    core.setRoutePermissionMode(route.id, "all");
    await asking;
    expect(decision).toBe("allow");
    expect(routeOf(route.id).status).toBe("idle");
    expect(() => core.setRoutePermissionMode("nope", "all")).toThrow();
  });

  it("等批准时停车：按拒绝处理，这一站算没答完", async () => {
    const route = await core.createRoute(project.id);
    let decision = "";
    claude.script = async (t) => {
      decision = (await t.askPermission("Bash", { command: "rm -rf build" })) as string;
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

describe("移除项目", () => {
  it("Local 一点不动；路、工作区、对话、候车、记录一起删；有没进 Local 的改动先拦下来", async () => {
    const a = await core.createRoute(project.id);
    claude.script = (t) => write(t.cwd, "b.txt", "from a\n");
    await core.ask(a.id, "改 b");
    const b = await core.createRoute(project.id);
    claude.script = (t) => {
      write(t.cwd, "half.txt", "half\n");
      return "interrupted" as const;
    };
    await core.ask(b.id, "改到一半");
    core.queueAdd(project.id, "以后再问");
    const sessions = [routeOf(a.id).sessionId!, routeOf(b.id).sessionId!];
    const before = dump(lab.local);
    const worktrees = path.dirname(a.worktreePath);

    const first = await core.removeProject(project.id);
    expect(first).toEqual({ status: "has-unsynced", routes: [{ routeId: b.id, label: `2路 ${routeOf(b.id).name}`, files: [{ path: "half.txt", note: "added" }] }], kept: [] });
    expect(core.listProjects()).toHaveLength(1); // 拦下来时什么都没删
    expect(has(b.worktreePath, "half.txt")).toBe(true);

    events.length = 0;
    expect(await core.removeProject(project.id, true)).toEqual({ status: "removed" });
    expect(events).toEqual([{ type: "project.removed", projectId: project.id }]);
    expect(dump(lab.local)).toEqual(before); // Local 的文件一个没动
    expect(core.listProjects()).toEqual([]);
    expect(fs.existsSync(worktrees)).toBe(false);
    for (const s of sessions) expect(claude.sessions.has(s)).toBe(false);
    expect(sh(lab.local, "worktree", "list").trim().split("\n")).toHaveLength(1); // 只剩 Local 自己
    expect(sh(lab.local, "for-each-ref", "refs/branchwork/").trim()).toBe("");

    // 再加回来是一个干净的新项目
    const again = await core.addProject(lab.local);
    expect(again.id).not.toBe(project.id);
    expect(core.snapshot(again.id)).toMatchObject({ routes: [], stops: [], queue: [] });
  });

  it("有路在回答时不能移除；留下的工作区也要先确认", async () => {
    const busy = await core.createRoute(project.id);
    claude.script = () => new Promise(() => {});
    void core.ask(busy.id, "不结束");
    await until("stop.created");
    await expect(core.removeProject(project.id)).rejects.toMatchObject({ code: "ROUTE_BUSY" });

    db.routes.update(busy.id, { status: "idle" }); // 当它停下了
    const r = await core.createRoute(project.id);
    claude.script = (t) => {
      write(t.cwd, "keep.txt", "k\n");
      return "interrupted" as const;
    };
    await core.ask(r.id, "留着");
    await core.deleteRoute(r.id, false, true);
    const res = await core.removeProject(project.id);
    expect(res).toMatchObject({ status: "has-unsynced", kept: [expect.stringContaining("留着")] });
  });

  it("Local 文件夹已经不在了也能移除", async () => {
    const route = await core.createRoute(project.id);
    await core.ask(route.id, "一");
    boot();
    fs.rmSync(lab.local, { recursive: true, force: true });
    expect(await core.removeProject(project.id)).toEqual({ status: "removed" });
    expect(core.listProjects()).toEqual([]);
    expect(fs.existsSync(route.worktreePath)).toBe(false);
  });
});

describe("每一路用哪个模型", () => {
  it("选了模型：下一站起用它，提前启动的也按它准备；分叉出来的路沿用", async () => {
    const route = await core.createRoute(project.id);
    expect(route.model).toBeNull();
    await core.ask(route.id, "第一站");
    expect(claude.asks[0]!.model).toBeUndefined(); // 没选就用 Claude Code 的默认

    const changed = core.setRouteModel(route.id, "opus");
    expect(changed.model).toBe("opus");
    expect(events.some((e) => e.type === "route.updated" && e.route.model === "opus")).toBe(true);
    expect(claude.warmedModels.at(-1)).toBe("opus");
    await core.ask(route.id, "第二站");
    expect(claude.asks[1]!.model).toBe("opus");

    const forked = await core.fork(route.id, stopsOf(route.id)[0]!.id);
    expect(forked.model).toBe("opus");
    expect(core.setRouteModel(route.id, null).model).toBeNull();
  });

  it("思考强度：下一站起用，提前启动的也按它准备；换模型不传强度时强度不变；default 就是不指定", async () => {
    const route = await core.createRoute(project.id);
    expect(route.effort).toBeNull();
    const r1 = core.setRouteModel(route.id, "opus", "high");
    expect(r1).toMatchObject({ model: "opus", effort: "high" });
    expect(claude.warmedRuns.at(-1)).toMatchObject({ model: "opus", effort: "high", permissionMode: "ask" });
    await core.ask(route.id, "一");
    expect(claude.asks[0]).toMatchObject({ model: "opus", effort: "high" });
    expect(core.setRouteModel(route.id, "sonnet")).toMatchObject({ model: "sonnet", effort: "high" });
    expect(core.setRouteModel(route.id, "default", null)).toMatchObject({ model: null, effort: null });
    const forked = await core.fork(route.id, stopsOf(route.id)[0]!.id);
    expect(forked.effort).toBeNull();
  });

  it("能选什么：先给上次读到的，同时再问一次 Claude Code；每次启动每个项目只问一次；读不到下次再试", async () => {
    const updated = () => events.filter((e) => e.type === "claude-options.updated");
    expect(core.claudeOptions(project.id)).toBeNull();
    await until("claude-options.updated");
    expect(updated()).toEqual([{ type: "claude-options.updated", projectId: project.id, options: claude.optionList }]);
    expect(claude.optionCalls).toEqual([project.localDir]);
    expect(core.claudeOptions(project.id)).toEqual(claude.optionList); // 记下来了
    expect(claude.optionCalls).toHaveLength(1);

    // 重新启动：先给记下的，再问一次；这次读不到
    const saved = claude.optionList;
    claude.optionList = new Error("连不上");
    boot();
    expect(core.claudeOptions(project.id)).toEqual(saved);
    await until("claude-options.updated");
    expect(updated()).toEqual([{ type: "claude-options.updated", projectId: project.id, options: null }]);
    events.length = 0;
    core.claudeOptions(project.id); // 上次没读到，再试
    await until("claude-options.updated");
    expect(claude.optionCalls).toHaveLength(3);
  });

  it("批准方式交给 Claude：项目选“自动判断”，这一路的模型不支持（Claude Code 说的）就按每次都问", async () => {
    core.claudeOptions(project.id);
    await until("claude-options.updated");
    const route = await core.createRoute(project.id);
    core.setRoutePermissionMode(route.id, "auto");
    await core.ask(route.id, "一");
    expect(claude.asks.at(-1)).toMatchObject({ permissionMode: "auto" });
    core.setRouteModel(route.id, "claude-haiku-4-5");
    expect(claude.warmedRuns.at(-1)).toMatchObject({ model: "claude-haiku-4-5", permissionMode: "ask" });
    await core.ask(route.id, "二");
    expect(claude.asks.at(-1)).toMatchObject({ permissionMode: "ask" });
    core.setRoutePermissionMode(route.id, "plan");
    await core.ask(route.id, "三");
    expect(claude.asks.at(-1)).toMatchObject({ permissionMode: "plan" });
  });
});

describe("给站起名", () => {
  it("小模型只看提问起名：名字回来后换掉临时名字，跟着这一站起名的路也一起换", async () => {
    const asked: string[] = [];
    let give!: (name: string | null) => void;
    claude.namer = (prompt) => {
      asked.push(prompt);
      return new Promise((r) => (give = r));
    };
    const route = await core.createRoute(project.id);
    await core.ask(route.id, "登录页点了没反应，帮我看看是不是事件没绑上");
    expect(asked).toEqual(["登录页点了没反应，帮我看看是不是事件没绑上"]);
    expect(stopsOf(route.id)[0]).toMatchObject({ name: "登录页点了没反应", nameState: "temp" });

    give("“修复登录按钮”。");
    await until("stop.updated");
    await new Promise((r) => setImmediate(r));
    // 引号、句号这类由 claude 模块收拾；这里只管换名字
    expect(stopsOf(route.id)[0]).toMatchObject({ nameState: "final" });
    expect(routeOf(route.id).name).toBe(stopsOf(route.id)[0]!.name);
    expect(routeOf(route.id).name).not.toBe("登录页点了没反应");
  });

  it("起不出名字就一直用临时名字；你自己起过名的路不动", async () => {
    claude.namer = async () => null;
    const route = await core.createRoute(project.id, "我起的名字");
    await core.ask(route.id, "随便问问");
    expect(stopsOf(route.id)[0]).toMatchObject({ name: "随便问问", nameState: "final" });

    claude.namer = async () => "新名字";
    await core.ask(route.id, "再问一个问题");
    await new Promise((r) => setTimeout(r, 20));
    expect(stopsOf(route.id)[1]).toMatchObject({ name: "新名字", nameState: "final" });
    expect(routeOf(route.id).name).toBe("我起的名字");
  });
});

describe("看改了什么", () => {
  it("没答完的一站改动留在工作区：能列出改了哪些文件、各增删多少行", async () => {
    const route = await core.createRoute(project.id);
    claude.script = (t) => {
      write(t.cwd, "b.txt", "one\ntwo\nthree\n");
      write(t.cwd, "new.txt", "hello\n");
      return "interrupted";
    };
    await core.ask(route.id, "改到一半");
    const files = await core.changes(route.id);
    expect(files.find((f) => f.path === "new.txt")).toEqual({ path: "new.txt", kind: "added", added: 1, removed: 0 });
    expect(files.find((f) => f.path === "b.txt")).toMatchObject({ kind: "modified", added: 3 });
    expect(has(lab.local, "new.txt")).toBe(false);

    // 正常答完、进了 Local 之后就没有了
    claude.script = () => {};
    await core.ask(route.id, "接着做完");
    expect(await core.changes(route.id)).toEqual([]);
  });
});

describe("后台终端", () => {
  const forever = `node -e "console.log('up http://localhost:4567');setInterval(()=>{},1000)"`;

  it("Claude 用应用给的工具开的命令：记在这一路这一站名下，这一站结束后还在跑", async () => {
    expect(claude.tools.map((t) => t.name)).toEqual(["terminal_start", "terminal_output", "terminal_list", "terminal_stop"]);
    const route = await core.createRoute(project.id);
    let reply = "";
    claude.script = async (t) => {
      reply = await t.callTool("terminal_start", { command: forever, name: "开发服务器" });
    };
    await core.ask(route.id, "把开发服务器跑起来");
    const [term] = core.terminals(project.id);
    expect(term).toMatchObject({ projectId: project.id, routeId: route.id, stopId: stopsOf(route.id)[0]!.id, name: "开发服务器", status: "running", port: 4567, cwd: route.worktreePath });
    expect(reply).toContain(term!.id);
    expect(reply).toContain("up http://localhost:4567");
    expect(routeOf(route.id).status).toBe("idle");
    expect(events.some((e) => e.type === "terminal.updated" && e.terminal.port === 4567)).toBe(true);
    expect(core.terminalOutput(term!.id)).toContain("up http://localhost:4567");

    // 下一站的 Claude 还能看到它、读它的输出、停掉它
    const seen: string[] = [];
    claude.script = async (t) => {
      seen.push(await t.callTool("terminal_list"));
      seen.push(await t.callTool("terminal_output", { id: term!.id }));
      seen.push(await t.callTool("terminal_stop", { id: term!.id }));
    };
    await core.ask(route.id, "停掉它");
    expect(seen[0]).toContain("运行中");
    expect(seen[1]).toContain("up http://localhost:4567");
    expect(core.terminals(project.id)[0]).toMatchObject({ status: "exited" });

    // 已退出的：再点一次就从列表里拿掉
    await core.terminalStop(term!.id);
    expect(core.terminals(project.id)).toEqual([]);
    expect(events.some((e) => e.type === "terminal.removed")).toBe(true);
  });

  it("别的路的终端碰不到；这一路删除时它的终端一起停掉", async () => {
    const a = await core.createRoute(project.id);
    const b = await core.createRoute(project.id);
    claude.script = async (t) => void (await t.callTool("terminal_start", { command: forever }));
    await core.ask(a.id, "开一个");
    const [term] = core.terminals(project.id);

    let error = "";
    claude.script = async (t) => {
      error = await t.callTool("terminal_stop", { id: term!.id }).catch((e: Error) => e.message);
    };
    await core.ask(b.id, "停掉别人的");
    expect(error).toContain("这一路没有");
    expect(core.terminals(project.id)[0]).toMatchObject({ status: "running" });

    await core.deleteRoute(a.id, true);
    expect(core.terminals(project.id)).toEqual([]);
  });
});

describe("改名、换颜色、上下文用量", () => {
  it("路可以改名、换颜色；改过名的路不会再被第一站的名字覆盖", async () => {
    const route = await core.createRoute(project.id);
    expect(core.renameRoute(route.id, "  登录  重构 ").name).toBe("登录 重构");
    expect(core.setRouteColor(route.id, 5).color).toBe(5);
    expect(() => core.setRouteColor(route.id, 99)).toThrow();
    expect(() => core.renameRoute(route.id, "   ")).toThrow();
    await core.ask(route.id, "第一个问题");
    expect(routeOf(route.id)).toMatchObject({ name: "登录 重构", color: 5 });
    expect(core.setRouteColor(route.id, null).color).toBeNull();
  });

  it("站可以改名；改过的站不会被小模型晚到的名字覆盖", async () => {
    let give!: (name: string | null) => void;
    claude.namer = () => new Promise((r) => (give = r));
    const route = await core.createRoute(project.id);
    await core.ask(route.id, "看看登录为什么慢");
    const stop = stopsOf(route.id)[0]!;
    expect(core.renameStop(stop.id, "登录性能")).toMatchObject({ name: "登录性能", nameState: "manual" });
    give("查登录慢");
    await new Promise((r) => setTimeout(r, 20));
    expect(stopsOf(route.id)[0]!.name).toBe("登录性能");
  });

  it("每站结束记下会话占了多少上下文", async () => {
    const route = await core.createRoute(project.id);
    expect(route.contextTokens).toBeNull();
    claude.contextTokens = 21400;
    await core.ask(route.id, "问一句");
    expect(routeOf(route.id).contextTokens).toBe(21400);
  });

  it("改文件的工具带上增删的行数", async () => {
    const route = await core.createRoute(project.id);
    claude.script = (t) => {
      t.tool("Edit", { file_path: "a.ts", old_string: "one\ntwo", new_string: "1\n2\n3" });
      t.tool("Write", { file_path: "b.ts", content: "x\ny\n" });
      t.tool("Bash", { command: "ls" });
    };
    await core.ask(route.id, "改两个文件");
    const tools = events.filter((e) => e.type === "stop.tool") as Extract<BwEvent, { type: "stop.tool" }>[];
    expect(tools.map((t) => [t.tool, t.added, t.removed])).toEqual([
      ["Edit", 3, 2],
      ["Write", 2, 0],
      ["Bash", undefined, undefined],
    ]);
  });
});

describe("截线", () => {
  it("删掉这一站和后面的站，会话退回到这一站之前；代码不动；能接着问", async () => {
    const route = await core.createRoute(project.id);
    claude.script = (t) => write(t.cwd, "one.txt", "1\n");
    await core.ask(route.id, "第一站");
    claude.script = (t) => write(t.cwd, "two.txt", "2\n");
    await core.ask(route.id, "第二站");
    claude.script = () => {};
    await core.ask(route.id, "第三站");
    const [, second] = stopsOf(route.id);
    const before = routeOf(route.id).sessionId!;

    const { prompt } = await core.truncate(route.id, second!.id);
    expect(prompt).toBe("第二站");
    expect(stopsOf(route.id).map((s) => s.prompt)).toEqual(["第一站"]);
    expect(events).toContainEqual({ type: "stops.removed", routeId: route.id, stopIds: expect.arrayContaining([second!.id]) });
    // 会话换成了只到第一站为止的那一份，旧的删掉了
    const after = routeOf(route.id).sessionId!;
    expect(after).not.toBe(before);
    expect((await claude.history(after)).filter((m) => m.role === "user")).toHaveLength(1);
    await expect(claude.history(before)).resolves.toEqual([]);
    // 代码不动：第二站带进 Local 的文件还在
    expect(has(lab.local, "two.txt")).toBe(true);

    await core.ask(route.id, "换个问法");
    expect(stopsOf(route.id).map((s) => [s.seq, s.prompt])).toEqual([
      [1, "第一站"],
      [2, "换个问法"],
    ]);
    expect(claude.asks.at(-1)!.sessionId).toBe(after);
  });

  it("截掉第一站：独立的路回到没发车；分叉出来的路留下从父路带来的那一段", async () => {
    const route = await core.createRoute(project.id);
    await core.ask(route.id, "父路第一站");
    await core.ask(route.id, "父路第二站");
    const forked = await core.fork(route.id, stopsOf(route.id)[0]!.id);
    await core.ask(forked.id, "子路第一站");
    await core.truncate(forked.id, stopsOf(forked.id)[0]!.id);
    expect(stopsOf(forked.id)).toEqual([]);
    const kept = await claude.history(routeOf(forked.id).sessionId!);
    expect(kept.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["父路第一站"]);

    await core.truncate(route.id, stopsOf(route.id)[0]!.id);
    expect(routeOf(route.id).sessionId).toBeNull();
    expect(stopsOf(route.id)).toEqual([]);
    // 从被截掉的站分出去的路不受影响
    expect(routeOf(forked.id).status).toBe("idle");
  });

  it("正在回答时不能截线；没答完的一站截掉后，这一路不再是没答完", async () => {
    const route = await core.createRoute(project.id);
    await core.ask(route.id, "第一站");
    claude.script = () => "interrupted";
    await core.ask(route.id, "第二站");
    expect(routeOf(route.id).status).toBe("interrupted");
    await core.truncate(route.id, stopsOf(route.id)[1]!.id);
    expect(routeOf(route.id).status).toBe("idle");

    let release: (() => void) | undefined;
    claude.script = () => new Promise<void>((r) => (release = r));
    const pending = core.ask(route.id, "慢的一站");
    while (!release) await new Promise((r) => setTimeout(r, 10));
    await expect(core.truncate(route.id, stopsOf(route.id)[0]!.id)).rejects.toThrow(/还在回答/);
    release();
    await pending;
  });
});

describe("没答完之后丢掉改动、拒绝时带一句话、导出", () => {
  it("丢掉工作区里没进 Local 的改动：工作区回到和 Local 对齐时的样子，Local 不动", async () => {
    const route = await core.createRoute(project.id);
    claude.script = (t) => {
      write(t.cwd, "half.txt", "写到一半\n");
      write(t.cwd, "b.txt", "改到一半\n");
      return "interrupted";
    };
    await core.ask(route.id, "改到一半");
    expect(await core.changes(route.id)).toHaveLength(2);
    const localBefore = dump(lab.local);

    await core.discardChanges(route.id);
    expect(await core.changes(route.id)).toEqual([]);
    expect(has(route.worktreePath, "half.txt")).toBe(false);
    expect(read(route.worktreePath, "b.txt")).toBe(read(lab.local, "b.txt"));
    expect(dump(lab.local)).toEqual(localBefore);
    expect(stopsOf(route.id)[0]!.syncState).toBe("none");
    // 还能接着问，改动照常进 Local
    claude.script = (t) => write(t.cwd, "done.txt", "ok\n");
    await core.ask(route.id, "重新来");
    expect(has(lab.local, "done.txt")).toBe(true);
    expect(has(lab.local, "half.txt")).toBe(false);
  });

  it("不批准时可以带一句话给 Claude", async () => {
    const route = await core.createRoute(project.id);
    let got: unknown;
    claude.script = async (t) => {
      got = await t.askPermission("Bash", { command: "npm i x" });
    };
    const done = core.ask(route.id, "装个库");
    await until("permission.request");
    const req = events.find((e) => e.type === "permission.request") as Extract<BwEvent, { type: "permission.request" }>;
    core.answerPermission(req.requestId, "deny", " 别装新库，用自带的 ");
    await done;
    expect(got).toEqual({ deny: "别装新库，用自带的" });
  });

  it("导出成 Markdown：每一站的提问和回答", async () => {
    const route = await core.createRoute(project.id, "导出试试");
    claude.script = (t) => {
      t.say("第一段回答");
      t.tool("Bash", { command: "ls" });
    };
    await core.ask(route.id, "列一下文件");
    const md = await core.exportMarkdown(route.id);
    expect(md).toContain("# 1路 导出试试");
    expect(md).toContain("## 第 1 站：列一下文件");
    expect(md).toContain("> 列一下文件");
    expect(md).toContain("第一段回答");
  });
});

describe("删掉对话，留下工作区", () => {
  it("对话没了，文件夹和里面没进 Local 的改动还在；之后可以彻底删掉", async () => {
    const route = await core.createRoute(project.id, "试试看");
    claude.script = (t) => {
      write(t.cwd, "draft.txt", "草稿\n");
      return "interrupted";
    };
    await core.ask(route.id, "写个草稿");
    expect(await core.deleteRoute(route.id, false, true)).toEqual({ status: "deleted" });
    expect(core.snapshot(project.id).routes).toEqual([]);
    const [kept] = core.keptWorktrees(project.id);
    expect(kept).toMatchObject({ projectId: project.id, path: route.worktreePath, label: "1路 试试看" });
    expect(read(route.worktreePath, "draft.txt")).toBe("草稿\n");
    expect(has(lab.local, "draft.txt")).toBe(false);

    await core.removeKept(kept!.id);
    expect(core.keptWorktrees(project.id)).toEqual([]);
    expect(fs.existsSync(route.worktreePath)).toBe(false);
  });
});

describe("导入终端里开过的会话", () => {
  const seed = () => {
    claude.sessions.set("term-1", [
      { id: "u1", role: "user", content: "看一下 session 过期问题" },
      { id: "a1", role: "assistant", content: [{ type: "text", text: "在 config 里" }] },
      { id: "t1", role: "user", content: [{ type: "tool_result", content: "ok" }] },
      { id: "a2", role: "assistant", content: [{ type: "text", text: "看完了" }] },
      { id: "u2", role: "user", content: [{ type: "text", text: "改成 7 天" }] },
      { id: "a3", role: "assistant", content: [{ type: "text", text: "改好了" }] },
    ]);
    claude.terminalSessions = [{ id: "term-1", title: "看一下 session 过期问题", lastModified: 5 }];
  };

  it("列出来：带上问了几次；Lanes 自己的会话不算", async () => {
    seed();
    const route = await core.createRoute(project.id);
    await core.ask(route.id, "自己问的");
    claude.terminalSessions.push({ id: core.snapshot(project.id).routes[0]!.sessionId!, title: "自己问的", lastModified: 9 });
    expect(await core.terminalSessions(lab.local)).toEqual([{ id: "term-1", title: "看一下 session 过期问题", questions: 2, lastModified: 5 }]);
  });

  it("导进来是一路：每个提问一站（工具结果不算提问），会话是复制的，可以接着问、可以分叉", async () => {
    seed();
    const [route] = await core.importSessions(project.id, ["term-1"]);
    expect(route!.name).toBe("看一下 session 过期问题");
    expect(route!.sessionId).not.toBe("term-1");
    expect(fs.existsSync(route!.worktreePath)).toBe(true);
    const stops = core.snapshot(project.id).stops.filter((s) => s.routeId === route!.id);
    expect(stops.map((s) => [s.seq, s.prompt, s.status, s.messageId, s.lastMessageId])).toEqual([
      [1, "看一下 session 过期问题", "done", "u1", "a2"],
      [2, "改成 7 天", "done", "u2", "a3"],
    ]);
    // 原来的会话没动
    expect(claude.sessions.get("term-1")).toHaveLength(6);
    // 接着问：第三站
    await core.ask(route!.id, "再加个测试");
    expect(core.snapshot(project.id).stops.filter((s) => s.routeId === route!.id).map((s) => s.seq)).toEqual([1, 2, 3]);
    // 从导入的第一站分叉
    const child = await core.fork(route!.id, stops[0]!.id);
    expect(claude.sessions.get(child.sessionId!)!.map((m) => m.id)).toEqual(["u1", "a1", "t1", "a2"]);
  });

  it("开新车、开新对话的进度：建工作区时报到哪一步，做完发 null", async () => {
    events.length = 0;
    const route = await core.createRoute(project.id);
    const steps = events.flatMap((e) => (e.type === "route.preparing" ? [e.step] : []));
    expect(steps).toEqual(["记下 Local 现在的样子", "检出文件", "带上 Local 没提交的改动", null]);
    await core.ask(route.id, "第一站");
    events.length = 0;
    await core.fork(route.id, stopsOf(route.id)[0]!.id);
    expect(events.flatMap((e) => (e.type === "route.preparing" ? [e.step] : []))).toEqual(["复制对话", "记下 Local 现在的样子", "检出文件", "带上 Local 没提交的改动", null]);
    // 同一个项目里的建工作区排队：后来的先报“在等”
    events.length = 0;
    await Promise.all([core.createRoute(project.id), core.createRoute(project.id)]);
    expect(events.flatMap((e) => (e.type === "route.preparing" ? [e.step] : []))).toContain("等别的路同步完");
  });

  it("导入的进度（设计稿 4-8）：每个会话一行，报到哪一步；一次最多两个；停止后没开始的不导", async () => {
    seed();
    for (const n of [3, 4, 5]) claude.sessions.set(`term-${n}`, [{ id: `u${n}`, role: "user", content: `问题 ${n}` }, { id: `a${n}`, role: "assistant", content: [{ type: "text", text: "嗯" }] }]);
    events.length = 0;
    const routes = await core.importSessions(project.id, ["term-1", "term-3"]);
    expect(routes.map((r) => r.name)).toEqual(["看一下 session 过期问题", "问题 3"]);
    const reports = events.flatMap((e) => (e.type === "import.progress" ? [e.progress] : []));
    expect(reports[0]!.items.map((i) => i.state)).toEqual(["waiting", "waiting"]);
    const steps = reports.map((r) => r.items[0]!.step).filter(Boolean) as string[];
    expect([...new Set(steps.map((t) => t.split(" · ")[0]))]).toEqual(["复制会话", "读出每一站", "建工作区"]);
    expect(steps).toContain("建工作区 · 检出文件");
    // 两个是一起导的：第一个还没导完，第二个就开始了
    expect(reports.some((r) => r.items.every((i) => i.state === "running"))).toBe(true);
    expect(reports.at(-1)).toMatchObject({ finished: true, items: [{ state: "done", prompts: 2 }, { state: "done", prompts: 1 }] });

    // 停止导入：正在导的导完，没开始的跳过
    events.length = 0;
    const off = core.on((e) => {
      if (e.type === "import.progress" && e.progress.items[1]!.state === "running") core.importCancel(e.progress.jobId);
    });
    const some = await core.importSessions(project.id, ["term-3", "term-4", "term-5"]);
    off();
    const last = events.flatMap((e) => (e.type === "import.progress" ? [e.progress] : [])).at(-1)!;
    expect(last.items.map((i) => i.state)).toEqual(["done", "done", "skipped"]);
    expect(some).toHaveLength(2);
  });

  it("终端里记的特殊消息：斜杠命令还原成 /命令，中断和命令输出不算提问，只在本机执行的命令不算一站，“好的”画成小点", async () => {
    claude.sessions.set("term-2", [
      { id: "c1", role: "user", content: "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>" },
      { id: "c2", role: "user", content: "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>sonnet</command-args>" },
      { id: "c3", role: "user", content: "<local-command-stdout>Set model to sonnet</local-command-stdout>" },
      { id: "u1", role: "user", content: "<command-message>review is running…</command-message>\n<command-name>/review</command-name>\n<command-args>auth</command-args>" },
      { id: "a1", role: "assistant", content: [{ type: "text", text: "看过了" }] },
      { id: "i1", role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] },
      { id: "u2", role: "user", content: "好的" },
      { id: "a2", role: "assistant", content: [{ type: "text", text: "嗯" }] },
    ]);
    const [route] = await core.importSessions(project.id, ["term-2"]);
    const stops = core.snapshot(project.id).stops.filter((s) => s.routeId === route!.id);
    expect(stops.map((s) => [s.seq, s.kind, s.name, s.prompt, s.messageId, s.lastMessageId])).toEqual([
      [1, "normal", "/review", "/review auth", "u1", "i1"],
      [2, "minor", "好的", "好的", "u2", "a2"],
    ]);
    expect(route!.name).toBe("/review auth");
  });

  it("早先导入时用了原始消息当提问的站，重新打开应用时改回用户打的样子", async () => {
    seed();
    const [route] = await core.importSessions(project.id, ["term-1"]);
    const [s1, s2] = core.snapshot(project.id).stops.filter((s) => s.routeId === route!.id);
    db.stops.update(s1!.id, { prompt: "<command-message>review</command-message>\n<command-name>/review</command-name>", name: "<command-m" });
    db.stops.update(s2!.id, { prompt: "[Request interrupted by user]", name: "[Request inte" });
    db.routes.update(route!.id, { name: "<command-message>review" });
    boot();
    const after = core.snapshot(project.id);
    expect(after.stops.filter((s) => s.routeId === route!.id).map((s) => [s.kind, s.name, s.prompt])).toEqual([
      ["normal", "/review", "/review"],
      ["minor", "中断", "[Request interrupted by user]"],
    ]);
    expect(after.routes.find((r) => r.id === route!.id)!.name).toBe("/review");
  });

  it("运行环境：Claude 版本、登录状态、git 版本", async () => {
    const env = await core.environment();
    expect(env.claudeVersion).toBe("9.9.9");
    expect(env.loggedIn).toBe(true);
    expect(env.gitVersion).toMatch(/^\d+\.\d+/);
  });
});

describe("你直接在 Local 里改了文件", () => {
  it("下一次同步时记进同步记录一条“local”，不算成哪一路的同步结果", async () => {
    const route = await core.createRoute(project.id);
    await core.ask(route.id, "先问一站");
    fs.writeFileSync(path.join(lab.local, "notes-by-hand.txt"), "我自己写的\n");
    await core.ask(route.id, "再问一站");
    const log = core.projectLog(project.id);
    const local = log.filter((e) => e.direction === "local");
    expect(local).toHaveLength(1);
    expect(local[0]!.files).toEqual([{ path: "notes-by-hand.txt", note: "added" }]);
    // 这一站开始前也照常从 Local 拿到了它
    expect(log.some((e) => e.direction === "pull" && e.files.some((f) => f.path === "notes-by-hand.txt"))).toBe(true);
    // 各路自己同步进 Local 的不算
    const other = await core.createRoute(project.id);
    claude.script = (t) => write(t.cwd, "by-claude.txt", "x\n");
    await core.ask(other.id, "写个文件");
    await core.ask(route.id, "第三站");
    expect(core.projectLog(project.id).filter((e) => e.direction === "local")).toHaveLength(1);
  });
});

describe("特殊的站：短确认、斜杠命令", () => {
  it("“继续”这类短确认是小点：不起名；斜杠命令直接用命令名；第一站不算短确认", async () => {
    let named = 0;
    claude.namer = async () => (named++, "起好的名字");
    const route = await core.createRoute(project.id);
    const first = await core.ask(route.id, "继续");
    const second = await core.ask(route.id, "好的。");
    const third = await core.ask(route.id, "/review src/auth 仔细点");
    expect(first).toMatchObject({ stop: { kind: "normal" } });
    expect(second).toMatchObject({ stop: { kind: "minor", name: "好的。", nameState: "final" } });
    expect(third).toMatchObject({ stop: { kind: "normal", name: "/review", nameState: "final" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(named).toBe(1); // 只有第一站去起了名
  });
});

describe("Local 专车（设计稿 9-10）", () => {
  it("每个项目一辆：直接在 Local 里回答，不建工作区、不同步；提问后面附上 Local 的现状", async () => {
    const one = await core.createRoute(project.id);
    claude.script = (t) => write(t.cwd, "a.txt", replaceLine(LINES, 2, "by one"));
    await core.ask(one.id, "改 a");

    const local = core.localRoute(project.id);
    expect(local).toMatchObject({ local: true, number: 0, name: "Local 专车", worktreePath: lab.local, status: "idle" });
    expect(core.localRoute(project.id).id).toBe(local.id); // 只有一辆
    expect(db.routes.nextNumber(project.id)).toBe(2); // 不占路号

    claude.script = (t) => {
      expect(t.cwd).toBe(lab.local);
      write(t.cwd, "notes.md", "专车写的\n");
      t.say("写好了");
    };
    const r = await core.ask(local.id, "写个 notes");
    expect(r).toMatchObject({ kind: "answered", sync: null, stop: { status: "done", syncState: "none" } });
    expect(read(lab.local, "notes.md")).toBe("专车写的\n");
    expect(core.syncLog(local.id)).toEqual([]);
    expect(routeOf(local.id).status).toBe("idle");

    // 交给 Claude 的提问：原话 + Local 现状（a.txt 是 1路 第 1 站带进来的）；存下来的提问还是原话
    const sent = claude.asks.at(-1)!.prompt;
    expect(sent.startsWith("写个 notes\n\n<branchwork-local>")).toBe(true);
    expect(sent).toMatch(/- a\.txt（改了；1路「改 a」第 1 站「改 a」）/);
    expect(stopsOf(local.id)[0]!.prompt).toBe("写个 notes");

    // 斜杠命令不附
    await core.ask(local.id, "/compact");
    expect(claude.asks.at(-1)!.prompt).toBe("/compact");
  });

  it("专车回答时，别的路到站后先等着，专车这一站做完再进 Local", async () => {
    const one = await core.createRoute(project.id);
    const local = core.localRoute(project.id);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    claude.script = async (t) => {
      if (t.cwd === lab.local) {
        write(t.cwd, "b.txt", "专车\n");
        await gate;
      } else write(t.cwd, "c.txt", "1路\n");
    };
    const pl = core.ask(local.id, "在 Local 里改 b");
    await new Promise((r) => setTimeout(r, 30));
    const p1 = core.ask(one.id, "改 c");
    // 1路 到站了，但改动还没进 Local：在等专车
    await until("route.activity");
    await new Promise((r) => setTimeout(r, 50));
    expect(events.some((e) => e.type === "route.activity" && e.routeId === one.id && e.activity?.kind === "waiting-local")).toBe(true);
    expect(fs.existsSync(path.join(lab.local, "c.txt"))).toBe(false);
    expect(stopsOf(one.id)[0]).toMatchObject({ status: "done" });

    release();
    await Promise.all([pl, p1]);
    expect(read(lab.local, "c.txt")).toBe("1路\n");
    expect(read(lab.local, "b.txt")).toBe("专车\n");
    expect(core.syncLog(one.id).map((e) => [e.direction, e.status])).toContainEqual(["push", "ok"]);
  });

  it("Local 现状：分支、没提交的文件各是哪一路带进来的；变了推 local.status", async () => {
    const one = await core.createRoute(project.id);
    claude.script = (t) => write(t.cwd, "b.txt", "x\n");
    await core.ask(one.id, "改 b");
    write(lab.local, "mine.txt", "我自己写的\n");
    const s = await core.localStatus(project.id);
    expect(s).toMatchObject({ projectId: project.id, missing: false, branch: expect.any(String) as string, upstream: null });
    const stop = stopsOf(one.id)[0]!;
    expect(s.files).toContainEqual({ path: "b.txt", state: "modified", by: { routeId: one.id, stopId: stop.id } });
    expect(s.files).toContainEqual({ path: "mine.txt", state: "untracked", by: null });
    // 1路 到站进了 Local：过一小会儿推一次新的现状
    await until("local.status");
  });

  it("专车不能改站、归档、删除、丢弃改动；移除项目时绝不删 Local", async () => {
    const local = core.localRoute(project.id);
    claude.script = (t) => t.say("好");
    await core.ask(local.id, "看看");
    const stop = stopsOf(local.id)[0]!;
    await expect(core.truncate(local.id, stop.id)).rejects.toMatchObject({ code: "LOCAL_ROUTE" });
    expect(() => core.archiveRoute(local.id)).toThrow(/不能归档/);
    await expect(core.deleteRoute(local.id)).rejects.toMatchObject({ code: "LOCAL_ROUTE" });
    await expect(core.discardChanges(local.id)).rejects.toMatchObject({ code: "LOCAL_ROUTE" });
    expect(await core.changes(local.id)).toEqual([]);

    // 改批准方式只改专车，不改项目的默认
    core.setRoutePermissionMode(local.id, "all");
    expect(core.listProjects()[0]!.permissionMode).not.toBe("all");

    await core.removeProject(project.id, true);
    expect(fs.existsSync(path.join(lab.local, "a.txt"))).toBe(true);
  });

  it("常用提示：没改过是 null；存了能读回来；null 恢复自带的", () => {
    expect(core.localPresets(project.id)).toBeNull();
    core.setLocalPresets(project.id, [{ id: "x", label: " 构建镜像 ", text: "docker build ." }, { id: "pull", label: "拉主分支", text: "拉", builtin: "pull", hidden: true }, { id: "e", label: "", text: "空的不存" }]);
    expect(core.localPresets(project.id)).toEqual([{ id: "x", label: "构建镜像", text: "docker build ." }, { id: "pull", label: "拉主分支", text: "拉", hidden: true, builtin: "pull" }]);
    core.setLocalPresets(project.id, null);
    expect(core.localPresets(project.id)).toBeNull();
  });
});

describe("Local 专车重新开始（设计稿 9-11）", () => {
  it("清掉专车的对话和会话，Local 里的文件不动；回答中不能清", async () => {
    const local = core.localRoute(project.id);
    claude.script = (t) => write(t.cwd, "kept.txt", "专车写的\n");
    await core.ask(local.id, "写个文件");
    const session = routeOf(local.id).sessionId;
    expect(session).toBeTruthy();
    const after = await core.resetLocal(local.id);
    expect(after).toMatchObject({ sessionId: null, status: "idle", contextTokens: null });
    expect(stopsOf(local.id)).toEqual([]);
    expect(read(lab.local, "kept.txt")).toBe("专车写的\n");
    expect(events.some((e) => e.type === "stops.removed" && e.routeId === local.id)).toBe(true);
    // 普通路不能这样清
    const one = await core.createRoute(project.id);
    await expect(core.resetLocal(one.id)).rejects.toMatchObject({ code: "LOCAL_ROUTE" });
    // 清完接着问：从第 1 站开始，新的会话
    await core.ask(local.id, "再来");
    expect(stopsOf(local.id)[0]).toMatchObject({ seq: 1 });
    expect(claude.asks.at(-1)!.sessionId).toBeUndefined();
  });
});
