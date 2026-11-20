import { useEffect, useState } from "react";
import { parseMcpJson, validMcpName, type McpOverview, type McpScope, type McpServerEntry, type McpServerInput, type McpServerState, type McpToolPolicy, type McpTransport } from "../../shared";
import { useStore } from "../stores/store";
import { IconClose, IconDownload, IconGlobe, IconPlug, IconTerminal } from "../ui/icons";
import css from "./Dialog.module.css";
import own from "./Mcp.module.css";

const SOURCE: Record<McpScope, string> = { local: "Claude Code · 这个项目", project: ".mcp.json", user: "Claude Code · 全局", lanes: "Lanes · 全部项目", "lanes-project": "Lanes · 这个项目" };
const SCOPES: { scope: McpScope; label: string; sub: string }[] = [
  { scope: "local", label: "这个项目，只有我", sub: "Claude Code · 本地，存在 ~/.claude.json" },
  { scope: "project", label: "这个项目，团队共享", sub: ".mcp.json，会进 git" },
  { scope: "user", label: "全部项目", sub: "Claude Code · 全局，存在 ~/.claude.json" },
  { scope: "lanes", label: "只在 Lanes", sub: "命令行里的 Claude Code 用不到" },
];

/** MCP 服务（设计稿 9-13）和内置浏览器（9-12）的设置 */
export function McpDialog({ projectId, projectName, tab, onClose }: { projectId: string; projectName: string; tab: "servers" | "browser"; onClose(): void }) {
  const mcp = useStore((s) => (s.mcp?.projectId === projectId ? s.mcp : null));
  const [view, setView] = useState<"servers" | "browser">(tab);
  const [editing, setEditing] = useState<McpServerEntry | "new" | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !editing && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing]);
  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`${css.dialog} ${own.dialog}`} role="dialog" aria-modal aria-label="MCP 服务和浏览器">
        <header>
          <h2>{editing ? (editing === "new" ? "添加 MCP 服务" : `编辑 ${editing.name}`) : "MCP 服务和浏览器"}</h2>
          {!editing && (
            <span className={own.seg} role="tablist">
              <button role="tab" aria-selected={view === "servers"} onClick={() => setView("servers")}>
                MCP 服务
              </button>
              <button role="tab" aria-selected={view === "browser"} onClick={() => setView("browser")}>
                浏览器
              </button>
            </span>
          )}
          <button aria-label="关闭" onClick={editing ? () => setEditing(null) : onClose}>
            <IconClose size={16} />
          </button>
        </header>
        {!mcp ? (
          <p className={css.sub}>正在读…</p>
        ) : editing ? (
          <ServerForm projectId={projectId} entry={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
        ) : view === "servers" ? (
          <ServerList projectId={projectId} projectName={projectName} mcp={mcp} onEdit={setEditing} onBrowser={() => setView("browser")} />
        ) : (
          <BrowserSettingsView mcp={mcp} />
        )}
      </section>
    </div>
  );
}

function transportText(t: McpTransport) {
  return t.type === "stdio" ? [t.command, ...(t.args ?? [])].join(" ") : t.url;
}

function Status({ st, entry }: { st?: McpServerState; entry: McpServerEntry }) {
  if (entry.replacedByBrowser) return <span className={own.status}>由内置的浏览器代替</span>;
  if (entry.shadowedBy) return <span className={own.status}>被{SOURCE[entry.shadowedBy]}的同名服务盖住</span>;
  if (entry.untrusted) return <span className={own.status} data-tone="amber">等你确认</span>;
  if (!entry.enabled) return <span className={own.status}>关着</span>;
  if (!st) return <span className={own.status}>还没检查</span>;
  if (st.status === "checking" || st.status === "pending")
    return (
      <span className={own.status} data-tone="blue">
        <i className={own.spin} aria-hidden />
        正在连
      </span>
    );
  if (st.status === "connected")
    return (
      <span className={own.status} data-tone="green">
        <i className={own.dot} />
        连上了 · {st.tools?.length ?? 0} 个工具
      </span>
    );
  if (st.status === "needs-auth")
    return (
      <span className={own.status} data-tone="amber">
        <i className={own.dot} />
        要登录
      </span>
    );
  return (
    <span className={own.status} data-tone="red" title={st.error}>
      <i className={own.dot} />
      连不上{st.error ? `：${st.error}` : ""}
    </span>
  );
}

function ServerList({ projectId, projectName, mcp, onEdit, onBrowser }: { projectId: string; projectName: string; mcp: McpOverview; onEdit(e: McpServerEntry | "new"): void; onBrowser(): void }) {
  const check = useStore((s) => s.mcpCheck);
  const setEnabled = useStore((s) => s.mcpSetEnabled);
  const trust = useStore((s) => s.mcpTrust);
  const remove = useStore((s) => s.mcpRemove);
  const setPolicy = useStore((s) => s.mcpSetPolicy);
  const [open, setOpen] = useState<string | null>(null);
  const [hideTrust, setHideTrust] = useState(false);
  const untrusted = mcp.servers.filter((s) => s.untrusted && !s.shadowedBy);
  const checking = Object.values(mcp.states).some((s) => s.status === "checking");
  const key = (e: McpServerEntry) => `${e.scope}:${e.name}`;
  return (
    <>
      <p className={css.sub}>
        {projectName} 能用的服务。Claude Code 里配过的直接读进来，改的就是原文件；开关只记在 Lanes 里。改动从每一路的下一站开始生效。
      </p>
      {untrusted.length > 0 && !hideTrust && (
        <div className={own.trust}>
          <b>这个项目的 .mcp.json 里有 {untrusted.length} 个服务</b>
          <span>它们会在你电脑上运行命令或连外网，用之前确认一下：{untrusted.map((s) => s.name).join("、")}</span>
          <span className={own.trustBtns}>
            <button className={own.primary} onClick={() => void trust(projectId, untrusted.map((s) => s.name), true)}>
              都用
            </button>
            <button className={own.link} onClick={() => setHideTrust(true)}>
              先不用
            </button>
          </span>
        </div>
      )}
      <div className={own.list}>
        <div className={own.row} data-builtin>
          <IconGlobe size={15} />
          <div className={own.name}>
            <span>
              <b>浏览器</b>
              <em className={own.tag}>内置</em>
            </span>
            <code>Chrome DevTools · Lanes 专用的 Chrome</code>
          </div>
          <span className={own.status} data-tone={mcp.browser.enabled ? "green" : undefined}>
            {mcp.browser.enabled && <i className={own.dot} />}
            {mcp.browser.enabled ? (mcp.browser.chromePath || mcp.browser.found ? "可以用" : "没找到 Chrome") : "关着"}
          </span>
          <span className={own.right}>
            <button className={own.link} onClick={onBrowser}>
              设置 ›
            </button>
          </span>
        </div>
        {mcp.servers.map((e) => {
          const st = mcp.states[e.name];
          const k = key(e);
          const inactive = !!e.shadowedBy || !!e.replacedByBrowser;
          const tools = !e.shadowedBy ? st?.tools : undefined;
          return (
            <div key={k} className={own.item} data-open={open === k || undefined}>
              <div className={own.row} data-dim={inactive || undefined}>
                {e.config.type === "stdio" ? <IconTerminal size={15} /> : <IconPlug size={15} />}
                <button className={own.name} onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k}>
                  <span>
                    <b>{e.name}</b>
                    <em className={own.tag}>{SOURCE[e.scope]}</em>
                  </span>
                  <code className="ell">{transportText(e.config)}</code>
                </button>
                <Status st={st} entry={e} />
                <span className={own.right}>
                  {st?.status === "needs-auth" && !inactive && <span className={own.hint}>在终端里运行 claude mcp login {e.name}</span>}
                  {!inactive && <Toggle on={e.enabled && !e.untrusted} label={`${e.enabled ? "关掉" : "打开"} ${e.name}`} onChange={(on) => void (e.untrusted ? trust(projectId, [e.name], on) : setEnabled(projectId, e.name, on))} />}
                </span>
              </div>
              {open === k && (
                <div className={own.detail}>
                  <div className={own.actions}>
                    <button className={own.btn} onClick={() => onEdit(e)}>
                      编辑
                    </button>
                    {!inactive && (
                      <button className={own.btn} onClick={() => void check(projectId, [e.name])}>
                        重新连接
                      </button>
                    )}
                    <button className={own.link} data-danger onClick={() => void remove(projectId, e.name, e.scope)}>
                      删除
                    </button>
                    <span className={own.fill} />
                    <span className={own.hint}>存在 {e.where}</span>
                  </div>
                  {st?.error && <pre className={own.error}>{st.error}</pre>}
                  {tools && tools.length > 0 && (
                    <>
                      <div className={own.toolsHead}>
                        <b>工具 · {tools.length} 个</b>
                        <span className={own.hint}>批准方式</span>
                      </div>
                      {tools.map((t) => {
                        const p = mcp.policies[e.name]?.[t.name] ?? (t.readOnly ? "allow" : "ask");
                        return (
                          <div key={t.name} className={own.tool}>
                            <span className={own.toolName}>
                              <code>{t.name}</code>
                              {t.readOnly && <em className={own.ro}>只读</em>}
                              <small className="ell" title={t.description}>
                                {t.description}
                              </small>
                            </span>
                            <span className={own.seg} data-small>
                              {(["allow", "ask", "deny"] as McpToolPolicy[]).map((v) => (
                                <button key={v} aria-pressed={p === v} onClick={() => void setPolicy(e.name, t.name, v)}>
                                  {v === "allow" ? "直接放行" : v === "ask" ? "跟这一路" : "不给"}
                                </button>
                              ))}
                            </span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {mcp.servers.length === 0 && <p className={own.empty}>还没有 MCP 服务。在 Claude Code 里加过的会自动出现在这里，也可以在这里加。</p>}
      </div>
      <footer className={own.foot}>
        <button className={own.btn} disabled={checking} onClick={() => void check(projectId)}>
          {checking ? "正在检查…" : "检查连接"}
        </button>
        <span className={own.fill} />
        <button className={own.primary} onClick={() => onEdit("new")}>
          ＋ 添加
        </button>
      </footer>
    </>
  );
}

function Toggle({ on, label, onChange, disabled }: { on: boolean; label: string; onChange(on: boolean): void; disabled?: boolean }) {
  return <button className={own.toggle} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

const kv = (o?: Record<string, string>) => Object.entries(o ?? {}).map(([k, v]) => ({ k, v }));
const fromKv = (list: { k: string; v: string }[]) => {
  const o = Object.fromEntries(list.filter((x) => x.k.trim()).map((x) => [x.k.trim(), x.v]));
  return Object.keys(o).length ? o : undefined;
};
/** 命令行拆成程序和参数（引号里的空格不拆） */
const splitCommand = (s: string) => [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
const joinCommand = (t: McpTransport) => (t.type === "stdio" ? [t.command, ...(t.args ?? [])].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ") : "");

function ServerForm({ projectId, entry, onDone }: { projectId: string; entry: McpServerEntry | null; onDone(): void }) {
  const save = useStore((s) => s.mcpSave);
  const test = useStore((s) => s.mcpTest);
  const remove = useStore((s) => s.mcpRemove);
  const [kind, setKind] = useState<"stdio" | "http" | "json">(entry ? (entry.config.type === "stdio" ? "stdio" : "http") : "stdio");
  const [name, setName] = useState(entry?.name ?? "");
  const [command, setCommand] = useState(entry ? joinCommand(entry.config) : "");
  const [url, setUrl] = useState(entry && entry.config.type !== "stdio" ? entry.config.url : "");
  const [sse, setSse] = useState(entry?.config.type === "sse");
  const [env, setEnv] = useState(kv(entry?.config.type === "stdio" ? entry.config.env : entry?.config.headers));
  const [scope, setScope] = useState<McpScope>(entry?.scope ?? "local");
  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<McpServerState | "testing" | null>(null);

  const parsed = (() => {
    if (kind !== "json" || !json.trim()) return null;
    try {
      return parseMcpJson(json);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  })();

  const build = (): McpServerInput | string => {
    const bad = validMcpName(name);
    if (bad) return bad;
    if (kind === "stdio") {
      const parts = splitCommand(command.trim());
      if (!parts.length) return "写一下怎么启动它（和终端里一样）";
      const e = fromKv(env);
      return { name, scope, config: { type: "stdio", command: parts[0]!, args: parts.slice(1), ...(e ? { env: e } : {}) } };
    }
    if (!/^https?:\/\//.test(url.trim())) return "网址要以 http:// 或 https:// 开头";
    const h = fromKv(env);
    return { name, scope, config: { type: sse ? "sse" : "http", url: url.trim(), ...(h ? { headers: h } : {}) } };
  };

  const submit = async () => {
    if (kind === "json") {
      if (!Array.isArray(parsed)) return setError(typeof parsed === "string" ? parsed : "粘贴一段配置");
      for (const p of parsed) {
        const n = p.name || name;
        const bad = validMcpName(n);
        if (bad) return setError(`${n || "（没有名字）"}：${bad}`);
        const err = await save(projectId, { name: n, scope, config: p.config });
        if (err) return setError(err);
      }
      return onDone();
    }
    const input = build();
    if (typeof input === "string") return setError(input);
    const err = await save(projectId, input, entry ? { name: entry.name, scope: entry.scope } : undefined);
    if (err) return setError(err);
    onDone();
  };
  const runTest = async () => {
    const input = build();
    if (typeof input === "string") return setError(input);
    setError(null);
    setTested("testing");
    setTested(await test(projectId, input).catch((e: unknown) => ({ status: "failed" as const, error: String(e), checkedAt: Date.now() })));
  };

  return (
    <div className={own.form}>
      {entry && entry.scope !== "lanes" && entry.scope !== "lanes-project" && (
        <p className={own.where}>
          存在 <code>{entry.where}</code>
          {entry.scope !== "project" ? " · Claude Code 也用这一份" : " · 会进 git"}
        </p>
      )}
      <span className={own.seg}>
        {(["stdio", "http", "json"] as const).map((k) => (
          <button key={k} aria-pressed={kind === k} disabled={!!entry && k === "json"} onClick={() => (setKind(k), setError(null), setTested(null))}>
            {k === "stdio" ? "本机命令" : k === "http" ? "远程网址" : "粘贴 JSON"}
          </button>
        ))}
      </span>
      {kind === "json" ? (
        <label className={css.field}>
          <span>粘贴文档里给的配置</span>
          <textarea className={own.mono} rows={9} value={json} onChange={(e) => setJson(e.target.value)} placeholder={'{\n  "mcpServers": {\n    "postgres": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres"] }\n  }\n}'} />
          <small className={own.hint}>认得 Claude Code、Claude Desktop、Cursor、VS Code 的写法</small>
        </label>
      ) : (
        <>
          <label className={css.field}>
            <span>名字</span>
            <input className={own.mono} value={name} onChange={(e) => setName(e.target.value)} placeholder="postgres" />
          </label>
          {kind === "stdio" ? (
            <label className={css.field}>
              <span>命令</span>
              <input className={own.mono} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-postgres postgres://localhost/app" />
              <small className={own.hint}>和终端里一样写，会在这一路的工作区里运行</small>
            </label>
          ) : (
            <label className={css.field}>
              <span>网址</span>
              <input className={own.mono} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" />
              <label className={own.check}>
                <input type="checkbox" checked={sse} onChange={(e) => setSse(e.target.checked)} />
                老式的 SSE 接法
              </label>
            </label>
          )}
          <div className={css.field}>
            <span>{kind === "stdio" ? "环境变量" : "请求头"}</span>
            {env.map((x, i) => (
              <div key={i} className={own.kv}>
                <input className={own.mono} value={x.k} placeholder={kind === "stdio" ? "API_KEY" : "Authorization"} onChange={(e) => setEnv(env.map((y, j) => (j === i ? { ...y, k: e.target.value } : y)))} />
                <input className={own.mono} value={x.v} placeholder={kind === "stdio" ? "值，或 ${API_KEY}" : "Bearer ${TOKEN}"} onChange={(e) => setEnv(env.map((y, j) => (j === i ? { ...y, v: e.target.value } : y)))} />
                <button aria-label="去掉" onClick={() => setEnv(env.filter((_, j) => j !== i))}>
                  <IconClose size={11} />
                </button>
              </div>
            ))}
            <button className={own.link} onClick={() => setEnv([...env, { k: "", v: "" }])}>
              ＋ 加一个
            </button>
            {kind === "http" && <small className={own.hint}>要 OAuth 登录的服务不用填，加好后在终端里运行 claude mcp login 名字。值可以写 ${"{"}VAR{"}"}，从环境变量里取</small>}
          </div>
        </>
      )}
      <div className={css.field}>
        <span>存到哪</span>
        <div className={own.radios}>
          {SCOPES.map((s) => (
            <label key={s.scope}>
              <input type="radio" name="scope" checked={scope === s.scope} onChange={() => setScope(s.scope)} />
              <span>
                {s.label}
                <small> · {s.sub}</small>
              </span>
            </label>
          ))}
        </div>
        {entry && scope !== entry.scope && <small className={own.hint}>换了位置就是从原来的地方挪过去，原来那条删掉</small>}
      </div>
      {Array.isArray(parsed) && (
        <p className={own.found}>
          认出 {parsed.length} 个：{parsed.map((p) => p.name || "（没有名字，用上面的名字）").join("、")}
        </p>
      )}
      {tested && tested !== "testing" && (
        <div className={own.tested} data-ok={tested.status === "connected" || undefined}>
          <b>{tested.status === "connected" ? `连上了 · ${tested.tools?.length ?? 0} 个工具` : tested.status === "needs-auth" ? "要登录" : `连不上${tested.error ? `：${tested.error}` : ""}`}</b>
          {tested.tools && tested.tools.length > 0 && <code>{tested.tools.map((t) => t.name).join(" · ")}</code>}
        </div>
      )}
      {error && <p className={css.error}>{error}</p>}
      <footer className={own.foot}>
        {kind !== "json" && (
          <button className={own.btn} disabled={tested === "testing"} onClick={() => void runTest()}>
            {tested === "testing" ? "正在连…" : "测试连接"}
          </button>
        )}
        {entry && (
          <button className={own.link} data-danger onClick={() => void remove(projectId, entry.name, entry.scope).then(onDone)}>
            删除
          </button>
        )}
        <span className={own.fill} />
        <button className={own.link} onClick={onDone}>
          取消
        </button>
        <button className={own.primary} onClick={() => void submit()}>
          {entry ? "保存" : Array.isArray(parsed) && parsed.length > 1 ? `添加 ${parsed.length} 个` : "添加"}
        </button>
      </footer>
    </div>
  );
}

function BrowserSettingsView({ mcp }: { mcp: McpOverview }) {
  const set = useStore((s) => s.setBrowserSettings);
  const openChrome = useStore((s) => s.openChromeDialog);
  const b = mcp.browser;
  const [path, setPath] = useState(b.chromePath);
  return (
    <div className={own.settings}>
      <p className={css.sub}>Lanes 管一个专用的 Chrome（一份单独的资料，你平时 Chrome 里的账号和密码不在里面；在里面登录过的测试账号会一直留着），每一路一个窗口。Claude 用浏览器的工具都直接放行，只有上传本机文件要问。</p>
      <div className={own.srow}>
        <b>内置浏览器</b>
        <label className={own.check}>
          <Toggle on={b.enabled} label="内置浏览器" onChange={(on) => void set({ enabled: on })} />
          {b.enabled ? "开着：每一路的 Claude 都能看和操作自己的浏览器窗口" : "关着：Claude 没有浏览器工具"}
        </label>
      </div>
      <div className={own.srow}>
        <b>Chrome 程序</b>
        <div className={own.scol}>
          <input className={own.mono} value={path} placeholder={b.found ?? "没找到 Chrome：写一下它的位置"} onChange={(e) => setPath(e.target.value)} onBlur={() => path !== b.chromePath && void set({ chromePath: path.trim() })} />
          {!b.chromePath && b.downloaded && b.found === b.downloaded.path && (
            <span className={own.cftRow}>
              <span className={own.pillGreen}>Lanes 下载的</span>
              <small className={own.hint}>Chrome for Testing {b.downloaded.version.split(".")[0]}。装了正式的 Chrome 后自动改用正式的</small>
            </span>
          )}
          {!b.chromePath && !b.found && (
            <span className={own.cftRow}>
              <span className={own.pillRed}>没找到 Chrome</span>
              <button className={own.darkBtn} onClick={() => openChrome(null)}>
                <IconDownload size={13} />
                下载 Chrome for Testing
              </button>
            </span>
          )}
          <small className={own.hint}>{b.chromePath ? "用你指定的这个" : b.found && b.found !== b.downloaded?.path ? "自动找到的。可以换成 Canary、Beta、Edge，或别的位置" : b.found ? "" : "或者在上面写 Chrome 的位置"}</small>
        </div>
      </div>
      <div className={own.srow}>
        <b>窗口</b>
        <div className={own.radios}>
          <label>
            <input type="radio" name="win" checked={!b.localOnly} onChange={() => void set({ localOnly: false })} />
            <span>每一路一个窗口</span>
          </label>
          <label>
            <input type="radio" name="win" checked={b.localOnly} onChange={() => void set({ localOnly: true })} />
            <span>
              只给 Local 专车开<small> · 其他路不给浏览器工具（内存不够时）</small>
            </span>
          </label>
        </div>
      </div>
      <div className={own.srow}>
        <b>自动做的</b>
        <label className={own.check}>
          <Toggle on={b.attachState} label="发车时附上浏览器现状" onChange={(on) => void set({ attachState: on })} />
          发车时附上浏览器现状（网址、上一站以来的报错和失败请求，几行字）
        </label>
      </div>
    </div>
  );
}
