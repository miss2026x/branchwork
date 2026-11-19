/** 数据模型。主进程和界面共用，只有普通对象。 */
import type { PromptImage } from "./images";

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
 * ask 每次都问；edits 改文件不问、运行命令等仍然问；auto 另一个模型在后台把关，拿不准才问；
 * plan 先只出计划，批准计划后才动手；dontAsk 不问，没事先允许过的一律拒绝；all 全部不问（相当于 --dangerously-skip-permissions）。
 * 对应 Claude Code 的 default / acceptEdits / auto / plan / dontAsk / bypassPermissions
 */
export type PermissionMode = "ask" | "edits" | "auto" | "plan" | "dontAsk" | "all";

export interface Project {
  id: string;
  name: string;
  /** 这个项目的 Local：唯一真实运行的目录 */
  localDir: string;
  /** 对这个项目里所有的路生效 */
  /** 新开的路默认用的批准方式：这个项目里上一次选的 */
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
  /** 这一路的思考强度；空表示用模型自己的默认 */
  effort: Effort | null;
  /** 这一路动手前问不问你（批准方式）。新开的路沿用项目上次选的，分叉、快线沿用来源那一路 */
  permissionMode: PermissionMode;
  /** 线路颜色：1–8 中的一个；空表示按路号自动取 */
  color: number | null;
  /** 这一路的会话现在占了多少上下文（token 数）；还没问过或不知道时为空 */
  contextTokens: number | null;
  /** 置顶：在左栏里排在最前面 */
  pinned: boolean;
  /** 折叠：线路图上只留线，不画它的站 */
  folded: boolean;
  /** 父路被删掉了：这里记下它当时的叫法（“2路”），线路图上标“从已删除的 2路 开出” */
  orphanOf: string | null;
  /**
   * Local 专车（设计稿 9-10）：直接在 Local 文件夹里干活的那一路，每个项目最多一辆。
   * 没有自己的工作区（worktreePath 就是 Local），不做站前、站后同步；路号是 0，不画在线路图上
   */
  local?: boolean;
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
  /** 提问里带了几张图（图片本身用 bw.images(stop.id) 取）；没有时可以不写 */
  images?: number;
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
  /** 带了几张图（图片本身用 bw.images(item.id) 取） */
  images?: number;
}

/** local：不是同步，是发现你直接在 Local 里改了文件 */
export type SyncDirection = "pull" | "push" | "resolve" | "recover" | "local";
export type SyncOutcomeStatus = "ok" | "noop" | "conflict" | "error";

/** 思考强度。哪个模型支持哪几档由 Claude Code 告诉我们（ModelChoice.efforts） */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** 一个能选的模型：从 Claude Code 读出来的（你的账号、这个项目的设置决定有哪些） */
export interface ModelChoice {
  /** 交给 Claude Code 的值：别名（opus）、完整型号，或 default */
  value: string;
  label: string;
  description: string;
  /** 支持的思考强度；空数组表示不能调 */
  efforts: Effort[];
  /** 能不能用“自动判断”（auto）批准方式 */
  autoMode: boolean;
  /** 别名实际对应的型号（Claude Code 说的，比如 sonnet → claude-sonnet-5-5；接了别家网关时可能是别的模型） */
  resolved?: string;
}

/** 从这台电脑上的 Claude Code 读到的：能选的模型、能用的批准方式（账号、管理员设置、项目设置都算进去了） */
export interface ClaudeOptions {
  models: ModelChoice[];
  modes: PermissionMode[];
}

/** 移除项目的结果：还有没进 Local 的改动或留下的工作区时先不删，列出来让你再确认 */
export type RemoveProjectResult =
  | { status: "removed" }
  | { status: "has-unsynced"; routes: { routeId: string; label: string; files: SyncFile[] }[]; kept: string[] };

export interface SyncFile {
  path: string;
  /** added / modified / deleted，或冲突原因 */
  note: string;
  /** 冲突时：两边改到一起的大致是第几行到第几行 */
  lines?: [number, number];
  /** 冲突时：Local 里这个文件上一次是谁改的。routeId 为空表示是你自己直接改的 */
  by?: { routeId: string | null; stopId: string | null };
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

/** 在终端里用 claude 命令开过的一个会话（不是 Lanes 开的） */
export interface TerminalSession {
  id: string;
  /** 会话的标题，或者它的第一个提问 */
  title: string;
  /** 问了几次 */
  questions: number;
  lastModified: number;
}

/** 运行环境：缺哪一样，哪一样就用不了 */
export interface Environment {
  /** 随应用带的 Claude 的版本；找不到为空 */
  claudeVersion: string | null;
  /** 有没有登录 Claude：true 有；false 没有；null 在这里确认不了（比如凭据存在系统钥匙串里） */
  loggedIn: boolean | null;
  /** 用什么登录的：方式（“Claude 账号”“API Key”“中转 api.x.com”“Amazon Bedrock”）、账号、在哪儿配的 */
  auth?: { how?: string; account?: string; where?: string };
  /** git 的版本；没装为空 */
  gitVersion: string | null;
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
 * 后台终端：一条由 Lanes 启动、在某一路的工作区里跑着的命令（开发服务器、监听构建等）。
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
export type ChatItem =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      tool: string;
      detail: string;
      /** 改文件的工具：这一次增、删了多少行 */
      added?: number;
      removed?: number;
      /** 这次调用的编号（对上它的结果） */
      id?: string;
      /** MCP 工具：完整的参数 */
      input?: Record<string, unknown>;
      /** MCP 工具的结果：文字（太长截断）和图片（浏览器截图） */
      result?: ToolResult;
    };

/** 一次工具调用的结果（只留 MCP 工具的：界面要显示截图、报错列表） */
export interface ToolResult {
  error: boolean;
  text: string;
  images: PromptImage[];
}

export interface StopContent {
  stopId: string;
  items: ChatItem[];
}

/** 一路此刻在做什么（设计稿 4-8）。since：这件事从什么时候开始（界面据此计时） */
export type RouteActivity =
  | { kind: "thinking"; since: number }
  /** 正在生成一次工具调用的参数（写大文件时要几十秒）：已经生成的字数、行数，认出来的文件名或命令 */
  | { kind: "writing"; tool: string; target?: string; chars: number; lines: number; since: number }
  /** 工具在跑 */
  | { kind: "running"; tool: string; detail: string; since: number }
  /** 点了停车，正在停：step 是在等哪一步 */
  | { kind: "stopping"; step: string; since: number }
  /** 到站了，改动等 Local 专车这一站做完再进 Local */
  | { kind: "waiting-local"; since: number };

/** Local 里一个没提交的文件 */
export type LocalFileState = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";

/** Local 现在的样子（设计稿 9-10 “Local 现在”）：Local 标签、专车面板用；每一站开始时也交给专车的 Claude */
export interface LocalStatus {
  projectId: string;
  /** Local 文件夹找不到了（被移走、改名） */
  missing: boolean;
  /** 当前分支；没在分支上（detached）时为空 */
  branch: string | null;
  /** 跟踪的远端分支（origin/main）；没设时为空 */
  upstream: string | null;
  ahead: number;
  behind: number;
  /** 没提交的改动。by：这个文件最近一次是哪一路哪一站带进 Local 的；找不到是你自己直接改的 */
  files: { path: string; state: LocalFileState; by: { routeId: string; stopId: string | null } | null }[];
  /** 从 package.json 读到的命令（pnpm dev、pnpm test）；读不到就没有 */
  commands: { dev?: string; test?: string };
  /** 什么时候看的 */
  at: number;
}

/** Local 专车的一条常用提示（设计稿 9-10）。builtin 是自带的那几条的编号；自己加的没有 */
export interface LocalPreset {
  id: string;
  label: string;
  text: string;
  hidden?: boolean;
  builtin?: string;
}

/** 导入终端会话的进度 */
export interface ImportProgress {
  jobId: string;
  projectId: string;
  /** 每个会话一行 */
  items: { sessionId: string; title: string; prompts: number | null; state: "waiting" | "running" | "done" | "failed" | "skipped"; step?: string; error?: string }[];
  /** 全部结束了（导完、出错或被停止） */
  finished: boolean;
}

// ───────────── MCP 服务（设计稿 9-13） ─────────────

/**
 * 一个 MCP 服务存在哪：前三种和 Claude Code 一样（claude mcp add --scope），存在它的文件里，命令行里也用得到；
 * 后两种只存在 Lanes 里
 */
export type McpScope = "local" | "project" | "user" | "lanes" | "lanes-project";

/** 怎么连：本机命令，或远程网址 */
export type McpTransport = { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> } | { type: "http" | "sse"; url: string; headers?: Record<string, string> };

/** 设置里列出的一个 MCP 服务 */
export interface McpServerEntry {
  name: string;
  scope: McpScope;
  /** 存在哪个文件（给人看的：~/.claude.json、.mcp.json、Lanes） */
  where: string;
  config: McpTransport;
  /** Lanes 里的开关（只记在 Lanes 里，不动原文件） */
  enabled: boolean;
  /** 同名的服务有更优先的一份：这一份不生效。值是盖住它的那份的范围 */
  shadowedBy?: McpScope;
  /** 认出是 chrome-devtools-mcp：由内置的浏览器代替，不生效 */
  replacedByBrowser?: boolean;
  /** 项目 .mcp.json 里的服务：你还没确认过要不要用（设计稿 9-13“项目里的服务先确认”） */
  untrusted?: boolean;
}

export type McpToolPolicy = "allow" | "ask" | "deny";

/** 检查一个服务连不连得上的结果 */
export interface McpServerState {
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled" | "checking";
  error?: string;
  tools?: { name: string; description?: string; readOnly?: boolean }[];
  checkedAt: number;
}

/** 内置浏览器的设置（设计稿 9-12） */
export interface BrowserSettings {
  enabled: boolean;
  /** Chrome 程序的位置；空的话自动找 */
  chromePath: string;
  /** 只给 Local 专车开浏览器（内存不够时） */
  localOnly: boolean;
  /** 发车时附上浏览器现状 */
  attachState: boolean;
  /** 每一站结束时截一张图 */
  stopShots: boolean;
}

/** MCP 设置页一次拿到的全部东西 */
export interface McpOverview {
  projectId: string;
  servers: McpServerEntry[];
  /** 按名字：最近一次检查的结果 */
  states: Record<string, McpServerState>;
  /** 按服务名、工具名：工具的批准方式；没写的按默认（只读的直接放行，其余跟这一路） */
  policies: Record<string, Record<string, McpToolPolicy>>;
  browser: BrowserSettings & { /** 自动找到的 Chrome；找不到为空 */ found: string | null };
}

/** 新加或改一个服务时交给主进程的东西 */
export interface McpServerInput {
  name: string;
  scope: McpScope;
  config: McpTransport;
}

// ───────────── 内置浏览器（设计稿 9-12） ─────────────

/** 浏览器里的一条问题：报错，或失败的请求 */
export interface BrowserIssue {
  id: string;
  kind: "error" | "warning" | "request";
  text: string;
  /** 报错的位置（auth.ts:88），请求的方法和状态（POST 401） */
  source: string;
  at: number;
}

/** 一路的浏览器窗口现在的样子 */
export interface BrowserState {
  routeId: string;
  /** 这一路有没有开着的窗口 */
  open: boolean;
  /** 现在的页面 */
  url: string;
  title: string;
  /** 这一路窗口里的全部页面 */
  pages: { url: string; title: string; active: boolean }[];
  /** 上一站以来的问题（新的在后） */
  issues: BrowserIssue[];
  /** 正在点选元素 */
  picking: boolean;
  /** 窗口关了：上次在的网址 */
  lastUrl: string | null;
  /** 找不到 Chrome、启动失败 */
  error: string | null;
}

/** 点选的元素（设计稿 9-12“点选元素”） */
export interface PickedElement {
  /** button「登录」 */
  label: string;
  /** form.login > button.primary */
  selector: string;
  width: number;
  height: number;
  x: number;
  y: number;
  /** 主要的样式，一行一条 */
  styles: string;
  text: string;
  /** 元素的 HTML（太长截断） */
  html: string;
  /** 局部截图 */
  image: PromptImage | null;
  url: string;
}
