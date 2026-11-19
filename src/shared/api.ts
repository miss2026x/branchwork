import type { BwListener, PermissionDecision } from "./events";
import type { PromptImage } from "./images";
import type { DirectoryInfo, ClaudeOptions, Effort, Environment, TerminalSession, FileStat, KeptWorktree, LocalPreset, LocalStatus, PermissionMode, Project, ProjectSnapshot, QueueItem, RemoveProjectResult, QueueMode, Route, StopContent, SyncFile, SyncLogEntry, Terminal, BrowserSettings, BrowserState, McpOverview, McpScope, McpServerInput, McpServerState, McpToolPolicy, PickedElement } from "./model";

/**
 * 界面能调用的全部操作，也就是 window.bw。
 * 主进程实现它，界面只通过它读写数据；两边都从这里引用，改一边另一边会报类型错误。
 * 所有操作都立即返回；过程和结果通过 onEvent 推送。
 */
export interface BwApi {
  listProjects(): Promise<Project[]>;
  /** 弹出系统的选目录窗口；取消返回 null */
  pickDirectory(): Promise<string | null>;
  /** 添加项目前看一眼这个文件夹：是不是 git 仓库、在哪个分支、有没有 CLAUDE.md */
  inspectDirectory(dir: string): Promise<DirectoryInfo>;
  /** 拖进窗口的文件或文件夹在磁盘上的路径（界面自己拿不到）；拿不到返回空字符串 */
  droppedPath(file: File): string;
  /** 运行环境：Claude 的版本、有没有登录、git 能不能用 */
  environment(): Promise<Environment>;
  /** 这个文件夹下在终端里用 claude 命令开过的会话 */
  terminalSessions(dir: string): Promise<TerminalSession[]>;
  /** 把终端里开过的会话导进来，每个画成一路 */
  /** 导入终端里的会话：每个画成一路。进度走 import.progress 事件 */
  importSessions(projectId: string, sessionIds: string[]): Promise<Route[]>;
  /** 停止导入：已经导好的留下，没开始的不导 */
  importCancel(jobId: string): Promise<void>;
  addProject(localDir: string, name?: string): Promise<Project>;
  /** 这个项目所有路的同步记录，新的在前 */
  projectLog(projectId: string): Promise<SyncLogEntry[]>;
  /** 在系统的文件管理器里打开这个项目的 Local */
  openLocal(projectId: string): Promise<void>;
  /** 在系统自带的终端里打开一个后台终端所在的文件夹（那一路的工作区） */
  openSystemTerminal(terminalId: string): Promise<void>;
  snapshot(projectId: string): Promise<ProjectSnapshot>;
  /** 改这个项目的批准方式；立即生效，正在等批准的请求也按新的方式处理 */
  /** 这一路的批准方式；同时记成项目的默认，之后新开的路沿用 */
  setRoutePermissionMode(routeId: string, mode: PermissionMode): Promise<Route>;
  createRoute(projectId: string, name?: string): Promise<Route>;
  /** 改线路名称 */
  renameRoute(routeId: string, name: string): Promise<Route>;
  /** 换线路颜色（1–8）；null 回到按路号自动取 */
  setRouteColor(routeId: string, color: number | null): Promise<Route>;
  /** 置顶到左栏、在线路图上折叠（只收起站，线还在） */
  setRouteFlags(routeId: string, flags: { pinned?: boolean; folded?: boolean }): Promise<Route>;
  /**
   * 截线：删掉这一路上从这一站起的所有站（只删对话，不动代码）。
   * 返回被截掉的那一站的提问，方便放回输入框改一改重新问。
   */
  truncate(routeId: string, stopId: string): Promise<{ prompt: string; images: PromptImage[] }>;
  /** 改站名。改过的站不会再被自动起的名字覆盖 */
  renameStop(stopId: string, name: string): Promise<void>;
  /** 这一路以后用哪个模型；null 表示用默认的。下一站起生效 */
  setRouteModel(routeId: string, model: string | null, effort?: Effort | null): Promise<Route>;
  /** 这个项目能选的模型和批准方式：先给上次读到的（可能是 null），新读到的通过 claude-options.updated 事件送来 */
  claudeOptions(projectId: string): Promise<ClaudeOptions | null>;
  /** 丢掉这一路工作区里还没进 Local 的改动（Local 本来就没有它们） */
  discardChanges(routeId: string): Promise<void>;
  /** 把这一路的对话导出成 Markdown 文件；用户取消返回 null，否则返回保存的位置 */
  exportRoute(routeId: string): Promise<string | null>;
  /** 这一路的工作区里有哪些改动还没进 Local，各增删了多少行 */
  changes(routeId: string): Promise<FileStat[]>;
  /** 这个项目里所有的后台终端（跑着的和已退出还没清掉的） */
  terminals(projectId: string): Promise<Terminal[]>;
  /** 一个后台终端到现在为止的输出（太长时只留最后一段） */
  terminalOutput(terminalId: string): Promise<string>;
  /** 停掉一个后台终端；已经退出的则从列表里拿掉 */
  terminalStop(terminalId: string): Promise<void>;
  /**
   * 问一站。发出即返回；站的出现、回答、到站、同步都走事件。不能问时（正在回答、有冲突）抛错。
   * images：带的图片；text 里用“[图 N]”标出第 N 张图的位置
   */
  ask(routeId: string, text: string, images?: PromptImage[], options?: { /** false：这一站不附浏览器现状 */ browserState?: boolean }): Promise<void>;
  /** 这个项目的 Local 专车（设计稿 9-10）；还没有就开一辆 */
  localRoute(projectId: string): Promise<Route>;
  /** Local 现在的样子；之后有变化走 local.status 事件 */
  localStatus(projectId: string): Promise<LocalStatus>;
  /** 专车的常用提示；没改过是 null，用自带的 */
  localPresets(projectId: string): Promise<LocalPreset[] | null>;
  /** 存专车的常用提示；null 恢复自带的 */
  setLocalPresets(projectId: string, presets: LocalPreset[] | null): Promise<void>;
  /** 专车重新开始：清掉它的对话（Local 里的文件不动） */
  resetLocal(routeId: string): Promise<Route>;
  /** 一站的提问、或候车区一个问题带的图片 */
  images(ownerId: string): Promise<PromptImage[]>;
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
  queueAdd(projectId: string, text: string, routeId?: string | null, mode?: QueueMode, images?: PromptImage[]): Promise<QueueItem>;
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
  /** keepWorktree：只删对话，工作区的文件夹留着（记在“留下的工作区”里） */
  deleteRoute(routeId: string, force?: boolean, keepWorktree?: boolean): Promise<{ status: "deleted" } | { status: "has-unsynced"; files: SyncFile[] }>;
  /** 从 Lanes 里移除一个项目：Local 文件夹不动，这个项目的路、工作区、对话记录一起删。force 才连没进 Local 的改动一起删 */
  removeProject(projectId: string, force?: boolean): Promise<RemoveProjectResult>;
  /** 这个项目留下的工作区 */
  keptWorktrees(projectId: string): Promise<KeptWorktree[]>;
  /** 在文件管理器里打开一个留下的工作区 */
  openKept(id: string): Promise<void>;
  /** 把一个留下的工作区彻底删掉 */
  removeKept(id: string): Promise<void>;
  /** 停车 */
  stop(routeId: string): Promise<void>;
  /** note：不批准时带给 Claude 的一句话，比如“别装新库，用自带的” */
  answerPermission(requestId: string, decision: PermissionDecision, note?: string): Promise<void>;
  /** 这一路各站的回答内容（从 Claude 的会话文件读） */
  history(routeId: string): Promise<StopContent[]>;
  syncLog(routeId: string): Promise<SyncLogEntry[]>;
  /** 用户点开了这一路：提前把 Claude 启动好 */
  warm(routeId: string): Promise<void>;
  // ── MCP 服务（设计稿 9-13） ──
  /** 这个项目能看到的全部 MCP 服务、上次检查的结果、工具的批准方式、浏览器设置 */
  mcpOverview(projectId: string): Promise<McpOverview>;
  /** 检查服务连不连得上（不给 names 就查全部在用的）。要等一会儿；中间状态走 mcp.states 事件 */
  mcpCheck(projectId: string, names?: string[]): Promise<Record<string, McpServerState>>;
  /** 测试连接：还没存的服务也能试（添加对话框里的“测试连接”） */
  mcpTest(projectId: string, input: McpServerInput): Promise<McpServerState>;
  /** 新加或改一个服务；previous：改的是哪一条（换名字、换位置时原来那条删掉） */
  mcpSave(projectId: string, input: McpServerInput, previous?: { name: string; scope: McpScope }): Promise<McpOverview>;
  mcpRemove(projectId: string, name: string, scope: McpScope): Promise<McpOverview>;
  /** Lanes 里的开关：只记在 Lanes 里，不动 Claude Code 的文件 */
  mcpSetEnabled(projectId: string, name: string, enabled: boolean): Promise<McpOverview>;
  /** 项目 .mcp.json 里的服务：确认要用 / 不用 */
  mcpTrust(projectId: string, names: string[], trusted: boolean): Promise<McpOverview>;
  /** 一个工具的批准方式；null 回到默认 */
  mcpSetPolicy(server: string, tool: string, policy: McpToolPolicy | null): Promise<void>;
  /** 这一路关掉了哪些服务（内置浏览器的名字是 browser） */
  routeMcp(routeId: string): Promise<string[]>;
  setRouteMcp(routeId: string, off: string[]): Promise<void>;

  // ── 内置浏览器（设计稿 9-12） ──
  browserSettings(): Promise<BrowserSettings & { found: string | null }>;
  setBrowserSettings(patch: Partial<BrowserSettings>): Promise<BrowserSettings & { found: string | null }>;
  browserState(routeId: string): Promise<BrowserState>;
  /** 打开这一路的窗口（没开就开，开着就拉到前面）；给了 url 就打开它 */
  browserOpen(routeId: string, url?: string): Promise<void>;
  /** 把这一路的窗口拉到前面 */
  browserShow(routeId: string): Promise<void>;
  /** 截这一路窗口当前的页面 */
  browserScreenshot(routeId: string): Promise<PromptImage>;
  /** 点选元素：Chrome 窗口跳到前面等你点；取消返回 null */
  browserPick(routeId: string): Promise<PickedElement | null>;
  browserCancelPick(routeId: string): Promise<void>;
  /** 关掉这一路的窗口 */
  browserClose(routeId: string): Promise<void>;

  /** 订阅事件，返回取消订阅的函数 */
  onEvent(listener: BwListener): () => void;
}
