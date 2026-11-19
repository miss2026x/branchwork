import type { BrowserSettings, BrowserState, BwApi, BwEvent, BwListener, ChatItem, ClaudeOptions, Effort, ImportProgress, LocalPreset, McpOverview, McpServerEntry, McpServerState, Project, PromptImage, ToolResult, QueueItem, Route, Stop, StopContent, SyncLogEntry, Terminal } from "../../shared";

/**
 * 假的后端：只在普通浏览器里打开界面时用（没有 Electron 主进程）。
 * 数据都在内存里，回答是编出来的。用来调界面和截图，不参与正式运行。
 *
 * 地址栏参数：?empty 从空白开始；?live 打开后自动问一站；?slow 把各阶段拖长（看状态显示）；
 * ?browser 第一路开着浏览器、对话里有浏览器操作（设计稿 9-12）
 */
export function installMockBw(): void {
  const q = new URLSearchParams(location.search);
  const slow = q.has("slow") ? 6 : 1;
  const listeners = new Set<BwListener>();
  const emit = (e: BwEvent) => listeners.forEach((l) => l(e));
  const importCancelled = new Set<string>();
  /** 演示建工作区的几步（设计稿 4-8 的做法），各磨蹭一会儿 */
  const preparing = async (projectId: string, first: string[] = []) => {
    for (const step of [...first, "记下 Local 现在的样子", "检出文件", "带上 Local 没提交的改动"]) {
      emit({ type: "route.preparing", projectId, step });
      await new Promise((r) => setTimeout(r, 700));
    }
    emit({ type: "route.preparing", projectId, step: null });
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms * slow));
  let n = 0;
  const id = (p: string) => `${p}${++n}`;

  const projects: Project[] = [];
  const routes = new Map<string, Route>();
  const stops = new Map<string, Stop>();
  const content = new Map<string, ChatItem[]>();
  const logs = new Map<string, SyncLogEntry[]>();
  const aborts = new Map<string, () => void>();
  let queue: QueueItem[] = [];
  const presets = new Map<string, LocalPreset[]>();
  const permissions = new Map<string, (d: string) => void>();

  // 和真的 Claude Code（2026-11）报的一样：常用的别名在前，后面是具体型号
  const ALL: Effort[] = ["low", "medium", "high", "xhigh", "max"];
  const MOCK_OPTIONS: ClaudeOptions = {
    models: [
      { value: "default", resolved: "claude-opus-5-5", label: "Default (recommended)", description: "Opus 5.5 · Best for everyday, complex tasks", efforts: ALL, autoMode: true },
      { value: "opus", resolved: "claude-opus-5-5", label: "Opus 5.5", description: "Best for everyday, complex tasks", efforts: ALL, autoMode: true },
      { value: "sonnet", resolved: "claude-sonnet-5-5", label: "Sonnet 5.5", description: "Efficient for routine tasks", efforts: ALL, autoMode: true },
      { value: "fable", resolved: "claude-fable-5-2", label: "Fable 5.2", description: "Most capable for your hardest and longest-running tasks", efforts: ALL, autoMode: true },
      { value: "haiku", resolved: "claude-haiku-5-5", label: "Haiku 5.5", description: "Fastest for quick answers", efforts: ALL, autoMode: true },
      { value: "claude-fable-5-1", label: "Fable 5.1", description: "Most capable for your hardest and longest-running tasks", efforts: ALL, autoMode: true },
      { value: "claude-sonnet-5", label: "Sonnet 5", description: "Efficient for routine tasks", efforts: ALL, autoMode: true },
      { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5", description: "Fastest for quick answers", efforts: [], autoMode: false },
    ],
    modes: ["ask", "edits", "auto", "plan", "dontAsk", "all"],
  };
  const addRoute = (projectId: string, name: string, extra: Partial<Route> = {}): Route => {
    const number = [...routes.values()].filter((r) => r.projectId === projectId && !r.local).length + 1;
    const r: Route = { id: id("r"), projectId, number, express: null, name, status: "idle", sessionId: null, worktreePath: `/worktrees/${projectId}/${number}`, parentRouteId: null, forkStopId: null, model: null, effort: null, permissionMode: projects.find((p) => p.id === projectId)?.permissionMode ?? "ask", color: null, contextTokens: null, pinned: false, folded: false, orphanOf: null, createdAt: Date.now(), archivedAt: null, ...extra };
    routes.set(r.id, r);
    return r;
  };
  const addStop = (routeId: string, name: string, prompt: string, answer: ChatItem[], extra: Partial<Stop> = {}): Stop => {
    const seq = [...stops.values()].filter((s) => s.routeId === routeId).length + 1;
    const s: Stop = { id: id("s"), routeId, seq, kind: "normal", name, nameState: "final", prompt, status: "done", syncState: "synced", messageId: "m", lastMessageId: "m", error: null, startedAt: Date.now(), endedAt: Date.now(), ...extra };
    stops.set(s.id, s);
    content.set(s.id, answer);
    return s;
  };

  if (!q.has("empty")) {
    const p: Project = { id: "p1", name: "auth-service", localDir: "D:/work/auth-service", permissionMode: "ask", createdAt: 1 };
    projects.push(p, { id: "p2", name: "web-console", localDir: "D:/work/web-console", permissionMode: "ask", createdAt: 2 });
    const r1 = addRoute(p.id, "登录重构");
    addStop(r1.id, "梳理认证结构", "先帮我梳理一下现在的认证代码结构，不要改代码。", [
      { kind: "tool", tool: "Glob", detail: "src/auth/**/*.ts" },
      { kind: "tool", tool: "Read", detail: "src/auth/session.ts" },
      { kind: "text", text: "认证相关的代码分三层：\n\n1. **路由层** `src/auth/routes.ts`：登录、登出、回调三个入口。\n2. **会话层** `src/auth/session.ts`：读写 cookie，校验签名。\n3. **存储层** `src/auth/store.ts`：把会话存进 Redis。\n\n会话读写和路由耦合得比较紧，`routes.ts` 里直接操作了 cookie。" },
    ]);
    addStop(r1.id, "定位会话读写", "会话读写具体在哪几处？", [{ kind: "text", text: "一共 4 处，都在 `routes.ts`：\n\n| 位置 | 做什么 |\n| --- | --- |\n| `login()` 第 42 行 | 写入会话 |\n| `logout()` 第 77 行 | 清除会话 |\n| `callback()` 第 103 行 | 写入会话 |\n| `refresh()` 第 131 行 | 读取后重写 |" }]);
    const fork = addStop(r1.id, "设计登录接口", "设计一个统一的登录接口，把这 4 处收拢。", [
      { kind: "tool", tool: "Edit", detail: "src/auth/session.ts" },
      { kind: "tool", tool: "Write", detail: "src/auth/login-flow.ts" },
      { kind: "text", text: "新增了 `LoginFlow`，对外只有三个方法：\n\n```ts\ninterface LoginFlow {\n  begin(provider: string): Promise<Redirect>;\n  complete(callback: CallbackParams): Promise<Session>;\n  end(sessionId: string): Promise<void>;\n}\n```\n\n`routes.ts` 里的 4 处已经改成调用它。" },
    ]);
    const r2 = addRoute(p.id, "GitHub 登录", { parentRouteId: r1.id, forkStopId: fork.id, sessionId: "s2" });
    addStop(r2.id, "改授权码流程", "接入 GitHub 登录，先改授权码流程。", [{ kind: "tool", tool: "Edit", detail: "src/auth/login-flow.ts" }, { kind: "text", text: "授权码流程已改成可插拔的 provider。" }]);
    addStop(r2.id, "接入 GitHub", "加上 GitHub 这个 provider。", [{ kind: "tool", tool: "Write", detail: "src/auth/providers/github.ts" }, { kind: "tool", tool: "Bash", detail: "npm test -- auth" }, { kind: "text", text: "加好了，`npm test -- auth` 通过（18 个用例）。" }]);
    const r3 = addRoute(p.id, "Cookie 方案", { parentRouteId: r1.id, forkStopId: fork.id, status: "conflict" });
    addStop(r3.id, "改 Cookie 结构", "把 cookie 改成只存会话 ID。", [{ kind: "text", text: "已改。" }]);
    addStop(r3.id, "写回 session", "把剩下的字段写回 session。", [{ kind: "tool", tool: "Edit", detail: "src/auth/session.ts" }, { kind: "text", text: "写好了。" }], { syncState: "conflict" });
    logs.set(r3.id, [{ id: "y1", routeId: r3.id, stopId: null, direction: "push", status: "conflict", files: [{ path: "src/auth/session.ts", note: "both-modified", lines: [42, 58], by: { routeId: r1.id, stopId: fork.id } }], message: null, at: Date.now() }]);
    const r4 = addRoute(p.id, "修复 CI 缓存", { status: "interrupted" });
    // ?many：路多到顶部标签放不下（设计稿 9-11）
    if (q.has("many")) for (const [name, status] of [["升级依赖", "awaiting_permission"], ["首页性能", "answering"], ["日志格式", "idle"], ["埋点", "idle"], ["暗色模式", "idle"]] as const) addRoute(p.id, name, { status });
    addStop(r4.id, "看 CI 配置", "CI 的缓存为什么总是不命中？", [{ kind: "text", text: "缓存的 key 里带了提交号，所以每次都" }], { status: "interrupted", syncState: "unsynced", error: "已停车" });
    addRoute("p2", "首页改版");
    // 最近一次对话的时间（设计稿 9-14）：1路 两小时前，2路 3 分钟前答完（还没看），3路 昨天，4路 更早
    const ago = (routeId: string, minutes: number) => {
      const list = [...stops.values()].filter((x) => x.routeId === routeId).sort((x, y) => y.seq - x.seq);
      list.forEach((x, i) => stops.set(x.id, { ...x, startedAt: Date.now() - (minutes + i * 7 + 2) * 60_000, endedAt: x.endedAt === null ? null : Date.now() - (minutes + i * 7) * 60_000 }));
    };
    ago(r1.id, 120);
    ago(r2.id, 3);
    ago(r3.id, 26 * 60);
    ago(r4.id, 9 * 24 * 60);
    // 演示用：只当 10 分钟前看过一遍，2路 那一站就是“答完了还没看”
    try {
      localStorage.setItem("lanes.seen", JSON.stringify({ since: Date.now() - 10 * 60_000, at: {} }));
    } catch {
      // 不要紧
    }
    queue = [
      { id: "w1", projectId: p.id, text: "把错误码映射成用户能看懂的提示", routeId: r2.id, mode: "auto", createdAt: 1 },
      { id: "w2", projectId: p.id, text: "README 补上 GitHub 环境变量说明", routeId: r2.id, mode: "manual", createdAt: 2 },
      { id: "w3", projectId: p.id, text: "登录失败要不要加限流？", routeId: null, mode: "unassigned", createdAt: Date.now() - 2 * 86_400_000 },
      { id: "w4", projectId: p.id, text: "CI 缓存老是失效，每次都重新装依赖", routeId: null, mode: "unassigned", createdAt: Date.now() - 3 * 3_600_000 },
      { id: "w5", projectId: p.id, text: "日志里这串请求 ID 对不上：req_7f3a9c0e1b2d4f6a8c0e1b2d4f6a8c0e1b2d4f6a8c0e1b2d4f6a8c0e1b2d，查一下是哪一层把它截断了，顺便看看网关和服务之间的透传逻辑", routeId: null, mode: "unassigned", createdAt: Date.now() - 25 * 60_000 },
    ];
  }

  const setRoute = (routeId: string, patch: Partial<Route>) => {
    const r = { ...routes.get(routeId)!, ...patch };
    routes.set(routeId, r);
    emit({ type: "route.updated", route: r });
    return r;
  };
  const setStop = (stopId: string, patch: Partial<Stop>) => {
    const s = { ...stops.get(stopId)!, ...patch };
    stops.set(stopId, s);
    emit({ type: "stop.updated", stop: s });
    return s;
  };

  /** 站和候车问题带的图片 */
  const images = new Map<string, PromptImage[]>();
  async function run(routeId: string, text: string, pics: PromptImage[] = []) {
    let stopped = false;
    aborts.set(routeId, () => (stopped = true));
    setRoute(routeId, { status: "answering" });
    await wait(700); // 站前同步
    if (text.includes("冲突") && text !== "解决同步冲突") {
      const entry: SyncLogEntry = { id: id("y"), routeId, stopId: null, direction: "pull", status: "conflict", files: [{ path: "src/auth/session.ts", note: "both-modified" }], message: null, at: Date.now() };
      logs.set(routeId, [entry]);
      emit({ type: "sync.result", entry });
      setRoute(routeId, { status: "conflict" });
      return;
    }
    const stop = addStop(routeId, Array.from(text.replace(/\[图 \d+\]/g, "")).slice(0, 6).join("") || "看图", text, [], { status: "answering", syncState: "none", nameState: "temp", endedAt: null, images: pics.length });
    if (pics.length) images.set(stop.id, pics);
    emit({ type: "stop.created", stop });
    const items: ChatItem[] = [];
    const finish = (patch: Partial<Stop>, route: Partial<Route>) => {
      content.set(stop.id, items);
      setStop(stop.id, { endedAt: Date.now(), ...patch });
      setRoute(routeId, route);
      aborts.delete(routeId);
    };
    const halted = () => finish({ status: "interrupted", syncState: "unsynced", error: "已停车" }, { status: "interrupted" });

    await wait(1200); // 启动 Claude
    if (stopped) return halted();
    emit({ type: "stop.started", routeId, stopId: stop.id });
    await wait(500);

    const say = async (t: string) => {
      for (const ch of t.match(/[\s\S]{1,3}/g) ?? []) {
        if (stopped) return;
        const last = items.at(-1);
        if (last?.kind === "text") last.text += ch;
        else items.push({ kind: "text", text: ch });
        emit({ type: "stop.delta", routeId, stopId: stop.id, text: ch });
        await wait(24);
      }
    };
    const tool = async (name: string, detail: string) => {
      if (stopped) return;
      items.push({ kind: "tool", tool: name, detail });
      emit({ type: "stop.tool", routeId, stopId: stop.id, tool: name, input: {}, detail });
      await wait(450);
    };

    await say("在回调里加 state 比对。失败时清掉临时 cookie，跳回登录页并带上错误码。我先改路由，再跑一遍测试。\n\n");
    await tool("Edit", "src/auth/routes.ts");
    if (!stopped && text.includes("批准") && routes.get(routeId)!.permissionMode !== "all") {
      const requestId = id("q");
      setRoute(routeId, { status: "awaiting_permission" });
      emit({ type: "permission.request", requestId, routeId, stopId: stop.id, tool: "Bash", input: { command: "npm test -- auth", description: "跑一遍 auth 相关的测试，会在本机起一个测试数据库" }, canRemember: true });
      const decision = await new Promise<string>((r) => permissions.set(requestId, r));
      if (!stopped) setRoute(routeId, { status: "answering" });
      if (decision === "deny") await say("你没有批准运行测试，我就不跑了。\n\n");
      else await tool("Bash", "npm test -- auth");
    } else {
      await tool("Bash", "npm test -- auth");
    }
    await say("改好了：\n\n- `callback()` 里先比对 `state`，不一致直接返回 `400`\n- 失败时清掉 `oauth_tmp` 这个 cookie\n- 跳回 `/login?error=state_mismatch`\n\n测试 18 个全部通过。");
    if (stopped) return halted();
    emit({ type: "stop.answered", routeId, stopId: stop.id });
    await wait(400);
    setStop(stop.id, { status: "done", endedAt: Date.now() });
    content.set(stop.id, items);
    await wait(900); // 站后同步
    const entry: SyncLogEntry = { id: id("y"), routeId, stopId: stop.id, direction: "push", status: "ok", files: [{ path: "src/auth/routes.ts", note: "modified" }], message: null, at: Date.now() };
    logs.set(routeId, [entry]);
    emit({ type: "sync.result", entry });
    setStop(stop.id, { syncState: "synced" });
    setRoute(routeId, { status: "idle", sessionId: "mock" });
    aborts.delete(routeId);
  }

  const emitQueue = (projectId: string) => emit({ type: "queue.updated", projectId, items: queue.filter((x) => x.projectId === projectId) });
  /** 这一路空着的话，发出派给它的下一个自动登车的问题 */
  const autoBoard = (routeId: string) => {
    if (routes.get(routeId)?.status !== "idle") return;
    const next = queue.find((x) => x.routeId === routeId && x.mode === "auto");
    if (!next) return;
    queue = queue.filter((x) => x.id !== next.id);
    emitQueue(next.projectId);
    void run(routeId, next.text, images.get(next.id)).then(() => autoBoard(routeId));
  };

  // 上下文用量的假数据
  [...routes.values()].forEach((r, i) => stops.size && (r.contextTokens = [6200, 21400, 12800, 3100, 4800][i % 5]!));
  // 后台终端的假数据：GitHub 登录这一路开着一个开发服务器，还有一个已经退出的测试
  const terminals: Terminal[] = [];
  // Local 专车里开着一个前后端一起起的开发服务器：项目名旁边写出两个端口（设计稿 9-14）
  if (projects.some((x) => x.id === "p1")) {
    const p1 = projects.find((x) => x.id === "p1")!;
    const local: Route = { ...addRoute("p1", "Local 专车"), number: 0, local: true, worktreePath: p1.localDir };
    routes.set(local.id, local);
    terminals.push({ id: "t0", projectId: "p1", routeId: local.id, stopId: null, name: "开发服务器", command: "pnpm dev", cwd: p1.localDir, status: "running", exitCode: null, port: 3000, ports: [5176, 3000], startedAt: Date.now() - 50 * 60_000, endedAt: null });
  }
  const withTerminals = [...routes.values()].find((x) => x.name === "GitHub 登录");
  if (withTerminals) {
    const stopId = [...stops.values()].find((x) => x.routeId === withTerminals.id)?.id ?? null;
    const base = { projectId: withTerminals.projectId, routeId: withTerminals.id, stopId, cwd: withTerminals.worktreePath };
    terminals.push(
      { ...base, id: "t1", name: "开发服务器", command: "npm run dev", status: "running", exitCode: null, port: 5173, ports: [5173, 3000], startedAt: Date.now() - 18 * 60_000, endedAt: null },
      { ...base, id: "t2", name: "测试（监听）", command: "npm test -- --watch", status: "exited", exitCode: 1, port: null, ports: [], startedAt: Date.now() - 40 * 60_000, endedAt: Date.now() - 31 * 60_000 },
    );
  }

  // ── 浏览器、MCP 的假数据（设计稿 9-12、9-13） ──
  /** 一张画出来的“登录页”截图 */
  const fakeShot = (): PromptImage => {
    const c = document.createElement("canvas");
    c.width = 760;
    c.height = 470;
    const g = c.getContext("2d")!;
    g.fillStyle = "#F6F8FA";
    g.fillRect(0, 0, 760, 470);
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 760, 52);
    g.fillStyle = "#E06C1F";
    g.fillRect(24, 19, 14, 14);
    g.fillStyle = "#161B22";
    g.font = "bold 15px sans-serif";
    g.fillText("auth-service", 46, 31);
    g.fillStyle = "#fff";
    g.fillRect(210, 92, 340, 300);
    g.fillStyle = "#161B22";
    g.font = "bold 20px sans-serif";
    g.fillText("登录", 230, 135);
    g.strokeStyle = "#DDE2E8";
    g.strokeRect(230, 154, 300, 40);
    g.strokeRect(230, 208, 300, 40);
    g.fillStyle = "#2563C9";
    g.fillRect(230, 266, 300, 44);
    g.fillStyle = "#fff";
    g.font = "bold 14px sans-serif";
    g.fillText("登录", 366, 293);
    return { type: "image/png", data: c.toDataURL("image/png").split(",")[1]!, name: "截图", width: 760, height: 470 };
  };
  const browserStates = new Map<string, BrowserState>();
  const closedBrowser = (routeId: string): BrowserState => ({ routeId, open: false, url: "", title: "", pages: [], issues: [], picking: false, lastUrl: null, error: null });
  const openBrowser = (routeId: string, url = "http://localhost:5174/login"): BrowserState => {
    const st: BrowserState = { ...closedBrowser(routeId), open: true, url, title: "登录 · auth-service", pages: [{ url, title: "登录 · auth-service", active: true }] };
    browserStates.set(routeId, st);
    emit({ type: "browser.state", state: st });
    return st;
  };
  let browserSettings: BrowserSettings = { enabled: true, chromePath: "", localOnly: false, attachState: true, stopShots: true };
  const mcpServers: McpServerEntry[] = [
    { name: "postgres", scope: "project", where: ".mcp.json", config: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres", "postgres://localhost/auth"] }, enabled: true },
    { name: "linear", scope: "user", where: "~/.claude.json（全局）", config: { type: "http", url: "https://mcp.linear.app/mcp" }, enabled: true },
    { name: "sentry", scope: "lanes", where: "Lanes（全部项目）", config: { type: "http", url: "https://mcp.sentry.dev/mcp" }, enabled: true },
    { name: "docs", scope: "project", where: ".mcp.json", config: { type: "http", url: "https://docs.example.com/mcp" }, enabled: true, untrusted: true },
    { name: "chrome-devtools", scope: "user", where: "~/.claude.json（全局）", config: { type: "stdio", command: "npx", args: ["chrome-devtools-mcp@latest"] }, enabled: true, replacedByBrowser: true },
  ];
  const mcpStates: Record<string, McpServerState> = {
    postgres: { status: "connected", tools: [{ name: "query", description: "运行一条只读 SQL", readOnly: true }, { name: "list_tables", description: "列出所有表", readOnly: true }, { name: "describe_table", description: "看一张表的结构", readOnly: true }], checkedAt: Date.now() },
    linear: { status: "needs-auth", checkedAt: Date.now() },
    sentry: { status: "failed", error: "HTTP 401 Unauthorized", checkedAt: Date.now() },
  };
  const mcpPolicies: McpOverview["policies"] = {};
  const overview = (projectId: string): McpOverview => ({ projectId, servers: mcpServers.map((x) => ({ ...x })), states: { ...mcpStates }, policies: mcpPolicies, browser: { ...browserSettings, found: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" } });
  const routeOff = new Map<string, string[]>();
  if (q.has("browser")) {
    const r1 = [...routes.values()][0];
    if (r1) {
      const st = openBrowser(r1.id);
      st.issues = [
        { id: "i1", kind: "error", text: "TypeError: Cannot read properties of undefined (reading 'token')", source: "auth.ts:88", at: Date.now() },
        { id: "i2", kind: "error", text: "Uncaught (in promise) 401 Unauthorized", source: "api.ts:21", at: Date.now() },
        { id: "i3", kind: "request", text: "POST /api/session → 401", source: "POST 401", at: Date.now() },
      ];
      const last = [...stops.values()].filter((x) => x.routeId === r1.id).at(-1);
      if (last) {
        const shot = fakeShot();
        const step = (tool: string, input: Record<string, unknown>, detail: string, result?: ToolResult): ChatItem => ({ kind: "tool", tool: `mcp__browser__${tool}`, detail, id: id("t"), input, ...(result ? { result } : {}) });
        content.set(last.id, [
          ...(content.get(last.id) ?? []),
          step("navigate_page", { pageId: 1, type: "url", url: "http://localhost:5174/login" }, "http://localhost:5174/login"),
          step("fill", { pageId: 1, uid: "1_4", value: "test@lanes.dev" }, ""),
          step("fill", { pageId: 1, uid: "1_6", value: "••••••" }, ""),
          step("click", { pageId: 1, uid: "1_8" }, ""),
          step("take_screenshot", { pageId: 1 }, "", { error: false, text: "Took a screenshot of the current page's viewport.", images: [shot] }),
          step("list_console_messages", { pageId: 1 }, "", { error: false, text: "## Console messages\nmsgid=1 [error] TypeError: Cannot read properties of undefined (reading 'token') (auth.ts:88)\nmsgid=2 [error] Uncaught (in promise) 401 Unauthorized (api.ts:21)", images: [] }),
          { kind: "tool", tool: "mcp__postgres__query", detail: "SELECT id, email FROM users LIMIT 3", id: id("t"), input: { sql: "SELECT id, email FROM users LIMIT 3" }, result: { error: false, text: "id | email\n1  | ada@lanes.dev\n2  | bob@lanes.dev", images: [] } },
          { kind: "text", text: "登录接口返回 401：session 里少了 token 字段，已经在 `auth.ts` 补上。" },
        ]);
      }
    }
  }

  const api: BwApi = {
    mcpOverview: async (projectId) => overview(projectId),
    async mcpCheck(projectId, names) {
      const list = names ?? mcpServers.filter((x) => x.enabled && !x.untrusted && !x.replacedByBrowser).map((x) => x.name);
      emit({ type: "mcp.states", projectId, states: { ...mcpStates, ...Object.fromEntries(list.map((n) => [n, { status: "checking" as const, checkedAt: Date.now() }])) } });
      await wait(1200);
      for (const n of list) mcpStates[n] ??= { status: "connected", tools: [{ name: "search", description: "搜索" }], checkedAt: Date.now() };
      emit({ type: "mcp.states", projectId, states: { ...mcpStates } });
      return { ...mcpStates };
    },
    async mcpTest() {
      await wait(800);
      return { status: "connected", tools: [{ name: "query", readOnly: true }, { name: "list_tables", readOnly: true }], checkedAt: Date.now() };
    },
    async mcpSave(projectId, input, previous) {
      const i = mcpServers.findIndex((x) => x.name === (previous?.name ?? input.name) && x.scope === (previous?.scope ?? input.scope));
      const where = { local: "~/.claude.json（这个项目）", project: ".mcp.json", user: "~/.claude.json（全局）", lanes: "Lanes（全部项目）", "lanes-project": "Lanes（这个项目）" }[input.scope];
      const entry: McpServerEntry = { name: input.name, scope: input.scope, where, config: input.config, enabled: true };
      if (i >= 0) mcpServers[i] = entry;
      else mcpServers.unshift(entry);
      return overview(projectId);
    },
    async mcpRemove(projectId, name, scope) {
      const i = mcpServers.findIndex((x) => x.name === name && x.scope === scope);
      if (i >= 0) mcpServers.splice(i, 1);
      return overview(projectId);
    },
    async mcpSetEnabled(projectId, name, enabled) {
      for (const x of mcpServers) if (x.name === name) x.enabled = enabled;
      return overview(projectId);
    },
    async mcpTrust(projectId, names, trusted) {
      for (const x of mcpServers) if (names.includes(x.name)) x.untrusted = !trusted;
      return overview(projectId);
    },
    async mcpSetPolicy(server, tool, policy) {
      const p = (mcpPolicies[server] ??= {});
      if (policy) p[tool] = policy;
      else delete p[tool];
    },
    routeMcp: async (routeId) => routeOff.get(routeId) ?? [],
    setRouteMcp: async (routeId, off) => void routeOff.set(routeId, off),
    browserSettings: async () => ({ ...browserSettings, found: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }),
    async setBrowserSettings(patch) {
      browserSettings = { ...browserSettings, ...patch };
      return { ...browserSettings, found: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" };
    },
    browserState: async (routeId) => browserStates.get(routeId) ?? closedBrowser(routeId),
    async browserOpen(routeId, url) {
      await wait(500);
      openBrowser(routeId, url);
    },
    browserShow: async () => {},
    async browserScreenshot() {
      return fakeShot();
    },
    async browserPick(routeId) {
      const st = browserStates.get(routeId) ?? openBrowser(routeId);
      browserStates.set(routeId, { ...st, picking: true });
      emit({ type: "browser.state", state: browserStates.get(routeId)! });
      await wait(1500);
      const done = { ...browserStates.get(routeId)!, picking: false };
      browserStates.set(routeId, done);
      emit({ type: "browser.state", state: done });
      return { label: "button「登录」", selector: "form.login > button.primary", width: 340, height: 44, x: 210, y: 270, styles: "display: block;\nmargin: 0px 0px 0px 40px;\nwidth: 100%;\nfont-size: 14px;", text: "登录", html: '<button class="primary">登录</button>', image: fakeShot(), url: st.url };
    },
    async browserCancelPick(routeId) {
      const st = browserStates.get(routeId);
      if (st) emit({ type: "browser.state", state: { ...st, picking: false } });
    },
    async browserClose(routeId) {
      const st = browserStates.get(routeId);
      const closed = { ...closedBrowser(routeId), lastUrl: st?.url ?? null };
      browserStates.set(routeId, closed);
      emit({ type: "browser.state", state: closed });
    },
    listProjects: async () => projects,
    pickDirectory: async () => `D:/work/demo-${projects.length + 1}`,
    async addProject(localDir) {
      const p: Project = { id: id("p"), name: localDir.split("/").pop()!, localDir, permissionMode: "ask", createdAt: Date.now() };
      projects.push(p);
      return p;
    },
    snapshot: async (projectId) => ({
      project: projects.find((p) => p.id === projectId)!,
      routes: [...routes.values()].filter((r) => r.projectId === projectId),
      stops: [...stops.values()].filter((s) => routes.get(s.routeId)?.projectId === projectId),
      queue: queue.filter((x) => x.projectId === projectId),
    }),
    async setRoutePermissionMode(routeId, mode) {
      const route = setRoute(routeId, { permissionMode: mode });
      const i = projects.findIndex((p) => p.id === route.projectId);
      projects[i] = { ...projects[i]!, permissionMode: mode };
      emit({ type: "project.updated", project: projects[i]! });
      if (mode === "all") for (const [k, resolve] of permissions) (permissions.delete(k), resolve("allow"));
      return route;
    },
    environment: async () => ({ claudeVersion: "2.4.1", loggedIn: true, gitVersion: "2.43.0" }),
    terminalSessions: async (dir) =>
      dir.includes("bad")
        ? []
        : [
            { id: "t1", title: "看一下 session 过期问题", questions: 4, lastModified: Date.now() - 6 * 86_400_000 },
            { id: "t2", title: "升级依赖", questions: 2, lastModified: Date.now() - 32 * 86_400_000 },
          ],
    // 演示导入的进度（设计稿 4-8）：每个会话三步，各磨蹭一会儿；不真的画出路来
    async importSessions(projectId, ids) {
      const titles: Record<string, string> = { t1: "看一下 session 过期问题", t2: "升级依赖" };
      const progress: ImportProgress = { jobId: id("i"), projectId, items: ids.map((sid) => ({ sessionId: sid, title: titles[sid] ?? sid, prompts: null, state: "waiting" as const })), finished: false };
      importCancelled.delete(progress.jobId);
      const report = () => emit({ type: "import.progress", progress: structuredClone(progress) });
      report();
      for (const item of progress.items) {
        if (importCancelled.has(progress.jobId)) break;
        for (const step of ["复制会话", "读出每一站", "建工作区"]) {
          Object.assign(item, { state: "running", step });
          report();
          await new Promise((r) => setTimeout(r, 1200));
        }
        Object.assign(item, { state: "done", step: undefined, prompts: 4 });
        report();
      }
      for (const item of progress.items) if (item.state === "waiting") item.state = "skipped";
      progress.finished = true;
      report();
      return [];
    },
    importCancel: async (jobId) => void importCancelled.add(jobId),
    droppedPath: (file) => `/Users/me/code/${file.name}`,
    inspectDirectory: async (dir) => ({ dir, name: dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir, exists: true, isRepo: !dir.includes("bad"), branch: "main", dirty: dir.includes("dirty") ? 3 : 0, hasClaudeMd: true, projectId: null }),
    projectLog: async (projectId) => {
      const rs = [...routes.values()].filter((r) => r.projectId === projectId);
      const last = (r: Route) => [...stops.values()].filter((s) => s.routeId === r.id).at(-1)?.id ?? null;
      const at = Date.now();
      return rs.flatMap((r, i): SyncLogEntry[] => [
        ...(i === 1 ? [{ id: `l${i}m`, routeId: r.id, stopId: null, direction: "local" as const, status: "ok" as const, files: [{ path: ".env.example", note: "modified" }], message: null, at: at - i * 240_000 + 60_000 }] : []),
        { id: `l${i}a`, routeId: r.id, stopId: last(r), direction: "push", status: r.status === "conflict" ? "conflict" : "ok", files: r.status === "conflict" ? [{ path: "src/auth/session.ts", note: "both-modified" }] : [{ path: "src/auth/github.ts", note: "added" }, { path: "src/auth/routes.ts", note: "modified" }], message: null, at: at - i * 240_000 },
        { id: `l${i}b`, routeId: r.id, stopId: last(r), direction: "pull", status: i % 2 ? "ok" : "noop", files: i % 2 ? [{ path: ".env.example", note: "modified" }] : [], message: null, at: at - i * 240_000 - 90_000 },
      ]);
    },
    openLocal: async () => {},
    openSystemTerminal: async () => {},
    focusWindow: async () => {},
    async truncate(routeId, stopId) {
      const target = stops.get(stopId)!;
      const gone = [...stops.values()].filter((s) => s.routeId === routeId && s.seq >= target.seq).map((s) => s.id);
      gone.forEach((id) => stops.delete(id));
      emit({ type: "stops.removed", routeId, stopIds: gone });
      return { prompt: target.prompt, images: images.get(stopId) ?? [] };
    },
    keptWorktrees: async (projectId) => (projectId === "p1" ? [{ id: "k1", projectId, path: "/Users/demo/.branchwork/worktrees/p1/r9", label: "5路 试试 Passkey", at: Date.now() - 86_400_000 }] : []),
    openKept: async () => {},
    removeKept: async () => {},
    discardChanges: async () => {},
    exportRoute: async () => null,
    renameRoute: async (routeId, name) => setRoute(routeId, { name }),
    setRouteColor: async (routeId, color) => setRoute(routeId, { color }),
    setRouteFlags: async (routeId, flags) => setRoute(routeId, flags),
    async renameStop(stopId, name) {
      setStop(stopId, { name, nameState: "manual" });
    },
    async setRouteModel(routeId, model, effort) {
      const r = routes.get(routeId)!;
      return setRoute(routeId, { model: model === "default" ? null : model, effort: effort === undefined ? r.effort : effort });
    },
    async claudeOptions(projectId) {
      // 假装第一次要读一会儿
      setTimeout(() => emit({ type: "claude-options.updated", projectId, options: MOCK_OPTIONS }), 1200);
      return null;
    },
    changes: async () => [
      { path: "src/auth/session.ts", kind: "modified", added: 42, removed: 17 },
      { path: "src/auth/providers/github.ts", kind: "added", added: 86, removed: 0 },
      { path: "src/auth/legacy-cookie.ts", kind: "deleted", added: 0, removed: 120 },
      { path: "public/logo.png", kind: "modified", added: null, removed: null },
    ],
    terminals: async (projectId) => terminals.filter((t) => t.projectId === projectId),
    terminalOutput: async (terminalId) =>
      terminalId === "t0"
        ? "> auth-service@1.4.0 dev\n> concurrently \"vite --port 5176\" \"node server.js\"\n\n[0]   VITE v7.1.0  ready in 388 ms\n[0]   ➜  Local:   http://localhost:5176/\n[1] API listening on http://localhost:3000\n"
        : terminalId === "t1"
        ? "> auth-service@1.4.0 dev\n> vite --port 5173\n\n  VITE v7.1.0  ready in 412 ms\n\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: use --host to expose\n\n10:42:07 [vite] hmr update /src/auth/login-flow.ts\n10:44:31 [vite] hmr update /src/auth/session.ts\n"
        : "> auth-service@1.4.0 test\n> vitest --watch\n\n ✓ tests/auth/session.test.ts (12)\n ✗ tests/auth/github.test.ts (3)\n   × exchanges the code for a token\n\n Test Files  1 failed | 1 passed (2)\n",
    async terminalStop(terminalId) {
      const t = terminals.find((x) => x.id === terminalId);
      if (!t) return;
      if (t.status === "running") {
        Object.assign(t, { status: "exited", exitCode: null, endedAt: Date.now() });
        emit({ type: "terminal.updated", terminal: { ...t } });
      } else {
        terminals.splice(terminals.indexOf(t), 1);
        emit({ type: "terminal.removed", terminalId, projectId: t.projectId });
      }
    },
    async createRoute(projectId, name) {
      await preparing(projectId);
      const r = addRoute(projectId, name ?? "");
      const named = { ...r, name: name ?? "新对话" };
      routes.set(r.id, named);
      return named;
    },
    images: async (ownerId) => images.get(ownerId) ?? [],
    async localRoute(projectId) {
      const found = [...routes.values()].find((r) => r.projectId === projectId && r.local);
      if (found) return found;
      const p = projects.find((x) => x.id === projectId)!;
      const r: Route = { ...addRoute(projectId, "Local 专车"), number: 0, local: true, worktreePath: p.localDir };
      routes.set(r.id, r);
      emit({ type: "route.updated", route: r });
      return r;
    },
    // 演示用的 Local 现状（设计稿 9-10）：落后远端 3 个提交，5 个文件没提交，前 3 个是 1路 带进来的
    async localStatus(projectId) {
      const rs = [...routes.values()].filter((r) => r.projectId === projectId && !r.local);
      const by = (i: number) => (rs[i] ? { routeId: rs[i]!.id, stopId: [...stops.values()].find((s) => s.routeId === rs[i]!.id)?.id ?? null } : null);
      const conflict = q.has("local-conflict");
      return {
        projectId,
        missing: false,
        branch: "main",
        upstream: "origin/main",
        ahead: 1,
        behind: 3,
        files: [
          { path: "src/auth/login-flow.ts", state: "added" as const, by: by(0) },
          { path: "src/routes.ts", state: conflict ? ("conflict" as const) : ("modified" as const), by: by(0) },
          { path: "src/auth/session.ts", state: "modified" as const, by: by(0) },
          { path: "src/auth/github.ts", state: "added" as const, by: by(1) },
          { path: "package.json", state: "modified" as const, by: by(1) },
        ],
        commands: { dev: "pnpm dev", test: "pnpm test" },
        at: Date.now(),
      };
    },
    localPresets: async (projectId) => presets.get(projectId) ?? null,
    async resetLocal(routeId) {
      const gone = [...stops.values()].filter((s) => s.routeId === routeId).map((s) => s.id);
      gone.forEach((sid) => stops.delete(sid));
      emit({ type: "stops.removed", routeId, stopIds: gone });
      return setRoute(routeId, { sessionId: null, contextTokens: null, status: "idle" });
    },
    setLocalPresets: async (projectId, list) => void (list ? presets.set(projectId, list) : presets.delete(projectId)),
    async ask(routeId, text, pics) {
      const r = routes.get(routeId)!;
      if (r.status === "answering" || r.status === "awaiting_permission") throw new Error("这一路正在回答，等它到站或先停车");
      if (r.status === "conflict" && text !== "解决同步冲突") throw new Error("这一路有同步冲突，解决后才能问下一站");
      void run(routeId, text, pics).then(() => autoBoard(routeId));
    },
    async fork(routeId, stopId, name) {
      const parent = routes.get(routeId)!;
      await preparing(parent.projectId, ["复制对话"]);
      const r = addRoute(parent.projectId, "", { parentRouteId: routeId, forkStopId: stopId, sessionId: "fork" });
      const named = { ...r, name: name?.trim() || "新对话" };
      routes.set(r.id, named);
      emit({ type: "route.updated", route: named });
      return named;
    },
    async queueAdd(projectId, text, routeId, mode, pics = []) {
      const item: QueueItem = { id: id("w"), projectId, text: text.trim(), routeId: routeId ?? null, mode: routeId ? (mode === "manual" ? "manual" : "auto") : "unassigned", createdAt: Date.now(), images: pics.length };
      if (pics.length) images.set(item.id, pics);
      queue.push(item);
      emitQueue(projectId);
      if (item.routeId && item.mode === "auto") autoBoard(item.routeId);
      return item;
    },
    async queueAssign(itemId, routeId, mode) {
      const i = queue.findIndex((x) => x.id === itemId);
      queue[i] = { ...queue[i]!, routeId, mode: routeId ? (mode === "manual" ? "manual" : "auto") : "unassigned" };
      emitQueue(queue[i]!.projectId);
      if (routeId && queue[i]!.mode === "auto") autoBoard(routeId);
      return queue[i]!;
    },
    async queueRemove(itemId) {
      const item = queue.find((x) => x.id === itemId);
      queue = queue.filter((x) => x.id !== itemId);
      if (item) emitQueue(item.projectId);
    },
    async queueBoard(itemId) {
      const item = queue.find((x) => x.id === itemId)!;
      queue = queue.filter((x) => x.id !== itemId);
      emitQueue(item.projectId);
      void run(item.routeId!, item.text).then(() => autoBoard(item.routeId!));
    },
    async queueStartNew(itemId) {
      const item = queue.find((x) => x.id === itemId)!;
      const r = addRoute(item.projectId, Array.from(item.text).slice(0, 8).join(""));
      emit({ type: "route.updated", route: r });
      queue = queue.filter((x) => x.id !== itemId);
      emitQueue(item.projectId);
      void run(r.id, item.text);
      return r;
    },
    async distill(_routeId, _stopId, keep) {
      await wait(1800);
      return ["## 目标", "把登录改成 OAuth 授权码流程，先接 GitHub。", "## 做完了", "- 梳理了认证结构和 session 读写，定下新登录接口 `LoginFlow`", "- `routes.ts` 里 4 处会话读写已经收拢到 `LoginFlow`", "## 改过的文件", "- `src/auth/session.ts`：抽出读写函数", "- `src/auth/login-flow.ts`：新增", "## 还没定 / 还没做", "- refresh token 的有效期，以及要不要滑动续期", "- 登录失败要不要限流", ...(keep ? ["## 要注意的", `- ${keep}`] : [])].join("\n");
    },
    cancelDistill: async () => {},
    async createExpress(routeId, stopId, summary, name) {
      const src = routes.get(routeId)!;
      const express = [...routes.values()].filter((r) => r.projectId === src.projectId && r.express).length + 1;
      const r = addRoute(src.projectId, name?.trim() || `${src.name} · 续`, { parentRouteId: routeId, forkStopId: stopId, express });
      const head = addStop(r.id, "交接摘要", summary, [], { kind: "summary", syncState: "none", messageId: null, lastMessageId: null });
      emit({ type: "route.updated", route: r });
      emit({ type: "stop.created", stop: head });
      emit({ type: "stop.updated", stop: head });
      return r;
    },
    archiveRoute: async (routeId) => setRoute(routeId, { status: "archived", archivedAt: Date.now() }),
    unarchiveRoute: async (routeId) => setRoute(routeId, { status: "idle", archivedAt: null }),
    async deleteRoute(routeId, force) {
      const mine = [...stops.values()].filter((s) => s.routeId === routeId);
      if (!force && mine.some((s) => s.syncState === "unsynced" || s.syncState === "conflict")) {
        return { status: "has-unsynced", files: [{ path: "src/auth/session.ts", note: "modified" }, { path: "src/auth/cookie.ts", note: "added" }] };
      }
      const projectId = routes.get(routeId)!.projectId;
      routes.delete(routeId);
      for (const s of mine) stops.delete(s.id);
      emit({ type: "route.deleted", routeId, projectId });
      return { status: "deleted" };
    },
    async removeProject(projectId, force) {
      const mine = [...routes.values()].filter((r) => r.projectId === projectId);
      const busy = mine.find((r) => r.status === "answering" || r.status === "awaiting_permission");
      if (busy) throw new Error("有路正在回答，到站或停车后才能移除这个项目");
      const dirty = mine.filter((r) => [...stops.values()].some((s) => s.routeId === r.id && (s.syncState === "unsynced" || s.syncState === "conflict")));
      if (!force && dirty.length) {
        return { status: "has-unsynced", routes: dirty.map((r) => ({ routeId: r.id, label: `${r.number}路 ${r.name}`, files: [{ path: "src/auth/session.ts", note: "modified" }] })), kept: [] };
      }
      for (const r of mine) {
        for (const s of [...stops.values()]) if (s.routeId === r.id) stops.delete(s.id);
        routes.delete(r.id);
      }
      queue = queue.filter((q) => q.projectId !== projectId);
      projects.splice(projects.findIndex((p) => p.id === projectId), 1);
      emit({ type: "project.removed", projectId });
      return { status: "removed" };
    },
    async resolveConflict(routeId) {
      void run(routeId, "解决同步冲突").then(() => {
        for (const s of stops.values()) if (s.routeId === routeId && s.syncState === "conflict") setStop(s.id, { syncState: "synced" });
      });
    },
    async resync(routeId) {
      const entry: SyncLogEntry = { id: id("y"), routeId, stopId: null, direction: "push", status: "conflict", files: [{ path: "src/auth/session.ts", note: "both-modified" }], message: null, at: Date.now() };
      emit({ type: "sync.result", entry });
    },
    async stop(routeId) {
      aborts.get(routeId)?.();
      for (const [k, resolve] of permissions) {
        permissions.delete(k);
        resolve("deny");
      }
    },
    async answerPermission(requestId, decision) {
      permissions.get(requestId)?.(decision);
      permissions.delete(requestId);
    },
    history: async (routeId): Promise<StopContent[]> => [...stops.values()].filter((s) => s.routeId === routeId).map((s) => ({ stopId: s.id, items: content.get(s.id) ?? [] })),
    syncLog: async (routeId) => logs.get(routeId) ?? [],
    warm: async () => {},
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  window.bw = api;

  // ?notices：把各种通知都触发一遍
  if (q.has("notices")) {
    setTimeout(() => {
      const byName = (name: string) => [...routes.values()].find((x) => x.name === name)!;
      const r3 = byName("Cookie 方案");
      emit({ type: "sync.result", entry: { id: id("y"), routeId: r3.id, stopId: [...stops.values()].filter((x) => x.routeId === r3.id).at(-1)!.id, direction: "push", status: "conflict", files: [{ path: "src/auth/session.ts", note: "both-modified" }], message: null, at: Date.now() } });
      const r4 = byName("修复 CI 缓存");
      const s4 = [...stops.values()].find((x) => x.routeId === r4.id)!;
      setStop(s4.id, { status: "answering", error: null });
      setStop(s4.id, { status: "interrupted", error: "网络断了" });
      setRoute(r4.id, { status: "interrupted" });
      const home = byName("首页改版");
      addStop(home.id, "换首屏大图", "把首屏大图换成新的。", [{ kind: "text", text: "换好了。" }]);
      // 答完了一站（设计稿 9-14）
      const answer = "改好了，按钮现在在窄屏下居中；顺手把 `margin-left` 去掉了。改动已进 Local。";
      const sd = addStop(home.id, "按钮居中", "按钮在窄屏下居中。", [{ kind: "text", text: answer }], { status: "answering", endedAt: null });
      emit({ type: "stop.created", stop: sd });
      emit({ type: "stop.delta", routeId: home.id, stopId: sd.id, text: answer });
      setStop(sd.id, { status: "done", endedAt: Date.now() });
      queue.push({ id: "w9", projectId: "p2", text: "跑一遍端到端测试", routeId: home.id, mode: "manual", createdAt: 9 });
      emitQueue("p2");
      setRoute(home.id, { status: "answering" });
      setRoute(home.id, { status: "idle" });
      autoBoard(byName("GitHub 登录").id);
    }, 600);
  }

  if (q.has("live")) {
    setTimeout(() => {
      const r = [...routes.values()].find((x) => x.name === "GitHub 登录");
      if (r) void run(r.id, q.get("live") || "校验回调里的 state，失败时给出明确的错误。");
    }, 600);
  }
}
