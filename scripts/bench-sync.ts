// 大仓库耗时测试：npx vitest run 不会跑这个；用 `npx tsx scripts/bench-sync.ts 20000` 手动跑
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSyncEngine } from "../src/sync";

const N = Number(process.argv[2] ?? 20000);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bw-bench-"));
const local = path.join(root, "local");
fs.mkdirSync(local);
const g = (...a: string[]) => execFileSync("git", a, { cwd: local, stdio: "ignore" });
for (let i = 0; i < N; i++) {
  const d = path.join(local, `d${i % 200}`, `s${i % 7}`);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `f${i}.ts`), `export const v${i} = ${i};\n`.repeat(20));
}
g("init", "-q", "-b", "main");
g("config", "gc.auto", "0");
g("-c", "user.email=a@b", "-c", "user.name=a", "add", "-A");
g("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "init");

const t = async <T>(label: string, fn: () => Promise<T>) => {
  const s = performance.now();
  const r = await fn();
  console.log(`${label.padEnd(34)} ${(performance.now() - s).toFixed(0).padStart(6)} ms`);
  return r;
};
{
  const s = performance.now();
  for (let i = 0; i < 10; i++) execFileSync("git", ["--version"], { stdio: "ignore" });
  console.log(`这台机器启动一次 git 平均 ${((performance.now() - s) / 10).toFixed(0)} ms`);
}
const engine = await createSyncEngine({ localDir: local, worktreesDir: path.join(root, "wt") });
console.log(`${N} 个文件`);
await t("新开一路", () => engine.createWorktree("r1"));
await t("站前（无变化）", () => engine.pullBeforeStop("r1"));
fs.writeFileSync(path.join(engine.worktreePath("r1"), "d1", "s1", "f1.ts"), "changed\n");
fs.writeFileSync(path.join(local, "d2", "s2", "f2.ts"), "changed by user\n");
await t("站后（改 1 个文件，Local 也改 1 个）", () => engine.pushAfterStop("r1"));
await t("站前（无变化，第二次）", () => engine.pullBeforeStop("r1"));
await t("站后（无变化）", () => engine.pushAfterStop("r1"));
fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
