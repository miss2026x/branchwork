import type { Project, QueueItem, Route, Stop, SyncLogEntry } from "./model";

export type PermissionDecision = "allow" | "allow-always" | "deny";

/** 主进程推给界面的事件 */
export type BwEvent =
  | { type: "project.updated"; project: Project }
  | { type: "route.updated"; route: Route }
  | { type: "route.deleted"; routeId: string; projectId: string }
  | { type: "stop.created"; stop: Stop }
  | { type: "stop.updated"; stop: Stop }
  /** Claude 已启动，开始处理这一站（在这之前界面显示“正在启动”） */
  | { type: "stop.started"; routeId: string; stopId: string }
  /** Claude 已给出结果，正在收尾（界面可以停掉“正在输入”的光标） */
  | { type: "stop.answered"; routeId: string; stopId: string }
  /** 回答的流式文字 */
  | { type: "stop.delta"; routeId: string; stopId: string; text: string }
  /** Claude 用了一个工具 */
  | { type: "stop.tool"; routeId: string; stopId: string; tool: string; input: Record<string, unknown>; /** 一行说明：文件名、命令等 */ detail: string }
  /** 等你批准；用 answerPermission(requestId, …) 回答 */
  | {
      type: "permission.request";
      requestId: string;
      routeId: string;
      stopId: string;
      tool: string;
      input: Record<string, unknown>;
      /** 能不能选“这一路以后都允许” */
      canRemember: boolean;
    }
  | { type: "sync.result"; entry: SyncLogEntry }
  /** 候车区变了：这个项目现在候车的全部问题 */
  | { type: "queue.updated"; projectId: string; items: QueueItem[] };

export type BwListener = (e: BwEvent) => void;
