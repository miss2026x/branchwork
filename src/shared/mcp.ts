import type { McpTransport } from "./model";

/**
 * MCP 服务配置里的一条（Claude Code、Claude Desktop、Cursor、VS Code 的写法）→ 我们的样子。
 * 认不出的（没有 command 也没有 url、ws 这类我们接不了的）返回 null
 */
export function toTransport(raw: unknown): McpTransport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const strMap = (v: unknown): Record<string, string> | undefined => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") out[k] = String(x);
    return Object.keys(out).length ? out : undefined;
  };
  const type = typeof r.type === "string" ? r.type : undefined;
  if (typeof r.url === "string" && r.url && (type === undefined || type === "http" || type === "streamable-http" || type === "sse")) {
    const headers = strMap(r.headers);
    return { type: type === "sse" ? "sse" : "http", url: r.url, ...(headers ? { headers } : {}) };
  }
  if (typeof r.command === "string" && r.command && (type === undefined || type === "stdio")) {
    const args = Array.isArray(r.args) ? r.args.filter((a): a is string => typeof a === "string") : undefined;
    const env = strMap(r.env);
    return { type: "stdio", command: r.command, ...(args && args.length ? { args } : {}), ...(env ? { env } : {}) };
  }
  return null;
}

/** 我们的样子 → 写进 Claude Code 配置文件的样子（stdio 不写 type，和 claude mcp add 写出来的一样） */
export function fromTransport(t: McpTransport): Record<string, unknown> {
  if (t.type === "stdio") return { command: t.command, args: t.args ?? [], ...(t.env ? { env: t.env } : {}) };
  return { type: t.type, url: t.url, ...(t.headers ? { headers: t.headers } : {}) };
}

/**
 * “粘贴 JSON”：认得 { "mcpServers": {...} }（Claude Code、Claude Desktop、Cursor）、{ "servers": {...} }（VS Code）、
 * 直接一个 { 名字: {...} }，或者单独一个服务 { "command": ... }（名字为空，要你填）。
 * 解析不了抛错，错误信息给人看
 */
export function parseMcpJson(text: string): { name: string; config: McpTransport }[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("不是有效的 JSON。检查一下是不是少了括号、逗号或引号");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("没认出 MCP 服务的配置");
  const obj = raw as Record<string, unknown>;
  const single = toTransport(obj);
  if (single && (typeof obj.command === "string" || typeof obj.url === "string")) return [{ name: "", config: single }];
  const map = (obj.mcpServers ?? obj.servers ?? obj) as Record<string, unknown>;
  if (!map || typeof map !== "object") throw new Error("没认出 MCP 服务的配置");
  const out: { name: string; config: McpTransport }[] = [];
  for (const [name, v] of Object.entries(map)) {
    const t = toTransport(v);
    if (t) out.push({ name, config: t });
  }
  if (out.length === 0) throw new Error("没认出 MCP 服务的配置：每个服务要有 command（本机命令）或 url（远程网址）");
  return out;
}

/** 服务名：Claude Code 允许的字符（字母、数字、- 和 _） */
export function validMcpName(name: string): string | null {
  if (!name.trim()) return "写一个名字";
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return "名字只能用英文字母、数字、- 和 _";
  if (name === "branchwork" || name === "browser") return "这个名字 Lanes 自己在用，换一个";
  return null;
}

/** 认出是 Chrome DevTools MCP：由内置的浏览器代替 */
export function isChromeDevtoolsMcp(t: McpTransport): boolean {
  return t.type === "stdio" && [t.command, ...(t.args ?? [])].some((a) => /chrome-devtools-mcp/i.test(a));
}

/** MCP 工具名 mcp__服务__工具 → [服务, 工具]；不是 MCP 工具返回 null */
export function splitMcpTool(name: string): [string, string] | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? [m[1]!, m[2]!] : null;
}

/** 内置浏览器在 Claude 那里的服务名：工具叫 mcp__browser__click 这样 */
export const BROWSER_SERVER = "browser";
