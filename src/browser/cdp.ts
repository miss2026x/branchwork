/** 一条到 Chrome 的 DevTools 协议（CDP）连接：发命令、收事件。用运行环境自带的 WebSocket */

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

export class CdpError extends Error {}

export class Cdp {
  private next = 1;
  private readonly pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; method: string }>();
  private readonly listeners = new Set<(e: CdpEvent) => void>();
  private readonly closers = new Set<() => void>();
  closed = false;

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      let m: { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string; result?: unknown; error?: { message?: string } };
      try {
        m = JSON.parse(String(e.data)) as typeof m;
      } catch {
        return;
      }
      if (typeof m.id === "number") {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(new CdpError(`${p.method}: ${m.error.message ?? "出错了"}`));
        else p.resolve(m.result ?? {});
      } else if (m.method) {
        const ev: CdpEvent = { method: m.method, params: m.params ?? {}, ...(m.sessionId ? { sessionId: m.sessionId } : {}) };
        for (const l of this.listeners) l(ev);
      }
    });
    ws.addEventListener("close", () => this.shut());
    ws.addEventListener("error", () => this.shut());
  }

  static connect(url: string, timeoutMs = 10_000): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new CdpError("连不上 Chrome（超时）"));
      }, timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new Cdp(ws));
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new CdpError("连不上 Chrome"));
      });
    });
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new CdpError("和 Chrome 的连接断了"));
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`${method}: Chrome 没有回应`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v as T)),
        reject: (e) => (clearTimeout(timer), reject(e)),
        method,
      });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(fn: (e: CdpEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onClose(fn: () => void): void {
    if (this.closed) fn();
    else this.closers.add(fn);
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // 已经关了
    }
    this.shut();
  }

  private shut(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new CdpError("和 Chrome 的连接断了"));
    this.pending.clear();
    for (const f of this.closers) f();
    this.closers.clear();
  }
}
