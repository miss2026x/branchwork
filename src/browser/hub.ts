import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { BrowserIssue, BrowserState, McpTransport, PickedElement, PromptImage } from "../shared";
import { Cdp, type CdpEvent } from "./cdp";
import { findChrome, launchChrome, type ChromeProcess } from "./chrome";
import { startCdpProxy, type CdpProxy } from "./proxy";

/**
 * Lanes 内置的浏览器（设计稿 9-12）：一个专用的 Chrome，每一路一个窗口。
 * - Claude 用的是 chrome-devtools-mcp（每个 Claude 进程一个），它经过 proxy.ts 只看得到自己那一路的窗口
 * - Lanes 自己也连着 Chrome：认窗口归哪一路、数报错和失败的请求、截图、点选元素、把窗口拉到前面
 */

export interface BrowserHubOptions {
  /** 专用 Chrome 的资料文件夹（登录状态、缓存都在这里） */
  profileDir: string;
  /** 用哪个 Chrome；返回空就自动找 */
  chromePath(): string;
  /** 某一路的浏览器有变化（开了、关了、跳了页面、多了报错） */
  onState(state: BrowserState): void;
  log?(s: string): void;
  /** 额外的 Chrome 启动参数（测试里用 --headless=new） */
  chromeArgs?: string[];
}

const MAX_ISSUES = 100;

interface PageInfo {
  targetId: string;
  url: string;
  title: string;
  openerId?: string;
  /** Lanes 自己连在这个页面上的会话（数报错、截图用） */
  sessionId?: string;
  routeId?: string | null;
}

interface RouteBrowser {
  windows: Set<number>;
  issues: BrowserIssue[];
  lastUrl: string | null;
  picking: { cancel(): void } | null;
  /** 最近一次被 Lanes 或 Claude 用到的页面 */
  activePage: string | null;
}

export function createBrowserHub(opts: BrowserHubOptions) {
  const log = opts.log ?? (() => undefined);
  const token = randomBytes(24).toString("hex");
  let proxy: CdpProxy | null = null;
  let chrome: ChromeProcess | null = null;
  let control: Cdp | null = null;
  let starting: Promise<Cdp> | null = null;
  let lastError: string | null = null;

  const routes = new Map<string, RouteBrowser>();
  const pages = new Map<string, PageInfo>();
  /** 窗口 → 哪一路 */
  const windowRoute = new Map<number, string>();
  /** 页面 → 窗口（查过的） */
  const windowOf = new Map<string, number>();
  /** 网络请求：编号 → 方法和地址（失败时要写出来） */
  const requests = new Map<string, { method: string; url: string }>();

  const route = (routeId: string): RouteBrowser => {
    let r = routes.get(routeId);
    if (!r) routes.set(routeId, (r = { windows: new Set(), issues: [], lastUrl: null, picking: null, activePage: null }));
    return r;
  };

  // ── 通知界面：同一路的变化 200 毫秒内合成一次 ──
  const dirty = new Map<string, ReturnType<typeof setTimeout>>();
  const touch = (routeId: string | null | undefined) => {
    if (!routeId || dirty.has(routeId)) return;
    dirty.set(
      routeId,
      setTimeout(() => {
        dirty.delete(routeId);
        opts.onState(state(routeId));
      }, 200),
    );
  };

  // ── 启动 Chrome、连上它 ──
  async function ensure(): Promise<Cdp> {
    if (control && !control.closed) return control;
    starting ??= (async () => {
      const exe = opts.chromePath() || findChrome();
      if (!exe) throw new Error("没找到 Chrome。装好后再试，或在设置里指定 Chrome 的位置");
      chrome = await launchChrome(exe, opts.profileDir, opts.chromeArgs);
      const c = await Cdp.connect(chrome.wsUrl);
      chrome.onExit(() => c.close());
      c.onClose(() => {
        control = null;
        pages.clear();
        windowOf.clear();
        windowRoute.clear();
        for (const [id, r] of routes) {
          r.windows.clear();
          r.activePage = null;
          touch(id);
        }
      });
      c.on((e) => onEvent(c, e));
      await c.send("Target.setDiscoverTargets", { discover: true, filter: [{ type: "page" }] });
      lastError = null;
      return c;
    })();
    try {
      control = await starting;
      return control;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      starting = null;
    }
  }

  /** 页面在哪个窗口（问 Chrome，记下来；标签页被拖到别的窗口时 Chrome 会报 targetInfoChanged，那时重查） */
  async function windowFor(c: Cdp, targetId: string, fresh = false): Promise<number | null> {
    if (!fresh && windowOf.has(targetId)) return windowOf.get(targetId)!;
    try {
      const r = await c.send<{ windowId: number }>("Browser.getWindowForTarget", { targetId });
      windowOf.set(targetId, r.windowId);
      return r.windowId;
    } catch {
      return null;
    }
  }

  async function routeOf(t: { targetId: string; type: string; openerId?: string }): Promise<string | null> {
    const c = await ensure();
    const w = await windowFor(c, t.targetId, true);
    if (w === null) return null;
    const owner = windowRoute.get(w);
    if (owner) return owner;
    // 这一路的页面弹出来的新窗口，也归这一路
    if (t.openerId) {
      const op = pages.get(t.openerId);
      const opener = op ? await routeOf({ targetId: op.targetId, type: "page" }) : null;
      if (opener) {
        claimWindow(opener, w);
        return opener;
      }
    }
    return null;
  }

  function claimWindow(routeId: string, windowId: number) {
    windowRoute.set(windowId, routeId);
    route(routeId).windows.add(windowId);
  }

  /** 这一路现在的全部页面 */
  const routePages = (routeId: string) => [...pages.values()].filter((p) => p.routeId === routeId);

  async function classify(c: Cdp, p: PageInfo) {
    const before = p.routeId;
    p.routeId = await routeOf({ targetId: p.targetId, type: "page", ...(p.openerId ? { openerId: p.openerId } : {}) }).catch(() => null);
    if (p.routeId && p.url && p.url !== "about:blank") route(p.routeId).lastUrl = p.url;
    if (p.routeId && !p.sessionId) await watch(c, p);
    if (before !== p.routeId) touch(before);
    touch(p.routeId);
  }

  /** 连到这一路的页面上：数报错、失败的请求 */
  async function watch(c: Cdp, p: PageInfo) {
    try {
      const { sessionId } = await c.send<{ sessionId: string }>("Target.attachToTarget", { targetId: p.targetId, flatten: true });
      p.sessionId = sessionId;
      await Promise.all([c.send("Runtime.enable", {}, sessionId), c.send("Log.enable", {}, sessionId), c.send("Network.enable", {}, sessionId)]);
    } catch {
      // 页面刚关
    }
  }

  const issue = (routeId: string | null | undefined, i: Omit<BrowserIssue, "id" | "at">) => {
    if (!routeId) return;
    const r = route(routeId);
    r.issues.push({ ...i, id: randomUUID(), at: Date.now() });
    if (r.issues.length > MAX_ISSUES) r.issues.splice(0, r.issues.length - MAX_ISSUES);
    touch(routeId);
  };
  const where = (url: unknown, line: unknown) => {
    if (typeof url !== "string" || !url) return "";
    const base = url.split(/[?#]/)[0]!.split("/").filter(Boolean).at(-1) ?? url;
    return typeof line === "number" ? `${base}:${line + 1}` : base;
  };

  function onEvent(c: Cdp, e: CdpEvent) {
    const p = e.params;
    if (!e.sessionId) {
      if (e.method === "Target.targetCreated" || e.method === "Target.targetInfoChanged") {
        const t = p.targetInfo as { targetId: string; type: string; url: string; title: string; openerId?: string };
        if (t.type !== "page") return;
        const known = pages.get(t.targetId);
        const info: PageInfo = { ...known, targetId: t.targetId, url: t.url, title: t.title, ...(t.openerId ? { openerId: t.openerId } : {}) };
        pages.set(t.targetId, info);
        if (info.routeId && t.url && t.url !== "about:blank") route(info.routeId).lastUrl = t.url;
        // 新页面、或者可能被拖到了别的窗口：重新认它归哪一路
        void classify(c, info);
      } else if (e.method === "Target.targetDestroyed") {
        const info = pages.get(p.targetId as string);
        pages.delete(p.targetId as string);
        windowOf.delete(p.targetId as string);
        if (info?.routeId) {
          const r = route(info.routeId);
          if (r.activePage === info.targetId) r.activePage = null;
          touch(info.routeId);
        }
      }
      return;
    }
    const page = [...pages.values()].find((x) => x.sessionId === e.sessionId);
    if (!page) return;
    const rid = page.routeId;
    switch (e.method) {
      case "Runtime.exceptionThrown": {
        const d = p.exceptionDetails as { text?: string; url?: string; lineNumber?: number; exception?: { description?: string } };
        issue(rid, { kind: "error", text: (d.exception?.description ?? d.text ?? "出错了").split("\n")[0]!.slice(0, 500), source: where(d.url, d.lineNumber) });
        break;
      }
      case "Runtime.consoleAPICalled": {
        const type = p.type as string;
        if (type !== "error" && type !== "warning" && type !== "assert") break;
        const args = (p.args as { value?: unknown; description?: string }[] | undefined) ?? [];
        const text = args.map((a) => (typeof a.value === "string" ? a.value : (a.description ?? JSON.stringify(a.value ?? "")))).join(" ");
        const frame = (p.stackTrace as { callFrames?: { url: string; lineNumber: number }[] } | undefined)?.callFrames?.[0];
        issue(rid, { kind: type === "warning" ? "warning" : "error", text: text.split("\n")[0]!.slice(0, 500), source: frame ? where(frame.url, frame.lineNumber) : "" });
        break;
      }
      case "Network.requestWillBeSent": {
        const req = p.request as { method: string; url: string };
        requests.set(p.requestId as string, { method: req.method, url: req.url });
        if (requests.size > 2000) requests.delete(requests.keys().next().value!);
        break;
      }
      case "Network.responseReceived": {
        const res = p.response as { status: number; url: string };
        if (res.status >= 400) {
          const req = requests.get(p.requestId as string);
          issue(rid, { kind: "request", text: `${req?.method ?? "GET"} ${shortUrl(res.url)} → ${res.status}`, source: `${req?.method ?? "GET"} ${res.status}` });
        }
        break;
      }
      case "Network.loadingFailed": {
        if (p.canceled) break;
        const req = requests.get(p.requestId as string);
        if (req) issue(rid, { kind: "request", text: `${req.method} ${shortUrl(req.url)} → ${String(p.errorText ?? "失败")}`, source: req.method });
        break;
      }
    }
  }

  /** 给这一路开一个页面：已经有窗口就开在它的窗口里（从它的页面里 window.open，新标签页会落在同一个窗口），没有就新开一个窗口 */
  async function createFor(routeId: string, params: Record<string, unknown>): Promise<string> {
    const c = await ensure();
    const url = typeof params.url === "string" && params.url ? params.url : "about:blank";
    if (typeof params.browserContextId === "string") {
      // 要单独的上下文（隔离 cookie）：只能新开窗口
      const { targetId } = await c.send<{ targetId: string }>("Target.createTarget", { url, browserContextId: params.browserContextId, newWindow: true });
      const w = await windowFor(c, targetId, true);
      if (w !== null) claimWindow(routeId, w);
      return targetId;
    }
    const host = pickPage(routeId);
    if (host?.sessionId) {
      const created = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => (off(), reject(new Error("新标签页没有出现"))), 5000);
        const off = c.on((e) => {
          const t = e.params.targetInfo as { targetId: string; type: string; openerId?: string } | undefined;
          if (e.method === "Target.targetCreated" && t?.type === "page" && t.openerId === host.targetId) {
            clearTimeout(timer);
            off();
            resolve(t.targetId);
          }
        });
      });
      // 不等 window.open 返回：新标签页一出现就被各路的 chrome-devtools-mcp 自动连上、停在“等调试器”，
      // 它们的代理要等这里开完才放行，等 evaluate 返回就互相卡住了
      void c.send("Runtime.evaluate", { expression: `void window.open(${JSON.stringify(url)}, "_blank")`, userGesture: true }, host.sessionId).catch(() => undefined);
      try {
        const targetId = await created;
        const w = await windowFor(c, targetId, true);
        if (w !== null && !windowRoute.has(w)) claimWindow(routeId, w);
        return targetId;
      } catch {
        // 打不开（页面不让弹窗之类）：新开一个窗口
      }
    }
    const { targetId } = await c.send<{ targetId: string }>("Target.createTarget", { url, newWindow: true });
    const w = await windowFor(c, targetId, true);
    if (w !== null) claimWindow(routeId, w);
    return targetId;
  }

  /** 这一路现在看着的页面：最近用过的，没有就最后开的 */
  function pickPage(routeId: string): PageInfo | null {
    const list = routePages(routeId);
    const r = route(routeId);
    return list.find((p) => p.targetId === r.activePage) ?? list.at(-1) ?? null;
  }

  /** 问页面自己是不是前台标签页（每个窗口里只有一个是） */
  async function activePage(routeId: string): Promise<PageInfo | null> {
    const c = control;
    const list = routePages(routeId);
    if (!c || list.length === 0) return null;
    for (const p of list) {
      if (!p.sessionId) continue;
      try {
        const r = await c.send<{ result: { value?: unknown } }>("Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true }, p.sessionId, 3000);
        if (r.result.value === "visible") {
          route(routeId).activePage = p.targetId;
          return p;
        }
      } catch {
        // 页面在跳转
      }
    }
    return pickPage(routeId);
  }

  function state(routeId: string): BrowserState {
    const r = route(routeId);
    const list = routePages(routeId);
    const cur = pickPage(routeId);
    return {
      routeId,
      open: list.length > 0,
      url: cur?.url ?? "",
      title: cur?.title ?? "",
      pages: list.map((p) => ({ url: p.url, title: p.title, active: p === cur })),
      issues: r.issues,
      picking: !!r.picking,
      lastUrl: r.lastUrl,
      error: lastError,
    };
  }

  async function screenshot(routeId: string): Promise<PromptImage> {
    const c = await ensure();
    const p = await activePage(routeId);
    if (!p?.sessionId) throw new Error("这一路还没开浏览器");
    const shot = await c.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 85 }, p.sessionId);
    const m = await c.send<{ cssVisualViewport: { clientWidth: number; clientHeight: number } }>("Page.getLayoutMetrics", {}, p.sessionId).catch(() => null);
    return { type: "image/jpeg", data: shot.data, name: `截图 ${p.title || p.url}`.slice(0, 120), width: Math.round(m?.cssVisualViewport.clientWidth ?? 0), height: Math.round(m?.cssVisualViewport.clientHeight ?? 0) };
  }

  /** 点选元素：Chrome 里像 DevTools 的检查一样高亮，点一下拿到那个元素；Esc 或 cancelPick 取消 */
  async function pick(routeId: string): Promise<PickedElement | null> {
    const c = await ensure();
    const r = route(routeId);
    r.picking?.cancel();
    let p = await activePage(routeId);
    if (!p) {
      await open(routeId);
      p = await activePage(routeId);
    }
    if (!p?.sessionId) throw new Error("这一路还没开浏览器");
    const sessionId = p.sessionId;
    await c.send("DOM.enable", {}, sessionId);
    await c.send("Overlay.enable", {}, sessionId);
    const node = await new Promise<number | null>((resolve) => {
      const off = c.on((e) => {
        if (e.sessionId !== sessionId) return;
        if (e.method === "Overlay.inspectNodeRequested") done(e.params.backendNodeId as number);
        // Esc：DevTools 的检查模式被退出时 Chrome 会发 inspectModeCanceled
        else if (e.method === "Overlay.inspectModeCanceled") done(null);
      });
      const done = (v: number | null) => {
        off();
        r.picking = null;
        touch(routeId);
        void c.send("Overlay.setInspectMode", { mode: "none", highlightConfig: {} }, sessionId).catch(() => undefined);
        resolve(v);
      };
      r.picking = { cancel: () => done(null) };
      touch(routeId);
      void c
        .send(
          "Overlay.setInspectMode",
          {
            mode: "searchForNode",
            highlightConfig: { showInfo: true, showStyles: true, contentColor: { r: 37, g: 99, b: 201, a: 0.22 }, borderColor: { r: 37, g: 99, b: 201, a: 0.9 }, paddingColor: { r: 147, g: 196, b: 125, a: 0.35 }, marginColor: { r: 246, g: 178, b: 107, a: 0.35 } },
          },
          sessionId,
        )
        .catch(() => done(null));
      void c.send("Target.activateTarget", { targetId: p.targetId }).catch(() => undefined);
    });
    if (node === null) return null;
    const { object } = await c.send<{ object: { objectId: string } }>("DOM.resolveNode", { backendNodeId: node }, sessionId);
    const r2 = await c.send<{ result: { value: Omit<PickedElement, "image" | "url"> } }>("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: DESCRIBE, returnByValue: true }, sessionId);
    const d = r2.result.value;
    let image: PromptImage | null = null;
    if (d.width > 0 && d.height > 0) {
      const pad = 8;
      const clip = { x: Math.max(0, d.x - pad), y: Math.max(0, d.y - pad), width: Math.min(d.width + pad * 2, 1600), height: Math.min(d.height + pad * 2, 1200), scale: 1 };
      const shot = await c.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true }, sessionId).catch(() => null);
      if (shot) image = { type: "image/png", data: shot.data, name: d.label.slice(0, 80), width: Math.round(clip.width), height: Math.round(clip.height) };
    }
    void c.send("Overlay.hideHighlight", {}, sessionId).catch(() => undefined);
    return { ...d, image, url: p.url };
  }

  async function open(routeId: string, url?: string): Promise<void> {
    const c = await ensure();
    const p = await activePage(routeId);
    if (p?.sessionId && url) await c.send("Page.navigate", { url }, p.sessionId).catch(() => c.send("Runtime.evaluate", { expression: `location.href = ${JSON.stringify(url)}` }, p.sessionId));
    else if (!p) {
      const targetId = await createFor(routeId, { url: url || route(routeId).lastUrl || "about:blank" });
      route(routeId).activePage = targetId;
    }
    await show(routeId);
  }

  async function show(routeId: string): Promise<void> {
    const c = await ensure();
    const p = await activePage(routeId);
    if (!p) return;
    const w = windowOf.get(p.targetId);
    if (w !== undefined) await c.send("Browser.setWindowBounds", { windowId: w, bounds: { windowState: "normal" } }).catch(() => undefined);
    await c.send("Target.activateTarget", { targetId: p.targetId }).catch(() => undefined);
  }

  async function closeRoute(routeId: string): Promise<void> {
    const c = control;
    if (c) for (const p of routePages(routeId)) await c.send("Target.closeTarget", { targetId: p.targetId }).catch(() => undefined);
    routes.delete(routeId);
    for (const [w, r] of windowRoute) if (r === routeId) windowRoute.delete(w);
  }

  /** 这一站结束：报错从这里重新数 */
  function mark(routeId: string) {
    const r = routes.get(routeId);
    if (!r || r.issues.length === 0) return;
    r.issues = [];
    touch(routeId);
  }

  /** 交给 Claude 的 chrome-devtools-mcp：本机命令，连到代理上自己那一路的入口 */
  function mcpServer(routeId: string, cwd: string): McpTransport | null {
    if (!proxy) return null;
    const require = createRequire(import.meta.url);
    let bin: string;
    try {
      bin = path.join(path.dirname(require.resolve("chrome-devtools-mcp/package.json")), "out", "Default", "gen", "src", "bin", "chrome-devtools-mcp.js");
    } catch {
      return null;
    }
    // 打包后的应用里，它被放在 app.asar.unpacked（压缩包里的脚本没法交给别的进程跑）
    bin = bin.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    return {
      type: "stdio",
      // Electron 自己就能当 Node 用（ELECTRON_RUN_AS_NODE），不要求电脑上装 Node
      command: process.execPath,
      args: [
        bin,
        "--wsEndpoint",
        `ws://127.0.0.1:${proxy.port}/route/${encodeURIComponent(routeId)}`,
        "--wsHeaders",
        JSON.stringify({ Authorization: `Bearer ${token}` }),
        "--workspace",
        cwd,
        "--workspace",
        os.tmpdir(),
        "--memoryDebugging",
        "--categoryWebauthn",
        "--categoryNetworkMocks",
        "--experimentalVision",
        "--acceptInsecureCerts",
        "--screenshotFormat",
        "jpeg",
        "--screenshotQuality",
        "80",
        "--screenshotMaxWidth",
        "1600",
        "--screenshotMaxHeight",
        "1600",
      ],
      env: { ELECTRON_RUN_AS_NODE: "1", CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1" },
    };
  }

  return {
    /** 开好代理（Chrome 等第一次要用时才启动） */
    async start() {
      proxy ??= await startCdpProxy({ routeOf, createFor, upstreamUrl: async () => (await ensure(), chrome!.wsUrl) }, token, log);
    },
    mcpServer,
    state,
    open,
    show,
    screenshot,
    pick,
    cancelPick: (routeId: string) => routes.get(routeId)?.picking?.cancel(),
    closeRoute,
    mark,
    /** 这一路有没有开着的窗口 */
    isOpen: (routeId: string) => routePages(routeId).length > 0,
    /** 测试用：在这一路当前的页面上模拟点一下鼠标 */
    async debugClick(routeId: string, x: number, y: number) {
      const c = await ensure();
      const p = await activePage(routeId);
      if (!p?.sessionId) throw new Error("没有页面");
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, p.sessionId);
    },
    found: () => findChrome(),
    async dispose() {
      for (const t of dirty.values()) clearTimeout(t);
      dirty.clear();
      control?.close();
      const c = chrome;
      if (c) {
        // 等它真的退出：资料文件夹还被它写着
        const gone = new Promise<void>((r) => c.onExit(r));
        c.kill();
        await Promise.race([gone, new Promise((r) => setTimeout(r, 3000))]);
      }
      chrome = null;
      await proxy?.close();
      proxy = null;
    },
  };
}

export type BrowserHub = ReturnType<typeof createBrowserHub>;

function shortUrl(u: string): string {
  try {
    const x = new URL(u);
    return (x.pathname + x.search).slice(0, 160) || u;
  } catch {
    return u.slice(0, 160);
  }
}

/** 在页面里描述被点选的元素（Runtime.callFunctionOn，this 就是那个元素） */
const DESCRIBE = `function () {
  const el = this.nodeType === 1 ? this : this.parentElement;
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
  const part = (e) => {
    let s = e.tagName.toLowerCase();
    if (e.id) return s + "#" + esc(e.id);
    const cls = [...e.classList].filter((c) => !/^(css|sc|jsx|_)[-_]?[a-z0-9]{4,}$/i.test(c)).slice(0, 2);
    if (cls.length) s += "." + cls.map(esc).join(".");
    return s;
  };
  const chain = [];
  for (let e = el; e && e.nodeType === 1 && e !== document.body && e !== document.documentElement && chain.length < 4; e = e.parentElement) {
    chain.unshift(part(e));
    if (e.id) break;
  }
  if (chain.length === 0) chain.push(part(el));
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const keys = ["display", "position", "width", "height", "margin", "padding", "color", "background-color", "font-size", "font-weight", "line-height", "border", "border-radius", "gap", "justify-content", "align-items", "text-align"];
  const skip = new Set(["none", "normal", "0px", "auto", "rgba(0, 0, 0, 0)", "static", "start"]);
  const styles = keys.map((k) => [k, cs.getPropertyValue(k)]).filter(([, v]) => v && !skip.has(v)).map(([k, v]) => k + ": " + v + ";").join("\\n");
  const text = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("alt") || "").replace(/\\s+/g, " ").trim().slice(0, 200);
  const tag = el.tagName.toLowerCase();
  const html = el.outerHTML.length > 1500 ? el.outerHTML.slice(0, 1500) + "…" : el.outerHTML;
  return {
    label: tag + (text ? "「" + text.slice(0, 24) + "」" : ""),
    selector: chain.join(" > "),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    x: Math.round(rect.left + scrollX),
    y: Math.round(rect.top + scrollY),
    styles,
    text,
    html,
  };
}`;
