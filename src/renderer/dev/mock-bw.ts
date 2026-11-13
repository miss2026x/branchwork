import type { BwApi, BwEvent, BwListener, ChatItem, Project, QueueItem, Route, Stop, StopContent, SyncLogEntry, Terminal } from "../../shared";

/**
 * 假的后端：只在普通浏览器里打开界面时用（没有 Electron 主进程）。
 * 数据都在内存里，回答是编出来的。用来调界面和截图，不参与正式运行。
 *
 * 地址栏参数：?empty 从空白开始；?live 打开后自动问一站；?slow 把各阶段拖长（看状态显示）
 */
export function installMockBw(): void {
  const q = new URLSearchParams(location.search);
  const slow = q.has("slow") ? 6 : 1;
  const listeners = new Set<BwListener>();
  const emit = (e: BwEvent) => listeners.forEach((l) => l(e));
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
  const permissions = new Map<string, (d: string) => void>();

  const addRoute = (projectId: string, name: string, extra: Partial<Route> = {}): Route => {
    const number = [...routes.values()].filter((r) => r.projectId === projectId).length + 1;
    const r: Route = { id: id("r"), projectId, number, express: null, name, status: "idle", sessionId: null, worktreePath: `/worktrees/${projectId}/${number}`, parentRouteId: null, forkStopId: null, model: null, color: null, contextTokens: null, createdAt: Date.now(), archivedAt: null, ...extra };
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
    logs.set(r3.id, [{ id: "y1", routeId: r3.id, stopId: null, direction: "push", status: "conflict", files: [{ path: "src/auth/session.ts", note: "both-modified" }], message: null, at: Date.now() }]);
    const r4 = addRoute(p.id, "修复 CI 缓存", { status: "interrupted" });
    addStop(r4.id, "看 CI 配置", "CI 的缓存为什么总是不命中？", [{ kind: "text", text: "缓存的 key 里带了提交号，所以每次都" }], { status: "interrupted", syncState: "unsynced", error: "已停车" });
    addRoute("p2", "首页改版");
    queue = [
      { id: "w1", projectId: p.id, text: "把错误码映射成用户能看懂的提示", routeId: r2.id, mode: "auto", createdAt: 1 },
      { id: "w2", projectId: p.id, text: "README 补上 GitHub 环境变量说明", routeId: r2.id, mode: "manual", createdAt: 2 },
      { id: "w3", projectId: p.id, text: "登录失败要不要加限流？", routeId: null, mode: "unassigned", createdAt: 3 },
      { id: "w4", projectId: p.id, text: "CI 缓存老是失效，每次都重新装依赖", routeId: null, mode: "unassigned", createdAt: 4 },
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

  async function run(routeId: string, text: string) {
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
    const stop = addStop(routeId, Array.from(text).slice(0, 6).join(""), text, [], { status: "answering", syncState: "none", nameState: "temp", endedAt: null });
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
    if (!stopped && text.includes("批准") && projects.find((p) => p.id === routes.get(routeId)!.projectId)?.permissionMode !== "all") {
      const requestId = id("q");
      setRoute(routeId, { status: "awaiting_permission" });
      emit({ type: "permission.request", requestId, routeId, stopId: stop.id, tool: "Bash", input: { command: "npm test -- auth" }, canRemember: true });
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
    void run(routeId, next.text).then(() => autoBoard(routeId));
  };

  // 上下文用量的假数据
  [...routes.values()].forEach((r, i) => stops.size && (r.contextTokens = [6200, 21400, 12800, 3100, 4800][i % 5]!));
  // 后台终端的假数据：GitHub 登录这一路开着一个开发服务器，还有一个已经退出的测试
  const terminals: Terminal[] = [];
  const withTerminals = [...routes.values()].find((x) => x.name === "GitHub 登录");
  if (withTerminals) {
    const stopId = [...stops.values()].find((x) => x.routeId === withTerminals.id)?.id ?? null;
    const base = { projectId: withTerminals.projectId, routeId: withTerminals.id, stopId, cwd: withTerminals.worktreePath };
    terminals.push(
      { ...base, id: "t1", name: "开发服务器", command: "npm run dev", status: "running", exitCode: null, port: 5173, startedAt: Date.now() - 18 * 60_000, endedAt: null },
      { ...base, id: "t2", name: "测试（监听）", command: "npm test -- --watch", status: "exited", exitCode: 1, port: null, startedAt: Date.now() - 40 * 60_000, endedAt: Date.now() - 31 * 60_000 },
    );
  }

  const api: BwApi = {
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
    async setPermissionMode(projectId, mode) {
      const i = projects.findIndex((p) => p.id === projectId);
      projects[i] = { ...projects[i]!, permissionMode: mode };
      emit({ type: "project.updated", project: projects[i]! });
      if (mode === "all") for (const [k, resolve] of permissions) (permissions.delete(k), resolve("allow"));
      return projects[i]!;
    },
    renameRoute: async (routeId, name) => setRoute(routeId, { name }),
    setRouteColor: async (routeId, color) => setRoute(routeId, { color }),
    async renameStop(stopId, name) {
      setStop(stopId, { name, nameState: "manual" });
    },
    async setRouteModel(routeId, model) {
      return setRoute(routeId, { model });
    },
    changes: async () => [
      { path: "src/auth/session.ts", kind: "modified", added: 42, removed: 17 },
      { path: "src/auth/providers/github.ts", kind: "added", added: 86, removed: 0 },
      { path: "src/auth/legacy-cookie.ts", kind: "deleted", added: 0, removed: 120 },
      { path: "public/logo.png", kind: "modified", added: null, removed: null },
    ],
    terminals: async (projectId) => terminals.filter((t) => t.projectId === projectId),
    terminalOutput: async (terminalId) =>
      terminalId === "t1"
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
      const r = addRoute(projectId, name ?? "");
      const named = { ...r, name: name ?? "新对话" };
      routes.set(r.id, named);
      return named;
    },
    async ask(routeId, text) {
      const r = routes.get(routeId)!;
      if (r.status === "answering" || r.status === "awaiting_permission") throw new Error("这一路正在回答，等它到站或先停车");
      if (r.status === "conflict" && text !== "解决同步冲突") throw new Error("这一路有同步冲突，解决后才能问下一站");
      void run(routeId, text).then(() => autoBoard(routeId));
    },
    async fork(routeId, stopId, name) {
      const parent = routes.get(routeId)!;
      const r = addRoute(parent.projectId, "", { parentRouteId: routeId, forkStopId: stopId, sessionId: "fork" });
      const named = { ...r, name: name?.trim() || "新对话" };
      routes.set(r.id, named);
      emit({ type: "route.updated", route: named });
      return named;
    },
    async queueAdd(projectId, text, routeId, mode) {
      const item: QueueItem = { id: id("w"), projectId, text: text.trim(), routeId: routeId ?? null, mode: routeId ? (mode === "manual" ? "manual" : "auto") : "unassigned", createdAt: Date.now() };
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
