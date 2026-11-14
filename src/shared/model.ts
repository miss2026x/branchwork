/** 数据模型。主进程和界面共用，只有普通对象。 */

export type RouteStatus =
  | "idle" // 停在站上，可以问下一站
  | "answering" // Claude 正在回答
  | "awaiting_permission" // 等你批准
  | "interrupted" // 上一站没答完
  | "conflict" // 有同步冲突，解决前不能问下一站
  | "archived";

export type StopKind = "normal" | "minor" | "summary";
export type StopNameState = "temp" | "final" | "manual";
export type StopStatus = "answering" | "done" | "interrupted";
/** 这一站的改动有没有进 Local */
export type StopSyncState = "none" | "synced" | "unsynced" | "conflict";

/**
 * Claude 要做需要批准的事时怎么办：
 * ask 每次都问；edits 改文件不问、运行命令等仍然问；all 全部不问（相当于 --dangerously-skip-permissions）
 */
export type PermissionMode = "ask" | "edits" | "all";

export interface Project {
  id: string;
  name: string;
  /** 这个项目的 Local：唯一真实运行的目录 */
  localDir: string;
  /** 对这个项目里所有的路生效 */
  permissionMode: PermissionMode;
  createdAt: number;
}

export interface Route {
  id: string;
  projectId: string;
  /** 路号：1 路、2 路… */
  number: number;
  /** 快线的编号（快1、快2…）；不是快线则为空。快线是带着交接摘要出发的全新对话 */
  express: number | null;
  name: string;
  status: RouteStatus;
  /** Claude 会话 ID；还没问过第一站时为空 */
  sessionId: string | null;
  worktreePath: string;
  /** 从哪一路的哪一站分叉出来的 */
  parentRouteId: string | null;
  forkStopId: string | null;
  /** 这一路用哪个模型：模型的别名（opus、sonnet、haiku）或完整名字；空表示用 Claude Code 的默认 */
  model: string | null;
  /** 线路颜色：1–8 中的一个；空表示按路号自动取 */
  color: number | null;
  /** 这一路的会话现在占了多少上下文（token 数）；还没问过或不知道时为空 */
  contextTokens: number | null;
  createdAt: number;
  archivedAt: number | null;
}

export interface Stop {
  id: string;
  routeId: string;
  /** 在这一路上的次序，从 1 开始 */
  seq: number;
  kind: StopKind;
  name: string;
  nameState: StopNameState;
  prompt: string;
  status: StopStatus;
  syncState: StopSyncState;
  /** 这一站提问那条消息的 ID */
  messageId: string | null;
  /** 这一站最后一条消息的 ID；分叉、截线、改站时用 */
  lastMessageId: string | null;
  error: string | null;
  startedAt: number;
  endedAt: number | null;
}

/**
 * 候车的问题怎么上车：
 * auto 派给了某一路，那一路正常到站后自动发出；manual 派给了某一路，到站后等你点“登车”；unassigned 还没派车
 */
export type QueueMode = "auto" | "manual" | "unassigned";

/** 候车区里的一个问题 */
export interface QueueItem {
  id: string;
  projectId: string;
  text: string;
  mode: QueueMode;
  /** 派给了哪一路；没派车时为空 */
  routeId: string | null;
  createdAt: number;
}

export type SyncDirection = "pull" | "push" | "resolve" | "recover";
export type SyncOutcomeStatus = "ok" | "noop" | "conflict" | "error";

export interface SyncFile {
  path: string;
  /** added / modified / deleted，或冲突原因 */
  note: string;
}

export interface SyncLogEntry {
  id: string;
  routeId: string;
  stopId: string | null;
  direction: SyncDirection;
  status: SyncOutcomeStatus;
  files: SyncFile[];
  message: string | null;
  at: number;
}

export interface ProjectSnapshot {
  project: Project;
  routes: Route[];
  stops: Stop[];
  queue: QueueItem[];
}

/** 删掉对话时留下来的工作区：对话没了，文件夹还在，可以打开看或者以后删掉 */
export interface KeptWorktree {
  id: string;
  projectId: string;
  path: string;
  /** 原来是哪一路，比如“3路 Cookie 方案” */
  label: string;
  at: number;
}

/** 添加项目前看一眼这个文件夹 */
export interface DirectoryInfo {
  dir: string;
  /** 默认的项目名：文件夹的名字 */
  name: string;
  exists: boolean;
  isRepo: boolean;
  branch: string | null;
  /** 没提交的改动有几个文件 */
  dirty: number;
  hasClaudeMd: boolean;
  /** 已经加过的项目（加过就不用再加） */
  projectId: string | null;
}

/** 工作区里一个还没进 Local 的文件，以及它增删了多少行 */
export interface FileStat {
  path: string;
  kind: "added" | "modified" | "deleted";
  /** 增加、删除的行数；二进制文件为空 */
  added: number | null;
  removed: number | null;
}

/**
 * 后台终端：一条由 Branchwork 启动、在某一路的工作区里跑着的命令（开发服务器、监听构建等）。
 * 它不随某一站结束而停：一直跑到你停掉它、这一路归档或删除、或者退出应用。
 */
export interface Terminal {
  id: string;
  projectId: string;
  routeId: string;
  /** 是哪一站开的；你自己开的为空 */
  stopId: string | null;
  name: string;
  command: string;
  /** 在哪个目录里跑（这一路的工作区） */
  cwd: string;
  status: "running" | "exited";
  exitCode: number | null;
  /** 从输出里认出来的端口号；没认出来为空 */
  port: number | null;
  startedAt: number;
  endedAt: number | null;
}

/** 一站回答里的一段：一段文字，或一次工具调用 */
export type ChatItem = { kind: "text"; text: string } | { kind: "tool"; tool: string; detail: string; /** 改文件的工具：这一次增、删了多少行 */ added?: number; removed?: number };

export interface StopContent {
  stopId: string;
  items: ChatItem[];
}
