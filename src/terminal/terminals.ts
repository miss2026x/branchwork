import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

/** 一个后台终端现在的样子 */
export interface TerminalInfo {
  id: string;
  /** 调用方给的归属（哪个项目、哪一路、哪一站）；本模块不解释它，只原样带着 */
  owner: TerminalOwner;
  name: string;
  command: string;
  cwd: string;
  status: "running" | "exited";
  exitCode: number | null;
  /** 从输出里认出来的端口号 */
  port: number | null;
  startedAt: number;
  endedAt: number | null;
}

export interface TerminalOwner {
  projectId: string;
  routeId: string;
  stopId: string | null;
}

export type TerminalEvent = { type: "updated"; terminal: TerminalInfo } | { type: "output"; id: string; text: string } | { type: "removed"; terminal: TerminalInfo };

export interface TerminalsOptions {
  onEvent?: (e: TerminalEvent) => void;
  /** 每个终端最多留多少字符的输出（留最后的）。默认 20 万 */
  maxOutput?: number;
  /** 同时最多开几个。默认 12 */
  maxRunning?: number;
}

export interface Terminals {
  /** 在 cwd 里启动一条命令，立即返回 */
  start(opts: { owner: TerminalOwner; cwd: string; command: string; name?: string }): TerminalInfo;
  get(id: string): TerminalInfo | undefined;
  list(filter?: Partial<TerminalOwner>): TerminalInfo[];
  /** 到现在为止的输出；tail 给了就只要最后这么多字符 */
  output(id: string, tail?: number): string;
  /** 等到有新输出或命令退出，最多等 ms 毫秒 */
  settle(id: string, ms: number): Promise<void>;
  /** 停掉（连同它启动的子进程）。已经退出的不做事 */
  stop(id: string): Promise<void>;
  /** 把一个已退出的从列表里拿掉；还在跑的先停再拿掉 */
  remove(id: string): Promise<void>;
  /** 停掉并拿掉某个归属下的全部（比如一路被归档或删除） */
  removeAll(filter: Partial<TerminalOwner>): Promise<void>;
  /** 应用退出：全部停掉 */
  dispose(): Promise<void>;
}

interface Entry {
  info: TerminalInfo;
  child: ChildProcess;
  output: string;
  exited: Promise<void>;
  waiters: Set<() => void>;
}

export class TerminalError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "TOO_MANY" | "EMPTY_COMMAND",
    message: string,
  ) {
    super(message);
    this.name = "TerminalError";
  }
}

/** 开发服务器常见的几种“我在哪个端口”的说法 */
const PORT_PATTERNS = [/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::(\d{2,5}))/i, /\bport\s*[:=]?\s*(\d{2,5})\b/i, /\blistening\s+(?:on|at)\s+\S*?:(\d{2,5})\b/i];
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

export function detectPort(text: string): number | null {
  for (const p of PORT_PATTERNS) {
    const n = Number(p.exec(text)?.[1]);
    if (n > 0 && n < 65536) return n;
  }
  return null;
}

/**
 * 后台终端：启动命令、收着输出、能停。
 * 不用伪终端（不依赖需要编译的原生模块）：命令的输入是关着的，只适合不需要你打字的长时间命令。
 */
export function createTerminals(opts: TerminalsOptions = {}): Terminals {
  const maxOutput = opts.maxOutput ?? 200_000;
  const maxRunning = opts.maxRunning ?? 12;
  const entries = new Map<string, Entry>();
  const emit = (e: TerminalEvent) => opts.onEvent?.(e);
  const matches = (info: TerminalInfo, f: Partial<TerminalOwner> = {}) =>
    (f.projectId === undefined || info.owner.projectId === f.projectId) && (f.routeId === undefined || info.owner.routeId === f.routeId) && (f.stopId === undefined || info.owner.stopId === f.stopId);
  const must = (id: string): Entry => {
    const e = entries.get(id);
    if (!e) throw new TerminalError("NOT_FOUND", `没有这个后台终端：${id}`);
    return e;
  };
  const wake = (e: Entry) => {
    for (const w of [...e.waiters]) w();
    e.waiters.clear();
  };

  /** 连同它启动的子进程一起停掉 */
  const kill = (child: ChildProcess): void => {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      // Windows 上杀掉 shell 不会带走它启动的进程，要按进程树杀
      execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
    } else {
      // 启动时让它自成一个进程组，这里整组一起停
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, 3000).unref();
    }
  };

  const self: Terminals = {
    start({ owner, cwd, command, name }) {
      const cmd = command.trim();
      if (!cmd) throw new TerminalError("EMPTY_COMMAND", "命令是空的");
      if ([...entries.values()].filter((e) => e.info.status === "running").length >= maxRunning) throw new TerminalError("TOO_MANY", `已经开着 ${maxRunning} 个后台终端了，先停掉几个`);
      const child = spawn(cmd, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
      const info: TerminalInfo = { id: "t" + randomUUID().replace(/-/g, "").slice(0, 12), owner, name: name?.trim() || [...cmd.split(/\s+/).slice(0, 3).join(" ")].slice(0, 24).join(""), command: cmd, cwd, status: "running", exitCode: null, port: null, startedAt: Date.now(), endedAt: null };
      let done!: () => void;
      const entry: Entry = { info, child, output: "", exited: new Promise<void>((r) => (done = r)), waiters: new Set() };
      entries.set(info.id, entry);

      const onData = (buf: Buffer) => {
        const text = buf.toString("utf8").replace(ANSI, "").replace(/\r\n/g, "\n");
        if (!text) return;
        entry.output = (entry.output + text).slice(-maxOutput);
        emit({ type: "output", id: info.id, text });
        if (entry.info.port === null) {
          const port = detectPort(entry.output.slice(-4000));
          if (port) {
            entry.info = { ...entry.info, port };
            emit({ type: "updated", terminal: entry.info });
          }
        }
        wake(entry);
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      const finish = (code: number | null, note?: string) => {
        if (entry.info.status === "exited") return;
        if (note) onData(Buffer.from(note));
        entry.info = { ...entry.info, status: "exited", exitCode: code, endedAt: Date.now() };
        emit({ type: "updated", terminal: entry.info });
        wake(entry);
        done();
      };
      child.on("error", (e) => finish(null, `\n没能启动：${e.message}\n`));
      child.on("close", (code) => finish(code));
      emit({ type: "updated", terminal: info });
      return info;
    },

    get: (id) => entries.get(id)?.info,
    list: (filter) => [...entries.values()].map((e) => e.info).filter((i) => matches(i, filter)),

    output(id, tail) {
      const out = must(id).output;
      return tail && out.length > tail ? out.slice(-tail) : out;
    },

    settle(id, ms) {
      const e = must(id);
      if (e.info.status === "exited") return Promise.resolve();
      return new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          e.waiters.delete(finish);
          resolve();
        };
        const timer = setTimeout(finish, ms);
        e.waiters.add(finish);
      });
    },

    async stop(id) {
      const e = must(id);
      if (e.info.status === "exited") return;
      kill(e.child);
      // 最多等 5 秒；实在停不下来也不卡住调用方
      await Promise.race([e.exited, new Promise((r) => setTimeout(r, 5000).unref())]);
    },

    async remove(id) {
      const e = entries.get(id);
      if (!e) return;
      await self.stop(id);
      entries.delete(id);
      emit({ type: "removed", terminal: e.info });
    },

    async removeAll(filter) {
      await Promise.all(self.list(filter).map((i) => self.remove(i.id)));
    },

    async dispose() {
      for (const e of entries.values()) kill(e.child);
      await Promise.race([Promise.all([...entries.values()].map((e) => e.exited)), new Promise((r) => setTimeout(r, 3000).unref())]);
    },
  };
  return self;
}
