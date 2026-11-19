import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BrowserIssue, BrowserState, ChatItem, PromptImage, RouteActivity, Terminal } from "../../shared";
import { splitMcpTool } from "../../shared";
import { useStore, type BrowserRef } from "../stores/store";
import { IconCamera, IconClose, IconErr, IconGlobe, IconMore, IconNet, IconPick, IconPlug, IconWarn, IconWindowUp } from "../ui/icons";
import { browserDoing, browserStep, hostPath, lastUrl, shortPath } from "./browser-steps";
import css from "./Browser.module.css";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;
const imgSrc = (i: PromptImage) => `data:${i.type};base64,${i.data}`;

/** 这一路正在跑的开发服务器的网址（“浏览器”菜单第一项直接打开它） */
export function devUrl(terminals: Terminal[]): { url: string; command: string } | null {
  const t = terminals.find((x) => x.status === "running" && x.port);
  return t ? { url: `http://localhost:${t.port}`, command: t.command } : null;
}

/**
 * 浏览器条（设计稿 9-12）：输入框正上方。这一路开了浏览器才出现；
 * 左边是现在的页面，右边是新报错和失败请求的数（点开看、引用），再往右：点选元素、截图、把窗口拉到前面、更多
 */
export function BrowserBar({ routeId, state, activity, onScreenshot, onSettings }: { routeId: string; state?: BrowserState; activity?: RouteActivity; onScreenshot(img: PromptImage): void; onSettings(): void }) {
  const pick = useStore((s) => s.browserPick);
  const cancelPick = useStore((s) => s.browserCancelPick);
  const shot = useStore((s) => s.browserShot);
  const show = useStore((s) => s.browserShow);
  const open = useStore((s) => s.browserOpen);
  const close = useStore((s) => s.browserClose);
  const addRef = useStore((s) => s.addBrowserRef);
  const [issues, setIssues] = useState<"error" | "request" | null>(null);
  const [menu, setMenu] = useState(false);
  const [goto, setGoto] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!issues && !menu) return;
    const down = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && (setIssues(null), setMenu(false));
    const key = (e: KeyboardEvent) => e.key === "Escape" && (setIssues(null), setMenu(false));
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
    };
  }, [issues, menu]);
  if (!state) return null;
  const errors = state.issues.filter((i) => i.kind !== "request");
  const requests = state.issues.filter((i) => i.kind === "request");

  if (state.error && !state.open) {
    return (
      <div className={css.bar} data-tone="red" role="alert">
        <IconWarn size={14} />
        <b className="ell">{/没找到 Chrome/.test(state.error) ? "没找到 Chrome" : "浏览器没开起来"}</b>
        <span className="ell">{/没找到 Chrome/.test(state.error) ? "装好后再试，或指定程序位置" : state.error}</span>
        <button className={css.text} onClick={onSettings}>
          去设置
        </button>
      </div>
    );
  }
  if (state.picking) {
    return (
      <div className={css.bar} data-tone="dark" role="status">
        <IconPick size={14} />
        <b className="ell">去浏览器窗口里点一个元素</b>
        <span className={css.dim}>Esc 取消</span>
        <button className={css.text} onClick={() => cancelPick(routeId)}>
          取消
        </button>
      </div>
    );
  }
  // 窗口关了：条收起来，工具栏的“浏览器”还在，菜单第一项是“重新打开上次的页面”
  if (!state.open) return null;
  const doing = activity?.kind === "running" ? browserDoing(activity.tool, activity.detail) : null;
  const cite = (list: BrowserIssue[]) => {
    for (const issue of list) addRef(routeId, { kind: "issue", issue });
    setIssues(null);
  };
  return (
    <div className={css.wrap} ref={wrap}>
      {doing ? (
        <div className={css.bar} data-tone="blue" role="status">
          <i className={css.spin} aria-hidden />
          <b className="ell">Claude 在操作：{doing}</b>
          <span className={css.fill} />
          <Buttons dim onPick={() => {}} onShot={() => {}} onShow={() => show(routeId)} onMore={() => setMenu(!menu)} />
        </div>
      ) : (
        <div className={css.bar}>
          <IconGlobe size={14} />
          <span className={css.page} title={state.url}>
            <b className="ell">{state.title || shortPath(state.url) || "空白页"}</b>
            <code className="ell">{shortPath(state.url)}</code>
          </span>
          {errors.length > 0 && (
            <button className={css.pill} data-tone="red" aria-expanded={issues === "error"} title="上一站以来的报错：点开看、引用" onClick={() => setIssues(issues === "error" ? null : "error")}>
              <IconErr size={11} />
              {errors.length}
            </button>
          )}
          {requests.length > 0 && (
            <button className={css.pill} data-tone="amber" aria-expanded={issues === "request"} title="上一站以来失败的请求：点开看、引用" onClick={() => setIssues(issues === "request" ? null : "request")}>
              <IconNet size={11} />
              {requests.length}
            </button>
          )}
          <Buttons
            onPick={() => void pick(routeId)}
            onShot={() => void shot(routeId).then((img) => img && onScreenshot(img))}
            onShow={() => show(routeId)}
            onMore={() => setMenu(!menu)}
          />
        </div>
      )}
      {issues && (
        <div className={css.pop} role="dialog" aria-label="报错和请求">
          <div className={css.popTabs}>
            <button aria-pressed={issues === "error"} onClick={() => setIssues("error")}>
              控制台 {errors.length}
            </button>
            <button aria-pressed={issues === "request"} onClick={() => setIssues("request")}>
              网络 {requests.length}
            </button>
            <span className={css.fill} />
            <span className={css.dim}>上一站以来</span>
          </div>
          <ul className={css.issues}>
            {(issues === "error" ? errors : requests).map((i) => (
              <li key={i.id}>
                {i.kind === "request" ? <IconNet size={13} /> : i.kind === "warning" ? <IconWarn size={13} /> : <IconErr size={13} />}
                <span className="ell" title={i.text}>
                  {i.text}
                </span>
                {i.source && i.kind !== "request" && <code>{i.source}</code>}
                <button className={css.cite} onClick={() => cite([i])}>
                  引用
                </button>
              </li>
            ))}
            {(issues === "error" ? errors : requests).length === 0 && <li className={css.dim}>没有</li>}
          </ul>
          <div className={css.popFoot}>
            <span className={css.dim}>悬停一行出现“引用”</span>
            <button className={css.text} onClick={() => cite(issues === "error" ? errors : requests)}>
              全部引用
            </button>
          </div>
        </div>
      )}
      {menu && (
        <div className={css.menu} role="menu">
          {goto ? (
            <form
              className={css.goto}
              onSubmit={(e) => {
                e.preventDefault();
                const url = new FormData(e.currentTarget).get("url")?.toString().trim();
                if (url) void open(routeId, /^[a-z]+:/i.test(url) ? url : `http://${url}`);
                setGoto(false);
                setMenu(false);
              }}
            >
              <input name="url" autoFocus placeholder="localhost:5174/admin" aria-label="网址" />
            </form>
          ) : (
            <button role="menuitem" onClick={() => setGoto(true)}>
              <IconGlobe size={14} />
              打开别的网址…
            </button>
          )}
          <button role="menuitem" onClick={() => (setMenu(false), setIssues("error"))}>
            <IconErr size={14} />
            看报错和请求
          </button>
          <button role="menuitem" onClick={() => (setMenu(false), close(routeId))}>
            <IconClose size={14} />
            关掉这一路的窗口
          </button>
          <hr />
          <button role="menuitem" onClick={() => (setMenu(false), onSettings())}>
            浏览器设置…
          </button>
          <p>{state.pages.length} 个标签页 · Lanes 专用的 Chrome</p>
        </div>
      )}
    </div>
  );
}

function Buttons({ dim, onPick, onShot, onShow, onMore }: { dim?: boolean; onPick(): void; onShot(): void; onShow(): void; onMore(): void }) {
  return (
    <span className={css.btns}>
      <button aria-label="点选元素" title="点选元素：去浏览器里点一个元素，发给 Claude" disabled={dim} onClick={onPick}>
        <IconPick size={15} />
      </button>
      <button aria-label="截图" title="截图：截这一路窗口看得到的部分，放进输入框" disabled={dim} onClick={onShot}>
        <IconCamera size={15} />
      </button>
      <button aria-label="把窗口拉到前面" title="把这一路的浏览器窗口拉到前面" onClick={onShow}>
        <IconWindowUp size={15} />
      </button>
      <button aria-label="更多" title="更多" onClick={onMore}>
        <IconMore size={15} />
      </button>
    </span>
  );
}

/** 输入框工具栏里的“浏览器”（这一路还没开窗口时）：认出开发服务器就直接打开它 */
export function BrowserOpenButton({ routeId, dev, lastUrl, disabled }: { routeId: string; dev: { url: string; command: string } | null; /** 窗口关之前在的页面 */ lastUrl?: string | null; disabled?: boolean }) {
  const open = useStore((s) => s.browserOpen);
  const pick = useStore((s) => s.browserPick);
  const [menu, setMenu] = useState(false);
  const [goto, setGoto] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && (setMenu(false), setGoto(false));
    const key = (e: KeyboardEvent) => e.key === "Escape" && (setMenu(false), setGoto(false));
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
    };
  }, [menu]);
  return (
    <span className={css.openWrap} ref={wrap}>
      {/* 工具栏放不下字：和回形针一样只放图标 */}
      <button className={css.openBtn} aria-label="浏览器" aria-expanded={menu} disabled={disabled} title="浏览器：开这一路的窗口，让 Claude 看和操作页面" onClick={() => setMenu(!menu)}>
        <IconGlobe size={16} />
      </button>
      {menu && (
        <div className={css.menu} data-up role="menu">
          {lastUrl && (
            <button role="menuitem" onClick={() => (setMenu(false), void open(routeId, lastUrl))}>
              <IconWindowUp size={14} />
              <span className="ell">重新打开 {hostPath(lastUrl)}</span>
              <code>上次的页面</code>
            </button>
          )}
          {dev && (!lastUrl || hostPath(lastUrl).split("/")[0] !== hostPath(dev.url).split("/")[0]) && (
            <button role="menuitem" onClick={() => (setMenu(false), void open(routeId, dev.url))}>
              <IconGlobe size={14} />
              <span className="ell">打开 {dev.url.replace(/^https?:\/\//, "")}</span>
              <code>{dev.command}</code>
            </button>
          )}
          {goto ? (
            <form
              className={css.goto}
              onSubmit={(e) => {
                e.preventDefault();
                const url = new FormData(e.currentTarget).get("url")?.toString().trim();
                if (url) void open(routeId, /^[a-z]+:/i.test(url) ? url : `http://${url}`);
                setMenu(false);
                setGoto(false);
              }}
            >
              <input name="url" autoFocus placeholder="localhost:5173" aria-label="网址" />
            </form>
          ) : (
            <button role="menuitem" onClick={() => setGoto(true)}>
              <IconGlobe size={14} />
              {dev ? "打开别的网址…" : "打开一个网址…"}
            </button>
          )}
          <button role="menuitem" onClick={() => (setMenu(false), void (async () => (await open(routeId, dev?.url), await pick(routeId)))())}>
            <IconPick size={14} />
            打开并点选元素
          </button>
          <p>Claude 第一次用浏览器时也会自己开窗口。</p>
        </div>
      )}
    </span>
  );
}

/** 输入框里引用的东西：点选的元素、报错、失败的请求（发车时一起交给 Claude） */
export function BrowserRefs({ refs, onRemove, children }: { refs: BrowserRef[]; onRemove(i: number): void; /** 排在最后的（“附上浏览器现状”） */ children?: ReactNode }) {
  const [hover, setHover] = useState<number | null>(null);
  if (refs.length === 0 && !children) return null;
  return (
    <div className={css.refs}>
      {refs.map((r, i) =>
        r.kind === "element" ? (
          <span key={i} className={css.chip} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className={css.thumb}>{r.el.image ? <img src={imgSrc(r.el.image)} alt="" /> : <IconPick size={14} />}</span>
            <span className={css.chipText}>
              <b className="ell">{r.el.label}</b>
              <code className="ell">{r.el.selector}</code>
            </span>
            <button aria-label="去掉" onClick={() => onRemove(i)}>
              <IconClose size={11} />
            </button>
            {hover === i && (
              <div className={css.detail}>
                <b>{r.el.label}</b>
                <dl>
                  <dt>位置</dt>
                  <dd>{r.el.selector}</dd>
                  <dt>大小</dt>
                  <dd>
                    {r.el.width} × {r.el.height}，在 ({r.el.x}, {r.el.y})
                  </dd>
                  {r.el.styles && (
                    <>
                      <dt>样式</dt>
                      <dd>{r.el.styles}</dd>
                    </>
                  )}
                  {r.el.text && (
                    <>
                      <dt>文字</dt>
                      <dd>{r.el.text}</dd>
                    </>
                  )}
                </dl>
                <span className={css.dim}>{r.el.image ? "还有一张这个元素的局部截图" : ""}</span>
              </div>
            )}
          </span>
        ) : (
          <span key={i} className={css.chip} data-tone={r.issue.kind === "request" ? "amber" : "red"}>
            {r.issue.kind === "request" ? <IconNet size={13} /> : <IconErr size={13} />}
            <span className="ell" title={r.issue.text}>
              {r.issue.text}
            </span>
            <button aria-label="去掉" onClick={() => onRemove(i)}>
              <IconClose size={11} />
            </button>
          </span>
        ),
      )}
      {children}
    </div>
  );
}

/** 输入框里的“附上浏览器现状”：开着窗口时出现，点 × 这一站就不带 */
export function BrowserStateChip({ state, off, onToggle }: { state?: BrowserState; off: boolean; onToggle(off: boolean): void }) {
  if (!state?.open) return null;
  const errors = state.issues.filter((i) => i.kind === "error").length;
  if (off)
    return (
      <button className={css.stateChip} data-off onClick={() => onToggle(false)} title="这一站不附浏览器现状；点一下恢复">
        <IconGlobe size={12} />
        不附浏览器现状
      </button>
    );
  return (
    <span className={css.stateChip} title="发车时把这一路浏览器的网址和上一站以来的报错交给 Claude">
      <IconGlobe size={12} />
      附上浏览器现状
      {errors > 0 && <b>· {errors} 个新报错</b>}
      <button aria-label="这一站不附" onClick={() => onToggle(true)}>
        <IconClose size={10} />
      </button>
    </span>
  );
}

// ───────────── 对话里 Claude 的浏览器操作、MCP 工具 ─────────────

/** 连着的浏览器操作合成一块（设计稿 9-12）：标题写几步、在哪一页，收起时只放最后一张截图 */
export function BrowserGroup({ tools, running, onOpenImages, onCite }: { tools: ToolItem[]; running?: boolean; onOpenImages(images: PromptImage[], index: number): void; onCite?(text: string): void }) {
  const [open, setOpen] = useState(false);
  const url = lastUrl(tools);
  const shots = tools.flatMap((t) => t.result?.images ?? []);
  const last = shots.at(-1);
  return (
    <div className={css.group}>
      <button className={css.groupHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconGlobe size={14} />
        <b>浏览器 · {tools.length} 步</b>
        {url && <code className="ell">{shortPath(url)}</code>}
        <span className={css.fill} />
        {running && <i className={css.spin} aria-hidden />}
        <span className={css.dim}>{open ? "收起" : "展开"}</span>
      </button>
      {open &&
        tools.map((t, i) => {
          const s = browserStep(t);
          return (
            <div key={t.id ?? i} className={css.step} data-error={t.result?.error || undefined}>
              <span>{s.verb}</span>
              <code className="ell" title={s.object}>
                {s.object}
              </code>
              {(t.result?.images.length ?? 0) > 0 && (
                <button className={css.text} onClick={() => onOpenImages(t.result!.images, 0)}>
                  看图
                </button>
              )}
              {t.result?.text && <ResultText text={t.result.text} onCite={onCite} />}
            </div>
          );
        })}
      {last && (
        <div className={css.shot}>
          <button onClick={() => onOpenImages(shots, shots.length - 1)} aria-label="放大截图">
            <img src={imgSrc(last)} alt="最后一步的截图" />
          </button>
          <span>
            <span>{shots.length > 1 ? `最后一张截图（共 ${shots.length} 张）` : "最后一步的截图"}</span>
            <button className={css.text} onClick={() => onOpenImages(shots, shots.length - 1)}>
              放大
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

/** 结果的文字：默认收起，点“结果”展开（控制台、网络这些很长） */
function ResultText({ text, onCite }: { text: string; onCite?(text: string): void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={css.text} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "收起" : "结果"}
      </button>
      {open && (
        <div className={css.result}>
          <pre>{text}</pre>
          {onCite && (
            <button className={css.text} onClick={() => onCite(text)}>
              引用
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** 别的 MCP 服务的一次调用（设计稿 9-13）：插头 + 服务名 + 工具名 + 参数，展开看结果 */
export function McpCall({ tool, running }: { tool: ToolItem; running?: boolean }) {
  const [open, setOpen] = useState(false);
  const [server, name] = splitMcpTool(tool.tool) ?? ["", tool.tool];
  const arg = tool.detail || Object.values(tool.input ?? {}).filter((v) => typeof v === "string")[0] || "";
  return (
    <div className={css.group}>
      <button className={css.mcpHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconPlug size={13} />
        <span className={css.dim}>{server}</span>
        <b>{name}</b>
        <code className="ell">{String(arg)}</code>
        {running && <i className={css.spin} aria-hidden />}
        <span className={css.dim}>{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div className={css.result}>
          {tool.input && Object.keys(tool.input).length > 0 && <pre>{JSON.stringify(tool.input, null, 2)}</pre>}
          {tool.result?.text && <pre data-result>{tool.result.text}</pre>}
          {tool.result?.images.map((img, i) => <img key={i} src={imgSrc(img)} alt="" />)}
          {!tool.result && <span className={css.dim}>{running ? "还在跑…" : "没有结果"}</span>}
        </div>
      )}
      {tool.result?.error && (
        <p className={css.callError}>
          <IconWarn size={13} />
          {server} 出错了，这一步没做成
        </p>
      )}
    </div>
  );
}
