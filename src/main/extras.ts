import { createHash } from "node:crypto";
import path from "node:path";
import { createBrowserHub, findChrome } from "../browser";
import type { ClaudeClient, McpRun } from "../claude";
import type { Core, CoreExtras } from "../core";
import type { Db } from "../db";
import { createMcpConfig, expandEnv } from "../mcp";
import { BROWSER_SERVER, type BrowserSettings, type BwEvent, type McpOverview, type McpScope, type McpServerInput, type McpServerState, type McpToolPolicy, type McpTransport, type Project, type Route } from "../shared";

const DEFAULT_BROWSER: BrowserSettings = { enabled: true, chromePath: "", localOnly: false, attachState: true, stopShots: true };

/** 上传本机文件会读你电脑上的文件：即使浏览器工具都直接放行，这个也要问（设计稿 9-12“批准”） */
const BROWSER_ASK = [`mcp__${BROWSER_SERVER}__upload_file`];

/**
 * MCP 服务（设计稿 9-13）和内置浏览器（9-12）接到 core 和界面上。
 * core 只认识 CoreExtras；界面的那些操作（设置页、浏览器条）从 ipc 直接调这里
 */
export function createExtras(db: Db, claude: ClaudeClient, home: string) {
  const mcp = createMcpConfig(db.settings);
  const listeners = new Set<(e: BwEvent) => void>();
  const emit = (e: BwEvent) => {
    for (const l of listeners) l(e);
  };

  const browserSettings = (): BrowserSettings => {
    try {
      return { ...DEFAULT_BROWSER, ...(JSON.parse(db.settings.get("browser.settings") ?? "{}") as Partial<BrowserSettings>) };
    } catch {
      return DEFAULT_BROWSER;
    }
  };

  const hub = createBrowserHub({
    profileDir: path.join(home, "browser-profile"),
    chromePath: () => browserSettings().chromePath,
    onState: (state) => emit({ type: "browser.state", state }),
    log: (s) => console.error("[browser]", s),
  });

  /** 最近一次检查的结果：按项目的 Local 文件夹存（重启后还用得上：只读的工具默认直接放行） */
  const states = (dir: string): Record<string, McpServerState> => {
    try {
      return JSON.parse(db.settings.get(`mcp.states:${dir}`) ?? "{}") as Record<string, McpServerState>;
    } catch {
      return {};
    }
  };

  const projectOf = (core: Core, projectId: string): Project => {
    const p = core.listProjects().find((x) => x.id === projectId);
    if (!p) throw new Error("找不到这个项目");
    return p;
  };

  const browserOn = (route: Route) => {
    const b = browserSettings();
    return b.enabled && (!b.localOnly || !!route.local) && !mcp.routeOff(route.id).includes(BROWSER_SERVER);
  };

  const coreExtras: CoreExtras = {
    mcpFor(route, project): McpRun | undefined {
      const off = mcp.routeOff(route.id);
      const servers: Record<string, McpTransport> = {};
      for (const s of mcp.active(project.localDir, off)) servers[s.name] = expandEnv(s.config);
      if (browserOn(route)) {
        const t = hub.mcpServer(route.id, route.worktreePath);
        if (t) servers[BROWSER_SERVER] = t;
      }
      if (Object.keys(servers).length === 0) return undefined;
      // 批准方式：你设过的为准；没设过的，服务自己标了只读的直接放行
      const policy: Record<string, McpToolPolicy> = {};
      const known = states(project.localDir);
      for (const [name, st] of Object.entries(known)) for (const t of st.tools ?? []) if (t.readOnly && servers[name]) policy[`mcp__${name}__${t.name}`] = "allow";
      for (const [server, tools] of Object.entries(mcp.policies())) for (const [tool, p] of Object.entries(tools)) if (servers[server]) policy[`mcp__${server}__${tool}`] = p;
      const key = createHash("sha1").update(JSON.stringify({ servers, policy })).digest("hex");
      return { servers, key, policy, autoAllow: [BROWSER_SERVER], askTools: BROWSER_ASK };
    },
    browserBrief(route) {
      if (!browserSettings().attachState || !browserOn(route) || !hub.isOpen(route.id)) return null;
      const st = hub.state(route.id);
      const lines = ["<lanes-browser>", "（这一段是 Lanes 自动附上的浏览器现状，不是用户写的。）", "这一路有自己的浏览器窗口（Lanes 专用的 Chrome），用 browser 这组工具看和操作它；列出来的页面都是这一路的。", "窗口里的页面："];
      st.pages.forEach((p, i) => lines.push(`  ${i + 1}. ${p.title || "（没有标题）"} · ${p.url}${p.active ? "（当前）" : ""}`));
      const issues = st.issues.filter((i) => i.kind !== "warning").slice(-12);
      if (issues.length) {
        lines.push("上一站以来：");
        for (const i of issues) lines.push(`  ${i.kind === "request" ? "请求失败" : "报错"} ${i.text}${i.source && i.kind !== "request" ? `  ${i.source}` : ""}`);
      }
      lines.push("</lanes-browser>");
      return lines.join("\n");
    },
    stopEnded(route) {
      hub.mark(route.id);
    },
    routeDeleted(routeId) {
      void hub.closeRoute(routeId);
      mcp.setRouteOff(routeId, []);
    },
  };

  function overview(core: Core, projectId: string): McpOverview {
    const p = projectOf(core, projectId);
    return { projectId, servers: mcp.list(p.localDir), states: states(p.localDir), policies: mcp.policies(), browser: { ...browserSettings(), found: findChrome() } };
  }

  return {
    coreExtras,
    hub,
    on(l: (e: BwEvent) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    api(core: Core) {
      return {
        mcpOverview: async (projectId: string) => overview(core, projectId),
        /** 检查这个项目在用的服务（开着的、确认过的）：启动一个不提问的 Claude 去连 */
        async mcpCheck(projectId: string, names?: string[]) {
          const p = projectOf(core, projectId);
          const list = mcp.list(p.localDir).filter((s) => !s.shadowedBy && !s.replacedByBrowser && (names ? names.includes(s.name) : s.enabled && !s.untrusted));
          const servers = Object.fromEntries(list.map((s) => [s.name, expandEnv(s.config)]));
          const checking = Object.fromEntries(list.map((s) => [s.name, { status: "checking" as const, checkedAt: Date.now() }]));
          emit({ type: "mcp.states", projectId, states: { ...states(p.localDir), ...checking } });
          let got: Record<string, McpServerState>;
          try {
            got = await claude.mcpStatus(p.localDir, servers);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            got = Object.fromEntries(list.map((s) => [s.name, { status: "failed" as const, error: `没能检查：${msg}`, checkedAt: Date.now() }]));
          }
          for (const s of list) got[s.name] ??= { status: "failed", error: "Claude 没有报告这个服务的状态", checkedAt: Date.now() };
          const all = { ...states(p.localDir), ...got };
          db.settings.set(`mcp.states:${p.localDir}`, JSON.stringify(all));
          emit({ type: "mcp.states", projectId, states: all });
          return all;
        },
        async mcpTest(projectId: string, input: McpServerInput): Promise<McpServerState> {
          const p = projectOf(core, projectId);
          const name = input.name || "test";
          try {
            const got = await claude.mcpStatus(p.localDir, { [name]: expandEnv(input.config) });
            return got[name] ?? { status: "failed", error: "Claude 没有报告这个服务的状态", checkedAt: Date.now() };
          } catch (e) {
            return { status: "failed", error: `没能检查：${e instanceof Error ? e.message : String(e)}`, checkedAt: Date.now() };
          }
        },
        async mcpSave(projectId: string, input: McpServerInput, previous?: { name: string; scope: McpScope }) {
          mcp.save(projectOf(core, projectId).localDir, input, previous);
          return overview(core, projectId);
        },
        async mcpRemove(projectId: string, name: string, scope: McpScope) {
          mcp.remove(projectOf(core, projectId).localDir, name, scope);
          return overview(core, projectId);
        },
        async mcpSetEnabled(projectId: string, name: string, enabled: boolean) {
          mcp.setEnabled(projectOf(core, projectId).localDir, name, enabled);
          return overview(core, projectId);
        },
        async mcpTrust(projectId: string, names: string[], trusted: boolean) {
          mcp.setTrusted(projectOf(core, projectId).localDir, names, trusted);
          return overview(core, projectId);
        },
        async mcpSetPolicy(server: string, tool: string, policy: McpToolPolicy | null) {
          mcp.setPolicy(server, tool, policy);
        },
        /** 这一路关掉了哪些服务（浏览器也算一个，名字是 browser） */
        routeMcp: async (routeId: string) => mcp.routeOff(routeId),
        setRouteMcp: async (routeId: string, off: string[]) => mcp.setRouteOff(routeId, off),
        browserSettings: async () => ({ ...browserSettings(), found: findChrome() }),
        async setBrowserSettings(patch: Partial<BrowserSettings>) {
          const next = { ...browserSettings(), ...patch };
          db.settings.set("browser.settings", JSON.stringify(next));
          return { ...next, found: findChrome() };
        },
        browserState: async (routeId: string) => hub.state(routeId),
        browserOpen: (routeId: string, url?: string) => hub.open(routeId, url),
        browserShow: (routeId: string) => hub.show(routeId),
        browserScreenshot: (routeId: string) => hub.screenshot(routeId),
        browserPick: (routeId: string) => hub.pick(routeId),
        browserCancelPick: async (routeId: string) => hub.cancelPick(routeId),
        browserClose: (routeId: string) => hub.closeRoute(routeId),
      };
    },
  };
}

export type Extras = ReturnType<typeof createExtras>;
