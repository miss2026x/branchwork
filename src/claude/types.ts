import type { PermissionDecision } from "../shared";

/** 回答过程中的事件 */
export type ClaudeEvent =
  /** Claude 进程已启动、会话已就绪；在这之前是启动时间，在这之后才是它在想和写 */
  | { type: "started" }
  /** Claude 给出了这一站的结果；之后它的进程还要收尾退出，可能再花几秒 */
  | { type: "answered" }
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
  /** 用哪个模型：别名（opus、sonnet、haiku）或完整名字；不传用 Claude Code 的默认 */
  model?: string;
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
  /** 这一站结束时会话占了多少上下文（最后一次请求读进去的加上写出来的 token 数）；拿不到时为空 */
  contextTokens?: number | null;
}

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant" | "system";
  /** SDK 给的原始消息内容 */
  content: unknown;
}

/**
 * 应用自己提供给 Claude 的工具（Claude Code 自带的工具之外）。
 * 调用方只管写“参数是什么、被调用时做什么”，怎么挂到 Claude 上由本模块负责。
 */
export interface ClaudeTool {
  /** 工具名：小写字母和下划线 */
  name: string;
  /** 给人看的名字：界面上显示“Claude 用了什么”、问你批准时用 */
  title: string;
  /** 给 Claude 看的说明：什么时候用、会发生什么 */
  description: string;
  params: Record<string, { type: "string" | "number"; description: string; optional?: boolean }>;
  /** 只读、没有副作用的工具不用问批准 */
  readonly?: boolean;
  /** cwd：是哪个目录里的 Claude 调用的（也就是哪一路）。返回给 Claude 看的文字；抛错则 Claude 看到错误信息 */
  run(input: Record<string, unknown>, ctx: { cwd: string }): Promise<string>;
}

/** 别的模块只认识这个接口，不知道底下是 Agent SDK。测试里用假的实现。 */
export interface ClaudeClient {
  /** 问一站 */
  ask(opts: AskOptions): Promise<AskResult>;
  /**
   * 提前在后台把 Claude 启动好，等下一站用。启动 Claude 在有些机器上要几十秒，
   * 提前做掉，问的时候就不用等。尽力而为：失败了不报错，问的时候照常现启动。
   */
  warm(cwd: string, sessionId?: string, model?: string): void;
  /** 设定应用自己提供给 Claude 的工具。对之后启动的 Claude 进程生效 */
  useTools(tools: ClaudeTool[]): void;
  /**
   * 给一个提问起个短名字（只看提问本身）。用一个单独的、一直开着的小模型进程，不影响任何一路的会话。
   * 尽力而为：起不出来返回 null，调用方继续用自己的临时名字。
   */
  name(prompt: string): Promise<string | null>;
  /** 关掉为这个目录提前启动好的 Claude（这一路归档或删除时调，否则它会占着目录和内存） */
  cool(cwd: string): void;
  /** 关掉所有提前启动好的 Claude（应用退出时调） */
  dispose(): void;
  /** 复制会话到某条消息为止（含），返回新会话的 ID；不传就复制全部 */
  fork(sessionId: string, upToMessageId?: string): Promise<string>;
  history(sessionId: string): Promise<HistoryMessage[]>;
  deleteSession(sessionId: string): Promise<void>;
}
