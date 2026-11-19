import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createMcpConfig, expandEnv } from "../../src/mcp";
import { parseMcpJson } from "../../src/shared";

function memStore() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), delete: (k: string) => void m.delete(k) };
}

describe("MCP 配置（设计稿 9-13）：读写 Claude Code 的文件，Lanes 自己的开关", () => {
  let home: string;
  let proj: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-home-"));
    proj = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-proj-"));
  });

  it("三种范围都读到；同名时 本地 > 项目 > 全局；chrome-devtools-mcp 标成由内置浏览器代替；.mcp.json 的要先确认", () => {
    fs.writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({
        numStartups: 3,
        mcpServers: { db: { command: "npx", args: ["pg"] }, cdt: { command: "npx", args: ["chrome-devtools-mcp@latest"] } },
        projects: { [proj]: { mcpServers: { db: { command: "local-pg" } } } },
      }),
    );
    fs.writeFileSync(path.join(proj, ".mcp.json"), JSON.stringify({ mcpServers: { docs: { type: "http", url: "https://docs.example.com/mcp" } } }));
    const cfg = createMcpConfig(memStore(), home);
    const list = cfg.list(proj);
    expect(list.map((s) => `${s.name}@${s.scope}`)).toEqual(["db@local", "docs@project", "db@user", "cdt@user"]);
    expect(list.find((s) => s.scope === "user" && s.name === "db")?.shadowedBy).toBe("local");
    expect(list.find((s) => s.name === "cdt")?.replacedByBrowser).toBe(true);
    expect(list.find((s) => s.name === "docs")?.untrusted).toBe(true);
    expect(cfg.active(proj).map((s) => s.name)).toEqual(["db"]);
    cfg.setTrusted(proj, ["docs"], true);
    expect(cfg.active(proj).map((s) => s.name)).toEqual(["db", "docs"]);
    cfg.setEnabled(proj, "db", false);
    expect(cfg.active(proj).map((s) => s.name)).toEqual(["docs"]);
    expect(cfg.active(proj, ["docs"]).map((s) => s.name)).toEqual([]);
  });

  it("改的就是原文件：存到全局、挪到本地、删掉；~/.claude.json 里别的东西不动", () => {
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ numStartups: 3, mcpServers: {} }));
    const cfg = createMcpConfig(memStore(), home);
    cfg.save(proj, { name: "linear", scope: "user", config: { type: "http", url: "https://mcp.linear.app/mcp" } });
    let cj = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));
    expect(cj.numStartups).toBe(3);
    expect(cj.mcpServers.linear).toEqual({ type: "http", url: "https://mcp.linear.app/mcp" });
    cfg.save(proj, { name: "linear", scope: "local", config: { type: "http", url: "https://mcp.linear.app/mcp" } }, { name: "linear", scope: "user" });
    cj = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));
    expect(cj.mcpServers.linear).toBeUndefined();
    expect(Object.values(cj.projects as Record<string, { mcpServers: object }>)[0]!.mcpServers).toEqual({ linear: { type: "http", url: "https://mcp.linear.app/mcp" } });
    cfg.save(proj, { name: "pg", scope: "project", config: { type: "stdio", command: "npx", args: ["pg"] } });
    expect(JSON.parse(fs.readFileSync(path.join(proj, ".mcp.json"), "utf8"))).toEqual({ mcpServers: { pg: { command: "npx", args: ["pg"] } } });
    // 自己在 Lanes 里加进 .mcp.json 的不用再确认
    expect(cfg.list(proj).find((s) => s.name === "pg")?.untrusted).toBeUndefined();
    cfg.save(proj, { name: "mine", scope: "lanes", config: { type: "stdio", command: "node", args: ["x.js"] } });
    expect(cfg.list(proj).map((s) => `${s.name}@${s.scope}`)).toEqual(["linear@local", "pg@project", "mine@lanes"]);
    cfg.remove(proj, "linear", "local");
    cfg.remove(proj, "mine", "lanes");
    expect(cfg.list(proj).map((s) => s.name)).toEqual(["pg"]);
  });

  it("${VAR} 和 ${VAR:-默认值} 用环境变量换掉", () => {
    expect(expandEnv({ type: "http", url: "${BASE:-https://x.dev}/mcp", headers: { Authorization: "Bearer ${KEY}" } }, { KEY: "k1" })).toEqual({ type: "http", url: "https://x.dev/mcp", headers: { Authorization: "Bearer k1" } });
  });

  it("粘贴 JSON：认得 mcpServers、VS Code 的 servers、单独一个服务", () => {
    expect(parseMcpJson('{"mcpServers":{"a":{"command":"npx","args":["a"]},"b":{"type":"http","url":"https://b"}}}').map((x) => x.name)).toEqual(["a", "b"]);
    expect(parseMcpJson('{"servers":{"c":{"type":"stdio","command":"c"}}}')).toEqual([{ name: "c", config: { type: "stdio", command: "c" } }]);
    expect(parseMcpJson('{"url":"https://d","type":"sse"}')).toEqual([{ name: "", config: { type: "sse", url: "https://d" } }]);
    expect(() => parseMcpJson("{oops")).toThrow(/JSON/);
  });
});
