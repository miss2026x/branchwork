/**
 * 后台终端：启动长时间运行的命令、收着它的输出、能停掉。
 * 本模块唯一的对外入口。只依赖 Node 自带模块；不知道 Claude、同步和数据库的存在。
 */
export { createTerminals, detectPort, TerminalError } from "./terminals";
export type { TerminalEvent, TerminalInfo, TerminalOwner, Terminals, TerminalsOptions } from "./terminals";
