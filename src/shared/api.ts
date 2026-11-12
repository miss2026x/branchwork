import type { BwListener, PermissionDecision } from "./events";
import type { PermissionMode, Project, ProjectSnapshot, QueueItem, QueueMode, Route, StopContent, SyncFile, SyncLogEntry } from "./model";

/**
 * 界面能调用的全部操作，也就是 window.bw。
 * 主进程实现它，界面只通过它读写数据；两边都从这里引用，改一边另一边会报类型错误。
 * 所有操作都立即返回；过程和结果通过 onEvent 推送。
 */
export interface BwApi {
  listProjects(): Promise<Project[]>;
  /** 弹出系统的选目录窗口；取消返回 null */
  pickDirectory(): Promise<string | null>;
  addProject(localDir: string): Promise<Project>;
  snapshot(projectId: string): Promise<ProjectSnapshot>;
  /** 改这个项目的批准方式；立即生效，正在等批准的请求也按新的方式处理 */
  setPermissionMode(projectId: string, mode: PermissionMode): Promise<Project>;
  createRoute(projectId: string, name?: string): Promise<Route>;
  /** 问一站。发出即返回；站的出现、回答、到站、同步都走事件。不能问时（正在回答、有冲突）抛错 */
  ask(routeId: string, text: string): Promise<void>;
  /** 从某一站开一条新的路（新会话、新工作区，带着到这一站为止的历史） */
  fork(routeId: string, stopId: string, name?: string): Promise<Route>;
  /** 压缩第一步：把到这一站为止的对话提炼成交接摘要。要等一会儿，写好后返回摘要；失败或取消则抛错 */
  distill(routeId: string, stopId: string, keep?: string): Promise<string>;
  cancelDistill(routeId: string): Promise<void>;
  /** 压缩第二步：带着摘要开一条快线（全新的会话和工作区） */
  createExpress(routeId: string, stopId: string, summary: string, name?: string): Promise<Route>;
  /** 让这一路的 Claude 解决同步冲突。发出即返回，过程走事件 */
  resolveConflict(routeId: string): Promise<void>;
  /** 重新同步一次（手工处理了冲突之后）。结果走事件 */
  resync(routeId: string): Promise<void>;
  /** 候车区：放一个问题进来。给了 routeId 就是派给那一路（默认自动登车） */
  queueAdd(projectId: string, text: string, routeId?: string | null, mode?: QueueMode): Promise<QueueItem>;
  /** 派车 / 改派 / 撤回（routeId 为空） */
  queueAssign(itemId: string, routeId: string | null, mode?: QueueMode): Promise<QueueItem>;
  queueRemove(itemId: string): Promise<void>;
  /** 登车：现在就发出。发出即返回，过程走事件 */
  queueBoard(itemId: string): Promise<void>;
  /** 开新车：为这个问题新开一路并发出 */
  queueStartNew(itemId: string): Promise<Route>;
  /** 归档：收起来，对话和工作区都留着 */
  archiveRoute(routeId: string): Promise<Route>;
  unarchiveRoute(routeId: string): Promise<Route>;
  /** 删除一路。有没进 Local 的改动时不删并返回这些文件；force 才连它们一起删 */
  deleteRoute(routeId: string, force?: boolean): Promise<{ status: "deleted" } | { status: "has-unsynced"; files: SyncFile[] }>;
  /** 停车 */
  stop(routeId: string): Promise<void>;
  answerPermission(requestId: string, decision: PermissionDecision): Promise<void>;
  /** 这一路各站的回答内容（从 Claude 的会话文件读） */
  history(routeId: string): Promise<StopContent[]>;
  syncLog(routeId: string): Promise<SyncLogEntry[]>;
  /** 用户点开了这一路：提前把 Claude 启动好 */
  warm(routeId: string): Promise<void>;
  /** 订阅事件，返回取消订阅的函数 */
  onEvent(listener: BwListener): () => void;
}
