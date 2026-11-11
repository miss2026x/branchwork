import type { PermissionDecision } from "../shared";

/** 回答过程中的事件 */
export type ClaudeEvent =
  /** Claude 进程已启动、会话已就绪；在这之前是启动时间，在这之后才是它在想和写 */
  | { type: "started" }
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; input: Record<string, unknown> };

export interface PermissionRequest {
  tool: string;
  input: Record<string, unknown>;
  /** 能不能选“以后都允许” */
  canRemember: boolean;
}

export interface AskOptions {
  /** 这一路的工作区目录 */
  cwd: string;
  prompt: string;
  /** 接着哪个会话问；不传就是新会话 */
  sessionId?: string;
  /** 上一站最后一条消息的 ID；用来在历史里找到这一站从哪开始 */
  afterMessageId?: string;
  /** 停车：abort 之后这一站算没答完 */
  signal?: AbortSignal;
  onEvent?: (e: ClaudeEvent) => void;
  /** 等你批准。不传则一律拒绝 */
  onPermission?: (req: PermissionRequest) => Promise<PermissionDecision>;
}

export type AskOutcome =
  | "completed" // 正常结束：只有这种情况才做站后同步
  | "interrupted" // 被停车，或进程中途退出
  | "failed"; // Claude 报错结束（超出轮数、执行出错等）

export interface AskResult {
  outcome: AskOutcome;
  sessionId: string | null;
  /** 完整的回答文字 */
  text: string;
  error: string | null;
  /** 这一站提问那条消息、最后一条消息的 ID；拿不到时为空 */
  promptMessageId: string | null;
  lastMessageId: string | null;
}

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant" | "system";
  /** SDK 给的原始消息内容 */
  content: unknown;
}

/** 别的模块只认识这个接口，不知道底下是 Agent SDK。测试里用假的实现。 */
export interface ClaudeClient {
  /** 问一站 */
  ask(opts: AskOptions): Promise<AskResult>;
  /**
   * 提前在后台把 Claude 启动好，等下一站用。启动 Claude 在有些机器上要几十秒，
   * 提前做掉，问的时候就不用等。尽力而为：失败了不报错，问的时候照常现启动。
   */
  warm(cwd: string, sessionId?: string): void;
  /** 关掉所有提前启动好的 Claude（应用退出时调） */
  dispose(): void;
  /** 复制会话到某条消息为止（含），返回新会话的 ID；不传就复制全部 */
  fork(sessionId: string, upToMessageId?: string): Promise<string>;
  history(sessionId: string): Promise<HistoryMessage[]>;
  deleteSession(sessionId: string): Promise<void>;
}
