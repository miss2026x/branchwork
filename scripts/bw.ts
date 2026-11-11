// 命令行小工具：不带界面地在一路上问一站。用来验证第 2 步。
//
//   pnpm bw new    <项目目录>                    新开一路
//   pnpm bw ask    <项目目录> "<问题>" [--route N]  在第 N 路上问一站（默认 1 路；没有就新开）
//                  [--allow]          不问，自动批准 Claude 的所有操作（没有人守着终端时用）
//                  [--stop-after 秒]   问出去这么多秒后自动停车（用来测“没答完”）
//                  [--stop-after-output 秒]  Claude 开始输出这么多秒后自动停车
//                  [--trace]          列出每条 git 命令的耗时
//   pnpm bw chat   <项目目录> [--route N] [--allow]  连着问：每输入一行就是一站，空行或 exit 结束
//                  这个命令不退出，所以每一站结束后会在后台提前把 Claude 启动好，下一站不用等
//   pnpm bw status <项目目录>                    列出各路、各站和最近的同步记录
//   pnpm bw resync <项目目录> [--route N]         重新同步一次
//
// 回答途中按 Ctrl+C 是“停车”。数据放在 ~/.branchwork-dev（可用环境变量 BRANCHWORK_HOME 改）。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { createClaudeClient } from "../src/claude";
import { gitStats } from "../src/sync/git";
import { createCore } from "../src/core";
import { openDb } from "../src/db";
import type { Route, SyncLogEntry } from "../src/shared";

const [cmd, dirArg, ...rest] = process.argv.slice(2);
if (!cmd || !dirArg || !["new", "ask", "chat", "status", "resync"].includes(cmd)) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(2, 14).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(1);
}
const words: string[] = [];
const flags: Record<string, string> = {};
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]!;
  if (a === "--allow") flags.allow = "1";
  else if (a === "--trace") flags.trace = "1";
  else if (a === "--route" || a === "--stop-after" || a === "--stop-after-output") flags[a.slice(2)] = rest[++i] ?? "";
  else words.push(a);
}
const routeNo = flags.route ? Number(flags.route) : 1;
const question = words.join(" ");
const autoAllow = flags.allow === "1";
const interactive = Boolean(process.stdin.isTTY);

// 开头先报版本和读到的选项：这样从输出就能看出跑的是哪一版、选项有没有生效
const version = (() => {
  try {
    return execFileSync("git", ["log", "-1", "--format=%h %cd", "--date=format:%m-%d %H:%M"], { cwd: path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "（不在 git 仓库里）";
  }
})();
console.log(`\x1b[2mbw 版本 ${version} | 命令 ${cmd} | ${routeNo} 路 | 自动批准：${autoAllow ? "是" : "否"} | 自动停车：${flags["stop-after"] ? "问出去 " + flags["stop-after"] + " 秒后" : flags["stop-after-output"] ? "开始输出 " + flags["stop-after-output"] + " 秒后" : "否"} | 终端有人：${interactive ? "是" : "否"}\x1b[0m`);

const home = process.env.BRANCHWORK_HOME ?? path.join(os.homedir(), ".branchwork-dev");
fs.mkdirSync(home, { recursive: true });
const db = openDb(path.join(home, "bw.sqlite"));
const claude = createClaudeClient();
// 只有 chat 是常驻的；其他命令跑完就退出，提前启动 Claude 只是白费
const core = createCore({ db, claude, worktreesRoot: path.join(home, "worktrees"), prewarm: cmd === "chat" });

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const showSync = (e: SyncLogEntry | null) => {
  if (!e) return console.log(dim("同步：没有需要同步的改动"));
  const dir = { pull: "站前 Local → 工作区", push: "站后 工作区 → Local", resolve: "解决冲突", recover: "启动时补写" }[e.direction];
  const status = { ok: "完成", noop: "无变化", conflict: "有冲突，没有写入", error: "出错" }[e.status];
  console.log(`同步（${dir}）：${status}${e.message ? "  " + e.message : ""}`);
  for (const f of e.files) console.log(`  ${f.note.padEnd(14)} ${f.path}`);
};

const project = await core.addProject(dirArg);
const routes = () => core.snapshot(project.id).routes;
const pickRoute = async (create: boolean): Promise<Route> => {
  const found = routes().find((r) => r.number === routeNo);
  if (found) return found;
  if (!create) throw new Error(`没有 ${routeNo} 路`);
  const r = await core.createRoute(project.id);
  console.log(dim(`新开 ${r.name}，工作区：${r.worktreePath}`));
  return r;
};

if (cmd === "new") {
  const r = await core.createRoute(project.id);
  console.log(`新开 ${r.name}，工作区：${r.worktreePath}`);
} else if (cmd === "status") {
  const snap = core.snapshot(project.id);
  console.log(`项目 ${snap.project.name}  Local：${snap.project.localDir}`);
  for (const r of snap.routes) {
    console.log(`\n${r.name}  [${r.status}]  会话：${r.sessionId ?? "（还没问过）"}`);
    for (const s of snap.stops.filter((x) => x.routeId === r.id)) {
      console.log(`  ${String(s.seq).padStart(2)}. ${s.name.padEnd(8)} ${s.status.padEnd(12)} 同步：${s.syncState}${s.error ? "  （" + s.error + "）" : ""}`);
    }
    const last = core.syncLog(r.id)[0];
    if (last) console.log(dim(`  最近一次同步：${last.direction} ${last.status}，${last.files.length} 个文件`));
  }
} else if (cmd === "resync") {
  const r = await pickRoute(false);
  const entries = await core.resync(r.id);
  if (entries.length === 0) showSync(null);
  entries.forEach(showSync);
  console.log(`${r.name} 现在的状态：${routes().find((x) => x.id === r.id)!.status}`);
} else {
  if (cmd === "ask" && !question) throw new Error("没有给出问题");
  const route = await pickRoute(true);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (!autoAllow && !interactive) console.log("注意：现在没有人守着终端，Claude 要批准的操作会一律按拒绝处理。要让它能改文件，加 --allow。\n");
  // 每个关键时点前面标上“从问出去算起过了多少秒”，这样能看出时间花在哪
  let t0 = Date.now();
  const at = () => `[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`;
  if (flags.trace) gitStats.trace = (args, ms) => console.log(dim(`${at()}     git ${args.slice(0, 3).join(" ").slice(0, 50).padEnd(50)} ${ms.toFixed(0).padStart(6)} ms`));
  if (flags["stop-after"]) {
    setTimeout(() => {
      console.log(dim(`\n${at()} [到 ${flags["stop-after"]} 秒，自动停车]`));
      core.stop(route.id);
    }, Number(flags["stop-after"]) * 1000);
  }
  let stops = 0;
  let asking = false;
  rl.on("SIGINT", () => {
    if (!asking || ++stops > 1) process.exit(130);
    console.log(dim("\n[停车中…再按一次 Ctrl+C 直接退出]"));
    core.stop(route.id);
  });
  let waited = 0; // 等人批准花掉的时间，不算在 Claude 头上
  let firstText = true;
  core.on(async (e) => {
    if (e.type === "stop.created") console.log(dim(`${at()} ${route.name} 第 ${e.stop.seq} 站「${e.stop.name}」出发（站前同步已完成，开始启动 Claude）\n`));
    if (e.type === "stop.started") console.log(dim(`${at()} Claude 已启动，开始处理`));
    if (e.type === "stop.answered") console.log(dim(`\n${at()} Claude 给出结果，进程收尾中`));
    if (e.type === "stop.delta") {
      if (firstText) {
        console.log(dim(`${at()} Claude 开始输出`));
        if (flags["stop-after-output"]) {
          setTimeout(() => {
            console.log(dim(`\n${at()} [开始输出已 ${flags["stop-after-output"]} 秒，自动停车]`));
            core.stop(route.id);
          }, Number(flags["stop-after-output"]) * 1000);
        }
      }
      firstText = false;
      process.stdout.write(e.text);
    }
    if (e.type === "stop.tool") console.log(dim(`\n${at()}   ▸ ${e.tool} ${e.detail}`));
    if (e.type === "stop.updated" && e.stop.status === "done" && e.stop.syncState === "none" && e.stop.endedAt) console.log(dim(`\n\n${at()} [已到站，正在同步…]`));
    if (e.type === "sync.result") console.log(dim(`${at()} 同步结束`));
    if (e.type === "permission.request") {
      console.log(`\n\n${dim(at())} 等你批准：${e.tool} ${JSON.stringify(e.input).slice(0, 300)}`);
      if (autoAllow || !interactive) {
        console.log(autoAllow ? dim("  → 自动批准（--allow）") : "  → 没有人能回答，按拒绝处理（加 --allow 可自动批准）");
        return core.answerPermission(e.requestId, autoAllow ? "allow" : "deny");
      }
      const asked = Date.now();
      setImmediate(() => rl.once("line", () => (waited += Date.now() - asked)));
      const a = (await rl.question(e.canRemember ? "  [y] 允许  [a] 这一路以后都允许  [n] 拒绝 > " : "  [y] 允许  [n] 拒绝 > ").catch(() => "n")).trim().toLowerCase();
      core.answerPermission(e.requestId, a === "y" ? "allow" : a === "a" && e.canRemember ? "allow-always" : "deny");
    }
  });

  const askOne = async (q: string) => {
    t0 = Date.now();
    waited = 0;
    firstText = true;
    stops = 0;
    asking = true;
    const report = await core.ask(route.id, q).finally(() => (asking = false));
    console.log();
    if (report.kind === "blocked") {
      console.log("这一站没有发出：站前同步有冲突。");
      showSync(report.sync);
    } else {
      const s = report.stop;
      console.log(`第 ${s.seq} 站：${s.status === "done" ? "已到站" : "没答完"}${s.error ? "（" + s.error + "）" : ""}，总用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒${waited ? `（其中等你批准 ${(waited / 1000).toFixed(1)} 秒）` : ""}`);
      if (s.status === "done") showSync(report.sync);
      else console.log(dim(`没有同步；工作区保留在 ${route.worktreePath}（同步状态：${s.syncState}）`));
      // 没答完时，已经说出的回答有没有留在会话文件里
      const sessionId = routes().find((r) => r.id === route.id)!.sessionId;
      if (s.status !== "done" && sessionId) {
        const h = await claude.history(sessionId).catch(() => []);
        const last = h.at(-1);
        const mine = s.messageId ? h.slice(h.findIndex((m) => m.id === s.messageId)) : [];
        if (mine.length === 0) console.log(dim("这一站在会话文件里没有留下消息（Claude 还没开始就停车了）"));
        else console.log(dim(`这一站在会话文件里留下了 ${mine.length} 条消息，最后一条是 ${last?.role ?? "（无）"}：${JSON.stringify(last?.content ?? null).slice(0, 200)}`));
      }
      console.log(dim(`消息 ID：提问 ${s.messageId ?? "（没拿到）"}，最后一条 ${s.lastMessageId ?? "（没拿到）"}`));
    }
    console.log(dim(`${route.name} 现在的状态：${routes().find((r) => r.id === route.id)!.status}`));
  };

  if (cmd === "ask") {
    await askOne(question);
  } else {
    core.warm(route.id);
    console.log(dim(`已在后台开始启动 Claude。在 ${route.name} 上连着问：每输入一行就是一站，空行或 exit 结束。\n`));
    for (;;) {
      const q = (await rl.question(`${route.name} > `).catch(() => "")).trim();
      if (!q || q === "exit") break;
      await askOne(q);
      console.log();
    }
  }
  rl.close();
  core.dispose();
}
db.close();
