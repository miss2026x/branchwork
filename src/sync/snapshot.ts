import fs from "node:fs/promises";
import path from "node:path";
import { git } from "./git";
import type { FileChange } from "./types";

/**
 * 给目录拍快照（含未提交、未跟踪的文件；不含被忽略的文件），得到一份文件树的编号。
 * 每个目录用引擎自己的一个索引文件，不碰用户的暂存区和分支。
 *
 * 启动一次 git 在有些 Windows 机器上要 0.2–0.3 秒，所以这里记住两件事来少启动几次：
 * - 每个索引文件上一次对应的文件树（目录没变时只需一次检查）
 * - 文件树对应的提交号（只有真要算三方合并时才需要提交）
 */
export class Snapshots {
  private readonly last = new Map<string, string>();
  private readonly commits = new Map<string, string>();

  constructor(private readonly repoDir: string) {}

  /** 完整拍一次。seedIndex：第一次用时从哪个现成的索引起步 */
  async take(dir: string, indexFile: string, seedIndex: string): Promise<string> {
    await ensureIndex(indexFile, seedIndex);
    const env = { GIT_INDEX_FILE: indexFile };
    await git(dir, ["add", "-A", "--", "."], { env });
    const tree = (await git(dir, ["write-tree"], { env })).stdout.trim();
    this.last.set(indexFile, tree);
    return tree;
  }

  /** 目录多半没变时用：先问一次“和上次比有没有变”，没变就直接用上次的结果 */
  async takeQuick(dir: string, indexFile: string, seedIndex: string): Promise<string> {
    const tree = this.last.get(indexFile);
    if (tree) {
      const r = await git(dir, ["ls-files", "-m", "-o", "-d", "--exclude-standard", "-z"], { env: { GIT_INDEX_FILE: indexFile } });
      if (r.stdout === "") return tree;
    }
    return this.take(dir, indexFile, seedIndex);
  }

  /** 引擎刚把目录改成了 tree 的样子（索引也已同步） */
  noteIs(indexFile: string, tree: string): void {
    this.last.set(indexFile, tree);
  }

  forget(indexFile: string): void {
    this.last.delete(indexFile);
  }

  /** 三方合并要用提交而不是文件树（旧版 git 的限制）；用到时才建，建过的记住 */
  async commitFor(tree: string): Promise<string> {
    let c = this.commits.get(tree);
    if (!c) {
      c = (await git(this.repoDir, ["commit-tree", tree, "-m", "branchwork snapshot"])).stdout.trim();
      this.commits.set(tree, c);
    }
    return c;
  }
}

async function ensureIndex(indexFile: string, seedIndex: string): Promise<void> {
  try {
    await fs.access(indexFile);
  } catch {
    // 第一次：从仓库现有索引起步，省掉重新计算全部文件的时间
    await fs.mkdir(path.dirname(indexFile), { recursive: true });
    await fs.copyFile(seedIndex, indexFile).catch(() => {});
  }
}

/** 一个引用指向的对象编号；不存在返回 null */
export async function readRef(dir: string, ref: string): Promise<string | null> {
  const r = await git(dir, ["rev-parse", "--verify", "-q", ref], { okCodes: [1, 128] });
  return r.code === 0 ? r.stdout.trim() : null;
}

/** 两份文件树之间变了哪些文件 */
export async function diffTrees(dir: string, from: string, to: string): Promise<FileChange[]> {
  if (from === to) return [];
  const { stdout } = await git(dir, ["diff-tree", "-r", "-z", "--no-renames", "--name-status", from, to]);
  const tok = stdout.split("\0");
  const out: FileChange[] = [];
  for (let i = 0; i + 1 < tok.length; i += 2) {
    const s = tok[i]!;
    out.push({ path: tok[i + 1]!, kind: s === "A" ? "added" : s === "D" ? "deleted" : "modified" });
  }
  return out;
}

/** 两份文件树之间每个文件增删了多少行（二进制文件没有行数） */
export async function diffStat(dir: string, from: string, to: string): Promise<Map<string, { added: number | null; removed: number | null }>> {
  const out = new Map<string, { added: number | null; removed: number | null }>();
  if (from === to) return out;
  const { stdout } = await git(dir, ["diff-tree", "-r", "-z", "--no-renames", "--numstat", from, to]);
  for (const rec of stdout.split("\0")) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(rec);
    if (m) out.set(m[3]!, { added: m[1] === "-" ? null : Number(m[1]), removed: m[2] === "-" ? null : Number(m[2]) });
  }
  return out;
}

/** 某份文件树里某个路径的内容编号；不存在返回 null */
export async function blobAt(dir: string, tree: string, file: string): Promise<string | null> {
  const r = await git(dir, ["rev-parse", "--verify", "-q", `${tree}:${file}`], { okCodes: [1, 128] });
  return r.code === 0 ? r.stdout.trim() : null;
}
