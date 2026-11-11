import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSyncEngine, type SyncEngine, type SyncHooks } from "../../src/sync";

export interface Lab {
  local: string;
  worktrees: string;
  engine: SyncEngine;
  /** 重新建一个引擎（模拟应用重启） */
  restart(hooks?: SyncHooks): Promise<SyncEngine>;
  wt(routeId: string): string;
  cleanup(): void;
}

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function write(dir: string, rel: string, content: string | Buffer): void {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

export function read(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), "utf8");
}

export function has(dir: string, rel: string): boolean {
  return fs.existsSync(path.join(dir, rel));
}

/** 目录里所有文件的内容（不含 .git），用来断言“一个字节都没变” */
export function dump(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out[r] = fs.readFileSync(path.join(dir, r)).toString("base64");
    }
  };
  walk("");
  return out;
}

export const LINES = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

export function replaceLine(text: string, n: number, to: string): string {
  const a = text.split("\n");
  a[n - 1] = to;
  return a.join("\n");
}

export async function makeLab(hooks?: SyncHooks): Promise<Lab> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bw-sync-")));
  const local = path.join(root, "local");
  const worktrees = path.join(root, "worktrees");
  fs.mkdirSync(local);
  sh(local, "init", "-q", "-b", "main");
  fs.appendFileSync(path.join(local, ".git", "config"), "[user]\n\temail = dev@example.com\n\tname = Dev\n[core]\n\tautocrlf = false\n");
  write(local, "a.txt", LINES);
  write(local, "b.txt", "bee\n");
  write(local, "src/app.ts", "export const n = 1;\n");
  write(local, ".gitignore", "node_modules/\n.env\n");
  sh(local, "add", "-A");
  sh(local, "commit", "-q", "-m", "init");
  const make = (h?: SyncHooks) => createSyncEngine({ localDir: local, worktreesDir: worktrees, hooks: h });
  const lab: Lab = {
    local,
    worktrees,
    engine: await make(hooks),
    restart: async (h) => (lab.engine = await make(h)),
    wt: (id) => path.join(worktrees, id),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
  return lab;
}
