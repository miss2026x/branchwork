import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 在这台电脑上找 Chrome（找不到 Chrome 时也认 Edge、Chromium：都是同一个内核，DevTools 协议一样） */
export function findChrome(env: NodeJS.ProcessEnv = process.env): string | null {
  const list: string[] = [];
  if (env.LANES_CHROME) list.push(env.LANES_CHROME);
  if (process.platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter((x): x is string => !!x);
    for (const r of roots) list.push(path.join(r, "Google", "Chrome", "Application", "chrome.exe"));
    for (const r of roots) list.push(path.join(r, "Microsoft", "Edge", "Application", "msedge.exe"));
    for (const r of roots) list.push(path.join(r, "Chromium", "Application", "chrome.exe"));
  } else if (process.platform === "darwin") {
    for (const base of ["/Applications", path.join(os.homedir(), "Applications")]) {
      list.push(path.join(base, "Google Chrome.app/Contents/MacOS/Google Chrome"));
      list.push(path.join(base, "Chromium.app/Contents/MacOS/Chromium"));
      list.push(path.join(base, "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"));
    }
  } else {
    const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) for (const d of dirs) list.push(path.join(d, name));
    list.push("/opt/google/chrome/chrome");
  }
  return list.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  }) ?? null;
}

export interface ChromeProcess {
  /** 浏览器级的 DevTools 地址 ws://127.0.0.1:端口/devtools/browser/… */
  wsUrl: string;
  child: ChildProcess;
  onExit(fn: () => void): void;
  kill(): void;
}

/**
 * 启动 Lanes 专用的 Chrome：单独一份资料（profileDir），开着远程调试端口（端口让 Chrome 自己挑），
 * 启动时不开窗口——每一路要用时再给它开自己的窗口
 */
export async function launchChrome(exe: string, profileDir: string, extraArgs: string[] = []): Promise<ChromeProcess> {
  fs.mkdirSync(profileDir, { recursive: true });
  const portFile = path.join(profileDir, "DevToolsActivePort");
  fs.rmSync(portFile, { force: true });
  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--no-startup-window",
    // 以 root 运行（容器、一些 Linux）时 Chrome 的沙箱起不来
    ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    ...extraArgs,
  ];
  const child = spawn(exe, args, { stdio: "ignore", detached: false, windowsHide: false });
  let exited = false;
  const exits = new Set<() => void>();
  child.once("exit", () => {
    exited = true;
    for (const f of exits) f();
  });
  const failed = new Promise<never>((_, reject) => {
    child.once("error", (e) => reject(new Error(`启动 Chrome 失败：${e.message}`)));
    child.once("exit", () => reject(new Error("Chrome 一启动就退出了。可能上次的 Lanes 浏览器还开着：关掉它再试")));
  });
  const ready = (async () => {
    for (let i = 0; i < 300; i++) {
      try {
        const [port, wsPath] = fs.readFileSync(portFile, "utf8").split("\n");
        if (port && wsPath) return `ws://127.0.0.1:${port.trim()}${wsPath.trim()}`;
      } catch {
        // 还没写出来
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Chrome 30 秒都没准备好");
  })();
  try {
    const wsUrl = await Promise.race([ready, failed]);
    failed.catch(() => undefined);
    return {
      wsUrl,
      child,
      onExit: (fn) => (exited ? fn() : void exits.add(fn)),
      kill: () => {
        if (!exited) child.kill();
      },
    };
  } catch (e) {
    failed.catch(() => undefined);
    if (!exited) child.kill();
    throw e;
  }
}
