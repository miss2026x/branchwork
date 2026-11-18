import fs from "node:fs/promises";
import path from "node:path";
import { git } from "./git";

/** Local 里一个没提交的文件。conflict：合并、拉代码时留下的冲突 */
export interface LocalGitFile {
  path: string;
  state: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";
}

/** Local 文件夹在 git 里的样子（Local 专车的“Local 现在”用） */
export interface LocalGit {
  missing: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: LocalGitFile[];
  /** package.json 里的开发、测试命令，已经配好包管理器（pnpm dev） */
  commands: { dev?: string; test?: string };
}

/** 读 Local 的分支、和远端差多少、没提交的文件。只读，不改任何东西（包括索引：不刷新 stat 信息） */
export async function readLocalGit(dir: string): Promise<LocalGit> {
  const exists = await fs.stat(dir).then((s) => s.isDirectory(), () => false);
  if (!exists) return { missing: true, branch: null, upstream: null, ahead: 0, behind: 0, files: [], commands: {} };
  const [status, commands] = await Promise.all([
    // --no-optional-locks：不为了刷新索引去拿锁，免得和你在终端里跑的 git 抢
    git(dir, ["--no-optional-locks", "status", "--porcelain=v1", "--branch", "-z", "--untracked-files=all"]),
    readCommands(dir),
  ]);
  return { missing: false, ...parseStatus(status.stdout), commands };
}

/** 去远端看一眼有没有新提交（git fetch，不改工作区）。没有远端、没网、要密码都算了 */
export async function fetchUpstream(dir: string): Promise<boolean> {
  try {
    const r = await Promise.race([
      git(dir, ["fetch", "--quiet", "--no-tags", "--no-recurse-submodules"], { anyCode: true }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 30_000)),
    ]);
    return r?.code === 0;
  } catch {
    return false;
  }
}

/** git status --porcelain=v1 --branch -z 的输出 */
export function parseStatus(out: string): Omit<LocalGit, "missing" | "commands"> {
  const parts = out.split("\0");
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: LocalGitFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (!p) continue;
    if (p.startsWith("## ")) {
      const head = p.slice(3);
      // “No commits yet on main”“HEAD (no branch)”“main...origin/main [ahead 1, behind 3]”
      const m = /^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(head);
      if (m && !head.startsWith("HEAD (no branch)")) {
        branch = m[1]!;
        upstream = m[2] ?? null;
        const info = m[3] ?? "";
        ahead = Number(/ahead (\d+)/.exec(info)?.[1] ?? 0);
        behind = Number(/behind (\d+)/.exec(info)?.[1] ?? 0);
        if (info === "gone") upstream = null;
      }
      continue;
    }
    const xy = p.slice(0, 2);
    const file = p.slice(3);
    // 改名、复制：后面还跟着一项原来的名字
    if (xy[0] === "R" || xy[0] === "C") i++;
    const state: LocalGitFile["state"] =
      xy === "??" ? "untracked" : xy.includes("U") || xy === "AA" || xy === "DD" ? "conflict" : xy.includes("D") ? "deleted" : xy[0] === "R" ? "renamed" : xy.includes("A") ? "added" : "modified";
    if (xy === "!!") continue;
    files.push({ path: file, state });
  }
  return { branch, upstream, ahead, behind, files };
}

/** package.json 的 scripts 里有 dev / start / serve、test 的话，配上这个项目用的包管理器 */
async function readCommands(dir: string): Promise<LocalGit["commands"]> {
  let pkg: { scripts?: Record<string, unknown>; packageManager?: unknown };
  try {
    pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as typeof pkg;
  } catch {
    return {};
  }
  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const has = (name: string) => typeof scripts[name] === "string" && !/no test specified/.test(scripts[name] as string);
  const pm = await packageManager(dir, pkg.packageManager);
  const run = (name: string) => (pm === "npm" && name !== "test" && name !== "start" ? `npm run ${name}` : `${pm} ${name}`);
  const dev = ["dev", "start", "serve"].find(has);
  return { ...(dev ? { dev: run(dev) } : {}), ...(has("test") ? { test: run("test") } : {}) };
}

async function packageManager(dir: string, declared: unknown): Promise<string> {
  if (typeof declared === "string") {
    const name = declared.split("@")[0]!;
    if (["pnpm", "yarn", "bun", "npm"].includes(name)) return name;
  }
  const lock = async (f: string) => fs.access(path.join(dir, f)).then(() => true, () => false);
  if (await lock("pnpm-lock.yaml")) return "pnpm";
  if (await lock("yarn.lock")) return "yarn";
  if ((await lock("bun.lockb")) || (await lock("bun.lock"))) return "bun";
  return "npm";
}
