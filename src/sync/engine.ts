import fs from "node:fs/promises";
import path from "node:path";
import { applySubset, switchTree } from "./apply";
import { git, gitVersion } from "./git";
import { mergeTrees } from "./merge";
import { blobAt, diffTrees, readRef, Snapshots } from "./snapshot";
import {
  SyncError,
  type ConflictFile,
  type FileChange,
  type RecoverResult,
  type RemoveResult,
  type ResolveResult,
  type RouteStatus,
  type SyncEngine,
  type SyncEngineOptions,
  type SyncResult,
} from "./types";

/** 写 Local 之前落盘的日志。三个字段都是文件树的编号 */
interface Journal {
  routeId: string;
  local: string; // 写之前 Local 的样子
  worktree: string; // 写之前工作区的样子
  merged: string; // 要写成的结果
  files: FileChange[];
}

const MAX_PUSH_ATTEMPTS = 3;

export async function createSyncEngine(opts: SyncEngineOptions): Promise<SyncEngine> {
  const [major, minor] = await gitVersion();
  if (major < 2 || (major === 2 && minor < 40)) {
    throw new SyncError("GIT_TOO_OLD", `需要 git 2.40 或更新的版本，当前是 ${major}.${minor}`);
  }
  const localDir = path.resolve(opts.localDir);
  // 正常情况一次调用拿到三样；失败了再分开问，给出具体原因
  const info = await git(localDir, ["rev-parse", "--show-toplevel", "--git-dir", "HEAD"], { okCodes: [128] });
  if (info.code !== 0) {
    const top = await git(localDir, ["rev-parse", "--show-toplevel"], { okCodes: [128] });
    if (top.code !== 0) throw new SyncError("NOT_A_REPO", `${localDir} 不是 git 仓库`);
    throw new SyncError("NO_COMMITS", "仓库里还没有任何提交，先提交一次再使用");
  }
  // --git-dir 是这个目录自己的 git 目录：Local 本身是 git worktree 时，它和主目录各有一份，状态互不干扰
  const [top, gitDirRaw] = info.stdout.trim().split("\n");
  if (!(await samePath(top!, localDir))) throw new SyncError("NOT_REPO_ROOT", `${localDir} 不是仓库的根目录`);

  const gitDir = path.resolve(localDir, gitDirRaw!);
  const stateDir = path.join(gitDir, "branchwork");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(opts.worktreesDir, { recursive: true });
  // 上次如果在 git 写索引时被杀，会留下锁文件；这些索引只有引擎自己用，启动时清掉是安全的
  for (const f of await fs.readdir(stateDir)) {
    if (f.endsWith(".lock")) await fs.rm(path.join(stateDir, f), { force: true });
  }

  return new Engine(localDir, path.resolve(opts.worktreesDir), gitDir, stateDir, opts.hooks ?? {});
}

class Engine implements SyncEngine {
  /** 所有操作排成一队，同一时刻只有一个在读写 Local */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly snaps: Snapshots;
  /** 每一路的同步基线（文件树编号）。也存在 refs/branchwork/ 下，这里只是免得每次去问 git */
  private readonly bases = new Map<string, string>();

  constructor(
    private readonly localDir: string,
    private readonly worktreesDir: string,
    private readonly gitDir: string,
    private readonly stateDir: string,
    private readonly hooks: NonNullable<SyncEngineOptions["hooks"]>,
  ) {
    this.snaps = new Snapshots(localDir);
  }

  // ───────────── 对外的操作 ─────────────

  worktreePath(routeId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(routeId)) throw new SyncError("BAD_ROUTE_ID", `路的 id 只能包含字母、数字、- 和 _：${routeId}`);
    return path.join(this.worktreesDir, routeId);
  }

  createWorktree(routeId: string): Promise<{ path: string }> {
    return this.serial(async () => {
      const wt = this.worktreePath(routeId);
      if (await exists(wt)) throw new SyncError("WORKTREE_EXISTS", `工作区已存在：${wt}`);
      const local = await this.snapLocal(true);
      const add = await git(this.localDir, ["worktree", "add", "--detach", wt, "HEAD"], { okCodes: [128] });
      if (add.code !== 0) {
        // 多半是上次删目录后 git 里还留着登记：清一下再试
        await git(this.localDir, ["worktree", "prune"]);
        await git(this.localDir, ["worktree", "add", "--detach", wt, "HEAD"]);
      }
      // 把 Local 未提交的改动也带过去，但不提交：工作区里看到的 git 状态和 Local 一样
      await git(wt, ["read-tree", "--reset", "-u", local]);
      await Promise.all([git(wt, ["reset", "-q"]), this.setBase(routeId, local)]);
      return { path: wt };
    });
  }

  pullBeforeStop(routeId: string): Promise<SyncResult> {
    return this.serial(async () => {
      const wt = await this.requireWorktree(routeId);
      const base = await this.getBase(routeId);
      const local = await this.snapLocal(true);
      if (local === base) return { status: "noop" };
      const work = await this.snapRoute(routeId, true);

      // 工作区自己没改过：结果就是 Local 的样子，不用算合并
      let merged = local;
      if (work !== base) {
        const m = await this.merge(base, work, local);
        if (m.conflicts.length > 0) return { status: "conflict", files: m.conflicts };
        merged = m.tree;
      }
      const changed = await diffTrees(this.localDir, work, merged);
      await this.switchRoute(routeId, work, merged);
      await Promise.all([this.setBase(routeId, local), this.alignHead(wt)]);
      return { status: "ok", changed };
    });
  }

  pushAfterStop(routeId: string): Promise<SyncResult> {
    return this.serial(async () => {
      const wt = await this.requireWorktree(routeId);
      const left = await this.markersLeft(routeId, wt);
      if (left.length > 0) return { status: "conflict", files: left };

      let why = "";
      for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
        const base = await this.getBase(routeId);
        // 两个目录互不相干，同时拍
        const [work, local] = await Promise.all([this.snapRoute(routeId, false), this.snapLocal(true)]);
        if (work === base) {
          await this.clearResolving(routeId);
          return { status: "noop" };
        }

        // 只在对象库里算，这时候 Local 一个字节都没动。
        // Local 从上次同步后没变过（最常见）：结果就是工作区的样子，不用算合并
        let merged = work;
        if (local !== base) {
          const m = await this.merge(base, local, work);
          if (m.conflicts.length > 0) return { status: "conflict", files: m.conflicts };
          merged = m.tree;
        }
        await this.hooks.afterMergeComputed?.();

        const toLocal = await diffTrees(this.localDir, local, merged);
        // 要新建的位置上 Local 已经有文件（只可能是被忽略的文件）：git 会直接覆盖它，我们不允许
        const blocked: ConflictFile[] = [];
        for (const c of toLocal) {
          if (c.kind !== "added") continue;
          const st = await fs.lstat(path.join(this.localDir, c.path)).catch(() => null);
          if (st && !st.isDirectory()) {
            blocked.push({ path: c.path, reason: "local-file-in-the-way", detail: "Local 里已有一个被忽略的同名文件" });
          }
        }
        if (blocked.length > 0) return { status: "conflict", files: blocked };
        await this.writeJournal({ routeId, local, worktree: work, merged, files: toLocal });
        await this.hooks.afterJournalWritten?.();

        // 写 Local。要改的文件如果在快照之后又被用户改了，git 会整体拒绝、一个文件都不写：重新来
        const written = await switchTree(this.localDir, this.localIndex, local, merged);
        if (!written.ok) {
          why = written.why;
          await this.clearJournal();
          continue;
        }
        this.snaps.noteIs(this.localIndex, merged);
        await this.hooks.afterLocalWritten?.();

        await this.switchRoute(routeId, work, merged);
        await Promise.all([this.setBase(routeId, merged), this.alignHead(wt)]);
        await this.clearJournal();
        await this.clearResolving(routeId);
        return toLocal.length > 0 ? { status: "ok", changed: toLocal } : { status: "noop" };
      }
      throw new SyncError("LOCAL_BUSY", `Local 里要写的文件一直在变化，这次没有同步，稍后重试。${why}`);
    });
  }

  mergeForResolve(routeId: string): Promise<ResolveResult> {
    return this.serial(async () => {
      const wt = await this.requireWorktree(routeId);
      const base = await this.getBase(routeId);
      const [work, local] = await Promise.all([this.snapRoute(routeId, false), this.snapLocal(false)]);
      const merged = await this.merge(base, work, local);
      const changed = await diffTrees(this.localDir, work, merged.tree);
      await this.switchRoute(routeId, work, merged.tree);
      // Local 的内容已经进了工作区（冲突处带标记），之后以这一刻的 Local 为共同起点
      await Promise.all([this.setBase(routeId, local), this.alignHead(wt)]);
      if (merged.conflicts.length === 0) return { status: "ok", changed };
      await fs.writeFile(this.resolvingFile(routeId), JSON.stringify(merged.conflicts.map((c) => c.path)));
      return { status: "resolving", files: merged.conflicts };
    });
  }

  status(routeId: string): Promise<RouteStatus> {
    return this.serial(async () => {
      const wt = await this.requireWorktree(routeId);
      const base = await this.getBase(routeId);
      const [work, local] = await Promise.all([this.snapRoute(routeId, true), this.snapLocal(true)]);
      const [unsynced, localAhead] = await Promise.all([diffTrees(this.localDir, base, work), diffTrees(this.localDir, base, local)]);
      return { worktreePath: wt, unsynced, localAhead, resolving: await exists(this.resolvingFile(routeId)) };
    });
  }

  removeWorktree(routeId: string, opts: { force?: boolean } = {}): Promise<RemoveResult> {
    return this.serial(async () => {
      const wt = this.worktreePath(routeId);
      if (await exists(wt)) {
        if (!opts.force) {
          const base = await this.getBase(routeId);
          const work = await this.snapRoute(routeId, false);
          const unsynced = await diffTrees(this.localDir, base, work);
          if (unsynced.length > 0) return { status: "has-unsynced", files: unsynced };
        }
        await git(this.localDir, ["worktree", "remove", "--force", wt], { okCodes: [128] });
        await fs.rm(wt, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
      await Promise.all([git(this.localDir, ["worktree", "prune"]), git(this.localDir, ["update-ref", "-d", this.baseRef(routeId)])]);
      this.bases.delete(routeId);
      this.snaps.forget(this.indexFile(routeId));
      await fs.rm(this.indexFile(routeId), { force: true });
      await this.clearResolving(routeId);
      return { status: "removed" };
    });
  }

  recover(): Promise<RecoverResult> {
    return this.serial(async () => {
      const j = await this.readJournal();
      if (!j) return { status: "clean" };
      // 日志指向的文件树如果已经不在仓库里了：没法补写。基线没动，下一次同步会重新合并
      const known = await git(this.localDir, ["cat-file", "-e", `${j.merged}^{tree}`], { okCodes: [1, 128] });
      if (known.code !== 0) {
        await this.clearJournal();
        return { status: "needs-attention", routeId: j.routeId, changed: [], skipped: j.files.map((f) => f.path) };
      }
      const now = await this.snapLocal(false);

      // Local：只补写“还停在写之前的样子”的文件；之后被人改过的不动
      const wanted = new Set(j.files.map((f) => f.path));
      const pending = (await diffTrees(this.localDir, now, j.merged)).filter((c) => wanted.has(c.path));
      const safe: FileChange[] = [];
      const skipped: string[] = [];
      for (const c of pending) {
        const [cur, old] = await Promise.all([blobAt(this.localDir, now, c.path), blobAt(this.localDir, j.local, c.path)]);
        if (cur === old) safe.push(c);
        else skipped.push(c.path);
      }
      await applySubset(this.localDir, j.merged, safe);
      this.snaps.forget(this.localIndex);

      // 工作区：如果还停在写之前的样子，对齐到结果
      if (await exists(this.worktreePath(j.routeId))) {
        const work = await this.snapRoute(j.routeId, false);
        if (work === j.worktree) await this.switchRoute(j.routeId, work, j.merged);
      }

      await this.clearJournal();
      if (skipped.length > 0) {
        // 基线不动：下一次同步会把这些文件重新合并一遍
        return { status: "needs-attention", routeId: j.routeId, changed: safe, skipped };
      }
      await this.setBase(j.routeId, j.merged);
      await this.clearResolving(j.routeId);
      return { status: "recovered", routeId: j.routeId, changed: safe };
    });
  }

  // ───────────── 内部 ─────────────

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /** quick：目录多半没变时传 true，没变就只启动一次 git */
  private snapLocal(quick: boolean): Promise<string> {
    const seed = path.join(this.gitDir, "index");
    return quick ? this.snaps.takeQuick(this.localDir, this.localIndex, seed) : this.snaps.take(this.localDir, this.localIndex, seed);
  }

  private async snapRoute(routeId: string, quick: boolean): Promise<string> {
    const [dir, idx] = [this.worktreePath(routeId), this.indexFile(routeId)];
    const seed = path.join(await this.routeGitDir(dir), "index");
    return quick ? this.snaps.takeQuick(dir, idx, seed) : this.snaps.take(dir, idx, seed);
  }

  /** 工作区自己的 git 目录，写在它的 .git 文件里（gitdir: …/worktrees/<名字>）；读文件不用启动 git */
  private async routeGitDir(wt: string): Promise<string> {
    const dotGit = await fs.readFile(path.join(wt, ".git"), "utf8").catch(() => "");
    const p = dotGit.replace(/^gitdir:\s*/, "").trim();
    return p ? path.resolve(wt, p) : "";
  }

  /** 三方合并：结果 = ours 加上 theirs 相对 base 的变化。只在对象库里算 */
  private async merge(base: string, ours: string, theirs: string) {
    const [b, o, t] = await Promise.all([this.snaps.commitFor(base), this.snaps.commitFor(ours), this.snaps.commitFor(theirs)]);
    return mergeTrees(this.localDir, b, o, t);
  }

  /** 把工作区从 from 改成 to。回答没在进行，工作区不该有人动，改不了就是出错 */
  private async switchRoute(routeId: string, from: string, to: string): Promise<void> {
    const r = await switchTree(this.worktreePath(routeId), this.indexFile(routeId), from, to);
    if (!r.ok) throw new SyncError("GIT_FAILED", `工作区在同步期间被改动，没有完成对齐：${routeId}。${r.why}`);
    this.snaps.noteIs(this.indexFile(routeId), to);
  }

  private get localIndex(): string {
    return path.join(this.stateDir, "index-local");
  }

  private indexFile(routeId: string): string {
    return path.join(this.stateDir, `index-${routeId}`);
  }

  private resolvingFile(routeId: string): string {
    return path.join(this.stateDir, `resolving-${routeId}.json`);
  }

  private baseRef(routeId: string): string {
    return `refs/branchwork/${routeId}/base`;
  }

  private async requireWorktree(routeId: string): Promise<string> {
    const wt = this.worktreePath(routeId);
    if (!(await exists(wt))) throw new SyncError("WORKTREE_MISSING", `这一路的工作区不存在：${wt}`);
    return wt;
  }

  private async getBase(routeId: string): Promise<string> {
    let base = this.bases.get(routeId) ?? null;
    if (!base) {
      base = await readRef(this.localDir, this.baseRef(routeId));
      if (!base) throw new SyncError("WORKTREE_MISSING", `找不到这一路的同步基线：${routeId}`);
      this.bases.set(routeId, base);
    }
    return base;
  }

  /** 基线直接记成文件树的编号（引用可以指向文件树），这样不必为每次同步多建一个提交 */
  private async setBase(routeId: string, tree: string): Promise<void> {
    await git(this.localDir, ["update-ref", this.baseRef(routeId), tree]);
    this.bases.set(routeId, tree);
  }

  /**
   * 用户在 Local 提交之后，让工作区的 HEAD 跟上，这样工作区里的 git status 不会把
   * 已提交的内容显示成未提交。只在工作区自己没有新提交时才动。文件内容不受影响。
   */
  private async alignHead(wt: string): Promise<void> {
    const name = path.basename(await this.routeGitDir(wt));
    if (!name) return;
    const r = await git(this.localDir, ["rev-parse", "HEAD", `worktrees/${name}/HEAD`], { okCodes: [128] });
    const [localHead, wtHead] = r.stdout.trim().split("\n");
    if (r.code !== 0 || !wtHead || !localHead || localHead === wtHead) return;
    const anc = await git(this.localDir, ["merge-base", "--is-ancestor", wtHead, localHead], { okCodes: [1] });
    if (anc.code !== 0) return;
    await git(wt, ["update-ref", "--no-deref", "HEAD", localHead]);
    await git(wt, ["reset", "-q"]);
  }

  /** 上次“让 Claude 解决”的文件里，哪些还留着冲突标记 */
  private async markersLeft(routeId: string, wt: string): Promise<ConflictFile[]> {
    let paths: string[];
    try {
      paths = JSON.parse(await fs.readFile(this.resolvingFile(routeId), "utf8")) as string[];
    } catch {
      return [];
    }
    const out: ConflictFile[] = [];
    for (const p of paths) {
      const text = await fs.readFile(path.join(wt, p), "utf8").catch(() => "");
      if (/^(<{7} |>{7} )/m.test(text)) out.push({ path: p, reason: "markers-left", detail: "文件里还有冲突标记" });
    }
    return out;
  }

  private async clearResolving(routeId: string): Promise<void> {
    await fs.rm(this.resolvingFile(routeId), { force: true });
  }

  private get journalFile(): string {
    return path.join(this.stateDir, "journal.json");
  }

  private async writeJournal(j: Journal): Promise<void> {
    // 先写临时文件再改名：日志本身不会只写了一半
    const tmp = this.journalFile + ".tmp";
    const fh = await fs.open(tmp, "w");
    await fh.writeFile(JSON.stringify(j));
    await fh.sync();
    await fh.close();
    await fs.rename(tmp, this.journalFile);
  }

  private async readJournal(): Promise<Journal | null> {
    try {
      return JSON.parse(await fs.readFile(this.journalFile, "utf8")) as Journal;
    } catch {
      return null;
    }
  }

  private async clearJournal(): Promise<void> {
    await fs.rm(this.journalFile, { force: true });
  }
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

async function samePath(a: string, b: string): Promise<boolean> {
  const norm = async (p: string) => {
    const r = await fs.realpath(path.resolve(p)).catch(() => path.resolve(p));
    return process.platform === "win32" || process.platform === "darwin" ? r.toLowerCase() : r;
  };
  return (await norm(a)) === (await norm(b));
}
