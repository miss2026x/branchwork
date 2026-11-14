/** 同步引擎对外的数据类型。只有普通对象，可以直接经 IPC 传给界面。 */

export type ConflictReason =
  | "both-modified" // 两边改了同一处
  | "both-added" // 两边都新建了同名文件，内容不同
  | "modify-delete" // 一边修改，另一边删除
  | "rename" // 改名相关
  | "binary" // 二进制文件两边都改了
  | "markers-left" // 上次冲突的标记还留在文件里
  | "local-file-in-the-way" // 要新建的位置上，Local 已经有一个被忽略的同名文件
  | "other";

export interface ConflictFile {
  path: string;
  reason: ConflictReason;
  /** git 给出的原始说明，放进同步记录里备查 */
  detail: string;
}

export interface FileChange {
  path: string;
  kind: "added" | "modified" | "deleted";
}

/** 一个改动过的文件，以及增删了多少行 */
export interface FileStat extends FileChange {
  /** 二进制文件为空 */
  added: number | null;
  removed: number | null;
}

export type SyncResult =
  /** 没有需要同步的内容 */
  | { status: "noop" }
  /** 已同步；changed 是这次写进目标目录的文件 */
  | { status: "ok"; changed: FileChange[] }
  /** 有冲突；目标目录一个字节都没写 */
  | { status: "conflict"; files: ConflictFile[] };

export type ResolveResult =
  | { status: "ok"; changed: FileChange[] }
  /** 已把带冲突标记的文件放进工作区，等 Claude 改好 */
  | { status: "resolving"; files: ConflictFile[] };

export type RemoveResult =
  | { status: "removed" }
  /** 工作区里还有没进 Local 的改动，没有删除 */
  | { status: "has-unsynced"; files: FileChange[] };

export type RecoverResult =
  | { status: "clean" }
  /** 上次写到一半，已补写完成 */
  | { status: "recovered"; routeId: string; changed: FileChange[] }
  /** 上次写到一半，其中一些文件之后被改过，没有动它们 */
  | { status: "needs-attention"; routeId: string; changed: FileChange[]; skipped: string[] };

export interface RouteStatus {
  worktreePath: string;
  /** 工作区里还没进 Local 的改动 */
  unsynced: FileChange[];
  /** Local 里还没进工作区的改动 */
  localAhead: FileChange[];
  /** 正在等 Claude 解决冲突 */
  resolving: boolean;
}

export type SyncErrorCode =
  | "GIT_TOO_OLD"
  | "NOT_A_REPO"
  | "NOT_REPO_ROOT"
  | "NO_COMMITS"
  | "BAD_ROUTE_ID"
  | "WORKTREE_EXISTS"
  | "WORKTREE_MISSING"
  | "LOCAL_BUSY"
  | "GIT_FAILED";

export class SyncError extends Error {
  constructor(
    public readonly code: SyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

/** 只给测试用：在同步的各个时点插入动作（例如抛错来模拟进程被杀）。 */
export interface SyncHooks {
  /** push 时，合并结果算好之后、写 Local 之前 */
  afterMergeComputed?: () => void | Promise<void>;
  /** 日志已落盘、Local 还一个字节没写 */
  afterJournalWritten?: () => void | Promise<void>;
  /** Local 写完之后、工作区对齐之前 */
  afterLocalWritten?: () => void | Promise<void>;
}

export interface SyncEngineOptions {
  /** 用户的项目目录（仓库根目录） */
  localDir: string;
  /** 放各路工作区的目录，每一路一个子目录 */
  worktreesDir: string;
  hooks?: SyncHooks;
}

export interface SyncEngine {
  /** 新开一路：从 Local 当前状态（含未提交的改动）建工作区 */
  createWorktree(routeId: string): Promise<{ path: string }>;
  /** 站前：把 Local 的新变化合并进工作区 */
  pullBeforeStop(routeId: string): Promise<SyncResult>;
  /** 站后（只在这一站正常结束时调）：把工作区的变化写回 Local */
  pushAfterStop(routeId: string): Promise<SyncResult>;
  /** “让当前 Claude 解决”：把 Local 的版本带冲突标记合进工作区 */
  mergeForResolve(routeId: string): Promise<ResolveResult>;
  /** 这一路现在的同步情况 */
  status(routeId: string): Promise<RouteStatus>;
  /** 丢掉工作区里还没进 Local 的改动：工作区回到上次和 Local 对齐时的样子 */
  discard(routeId: string): Promise<void>;
  /** 工作区里还没进 Local 的改动，带每个文件增删的行数 */
  changes(routeId: string): Promise<FileStat[]>;
  /** 删除一路的工作区；有未同步改动时默认不删 */
  /** keep：文件夹留着不删，只是不再由引擎管它 */
  removeWorktree(routeId: string, opts?: { force?: boolean; keep?: boolean }): Promise<RemoveResult>;
  /** 彻底删掉一个不再由引擎管的工作区文件夹（删掉对话时留下来的那种） */
  removeFolder(dir: string): Promise<void>;
  /** 应用启动时调：检查上次有没有写到一半的同步 */
  recover(): Promise<RecoverResult>;
  worktreePath(routeId: string): string;
}
