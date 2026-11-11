import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git } from "./git";
import type { FileChange } from "./types";

/**
 * 把目录从 fromTree 的样子改成 toTree 的样子，一次 git 调用完成。
 * 前提：indexFile 刚给这个目录拍过快照，且快照就是 fromTree。
 *
 * git 会先整体检查再动手：要改的文件如果在快照之后又被人改过，或者要新建的
 * 位置上已经有文件，它会拒绝，并且一个文件都不写。这时返回 ok: false 和 git 给的原因。
 * 不在改动范围内的文件不受影响。
 */
export async function switchTree(dir: string, indexFile: string, fromTree: string, toTree: string): Promise<{ ok: true } | { ok: false; why: string }> {
  if (fromTree === toTree) return { ok: true };
  const r = await git(dir, ["read-tree", "-m", "-u", fromTree, toTree], { env: { GIT_INDEX_FILE: indexFile }, okCodes: [128, 1] });
  return r.code === 0 ? { ok: true } : { ok: false, why: r.stderr.trim() };
}

/**
 * 只把列出的文件改成 toTree 里的样子。只在崩溃恢复时用（需要跳过个别文件）。
 */
export async function applySubset(dir: string, toTree: string, changes: FileChange[]): Promise<void> {
  if (changes.length === 0) return;

  // 先删，再写：这样“文件变目录”“目录变文件”都能正确处理
  for (const c of changes) {
    if (c.kind !== "deleted") continue;
    await fs.rm(path.join(dir, c.path), { force: true });
    await pruneEmptyDirs(dir, path.dirname(c.path));
  }
  const writes = changes.filter((c) => c.kind !== "deleted").map((c) => c.path);
  if (writes.length === 0) return;

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bw-idx-"));
  try {
    const env = { GIT_INDEX_FILE: path.join(tmp, "index") };
    await git(dir, ["read-tree", toTree], { env });
    for (const p of writes) {
      const st = await fs.lstat(path.join(dir, p)).catch(() => null);
      if (st?.isDirectory()) await fs.rm(path.join(dir, p), { recursive: true, force: true });
    }
    await git(dir, ["checkout-index", "-f", "-z", "--stdin"], { env, input: writes.join("\0") + "\0" });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function pruneEmptyDirs(root: string, rel: string): Promise<void> {
  while (rel && rel !== "." && rel !== path.sep) {
    try {
      await fs.rmdir(path.join(root, rel)); // 只有空目录才删得掉
    } catch {
      return;
    }
    rel = path.dirname(rel);
  }
}
