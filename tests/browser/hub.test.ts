import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBrowserHub, findChrome, type BrowserHub } from "../../src/browser";
import type { BrowserState, McpTransport } from "../../src/shared";

/**
 * 真的启动 Chrome、真的跑 chrome-devtools-mcp：两路各自的 Claude 只看得到自己的窗口（设计稿 9-12）。
 * 这台机器上找不到 Chrome 就跳过（CI 里用 Playwright 带的 Chromium：LANES_CHROME 指过去）
 */
function playwrightChromium(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require("playwright").chromium.executablePath() as string;
    return fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}
const exe = process.env.LANES_CHROME || findChrome() || playwrightChromium();

/** 最简单的 MCP 客户端：stdio 上的 JSON-RPC */
class Mcp {
  private buf = "";
  private next = 1;
  private readonly waiting = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>();
  constructor(private readonly child: ChildProcess) {
    child.stdout!.on("data", (d: Buffer) => {
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        const m = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } };
        if (typeof m.id === "number") this.waiting.get(m.id)?.(m), this.waiting.delete(m.id);
      }
    });
  }
  static async start(t: McpTransport): Promise<Mcp> {
    if (t.type !== "stdio") throw new Error("not stdio");
    const env = { ...process.env, ...t.env };
    delete env.ELECTRON_RUN_AS_NODE; // 测试里 command 就是 node
    const m = new Mcp(spawn(t.command, t.args ?? [], { env, stdio: ["pipe", "pipe", "inherit"] }));
    await m.req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    m.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return m;
  }
  req(method: string, params: unknown): Promise<unknown> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
      this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  async call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; images: number }> {
    const r = (await this.req("tools/call", { name, arguments: args })) as { content: { type: string; text?: string }[] };
    return { text: r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"), images: r.content.filter((c) => c.type === "image").length };
  }
  close() {
    this.child.kill();
  }
}

describe.skipIf(!exe)("内置浏览器：每一路只看得到自己的窗口", () => {
  let hub: BrowserHub;
  const states: BrowserState[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-hub-"));
  const clients: Mcp[] = [];
  beforeAll(async () => {
    hub = createBrowserHub({ profileDir: path.join(dir, "profile"), chromePath: () => exe!, onState: (s) => states.push(s), chromeArgs: ["--headless=new"] });
    await hub.start();
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await hub.dispose();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("两路各开各的页面，list_pages 只列自己的；截图、Lanes 自己看到的现状都对", async () => {
    const one = await Mcp.start(hub.mcpServer("r1", dir)!);
    const two = await Mcp.start(hub.mcpServer("r2", dir)!);
    clients.push(one, two);
    await one.call("new_page", { url: "data:text/html,<title>A</title><h1>A</h1>" });
    await two.call("new_page", { url: "data:text/html,<title>B</title><h1>B</h1>" });
    const p1 = (await one.call("list_pages")).text;
    const p2 = (await two.call("list_pages")).text;
    expect(p1).toContain("<h1>A</h1>");
    expect(p1).not.toContain("<h1>B</h1>");
    expect(p2).toContain("<h1>B</h1>");
    expect(p2).not.toContain("<h1>A</h1>");
    // 第二个页面开在同一路的窗口里，另一路仍然看不到
    await one.call("new_page", { url: "data:text/html,<title>A2</title>" });
    expect((await one.call("list_pages")).text).toContain("A2");
    expect((await two.call("list_pages")).text).not.toContain("A2");

    const shot = await one.call("take_screenshot", { pageId: 1 });
    expect(shot.images).toBe(1);

    await new Promise((r) => setTimeout(r, 400));
    // chrome-devtools-mcp 连上时这一路还没有页面，它会先开一个空白页
    expect(hub.state("r1").pages.map((p) => p.url).filter((u) => u !== "about:blank")).toEqual(["data:text/html,<title>A</title><h1>A</h1>", "data:text/html,<title>A2</title>"]);
    expect(hub.state("r2").pages.map((p) => p.url).filter((u) => u !== "about:blank")).toEqual(["data:text/html,<title>B</title><h1>B</h1>"]);
    const img = await hub.screenshot("r2");
    expect(img.data.length).toBeGreaterThan(100);
  }, 60_000);

  it("页面里的报错、失败的请求记在那一路上；一站结束后重新数", async () => {
    await hub.open("r3", "data:text/html,<script>setTimeout(()=>{throw new Error('boom')},50);setTimeout(()=>fetch('http://127.0.0.1:9/nope').catch(()=>{}),300)</script>");
    await new Promise((r) => setTimeout(r, 1500));
    const st = hub.state("r3");
    expect(st.open).toBe(true);
    expect(st.issues.some((i) => i.kind === "error" && i.text.includes("boom"))).toBe(true);
    expect(st.issues.some((i) => i.kind === "request")).toBe(true);
    hub.mark("r3");
    expect(hub.state("r3").issues).toEqual([]);
  }, 60_000);

  it("点选元素：像 DevTools 的检查一样点一下，拿到它的位置、大小、样式和局部截图", async () => {
    await hub.open("r4", "data:text/html;charset=utf-8,<body style='margin:0'><form class='login'><button class='primary' data-insp-path='/app/src/Login.vue:12:5:button' style='margin-left:40px;width:200px;height:44px'>登录</button></form></body>");
    await new Promise((r) => setTimeout(r, 500));
    const picking = hub.pick("r4");
    await new Promise((r) => setTimeout(r, 500));
    expect(hub.state("r4").picking).toBe(true);
    // 模拟在按钮上点一下（Chrome 的检查模式吃的是真实的鼠标事件，这里从另一条连接发）
    await hub.debugClick("r4", 100, 20);
    const el = await picking;
    expect(el).not.toBeNull();
    expect(el!.label).toBe("button「登录」");
    expect(el!.selector).toBe("form.login > button.primary");
    expect(el!.width).toBe(200);
    expect(el!.styles).toContain("margin: 0px 0px 0px 40px");
    expect(el!.image?.data.length).toBeGreaterThan(100);
    // 设计稿 9-15：认出插件加的源码位置；页面里打上标记，HTML 里不带这个标记
    expect(el!.source).toMatchObject({ file: "/app/src/Login.vue", line: 12, column: 5, via: "attr" });
    expect(el!.mark).toBe("1");
    expect(el!.html).not.toContain("data-lanes-pick");
  }, 60_000);
});
