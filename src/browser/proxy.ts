import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";

/**
 * 每一路的 chrome-devtools-mcp 连的不是 Chrome 本身，而是这里：一个只让它看到自己那一路窗口的 DevTools 协议代理。
 * 大家共用一个 Chrome（登录状态共用、省内存），各路的 Claude 却只看得到、只动得了自己的窗口。
 *
 * 怎么分：页面、标签页在哪个窗口里，窗口归哪一路（Hub 记着）。
 * - 它新开页面（Target.createTarget）由 Hub 代办：这一路已经有窗口就开在那个窗口里，没有就新开一个窗口
 * - Chrome 发来的“有新目标、目标变了、连上了”这类消息，不是这一路的就不转给它；
 *   被自动连上、在等调试器的别人的标签页，代理替它放行并断开，免得别的路的页面卡住
 * - 关浏览器（Browser.close）不转：Chrome 是大家的
 */

export interface Ownership {
  /** 这个页面或标签页归哪一路；不归任何一路返回 null */
  routeOf(target: { targetId: string; type: string; openerId?: string }): Promise<string | null>;
  /** 给这一路开一个页面，返回页面的 targetId */
  createFor(routeId: string, params: Record<string, unknown>): Promise<string>;
  /** Chrome 的地址（还没启动就启动它） */
  upstreamUrl(): Promise<string>;
}

/** 按路分开看的目标类型；其他的（service worker、浏览器本身）大家都能看到 */
const SPLIT = new Set(["page", "tab", "background_page", "webview", "other"]);
/** 代理自己发给 Chrome 的命令用这一段编号，回来的答复不转给客户端 */
const OWN_ID = 1_000_000_000;

interface Msg {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: Record<string, unknown>;
  error?: unknown;
}

export interface CdpProxy {
  port: number;
  close(): Promise<void>;
}

export async function startCdpProxy(own: Ownership, token: string, log: (s: string) => void = () => undefined): Promise<CdpProxy> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0, perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });
  wss.on("connection", (down: WebSocket, req: IncomingMessage) => {
    const m = /^\/route\/([^/?]+)/.exec(req.url ?? "");
    if (!m || req.headers.authorization !== `Bearer ${token}`) {
      down.close(1008, "unauthorized");
      return;
    }
    void serve(down, decodeURIComponent(m[1]!), own, log);
  });
  const addr = wss.address();
  return {
    port: typeof addr === "object" && addr ? addr.port : 0,
    close: () =>
      new Promise((r) => {
        for (const c of wss.clients) c.terminate();
        wss.close(() => r());
      }),
  };
}

async function serve(down: WebSocket, routeId: string, own: Ownership, log: (s: string) => void): Promise<void> {
  const early: string[] = [];
  const onEarly = (d: RawData) => early.push(d.toString());
  down.on("message", onEarly);
  let up: WebSocket;
  try {
    up = new WebSocket(await own.upstreamUrl(), { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
    await new Promise<void>((resolve, reject) => {
      up.once("open", resolve);
      up.once("error", reject);
    });
  } catch (e) {
    log(`浏览器代理：连不上 Chrome：${e instanceof Error ? e.message : String(e)}`);
    down.close(1011, "chrome unavailable");
    return;
  }
  down.off("message", onEarly);

  /** 转给过客户端的目标 */
  const shown = new Set<string>();
  /** 被自动连上、不是这一路的标签页：它们的会话上的消息都不转 */
  const hiddenSessions = new Set<string>();
  /** 客户端发出、还没答复的命令：编号 → 命令名（Target.getTargets 的答复要筛） */
  const asked = new Map<number, string>();
  let ownId = OWN_ID;
  /** 正在代开页面：这期间新冒出来的页面先别判，等开完、窗口登记好了再判 */
  let creating: Promise<unknown> = Promise.resolve();

  const toDown = (m: Msg) => down.readyState === WebSocket.OPEN && down.send(JSON.stringify(m));
  const toUp = (m: Msg) => up.readyState === WebSocket.OPEN && up.send(JSON.stringify(m));

  const visible = async (info: { targetId: string; type: string; openerId?: string }) => {
    if (!SPLIT.has(info.type)) return true;
    await creating.catch(() => undefined);
    return (await own.routeOf(info).catch(() => null)) === routeId;
  };

  const fromDown = (raw: string) => {
    let m: Msg;
    try {
      m = JSON.parse(raw) as Msg;
    } catch {
      return;
    }
    if (!m.sessionId && m.method === "Target.createTarget" && typeof m.id === "number") {
      const id = m.id;
      const job = own.createFor(routeId, m.params ?? {});
      creating = job.catch(() => undefined);
      job.then(
        (targetId) => toDown({ id, result: { targetId } }),
        (e: unknown) => toDown({ id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } }),
      );
      return;
    }
    if (!m.sessionId && m.method === "Browser.close" && typeof m.id === "number") return toDown({ id: m.id, result: {} });
    if (typeof m.id === "number" && m.method && !m.sessionId) asked.set(m.id, m.method);
    toUp(m);
  };
  for (const raw of early) fromDown(raw);
  down.on("message", (d) => fromDown(d.toString()));

  // Chrome → 客户端：按顺序一条条处理（有的要先查窗口），不打乱先后
  let chain: Promise<void> = Promise.resolve();
  const fromUp = async (m: Msg) => {
    if (typeof m.id === "number" && m.id >= OWN_ID) return; // 代理自己的命令的答复
    if (m.sessionId) {
      if (hiddenSessions.has(m.sessionId)) return;
      return void toDown(m);
    }
    if (typeof m.id === "number") {
      const method = asked.get(m.id);
      asked.delete(m.id);
      if (method === "Target.getTargets" && Array.isArray(m.result?.targetInfos)) {
        const infos = m.result.targetInfos as { targetId: string; type: string; openerId?: string }[];
        const keep = [];
        for (const t of infos) if (await visible(t)) keep.push(t);
        return void toDown({ ...m, result: { ...m.result, targetInfos: keep } });
      }
      return void toDown(m);
    }
    const p = m.params ?? {};
    switch (m.method) {
      case "Target.targetCreated":
      case "Target.targetInfoChanged": {
        const info = p.targetInfo as { targetId: string; type: string; openerId?: string };
        if (shown.has(info.targetId) || (await visible(info))) {
          shown.add(info.targetId);
          return void toDown(m);
        }
        return;
      }
      case "Target.attachedToTarget": {
        const info = p.targetInfo as { targetId: string; type: string; openerId?: string };
        if (shown.has(info.targetId) || (await visible(info))) {
          shown.add(info.targetId);
          return void toDown(m);
        }
        // 别的路的标签页被自动连上了：替它放行（不然那个页面停在“等调试器”），然后断开
        const sessionId = p.sessionId as string;
        hiddenSessions.add(sessionId);
        if (p.waitingForDebugger) toUp({ id: ownId++, method: "Runtime.runIfWaitingForDebugger", sessionId });
        toUp({ id: ownId++, method: "Target.detachFromTarget", params: { sessionId } });
        return;
      }
      case "Target.detachedFromTarget": {
        const sessionId = p.sessionId as string;
        if (hiddenSessions.delete(sessionId)) return;
        return void toDown(m);
      }
      case "Target.targetDestroyed":
      case "Target.targetCrashed": {
        const targetId = p.targetId as string;
        if (!shown.delete(targetId)) return;
        return void toDown(m);
      }
      default:
        return void toDown(m);
    }
  };
  up.on("message", (d) => {
    let m: Msg;
    try {
      m = JSON.parse(d.toString()) as Msg;
    } catch {
      return;
    }
    chain = chain.then(() => fromUp(m)).catch(() => undefined);
  });
  const end = () => {
    if (up.readyState === WebSocket.OPEN || up.readyState === WebSocket.CONNECTING) up.close();
    if (down.readyState === WebSocket.OPEN) down.close();
  };
  up.on("close", end);
  up.on("error", end);
  down.on("close", end);
  down.on("error", end);
}
