/** MCP 服务的配置（设计稿 9-13）：读写 Claude Code 的 ~/.claude.json、项目的 .mcp.json，和 Lanes 自己存的。本模块唯一的对外入口 */
export { createMcpConfig, expandEnv, type McpConfig, type McpStore } from "./config";
