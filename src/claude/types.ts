import type { AuthInfo } from "./auth";
import type { ClaudeOptions, Effort, McpServerState, McpTransport, PermissionDecision, PermissionMode, PromptImage, ToolResult } from "../shared";

/** 一个 Claude 进程按什么设置启动：启动后就改不了，变了就得换一个进程 */
export interface RunSettings {
  model?: string;
  effort?: Effort;
  permissionMode?: PermissionMode;
  /** 交给这个 Claude 进程的外部 MCP 服务（设计稿 9-13；不含 Lanes 自己的工具）和工具的批准规则 */
  mcp?: McpRun;
}

export interface McpRun {
  servers: Record<string, McpTransport>;
  /** 这套服务的指纹：一样才能用提前启动好的进程 */
  key: string;
  /** 完整工具名（mcp__服务__工具）→ 批准方式。deny 的不给 Claude 看 */
  policy: Record<string, "allow" | "ask" | "deny">;
  /** 这些服务的工具都直接放行（内置的浏览器），除了 askTools 里的 */
  autoAllow: string[];
  askTools: string[];
}

/** 回答过程中的事件 */
export type ClaudeEvent =
  /** Claude 进程已启动、会话已就绪；在这之前是启动时间，在这之后才是它在想和写 */
  | { type: "started" }
  /** Claude 给出了这一站的结果；之后它的进程还要收尾退出，可能再花几秒 */
  | { type: "answered" }
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; input: Record<string, unknown>; /** 这次调用的编号 */ id?: string }
  /** 它在想（设计稿 4-8）：text 是想的内容（有的模型不给内容，只有空的开始） */
  | { type: "thinking"; text: string }
  /**
   * 它在生成一次工具调用的参数（写大文件时要几十秒）：chars 是已经生成的字数，
   * target 是从参数里认出来的文件名或命令（还没生成出来时为空）
   */
  | { type: "tool-input"; tool: string; chars: number; lines: number; target?: string }
  /** 工具跑完了（结果回来了）；error：跑出错了 */
  | { type: "tool-result"; error: boolean; /** 对上是哪次调用；MCP 工具还带结果（文字、截图） */ id?: string; result?: ToolResult };

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
  /** 提问带的图片：prompt 里的“[图 N]”标出第 N 张的位置，图片就插在那里发给 Claude */
  images?: PromptImage[];
  /** 接着哪个会话问；不传就是新会话 */
  sessionId?: string;
  /** 上一站最后一条消息的 ID；用来在历史里找到这一站从哪开始 */
  afterMessageId?: string;
  /** 用哪个模型：别名（opus、sonnet、haiku）或完整名字；不传用 Claude Code 的默认 */
  model?: string;
  /** 思考强度；不传用模型自己的默认 */
  effort?: Effort;
  /** 批准方式；不传是每次都问 */
  permissionMode?: PermissionMode;
  /** 外部 MCP 服务（设计稿 9-13） */
  mcp?: McpRun;
  /** 停车：abort 之后这一站算没答完 */
  signal?: AbortSignal;
  onEvent?: (e: ClaudeEvent) => void;
  /** 等你批准。不传则一律拒绝 */
  /** 返回 { deny: "…" } 表示不批准，并把这句话带给 Claude（比如“换个做法”） */
  onPermission?: (req: PermissionRequest) => Promise<PermissionDecision | { deny: string }>;
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
  warm(cwd: string, sessionId?: string, run?: RunSettings): void;
  /** 设定应用自己提供给 Claude 的工具。对之后启动的 Claude 进程生效 */
  useTools(tools: ClaudeTool[]): void;
  /**
   * 给一个提问起个短名字（只看提问本身）。用一个单独的、一直开着的小模型进程，不影响任何一路的会话。
   * 尽力而为：起不出来返回 null，调用方继续用自己的临时名字。
   */
  name(prompt: string): Promise<string | null>;
  /**
   * 检查这些 MCP 服务连不连得上、有哪些工具（设计稿 9-13）：启动一个不提问的 Claude 进程，让它去连，等它们都有了结果。
   * 结果和 Claude 真正用的时候一致（包括要不要登录）
   */
  mcpStatus(cwd: string, servers: Record<string, McpTransport>): Promise<Record<string, McpServerState>>;
  /** 关掉为这个目录提前启动好的 Claude（这一路归档或删除时调，否则它会占着目录和内存） */
  cool(cwd: string): void;
  /** 关掉所有提前启动好的 Claude（应用退出时调） */
  dispose(): void;
  /** 复制会话到某条消息为止（含），返回新会话的 ID；不传就复制全部 */
  fork(sessionId: string, upToMessageId?: string): Promise<string>;
  history(sessionId: string): Promise<HistoryMessage[]>;
  deleteSession(sessionId: string): Promise<void>;
  /** 在这个目录下用 claude 命令开过的会话（新的在前，最多 max 个） */
  listSessions(dir: string, max?: number): Promise<{ id: string; title: string; lastModified: number }[]>;
  /**
   * 在这个目录下能选哪些模型、能用哪些批准方式：问这台电脑上的 Claude Code（它按你的账号、管理员和这个目录的设置给出）。
   * 要启动一个 Claude 进程，不提问、不花 token；读不到就抛错
   */
  options(cwd: string): Promise<ClaudeOptions>;
  /** Claude 的版本、有没有登录。只看本机的文件，不启动 Claude */
  /** projectDirs：各项目的 Local 文件夹（项目里的 .claude/settings.json 也能配 Key） */
  environment(projectDirs?: string[]): Promise<{ version: string | null; loggedIn: boolean | null; auth?: AuthInfo }>;
}
