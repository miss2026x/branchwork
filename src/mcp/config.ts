import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fromTransport, isChromeDevtoolsMcp, toTransport, type McpScope, type McpServerEntry, type McpServerInput, type McpToolPolicy, type McpTransport } from "../shared";

/** Lanes 自己存东西的地方（就是数据库的 settings 表） */
export interface McpStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

/** 只在 Lanes 里的服务 */
interface LanesServer {
  name: string;
  config: McpTransport;
  /** 只给这个项目（Local 文件夹）用；空的是全部项目 */
  projectDir?: string;
}

/** 同名时谁优先：和 Claude Code 一样 本地 > 项目 > 全局，Lanes 自己的排在后面 */
const RANK: McpScope[] = ["local", "project", "user", "lanes-project", "lanes"];

const WHERE: Record<McpScope, string> = { local: "~/.claude.json（这个项目）", project: ".mcp.json", user: "~/.claude.json（全局）", "lanes-project": "Lanes（这个项目）", lanes: "Lanes（全部项目）" };

/**
 * 读写 Claude Code 的 MCP 配置（~/.claude.json、项目的 .mcp.json）和 Lanes 自己的。
 * home：放 .claude.json 的目录（测试里换掉）
 */
export function createMcpConfig(store: McpStore, home = os.homedir()) {
  const claudeJson = () => path.join(home, ".claude.json");
  const mcpJson = (projectDir: string) => path.join(projectDir, ".mcp.json");

  /** 读 JSON 文件：按修改时间缓存（~/.claude.json 可能好几 MB，Claude Code 又常写它） */
  const cache = new Map<string, { mtime: number; size: number; data: Record<string, unknown> | null }>();
  function readJson(file: string): Record<string, unknown> | null {
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      cache.delete(file);
      return null;
    }
    const hit = cache.get(file);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.data;
    let data: Record<string, unknown> | null = null;
    try {
      const v = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      data = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      data = null; // 写坏了的文件当作没有，不去碰它
    }
    cache.set(file, { mtime: st.mtimeMs, size: st.size, data });
    return data;
  }

  /** 改一个 JSON 文件：读、改、写到临时文件再换过去（Claude Code 也在写 ~/.claude.json，窗口越短越好） */
  function editJson(file: string, edit: (data: Record<string, unknown>) => void): void {
    let data: Record<string, unknown> = {};
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, "utf8");
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error(`${file} 不是有效的 JSON，没敢改它。修好之后再试`);
      }
    }
    edit(data);
    const tmp = `${file}.lanes-${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, file);
    cache.delete(file);
  }

  /** ~/.claude.json 里这个项目的那一节用的是哪个键（Windows 上可能是正斜杠、大小写不同） */
  function projectKey(data: Record<string, unknown> | null, projectDir: string): string | null {
    const projects = data?.projects;
    if (!projects || typeof projects !== "object") return null;
    const norm = (p: string) => {
      const r = path.resolve(p).replace(/\\/g, "/").replace(/\/+$/, "");
      return process.platform === "win32" || process.platform === "darwin" ? r.toLowerCase() : r;
    };
    const want = norm(projectDir);
    return Object.keys(projects).find((k) => norm(k) === want) ?? null;
  }

  const servers = (v: unknown): [string, McpTransport][] => {
    if (!v || typeof v !== "object") return [];
    return Object.entries(v as Record<string, unknown>).flatMap(([name, raw]) => {
      const t = toTransport(raw);
      return t ? [[name, t] as [string, McpTransport]] : [];
    });
  };

  const lanesServers = (): LanesServer[] => {
    try {
      return JSON.parse(store.get("mcp.lanes") ?? "[]") as LanesServer[];
    } catch {
      return [];
    }
  };
  const listKey = (key: string): string[] => {
    try {
      const v = JSON.parse(store.get(key) ?? "[]") as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  const sameDir = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

  /** 这个项目能看到的全部服务（同名的都列出来，被盖住的标出来） */
  function list(projectDir: string): McpServerEntry[] {
    const cj = readJson(claudeJson());
    const key = projectKey(cj, projectDir);
    const raw: { name: string; scope: McpScope; config: McpTransport }[] = [];
    if (key) for (const [name, config] of servers((cj!.projects as Record<string, Record<string, unknown>>)[key]?.mcpServers)) raw.push({ name, scope: "local", config });
    for (const [name, config] of servers(readJson(mcpJson(projectDir))?.mcpServers)) raw.push({ name, scope: "project", config });
    for (const [name, config] of servers(cj?.mcpServers)) raw.push({ name, scope: "user", config });
    for (const s of lanesServers()) {
      if (s.projectDir && !sameDir(s.projectDir, projectDir)) continue;
      raw.push({ name: s.name, scope: s.projectDir ? "lanes-project" : "lanes", config: s.config });
    }
    raw.sort((a, b) => RANK.indexOf(a.scope) - RANK.indexOf(b.scope));
    const off = new Set(listKey(`mcp.off:${projectDir}`));
    const trusted = new Set(listKey(`mcp.trusted:${projectDir}`));
    const first = new Map<string, McpScope>();
    return raw.map((r): McpServerEntry => {
      const winner = first.get(r.name);
      if (!winner) first.set(r.name, r.scope);
      return {
        ...r,
        where: WHERE[r.scope],
        enabled: !off.has(r.name),
        ...(winner ? { shadowedBy: winner } : {}),
        ...(isChromeDevtoolsMcp(r.config) ? { replacedByBrowser: true } : {}),
        ...(r.scope === "project" && !trusted.has(r.name) ? { untrusted: true } : {}),
      };
    });
  }

  /** 真正交给 Claude 的服务：开着的、没被盖住、不是 chrome-devtools-mcp、确认过的 */
  function active(projectDir: string, routeOff: string[] = []): { name: string; config: McpTransport }[] {
    const off = new Set(routeOff);
    return list(projectDir)
      .filter((s) => s.enabled && !s.shadowedBy && !s.replacedByBrowser && !s.untrusted && !off.has(s.name))
      .map((s) => ({ name: s.name, config: s.config }));
  }

  /** 从某个位置删掉一个服务 */
  function removeAt(projectDir: string, name: string, scope: McpScope): void {
    if (scope === "user") editJson(claudeJson(), (d) => void delete (d.mcpServers as Record<string, unknown> | undefined)?.[name]);
    else if (scope === "local")
      editJson(claudeJson(), (d) => {
        const key = projectKey(d, projectDir);
        if (key) delete ((d.projects as Record<string, Record<string, unknown>>)[key]!.mcpServers as Record<string, unknown> | undefined)?.[name];
      });
    else if (scope === "project") {
      if (fs.existsSync(mcpJson(projectDir))) editJson(mcpJson(projectDir), (d) => void delete (d.mcpServers as Record<string, unknown> | undefined)?.[name]);
    } else {
      const keep = lanesServers().filter((s) => !(s.name === name && (scope === "lanes" ? !s.projectDir : s.projectDir && sameDir(s.projectDir, projectDir))));
      store.set("mcp.lanes", JSON.stringify(keep));
    }
  }

  /** 存一个服务；previous：改的是哪一条（换了名字或位置时，原来那条删掉） */
  function save(projectDir: string, input: McpServerInput, previous?: { name: string; scope: McpScope }): void {
    const value = fromTransport(input.config);
    const { name, scope } = input;
    if (previous && (previous.name !== name || previous.scope !== scope)) removeAt(projectDir, previous.name, previous.scope);
    if (scope === "user")
      editJson(claudeJson(), (d) => {
        d.mcpServers = { ...((d.mcpServers as Record<string, unknown>) ?? {}), [name]: value };
      });
    else if (scope === "local")
      editJson(claudeJson(), (d) => {
        const projects = ((d.projects as Record<string, Record<string, unknown>>) ??= {});
        // 没有这个项目的那一节就照 Claude Code 的写法新开一节（Windows 上它用正斜杠）
        const key = projectKey(d, projectDir) ?? (process.platform === "win32" ? path.resolve(projectDir).replace(/\\/g, "/") : path.resolve(projectDir));
        const p = (projects[key] ??= {});
        p.mcpServers = { ...((p.mcpServers as Record<string, unknown>) ?? {}), [name]: value };
      });
    else if (scope === "project")
      editJson(mcpJson(projectDir), (d) => {
        d.mcpServers = { ...((d.mcpServers as Record<string, unknown>) ?? {}), [name]: value };
      });
    else {
      const list = lanesServers().filter((s) => !(s.name === name && (scope === "lanes" ? !s.projectDir : s.projectDir && sameDir(s.projectDir, projectDir))));
      list.push({ name, config: input.config, ...(scope === "lanes-project" ? { projectDir: path.resolve(projectDir) } : {}) });
      store.set("mcp.lanes", JSON.stringify(list));
    }
    // 自己在 Lanes 里加进 .mcp.json 的，不用再确认
    if (scope === "project") setTrusted(projectDir, [name], true);
  }

  function setEnabled(projectDir: string, name: string, enabled: boolean): void {
    const off = new Set(listKey(`mcp.off:${projectDir}`));
    if (enabled) off.delete(name);
    else off.add(name);
    store.set(`mcp.off:${projectDir}`, JSON.stringify([...off]));
  }

  function setTrusted(projectDir: string, names: string[], trusted: boolean): void {
    const set = new Set(listKey(`mcp.trusted:${projectDir}`));
    for (const n of names) (trusted ? set.add(n) : set.delete(n));
    store.set(`mcp.trusted:${projectDir}`, JSON.stringify([...set]));
  }

  function policies(): Record<string, Record<string, McpToolPolicy>> {
    try {
      return JSON.parse(store.get("mcp.policies") ?? "{}") as Record<string, Record<string, McpToolPolicy>>;
    } catch {
      return {};
    }
  }
  function setPolicy(server: string, tool: string, policy: McpToolPolicy | null): void {
    const all = policies();
    const p = { ...(all[server] ?? {}) };
    if (policy) p[tool] = policy;
    else delete p[tool];
    all[server] = p;
    store.set("mcp.policies", JSON.stringify(all));
  }

  const routeOff = (routeId: string) => listKey(`mcp.route:${routeId}`);
  const setRouteOff = (routeId: string, names: string[]) => (names.length ? store.set(`mcp.route:${routeId}`, JSON.stringify(names)) : store.delete(`mcp.route:${routeId}`));

  return { list, active, save, remove: removeAt, setEnabled, setTrusted, policies, setPolicy, routeOff, setRouteOff };
}

export type McpConfig = ReturnType<typeof createMcpConfig>;

/** 配置里的 ${VAR}、${VAR:-默认值}：用环境变量换掉（Claude Code 读 .mcp.json 时也这样做） */
export function expandEnv(t: McpTransport, env: NodeJS.ProcessEnv = process.env): McpTransport {
  const x = (s: string) => s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (m, k: string, def?: string) => env[k] ?? def ?? m);
  const map = (o?: Record<string, string>) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, x(v)])) : undefined);
  if (t.type === "stdio") return { type: "stdio", command: x(t.command), ...(t.args ? { args: t.args.map(x) } : {}), ...(t.env ? { env: map(t.env)! } : {}) };
  return { type: t.type, url: x(t.url), ...(t.headers ? { headers: map(t.headers)! } : {}) };
}
