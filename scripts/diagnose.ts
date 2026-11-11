// 诊断：这台机器上同步为什么慢。运行：npm run diagnose   然后把全部输出发回来。
// 只读取 git 的几项设置，并在临时目录和当前项目目录下各建一个小仓库测耗时，结束后删除。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSyncEngine } from "../src/sync";
import { gitBinary, gitStats } from "../src/sync/git";

const run = (cmd: string, args: string[], cwd?: string) => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "(无)";
  }
};
const time = async <T>(fn: () => T | Promise<T>) => {
  const s = performance.now();
  await fn();
  return performance.now() - s;
};

console.log("== 环境 ==");
console.log("系统:", os.platform(), os.release(), "| Node:", process.version);
console.log("git:", run("git", ["--version"]));
console.log("git 位置:", run(process.platform === "win32" ? "where" : "which", ["git"]).split(/\r?\n/).join(" ; "));
for (const k of ["core.fsmonitor", "core.untrackedcache", "core.fscache", "core.autocrlf", "feature.manyFiles", "gc.auto", "core.hookspath", "init.templatedir"]) {
  console.log(`  ${k} =`, run("git", ["config", "--get", k]));
}

console.log("\n== 启动一次进程要多久（各 10 次取平均）==");
const avg = async (cmd: string, args: string[]) => ((await time(() => { for (let i = 0; i < 10; i++) run(cmd, args); })) / 10).toFixed(0) + " ms";
console.log("git --version:", await avg("git", ["--version"]));
console.log("node --version:", await avg(process.execPath, ["--version"]));
const chosen = await gitBinary();
console.log("引擎实际使用的 git:", chosen.bin);
if (chosen.bin !== "git") console.log("直接运行它 --version:", await avg(chosen.bin, ["--version"]));

async function cycle(label: string, root: string) {
  console.log(`\n== ${label}：${root} ==`);
  const local = path.join(root, "local");
  fs.mkdirSync(local, { recursive: true });
  console.log("写 200 个小文件:", (await time(() => { for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(local, `f${i}.txt`), `file ${i}\n`); })).toFixed(0), "ms");
  const g = (...a: string[]) => execFileSync("git", a, { cwd: local, stdio: "ignore" });
  console.log("git init:", (await time(() => g("init", "-q", "-b", "main"))).toFixed(0), "ms");
  console.log("git add -A:", (await time(() => g("add", "-A"))).toFixed(0), "ms");
  console.log("git commit:", (await time(() => g("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "init"))).toFixed(0), "ms");

  const log: string[] = [];
  gitStats.trace = (args, ms) => log.push(`    ${ms.toFixed(0).padStart(6)} ms  git ${args.slice(0, 4).join(" ").slice(0, 60)}`);
  const step = async (name: string, fn: () => Promise<unknown>) => {
    log.length = 0;
    const ms = await time(fn);
    console.log(`  ${name}: ${ms.toFixed(0)} ms，启动 git ${log.length} 次`);
    console.log(log.join("\n"));
  };
  let engine!: Awaited<ReturnType<typeof createSyncEngine>>;
  await step("建引擎", async () => (engine = await createSyncEngine({ localDir: local, worktreesDir: path.join(root, "wt") })));
  await step("新开一路", () => engine.createWorktree("r1"));
  await step("站前（无变化）", () => engine.pullBeforeStop("r1"));
  fs.writeFileSync(path.join(engine.worktreePath("r1"), "f1.txt"), "changed\n");
  await step("站后（改 1 个文件）", () => engine.pushAfterStop("r1"));
  await step("站后（无变化）", () => engine.pushAfterStop("r1"));
  await step("删除这一路", () => engine.removeWorktree("r1"));
  gitStats.trace = undefined;

  const procs = process.platform === "win32" ? run("tasklist", ["/FI", "IMAGENAME eq git.exe", "/NH"]) : run("pgrep", ["-fl", "git"]);
  console.log("此刻还在运行的 git 进程:", procs.includes("git") ? "\n" + procs : "没有");
  console.log("删除测试目录:", (await time(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }))).toFixed(0), "ms");
}

await cycle("系统临时目录", fs.mkdtempSync(path.join(os.tmpdir(), "bw-diag-")));
await cycle("项目目录下", fs.mkdtempSync(path.join(process.cwd(), ".diag-")));
