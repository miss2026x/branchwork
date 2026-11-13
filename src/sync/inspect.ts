import fs from "node:fs";
import path from "node:path";
import { git } from "./git";

/** 一个文件夹能不能当项目用，以及它现在的样子 */
export interface RepoInfo {
  /** 文件夹存在 */
  exists: boolean;
  /** 是 git 仓库，并且至少有一次提交 */
  isRepo: boolean;
  /** 当前所在的分支；游离状态或不是仓库时为空 */
  branch: string | null;
  /** 没提交的改动有几个文件 */
  dirty: number;
  hasClaudeMd: boolean;
}

/** 看一眼这个文件夹：只读，不改任何东西 */
export async function inspectRepo(dir: string): Promise<RepoInfo> {
  const info: RepoInfo = { exists: false, isRepo: false, branch: null, dirty: 0, hasClaudeMd: false };
  try {
    if (!fs.statSync(dir).isDirectory()) return info;
  } catch {
    return info;
  }
  info.exists = true;
  info.hasClaudeMd = fs.existsSync(path.join(dir, "CLAUDE.md"));
  const head = await git(dir, ["rev-parse", "--verify", "HEAD"], { anyCode: true }).catch(() => null);
  if (!head || head.code !== 0) return info;
  info.isRepo = true;
  const branch = await git(dir, ["symbolic-ref", "--short", "-q", "HEAD"], { anyCode: true });
  info.branch = branch.code === 0 ? branch.stdout.trim() || null : null;
  const status = await git(dir, ["status", "--porcelain"], { anyCode: true });
  info.dirty = status.code === 0 ? status.stdout.split("\n").filter(Boolean).length : 0;
  return info;
}
