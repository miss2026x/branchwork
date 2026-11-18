import type { ClaudeOptions, ImportProgress, Project, QueueItem, Route, RouteActivity, Stop, SyncLogEntry, Terminal } from "./model";

export type PermissionDecision = "allow" | "allow-always" | "deny";

/** 主进程推给界面的事件 */
export type BwEvent =
  | { type: "project.updated"; project: Project }
  /** 项目从 Branchwork 里移除了（Local 文件夹不动） */
  | { type: "project.removed"; projectId: string }
  /** 从这台电脑上的 Claude Code 读到了这个项目能选的模型和批准方式；读不到时 options 为 null */
  | { type: "claude-options.updated"; projectId: string; options: ClaudeOptions | null }
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
  /** 它在想的内容（流式；有的模型不给内容） */
  | { type: "stop.thinking"; routeId: string; stopId: string; text: string }
  /** 这一路此刻在做什么（设计稿 4-8：在想、正在写文件、工具在跑、停车中）；null：在出字或者闲着 */
  | { type: "route.activity"; routeId: string; activity: RouteActivity | null }
  /** 正在开新的一路（开新车、开新对话、压缩成快线）：做到哪一步；step 为 null 表示做完了 */
  | { type: "route.preparing"; projectId: string; step: string | null }
  /** 导入终端会话的进度（设计稿 4-8） */
  | { type: "import.progress"; progress: ImportProgress }
  /** Claude 用了一个工具 */
  | { type: "stop.tool"; routeId: string; stopId: string; tool: string; input: Record<string, unknown>; /** 一行说明：文件名、命令等 */ detail: string; added?: number; removed?: number }
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
  /** 截线：这一路上这些站被删掉了 */
  | { type: "stops.removed"; routeId: string; stopIds: string[] }
  /** 后台终端开了、退出了、认出了端口 */
  | { type: "terminal.updated"; terminal: Terminal }
  /** 后台终端新吐出来的一段输出 */
  | { type: "terminal.output"; terminalId: string; text: string }
  /** 后台终端从列表里拿掉了 */
  | { type: "terminal.removed"; terminalId: string; projectId: string }
  /** 候车区变了：这个项目现在候车的全部问题 */
  | { type: "queue.updated"; projectId: string; items: QueueItem[] };

export type BwListener = (e: BwEvent) => void;
