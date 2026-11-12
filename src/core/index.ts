/**
 * 产品规则：把同步引擎、数据库、Claude 拼成“问一站”的完整流程。
 * 本模块唯一的对外入口。sync、db、claude 互相不认识，只有这里把它们连起来。
 */
export { BRANCHWORK_BRIEFING } from "./briefing";
export { createCore, CoreError, NEW_ROUTE_NAME, stopName } from "./core";
export type { AskReport, Core, CoreErrorCode, CoreOptions } from "./core";
