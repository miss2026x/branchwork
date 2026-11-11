/**
 * 存储：项目、路、站、同步记录。
 * 本模块唯一的对外入口。只依赖 shared 和 SQLite（Node 自带的 node:sqlite）。
 */
export { openDb } from "./database";
export type { Db } from "./database";
