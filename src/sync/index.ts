/**
 * 同步引擎：工作区和 Local 之间的站级同步。
 * 这是本模块唯一的对外入口；其他模块只能从这里引用。
 * 只依赖 git 和 Node 自带模块，不依赖 Electron、数据库或 Claude。
 */
export { inspectRepo, type RepoInfo } from "./inspect";
export { gitVersionText } from "./git";
export { createSyncEngine } from "./engine";
export { SyncError } from "./types";
export type {
  ConflictFile,
  ConflictReason,
  FileChange,
  FileStat,
  RecoverResult,
  RemoveResult,
  ResolveResult,
  RouteStatus,
  SyncEngine,
  SyncEngineOptions,
  SyncErrorCode,
  SyncHooks,
  SyncResult,
} from "./types";
