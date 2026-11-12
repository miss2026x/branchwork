import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SyncError } from "./types";

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface GitOptions {
  env?: Record<string, string>;
  input?: string;
  /** 允许的非零退出码（例如 merge-tree 有冲突时返回 1） */
  okCodes?: number[];
  /** 不管退出码是多少都不抛错，由调用方自己看结果 */
  anyCode?: boolean;
}

// 快照提交用固定的作者和时间：同一份文件树永远得到同一个提交号
const IDENTITY = {
  GIT_AUTHOR_NAME: "Branchwork",
  GIT_AUTHOR_EMAIL: "branchwork@localhost",
  GIT_COMMITTER_NAME: "Branchwork",
  GIT_COMMITTER_EMAIL: "branchwork@localhost",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
};

// gc.auto=0：我们的命令不触发后台整理，避免它和同步抢文件
const BASE_ARGS = [
  "-c", "core.quotepath=false",
  "-c", "core.longpaths=true",
  "-c", "advice.detachedHead=false",
  "-c", "gc.auto=0",
  "-c", "maintenance.auto=false",
];

/** 启动 git 的次数。测试用它守住“每次同步启动几次 git”的上限 */
export const gitStats: { calls: number; trace?: (args: string[], ms: number) => void } = { calls: 0 };

export interface GitBinary {
  bin: string;
  /** 要加到 PATH 前面的目录（Windows 上直接运行真正的 git.exe 时需要） */
  pathPrefix: string[];
}

let binaryOnce: Promise<GitBinary> | undefined;

/**
 * 找到要运行的 git。一个进程里只找一次。
 *
 * Windows 上 PATH 里的 git（Git\cmd\git.exe）只是个转发器，它再去启动真正的
 * git.exe（Git\mingw64\bin\git.exe），等于每条命令启动两个进程。在启动进程很慢的
 * 机器上这会让每条命令慢一倍，所以这里找出真正的那个直接运行。找不到或运行不了就退回 "git"。
 * 设置环境变量 BRANCHWORK_GIT 可以指定用哪个 git（设成 git 即关闭这个优化）。
 */
export function gitBinary(): Promise<GitBinary> {
  binaryOnce ??= (async (): Promise<GitBinary> => {
    const fallback: GitBinary = { bin: process.env.BRANCHWORK_GIT || "git", pathPrefix: [] };
    if (process.env.BRANCHWORK_GIT || process.platform !== "win32") return fallback;
    try {
      const out = await raw("git", ["--exec-path"], process.env); // …\mingw64\libexec\git-core
      if (out.code !== 0) return fallback;
      const root = path.resolve(out.stdout.trim(), "..", "..");
      const real = path.join(root, "bin", "git.exe");
      if (!fs.existsSync(real)) return fallback;
      const pathPrefix = [path.join(root, "bin"), path.resolve(root, "..", "usr", "bin")].filter((d) => fs.existsSync(d));
      const probe = await raw(real, ["--version"], withPath(process.env, pathPrefix));
      return probe.code === 0 ? { bin: real, pathPrefix } : fallback;
    } catch {
      return fallback;
    }
  })();
  return binaryOnce;
}

function withPath(env: NodeJS.ProcessEnv, prefix: string[]): NodeJS.ProcessEnv {
  if (prefix.length === 0) return env;
  // Windows 的环境变量名不分大小写，实际可能叫 Path
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  return { ...env, [key]: prefix.join(path.delimiter) + path.delimiter + (env[key] ?? "") };
}

function raw(bin: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string, input?: string): Promise<GitResult & { err?: unknown }> {
  return new Promise((resolve) => {
    const child = execFile(bin, args, { cwd, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : -1) : 0;
      resolve({ stdout, stderr, code, err });
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

export async function git(cwd: string, args: string[], opts: GitOptions = {}): Promise<GitResult> {
  const { bin, pathPrefix } = await gitBinary();
  gitStats.calls++;
  const started = performance.now();
  const env: NodeJS.ProcessEnv = { ...process.env, ...IDENTITY, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" };
  // 不继承外面可能设置的 git 环境变量，避免操作到别的仓库或索引
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  Object.assign(env, opts.env);

  // 只给测试用：模拟启动进程很慢的机器（毫秒）
  const slow = Number(process.env.BRANCHWORK_TEST_GIT_DELAY_MS ?? 0);
  if (slow > 0) await new Promise((r) => setTimeout(r, slow));
  const r = await raw(bin, [...BASE_ARGS, ...args], withPath(env, pathPrefix), cwd, opts.input);
  gitStats.trace?.(args, performance.now() - started);
  if (r.code === 0 || opts.anyCode || opts.okCodes?.includes(r.code)) return { stdout: r.stdout, stderr: r.stderr, code: r.code };
  throw new SyncError("GIT_FAILED", `git ${args.join(" ")} 失败（${r.code}）：${r.stderr.trim() || String(r.err)}`);
}

let versionOnce: Promise<[number, number]> | undefined;

/** git 的版本号；一个进程里只问一次 */
export function gitVersion(): Promise<[number, number]> {
  versionOnce ??= git(process.cwd(), ["--version"]).then(({ stdout }) => {
    const m = /(\d+)\.(\d+)/.exec(stdout);
    return m ? [Number(m[1]), Number(m[2])] : [0, 0];
  });
  return versionOnce;
}
