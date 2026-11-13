import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createTerminals, detectPort, type TerminalEvent, type Terminals } from "../../src/terminal";

const owner = { projectId: "p1", routeId: "r1", stopId: "s1" };
const node = (code: string) => `node -e "${code}"`;
let terms: Terminals;
let events: TerminalEvent[];
const boot = (opts = {}) => {
  events = [];
  terms = createTerminals({ onEvent: (e) => events.push(e), ...opts });
};
const until = async (ok: () => boolean, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("等太久了");
    await new Promise((r) => setTimeout(r, 30));
  }
};
afterEach(() => terms?.dispose());

describe("后台终端", () => {
  it("启动一条一直跑着的命令：收着输出、认出端口，能停掉", async () => {
    boot();
    const t = terms.start({ owner, cwd: os.tmpdir(), name: "开发服务器", command: node("console.log('ready on http://localhost:4321/');setInterval(()=>console.log('tick'),200)") });
    expect(t).toMatchObject({ owner, name: "开发服务器", status: "running", port: null, exitCode: null });
    await until(() => terms.get(t.id)?.port === 4321);
    await until(() => terms.output(t.id).includes("tick"));
    expect(terms.output(t.id)).toContain("ready on http://localhost:4321/");
    expect(events.some((e) => e.type === "output" && e.id === t.id)).toBe(true);

    await terms.stop(t.id);
    expect(terms.get(t.id)).toMatchObject({ status: "exited" });
    expect(terms.get(t.id)!.endedAt).not.toBeNull();
    // 停掉后不再有新输出
    const size = terms.output(t.id).length;
    await new Promise((r) => setTimeout(r, 500));
    expect(terms.output(t.id).length).toBe(size);
    // 已退出的还留在列表里，拿掉才没有
    expect(terms.list({ routeId: "r1" })).toHaveLength(1);
    await terms.remove(t.id);
    expect(terms.list()).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "removed" });
  });

  it("命令自己结束：记下退出码；错误输出也收着", async () => {
    boot();
    const t = terms.start({ owner, cwd: os.tmpdir(), command: node("console.error('boom');process.exit(3)") });
    await until(() => terms.get(t.id)?.status === "exited");
    expect(terms.get(t.id)).toMatchObject({ exitCode: 3 });
    expect(terms.output(t.id)).toContain("boom");
    expect(t.name.startsWith("node -e")).toBe(true); // 没给名字就用命令的开头
    expect(t.name.length).toBeLessThanOrEqual(24);
  });

  it("settle：等到有新输出或命令退出就回来，不用傻等", async () => {
    boot();
    const t = terms.start({ owner, cwd: os.tmpdir(), command: node("setTimeout(()=>console.log('late'),300);setInterval(()=>{},1000)") });
    const at = Date.now();
    await terms.settle(t.id, 15_000);
    expect(Date.now() - at).toBeLessThan(10_000);
    expect(terms.output(t.id)).toContain("late");
  });

  it("按归属筛选；一路没了就把它的终端全部停掉拿走", async () => {
    boot();
    const sleep = node("setInterval(()=>{},1000)");
    const a = terms.start({ owner, cwd: os.tmpdir(), command: sleep });
    const b = terms.start({ owner: { ...owner, routeId: "r2" }, cwd: os.tmpdir(), command: sleep });
    expect(terms.list({ routeId: "r1" }).map((t) => t.id)).toEqual([a.id]);
    expect(terms.list({ projectId: "p1" })).toHaveLength(2);
    await terms.removeAll({ routeId: "r1" });
    expect(terms.list().map((t) => t.id)).toEqual([b.id]);
    expect(terms.get(b.id)?.status).toBe("running");
  });

  it("输出太长只留最后一段；开得太多会拒绝；空命令会拒绝", async () => {
    boot({ maxOutput: 100, maxRunning: 1 });
    const t = terms.start({ owner, cwd: os.tmpdir(), command: node("console.log('x'.repeat(500)+'END');setInterval(()=>{},1000)") });
    await until(() => terms.output(t.id).includes("END"));
    expect(terms.output(t.id).length).toBeLessThanOrEqual(100);
    expect(() => terms.start({ owner, cwd: os.tmpdir(), command: "node -v" })).toThrow(/先停掉几个/);
    expect(() => terms.start({ owner, cwd: os.tmpdir(), command: "  " })).toThrow(/空的/);
  });

  it("从输出里认端口", () => {
    expect(detectPort("  ➜  Local:   http://localhost:5173/")).toBe(5173);
    expect(detectPort("Server listening on 0.0.0.0:8080")).toBe(8080);
    expect(detectPort("started server on port 3000")).toBe(3000);
    expect(detectPort("compiled 12 modules in 300 ms")).toBeNull();
  });
});
