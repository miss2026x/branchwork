/**
 * 和 Claude 对接：问一站、分叉、读历史。
 * 本模块唯一的对外入口。只依赖 shared 和 Agent SDK；不知道同步和数据库的存在。
 */
export { createClaudeClient } from "./sdk-client";
export type { ClaudeClientOptions, SdkFunctions } from "./sdk-client";
export type { AskOptions, AskOutcome, AskResult, ClaudeClient, ClaudeEvent, HistoryMessage, PermissionRequest } from "./types";
