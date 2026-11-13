import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatItem, PermissionMode, QueueItem, QueueMode, Route, Stop, Terminal } from "../../shared";
import { TerminalStrip } from "../terminal/TerminalStrip";
import { ModelControl } from "./ModelControl";
import { PermissionModeControl } from "./PermissionModeControl";
import { firstStops } from "../stores/numbering";
import { useStore, type LiveStop } from "../stores/store";
import { IconChevron, IconSend, IconStop, IconWait, IconWarn } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import css from "./ChatPanel.module.css";

/** 右侧面板：当前这一路的对话、状态、输入框 */
interface Props {
  route: Route;
  stops: Stop[];
  /** 这一路从父路带来了几站；这一路自己的第 1 站显示成第 offset+1 站 */
  offset: number;
  /** 从哪一路分叉出来的 */
  parent?: Route;
  onGoToRoute(routeId: string): void;
  /** 这个项目的批准方式 */
  permissionMode: PermissionMode;
  projectName: string;
  onPermissionMode(mode: PermissionMode): void;
  /** 这一路换模型 */
  onModel(model: string | null): void;
  /** 这一路的后台终端 */
  terminals: Terminal[];
  onOpenTerminal(terminalId: string): void;
  onStopTerminal(terminalId: string): void;
  /** 看这一路的工作区里有哪些改动还没进 Local */
  onViewChanges(): void;
  /** 候车区里派给这一路的问题有几个 */
  waiting: QueueItem[];
  /** 打开候车区 */
  onOpenWaiting(): void;
  /** 这一路还在路上时“排队”：放进候车区，到站后自动发 */
  /** 这一站还在回答时写的问题：自动登车、手动登车，或者只放进候车区不派车 */
  onQueue(text: string, mode: QueueMode): void;
  /** 要滚到眼前的那一站 */
  focus?: { stopId: string; n: number } | null;
  /** 窄窗口里面板是盖在地图上的抽屉：给了就显示收起按钮 */
  onCollapse?: () => void;
}

const REASONS: Record<string, string> = {
  "both-modified": "这一路和 Local 改了同一处",
  "both-added": "两边都新建了这个文件，内容不同",
  "modify-delete": "一边修改了它，另一边删除了它",
  rename: "两边对它做了不同的改名",
  binary: "二进制文件，两边都改了",
  "markers-left": "文件里还留着冲突标记",
  "local-file-in-the-way": "Local 里已经有一个被忽略的同名文件",
};

export function ChatPanel({ route, stops, offset, parent, onGoToRoute, permissionMode, projectName, onPermissionMode, waiting, onOpenWaiting, onQueue, focus, onCollapse, onModel, terminals, onOpenTerminal, onStopTerminal, onViewChanges }: Props) {
  const resolveConflict = useStore((s) => s.resolveConflict);
  const resync = useStore((s) => s.resync);
  const content = useStore((s) => s.content);
  const live = useStore((s) => s.live);
  const pending = useStore((s) => s.pendingAsk[route.id]);
  const permission = useStore((s) => s.permissions[route.id]);
  const lastSync = useStore((s) => s.lastSync[route.id]);
  const draft = useStore((s) => s.drafts[route.id] ?? "");
  const setDraft = useStore((s) => s.setDraft);
  const ask = useStore((s) => s.ask);
  const stop = useStore((s) => s.stop);
  const answerPermission = useStore((s) => s.answerPermission);

  const colors = routeColors(route);
  const busy = route.status === "answering" || route.status === "awaiting_permission";
  const blocked = route.status === "conflict";
  const current = stops.find((s) => s.status === "answering");
  const currentLive = current ? live[current.id] : undefined;

  // 新内容出来时，如果本来就在底部，跟着滚到底
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = log.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => {
    stick.current = true;
  }, [route.id]);

  // 从搜索或通知跳过来：滚到那一站，闪一下
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!focus) return;
    const el = log.current?.querySelector<HTMLElement>(`[data-stop="${focus.stopId}"]`);
    if (!el) return;
    stick.current = false;
    el.scrollIntoView({ block: "start" });
    setFlash(focus.stopId);
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [focus?.n, focus?.stopId]);

  /** 回答中写的问题怎么排：到站自动发、到站等你点、只放着 */
  const [queueMode, setQueueMode] = useState<QueueMode>("auto");
  const queued = waiting.length;
  const total = offset + stops.length;
  const send = () => {
    if (blocked || !draft.trim()) return;
    if (busy) {
      // 这一站还在路上：进候车区
      onQueue(draft, queueMode);
      setDraft(route.id, "");
    } else {
      void ask(route.id, draft);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <aside className={css.panel}>
      <header className={css.head} style={{ borderColor: colors.tag }}>
        <Plate route={route} size="l" />
        <div className={css.headText}>
          <h2 className="ell">{route.name}</h2>
          <p className="ell">
            {busy && <i className={css.statusDot} style={{ background: colors.line }} />}
            <StatusLine route={route} n={offset + stops.length} phase={pending !== undefined ? "syncing" : currentLive?.phase} />
            {busy && waiting[0] && <span className={css.next}>下一站{waiting[0].mode === "auto" ? "自动登车" : "等你登车"}</span>}
          </p>
        </div>
        {onCollapse && (
          <button className={css.collapse} aria-label="收起对话" title="收起对话" onClick={onCollapse}>
            <IconChevron size={16} />
          </button>
        )}
      </header>

      <div className={css.meta}>
        {/* 缩略线路：带来的站、自己的站、候车的问题 */}
        <div className={css.strip} aria-hidden style={{ ["--c" as string]: colors.line, ["--p" as string]: parent ? routeColors(parent).line : colors.line }}>
          {Array.from({ length: Math.min(offset, 6) }, (_, i) => (
            <i key={`p${i}`} data-kind="inherited" />
          ))}
          {stops.slice(-12).map((s) => (
            <i key={s.id} data-kind={s.status === "answering" ? "current" : s.kind === "minor" ? "minor" : "own"} />
          ))}
          {waiting.slice(0, 4).map((q) => (
            <i key={q.id} data-kind="waiting" />
          ))}
        </div>
        <div className={css.stripLabels}>
          {offset > 0 && parent && <span>{offset > 1 ? `1–${offset}` : "1"} 随 {parent.express ? `快${parent.express}` : `${parent.number}路`} 带来</span>}
          {(() => {
            const done = busy ? stops.length - 1 : stops.length;
            const range = (from: number, to: number) => (to > from ? `${from}–${to}` : String(from));
            return (
              <>
                {stops.length === 0 && <span>还没有自己的站</span>}
                {done > 0 && <span>{range(offset + 1, offset + done)} {offset > 0 ? "本对话" : "已到站"}</span>}
                {busy && stops.length > 0 && <span>{total} 回答中</span>}
              </>
            );
          })()}
          {queued > 0 && <span>{queued > 1 ? `${total + 1}–${total + queued}` : total + 1} 候车</span>}
        </div>
        <div className={css.metaRow}>
          <span className="ell">
            {parent && !route.express && offset > 0 ? `从 ${parent.number}路第 ${offset} 站分出` : parent && route.express ? `从 ${parent.number}路 提炼开出` : "自己的工作区"}
            {route.sessionId ? `，会话 ${route.sessionId.slice(0, 8)}` : ""}
          </span>
          {route.contextTokens !== null && (
            <span>
              上下文 <b>{route.contextTokens >= 1000 ? `${(route.contextTokens / 1000).toFixed(1)}k` : route.contextTokens}</b> / 200k
            </span>
          )}
        </div>
        <button className={css.waitBar} onClick={onOpenWaiting}>
          <IconWait size={16} />
          <b>本路候车 {queued} 条</b>
          <span>
            {waiting.slice(0, 2).map((q, i) => (
              <em key={q.id} data-mode={q.mode}>
                第 {total + i + 1} 站{q.mode === "auto" ? "自动" : "手动"}
              </em>
            ))}
          </span>
          <IconChevron size={14} />
        </button>
      </div>

      <div
        ref={log}
        className={css.log}
        role="log"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {parent && route.express && (
          <button className={css.inherited} onClick={() => onGoToRoute(parent.id)} title={`去 ${parent.name} 看原来的对话`}>
            <Plate route={parent} />
            <span>这是一条快线：全新的对话，带着 {parent.number}路 的摘要出发。原来的对话还在 {parent.number}路</span>
          </button>
        )}
        {parent && offset > 0 && (
          <button className={css.inherited} onClick={() => onGoToRoute(parent.id)} title={`去 ${parent.name} 看这几站`}>
            <Plate route={parent} />
            <span>{firstStops(offset)}随 {parent.number}路 带来，Claude 记得{offset > 1 ? "它们" : "它"}</span>
          </button>
        )}
        {stops.length === 0 && pending === undefined && <p className={css.hint}>{offset > 0 ? "这一路还没有自己的站。在下面写第一个问题，发车。" : "这一路还没有站。在下面写第一个问题，发车。"}</p>}

        {stops.map((s) => {
          const l = live[s.id];
          const items = l ? l.items : (content[s.id] ?? []);
          if (s.kind === "summary") {
            return (
              <section key={s.id} className={css.summary} style={{ borderColor: colors.line }}>
                <h3 style={{ color: colors.tag }}>交接摘要</h3>
                <div className={css.md}>
                  <Markdown remarkPlugins={[remarkGfm]}>{s.prompt}</Markdown>
                </div>
                <p>第一个问题会连同这份摘要一起交给 Claude。</p>
              </section>
            );
          }
          return (
            <section key={s.id} className={css.stop} data-stop={s.id} data-flash={flash === s.id}>
              <div className={css.ask} style={{ background: colors.tint }}>
                {s.prompt}
              </div>
              <div className={css.who}>
                Claude <span>第 {offset + s.seq} 站 · {s.name}</span>
              </div>
              <Items items={items} streaming={l?.phase === "answering"} />
              {l && items.length === 0 && <p className={css.waiting}>{l.phase === "starting" ? "正在启动 Claude…" : "Claude 在想…"}</p>}
              {s.status === "interrupted" && (
                <p className={css.noteAmber}>
                  没答完{s.error && s.error !== "已停车" ? `：${s.error}` : "（已停车）"}。这一站的改动留在这一路的工作区里，没有进 Local；接着问，下一站正常到站后会一起带过去。{" "}
                  {s.syncState === "unsynced" && (
                    <button className={css.inlineLink} onClick={onViewChanges}>
                      看改了什么
                    </button>
                  )}
                </p>
              )}
              {s.status === "done" && s.syncState === "synced" && <p className={css.synced}>改动已进 Local</p>}
              {s.syncState === "conflict" && (
                <p className={css.noteRed}>
                  <IconWarn size={14} /> 这一站的改动和 Local 冲突，没有写进 Local。
                </p>
              )}
            </section>
          );
        })}

        {pending !== undefined && (
          <section className={css.stop}>
            <div className={css.ask} style={{ background: colors.tint }}>
              {pending}
            </div>
            <p className={css.waiting}>正在把 Local 的新变化带进这一路…</p>
          </section>
        )}
      </div>

      {permission && (
        <div className={css.permission} role="alertdialog" aria-label="等你批准">
          <b>等你批准：{permission.tool}</b>
          <code>{permission.detail}</code>
          <div>
            <button className={css.allow} onClick={() => answerPermission(route.id, "allow")}>
              允许
            </button>
            {permission.canRemember && <button onClick={() => answerPermission(route.id, "allow-always")}>这一路以后都允许</button>}
            <button onClick={() => answerPermission(route.id, "deny")}>拒绝</button>
          </div>
        </div>
      )}

      {blocked && (
        <div className={css.conflict} role="alert">
          <b>
            <IconWarn size={16} /> 这一路的改动没法自动合进 Local
          </b>
          {lastSync?.status === "conflict" && lastSync.files.length > 0 && (
            <ul>
              {lastSync.files.map((f) => (
                <li key={f.path}>
                  <code>{f.path}</code>
                  <span>{REASONS[f.note] ?? f.note}</span>
                </li>
              ))}
            </ul>
          )}
          <p>Local 没有被改动，这一路的改动都留在它自己的工作区里。其他路照常。解决之前这一路不能问下一站。</p>
          <button className={css.resolve} onClick={() => void resolveConflict(route.id)}>
            让 {route.number}路 的 Claude 解决
            <small>在这一路开一站“解决同步冲突”，带上两边的代码；改好后自动再同步一次</small>
          </button>
          <button className={css.retry} onClick={() => void resync(route.id)}>
            我自己改好了，重新同步
          </button>
        </div>
      )}

      <TerminalStrip
        terminals={terminals}
        stopLabel={(id) => {
          const s = id ? stops.find((x) => x.id === id) : undefined;
          return s ? `第 ${offset + s.seq} 站` : null;
        }}
        onOpen={onOpenTerminal}
        onStop={onStopTerminal}
      />

      <footer className={css.composer}>
        {busy && (
          <div className={css.running}>
            <span style={{ color: colors.tag }}>
              <i style={{ background: colors.line }} />
              {route.status === "awaiting_permission" ? "等你批准" : pending !== undefined ? "同步中" : currentLive?.phase === "starting" ? "启动中" : currentLive?.phase === "finishing" ? "收尾中" : "回答中"}
            </span>
            <button onClick={() => stop(route.id)}>
              <IconStop size={12} /> 停车
            </button>
          </div>
        )}
        {busy && current && <p className={css.queueHint}>第 {offset + current.seq} 站还在回答，现在写的会进{queueMode === "unassigned" ? "候车区，先不派车" : ` ${route.express ? `快${route.express}` : `${route.number}路`} 候车`}</p>}
        <textarea
          value={draft}
          onChange={(e) => setDraft(route.id, e.target.value)}
          onKeyDown={onKey}
          placeholder={blocked ? "先解决冲突" : busy ? "这一站还在路上。写下一个问题，Enter 排队，到站后自动发" : "写下一个问题。Enter 发车，Shift+Enter 换行"}
          disabled={blocked}
          rows={3}
        />
        {busy && (
          <div className={css.seg} role="radiogroup" aria-label="排队方式">
            {(["auto", "manual", "unassigned"] as const).map((m) => (
              <button key={m} role="radio" aria-checked={queueMode === m} onClick={() => setQueueMode(m)} title={m === "auto" ? "这一站正常答完就自动发出" : m === "manual" ? "到站后等你点“登车”再发" : "放进候车区，先不派给哪一路"}>
                {m === "auto" ? "自动登车" : m === "manual" ? "手动登车" : "只放着"}
              </button>
            ))}
          </div>
        )}
        <div className={css.actions}>
          <PermissionModeControl mode={permissionMode} projectName={projectName} onChange={onPermissionMode} />
          <ModelControl model={route.model} routeLabel={route.express ? `快${route.express}` : `${route.number}路`} onChange={onModel} />
          <span>{route.status === "interrupted" ? "上一站没答完，可以接着问" : ""}</span>
          <button className={css.send} style={{ background: colors.tag }} disabled={blocked || !draft.trim()} onClick={send}>
            {busy ? "排队" : "发车"} <IconSend size={14} />
          </button>
        </div>
      </footer>
    </aside>
  );
}

function StatusLine({ route, n, phase }: { route: Route; n: number; phase?: LiveStop["phase"] | "syncing" }) {
  if (phase === "syncing") return <>第 {n + 1} 站 · 正在同步 Local</>;
  if (route.status === "awaiting_permission") return <b>第 {n} 站 · 等你批准</b>;
  if (route.status === "answering") return <b>第 {n} 站 · {phase === "starting" ? "正在启动 Claude" : phase === "finishing" ? "正在收尾" : "回答中"}</b>;
  if (route.status === "interrupted") return <>第 {n} 站没答完</>;
  if (route.status === "conflict") return <>有同步冲突</>;
  return <>{n === 0 ? "还没发车" : `已到第 ${n} 站`}</>;
}

function Items({ items, streaming }: { items: ChatItem[]; streaming?: boolean }) {
  // 连着的工具调用收成一组
  const blocks: ({ kind: "text"; text: string; last: boolean } | { kind: "tools"; tools: Extract<ChatItem, { kind: "tool" }>[] })[] = [];
  items.forEach((it, i) => {
    const prev = blocks.at(-1);
    if (it.kind === "text") blocks.push({ kind: "text", text: it.text, last: i === items.length - 1 });
    else if (prev?.kind === "tools") prev.tools.push(it);
    else blocks.push({ kind: "tools", tools: [it] });
  });
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "text" ? (
          <div key={i} className={css.md} data-streaming={streaming && b.last}>
            <Markdown remarkPlugins={[remarkGfm]}>{b.text}</Markdown>
          </div>
        ) : (
          <Tools key={i} tools={b.tools} />
        ),
      )}
    </>
  );
}

/** 一组工具调用。超过 4 次时只显示最后 3 次，其余收起来 */
function Tools({ tools }: { tools: Extract<ChatItem, { kind: "tool" }>[] }) {
  const [open, setOpen] = useState(false);
  const many = tools.length > 4;
  const shown = many && !open ? tools.slice(-3) : tools;
  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t.tool, (counts.get(t.tool) ?? 0) + 1);
  return (
    <div className={css.tools}>
      {many && (
        <button className={css.toolsMore} aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>{open ? "收起" : `还有 ${tools.length - 3} 次`}</span>
          <code className="ell">
            共 {tools.length} 次：{[...counts].map(([name, n]) => `${name} ×${n}`).join("、")}
          </code>
        </button>
      )}
      {shown.map((t, i) => (
        <div key={i} className={css.tool}>
          <span>{t.tool}</span>
          <code className="ell" title={t.detail}>
            {t.detail}
          </code>
          {t.added !== undefined && (
            <em>
              {t.added > 0 && <b>+{t.added}</b>}
              {(t.removed ?? 0) > 0 && <i>−{t.removed}</i>}
            </em>
          )}
        </div>
      ))}
    </div>
  );
}
