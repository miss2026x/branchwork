import fs from "node:fs";
import path from "node:path";
import extract from "extract-zip";

/**
 * 电脑上没有 Chrome 时，下载一个 Chrome for Testing 给 Lanes 自己用（设计稿 9-15）。
 * Google 给自动化测试出的 Chrome，每个版本一个 zip，解开就能跑，不用安装。
 * 放在 Lanes 数据文件夹里的 chrome/版本号/，新版本下好后删掉旧的
 */

export const CFT_INDEX = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";

export type CftPlatform = "linux64" | "mac-arm64" | "mac-x64" | "win64" | "win32";

/** 这台电脑对应 Chrome for Testing 的哪一份；没有的（比如 Linux ARM）返回空 */
export function cftPlatform(platform: NodeJS.Platform = process.platform, arch: string = process.arch): CftPlatform | null {
  if (platform === "win32") return arch === "x64" || arch === "arm64" ? "win64" : "win32";
  if (platform === "darwin") return arch === "arm64" ? "mac-arm64" : "mac-x64";
  if (platform === "linux") return arch === "x64" ? "linux64" : null;
  return null;
}

/** zip 解开后程序在哪 */
export function cftExecutable(p: CftPlatform): string {
  if (p === "win64" || p === "win32") return path.join(`chrome-${p}`, "chrome.exe");
  if (p === "linux64") return path.join("chrome-linux64", "chrome");
  return path.join(`chrome-${p}`, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
}

const byVersion = (a: string, b: string) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** 已经下好的（最新的那个）：{ 版本, 程序位置 } */
export function downloadedChrome(root: string, p: CftPlatform | null = cftPlatform()): { version: string; path: string } | null {
  if (!p) return null;
  let names: string[];
  try {
    names = fs.readdirSync(root).filter((n) => /^\d+(\.\d+)+$/.test(n));
  } catch {
    return null;
  }
  for (const version of names.sort(byVersion).reverse()) {
    const exe = path.join(root, version, cftExecutable(p));
    if (fs.existsSync(exe)) return { version, path: exe };
  }
  return null;
}

export interface CftRelease {
  version: string;
  url: string;
  platform: CftPlatform;
}

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** 问 Google 现在的稳定版是哪个、这台电脑该下哪个 zip */
export async function latestCft(fetchFn: Fetch, p: CftPlatform | null = cftPlatform(), signal?: AbortSignal): Promise<CftRelease> {
  if (!p) throw new Error(`Chrome for Testing 没有给这台电脑（${process.platform} ${process.arch}）的版本。请自己装 Chrome 或 Chromium，再在设置里写它的位置`);
  const res = await fetchFn(CFT_INDEX, { signal });
  if (!res.ok) throw new Error(`查不到 Chrome for Testing 的版本（${res.status}）`);
  const json = (await res.json()) as { channels?: { Stable?: { version?: string; downloads?: { chrome?: { platform: string; url: string }[] } } } };
  const stable = json.channels?.Stable;
  const hit = stable?.downloads?.chrome?.find((d) => d.platform === p);
  if (!stable?.version || !hit) throw new Error("Chrome for Testing 的版本列表里没有这台电脑能用的");
  return { version: stable.version, url: hit.url, platform: p };
}

export interface DownloadProgress {
  received: number;
  /** 不知道大小时是 0 */
  total: number;
}

/**
 * 下载并解开。先下到 .zip.part、解到 版本号.part，都好了才改名成 版本号，中途失败或取消不会留下半个 Chrome。
 * 成功后删掉别的版本
 */
export async function installCft(opts: { root: string; release: CftRelease; fetch: Fetch; signal?: AbortSignal; onProgress?(p: DownloadProgress): void }): Promise<{ version: string; path: string }> {
  const { root, release } = opts;
  fs.mkdirSync(root, { recursive: true });
  const zip = path.join(root, `${release.version}.zip.part`);
  const tmp = path.join(root, `${release.version}.part`);
  const dest = path.join(root, release.version);
  const cleanup = () => {
    fs.rmSync(zip, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  try {
    const res = await opts.fetch(release.url, { signal: opts.signal });
    if (!res.ok || !res.body) throw new Error(`下载失败（${res.status}）`);
    const total = Number(res.headers.get("content-length") ?? 0) || 0;
    let received = 0;
    let last = 0;
    const out = fs.createWriteStream(zip);
    const done = new Promise<void>((resolve, reject) => {
      out.on("finish", () => resolve());
      out.on("error", reject);
    });
    const reader = res.body.getReader();
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      received += value.byteLength;
      if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
      // 进度最多每 200 毫秒报一次
      const now = Date.now();
      if (now - last > 200) {
        last = now;
        opts.onProgress?.({ received, total });
      }
    }
    out.end();
    await done;
    opts.onProgress?.({ received, total: total || received });
    if (total && received !== total) throw new Error("下载不完整，请再试一次");
    fs.rmSync(tmp, { recursive: true, force: true });
    await extract(zip, { dir: path.resolve(tmp) });
    const exe = path.join(tmp, cftExecutable(release.platform));
    if (!fs.existsSync(exe)) throw new Error("解开后没找到 Chrome 程序");
    if (process.platform !== "win32") fs.chmodSync(exe, 0o755);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    fs.rmSync(zip, { force: true });
  } catch (e) {
    cleanup();
    if (opts.signal?.aborted) throw new Error("取消了下载");
    throw e;
  }
  // 旧版本、以前没下完的都删掉（旧的正开着时 Windows 上删不掉，下次再删）
  for (const n of fs.readdirSync(root))
    if (n !== release.version)
      try {
        fs.rmSync(path.join(root, n), { recursive: true, force: true });
      } catch {
        // 下次
      }
  return { version: release.version, path: path.join(dest, cftExecutable(release.platform)) };
}
