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

export interface Project {
  id: string;
  name: string;
  /** 这个项目的 Local：唯一真实运行的目录 */
  localDir: string;
  createdAt: number;
}

export interface Route {
  id: string;
  projectId: string;
  /** 路号：1 路、2 路… */
  number: number;
  name: string;
  status: RouteStatus;
  /** Claude 会话 ID；还没问过第一站时为空 */
  sessionId: string | null;
  worktreePath: string;
  /** 从哪一路的哪一站分叉出来的 */
  parentRouteId: string | null;
  forkStopId: string | null;
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

export type QueueMode = "auto" | "manual" | "unassigned";

export interface QueueItem {
  id: string;
  projectId: string;
  text: string;
  mode: QueueMode;
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
}
