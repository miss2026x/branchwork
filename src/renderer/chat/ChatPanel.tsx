import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatItem, Effort, PermissionMode, PromptImage, QueueItem, QueueMode, Route, Stop, Terminal, SyncFile } from "../../shared";
import { currentModel, type OptionsState } from "../ui/claude-options";
import { TerminalStrip } from "../terminal/TerminalStrip";
import { ModelControl } from "./ModelControl";
import { EffortControl } from "./EffortControl";
import { PermissionModeControl } from "./PermissionModeControl";
import { firstStops } from "../stores/numbering";
import { draftId, useStore, type LiveStop } from "../stores/store";
import { draftStatus, toPrompt, type DraftImage } from "./draft";
import { PromptInput, type PromptInputHandle } from "./PromptInput";
import { PromptView } from "./PromptView";
import imgCss from "./Images.module.css";
import { IconChevron, IconClip, IconEdit, IconEye, IconSend, IconStop, IconTerminal, IconWait, IconWarn } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import { ordinal } from "../stores/numbering";
import css from "./ChatPanel.module.css";
import { Md, StreamingMd } from "./Md";

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
  onPermissionMode(mode: PermissionMode): void;
  /** 正在看的以前的某一站；没有就是跟着最新 */
  viewing?: Stop;
  onBackToLatest(): void;
  /** 这一路换模型 */
  onModel(model: string | null, effort: Effort | null): void;
  /** 这个项目能选的模型和批准方式（从这台电脑上的 Claude Code 读的） */
  claudeOptions: OptionsState;
  /** 这一路的后台终端 */
  terminals: Terminal[];
  onOpenTerminal(terminalId: string): void;
  onStopTerminal(terminalId: string): void;
  /** 看这一路的工作区里有哪些改动还没进 Local */
  onViewChanges(): void;
  /** 丢掉这一路工作区里没进 Local 的改动 */
  onDiscard(): void;
  /** 候车区里派给这一路的问题有几个 */
  waiting: QueueItem[];
  /** 打开候车区 */
  onOpenWaiting(): void;
  /** 这一路还在路上时“排队”：放进候车区，到站后自动发 */
  /** 这一站还在回答时写的问题：自动登车、手动登车，或者只放进候车区不派车 */
  onQueue(text: string, mode: QueueMode, images: PromptImage[]): void;
  /** 要滚到眼前的那一站 */
  focus?: { stopId: string; n: number } | null;
  /** 冲突的文件在 Local 里上一次是谁改的，说成一句话 */
  whoChanged?: (by: NonNullable<SyncFile["by"]>) => string;
  /** 窄窗口里面板是盖在地图上的抽屉：给了就显示收起按钮 */
  onCollapse?: () => void;
}

const NO_IMAGES: DraftImage[] = [];

const REASONS: Record<string, string> = {
  "both-modified": "这一路和 Local 改了同一处",
  "both-added": "两边都新建了这个文件，内容不同",
  "modify-delete": "一边修改了它，另一边删除了它",
  rename: "两边对它做了不同的改名",
  binary: "二进制文件，两边都改了",
  "markers-left": "文件里还留着冲突标记",
  "local-file-in-the-way": "Local 里已经有一个被忽略的同名文件",
};

export function ChatPanel({ route, stops, offset, parent, onGoToRoute, permissionMode, onPermissionMode, waiting, onOpenWaiting, onQueue, focus, onCollapse, viewing, onBackToLatest, onModel, claudeOptions, terminals, onOpenTerminal, onStopTerminal, onViewChanges, onDiscard, whoChanged }: Props) {
  const resolveConflict = useStore((s) => s.resolveConflict);
  const resync = useStore((s) => s.resync);
  const content = useStore((s) => s.content);
  const live = useStore((s) => s.live);
  const pending = useStore((s) => s.pendingAsk[route.id]);
  const permission = useStore((s) => s.permissions[route.id]);
  const lastSync = useStore((s) => s.lastSync[route.id]);
  const draft = useStore((s) => s.drafts[route.id] ?? "");
  const draftImages = useStore((s) => s.draftImages[route.id] ?? NO_IMAGES);
  const pendingImages = useStore((s) => s.pendingImages[route.id]);
  const setDraft = useStore((s) => s.setDraft);
  const patchDraftImage = useStore((s) => s.patchDraftImage);
  const input = useRef<PromptInputHandle>(null);
  /** 拖着图片经过对话栏：整栏变成落点，显示有几张 */
  const [dropping, setDropping] = useState<number | null>(null);
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
  // 看以前的某一站：只显示到这一站，滚到它的末尾；回到最新时滚到底，接着跟随
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stick.current = true;
  }, [viewing?.id]);

  // 有命令等批准：卡片在对话末尾，滚过去让它露出来
  useLayoutEffect(() => {
    const el = log.current;
    if (el && permission) (el.scrollTop = el.scrollHeight), (stick.current = true);
  }, [permission?.requestId]);

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

  /** 对话里显示哪些站：在看以前的某一站时只到那一站为止 */
  const shown = viewing ? stops.filter((s) => s.seq <= viewing.seq) : stops;

  /** 回答中写的问题怎么排：到站自动发、到站等你点、只放着 */
  const [queueMode, setQueueMode] = useState<QueueMode>("auto");
  const queued = waiting.length;
  /** 短确认（小点）不占站号 */
  const counted = stops.filter((s) => s.kind !== "minor").length;
  const num = (s: Stop) => offset + ordinal(s, stops);
  const total = offset + counted;
  const [discarding, setDiscarding] = useState(false);
  const denyNote = useRef<HTMLInputElement>(null);
  // 等你批准时：按 1、2、3 直接选（正在打字时不抢）
  useEffect(() => {
    if (!permission) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "1") answerPermission(route.id, "allow");
      else if (e.key === "2" && permission.canRemember) answerPermission(route.id, "allow-always");
      else if (e.key === "3") denyNote.current?.focus();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission?.requestId, route.id]);

  const status = draftStatus(draft, draftImages);
  const send = () => {
    if (blocked || status !== "ok") return;
    const q = toPrompt(draft, draftImages);
    if (busy) {
      // 这一站还在路上：进候车区
      onQueue(q.text, queueMode, q.images);
      setDraft(route.id, "", []);
    } else {
      void ask(route.id, q.text, q.images);
    }
  };
  const canDrop = !viewing && !blocked;
  const fileCount = (e: React.DragEvent) => [...e.dataTransfer.items].filter((i) => i.kind === "file").length;

  return (
    <aside
      className={css.panel}
      onDragOver={(e) => {
        if (!canDrop || ![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (dropping === null) setDropping(fileCount(e));
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(null)}
      onDrop={(e) => {
        setDropping(null);
        if (!canDrop || ![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        input.current?.insertFiles([...e.dataTransfer.files]);
      }}
    >
      {dropping !== null && (
        <div className={imgCss.dropZone} aria-hidden>
          <b>松开，插在光标处</b>
          <span>{dropping > 0 ? `${dropping} 个文件 · ` : ""}PNG、JPG、GIF、WebP</span>
        </div>
      )}
      <header className={css.head} style={{ borderColor: colors.tag }}>
        <Plate route={route} size="l" />
        <div className={css.headText}>
          <h2 className="ell">{route.name}</h2>
          <p className="ell">
            {viewing && (
              <>
                <b>正在看第 {num(viewing)} 站</b>
                <button className={css.back} onClick={onBackToLatest}>
                  回到最新
                </button>
              </>
            )}
            {!viewing && (
              <span className={busy ? css.status : undefined} style={busy ? { color: route.status === "awaiting_permission" ? "var(--amber-text)" : colors.text } : undefined}>
                {busy && <i className={css.statusDot} style={{ background: route.status === "awaiting_permission" ? "var(--amber)" : colors.line }} />}
                <StatusLine route={route} n={total} phase={pending !== undefined ? "syncing" : currentLive?.phase} />
              </span>
            )}
            {!viewing && busy && waiting[0] && <span>下一站 {total + 1} {waiting[0].mode === "auto" ? "自动登车" : "等你登车"}</span>}
          </p>
        </div>
        {onCollapse && (
          <button className={css.collapse} aria-label="收起对话" title="收起对话" onClick={onCollapse}>
            <IconChevron size={16} />
          </button>
        )}
      </header>

      <div className={css.meta}>
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

        {shown.map((s) => {
          const l = live[s.id];
          const items = l ? l.items : (content[s.id] ?? []);
          if (s.kind === "summary") {
            return (
              <section key={s.id} className={css.summary} style={{ borderColor: colors.line }}>
                <h3 style={{ color: colors.tag }}>交接摘要</h3>
                <div className={css.md}>
                  <Md>{s.prompt}</Md>
                </div>
                <p>第一个问题会连同这份摘要一起交给 Claude。</p>
              </section>
            );
          }
          return (
            <section key={s.id} className={css.stop} data-stop={s.id} data-flash={flash === s.id}>
              {/* 设计稿：站号小字在提问上方靠右；短确认（小点）不占站号 */}
              <div className={`${css.askNo} ell`}>
                {s.kind === "minor" ? `接着第 ${num(s)} 站` : `第 ${num(s)} 站`} · {s.name}
              </div>
              <div className={css.ask} style={{ background: colors.tint }}>
                <PromptView text={s.prompt} ownerId={s.id} count={s.images ?? 0} title={`第 ${num(s)} 站`} />
              </div>
              <div className={css.who}>Claude</div>
              <Items items={items} streaming={l?.phase === "answering"} />
              {l && items.length === 0 && <p className={css.waiting}>{l.phase === "starting" ? "正在启动 Claude…" : "Claude 在想…"}</p>}
              {s.status === "interrupted" && (
                <>
                <p className={css.noteAmber}>
                  没答完{s.error && s.error !== "已停车" ? `：${s.error}` : "（已停车）"}。这一站的改动留在这一路的工作区里，没有进 Local；接着问，下一站正常到站后会一起带过去。{" "}
                  {s.syncState === "unsynced" && (
                    <button className={css.inlineLink} onClick={onViewChanges}>
                      看改了什么
                    </button>
                  )}
                </p>
                {s.id === stops.at(-1)?.id && route.status === "interrupted" && (
                  <div className={css.afterBreak}>
                    <button className={css.primaryBtn} onClick={() => void ask(route.id, "接着上一站没做完的地方继续，把它做完。")}>
                      让 Claude 接着做完
                    </button>
                    {s.syncState === "unsynced" &&
                      (discarding ? (
                        <>
                          <span>丢掉后找不回来，确定？</span>
                          <button className={css.dangerBtn} onClick={() => (setDiscarding(false), onDiscard())}>
                            丢掉
                          </button>
                          <button onClick={() => setDiscarding(false)}>不丢</button>
                        </>
                      ) : (
                        <button onClick={() => setDiscarding(true)}>丢掉这些改动</button>
                      ))}
                  </div>
                )}
                </>
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

        {/* 等你批准（设计稿“权限请求”）：卡片排在对话里，紧跟着这一站，不挤占对话的高度 */}
        {permission && !viewing && (
          <section className={css.permission} role="alertdialog" aria-label="等你批准" aria-describedby={permission.reason ? "perm-reason" : undefined}>
            <header>
              <span>{/bash|终端|command/i.test(permission.tool) ? <IconTerminal size={16} /> : /write|edit/i.test(permission.tool) ? <IconEdit size={16} /> : <IconWarn size={16} />}</span>
              <h3>Claude 想{/bash|终端|command/i.test(permission.tool) ? "运行一条命令" : /write|edit/i.test(permission.tool) ? "改一个文件" : `用 ${permission.tool}`}</h3>
            </header>
            <code>{permission.detail}</code>
            {permission.reason && <p id="perm-reason">{permission.reason}</p>}
            <div className={css.choices}>
              <button className={css.allow} onClick={() => answerPermission(route.id, "allow")}>
                <kbd>1</kbd>
                <span className="ell">允许这一次</span>
              </button>
              {permission.canRemember && (
                <button onClick={() => answerPermission(route.id, "allow-always")}>
                  <kbd>2</kbd>
                  <span className="ell">这一路以后都允许</span>
                </button>
              )}
              <div className={css.deny}>
                <label htmlFor="perm-deny">
                  <kbd>3</kbd> 不允许，告诉 Claude 换个做法
                </label>
                <div>
                  <input id="perm-deny" ref={denyNote} aria-label="告诉 Claude 换个做法" placeholder="可以不写，比如：别装新库，用自带的" maxLength={500} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && answerPermission(route.id, "deny", e.currentTarget.value)} />
                  <button onClick={() => answerPermission(route.id, "deny", denyNote.current?.value)}>拒绝</button>
                </div>
              </div>
            </div>
            {queued > 0 && <small>候车区里排给 {route.express ? `快${route.express}` : `${route.number}路`} 的问题，会等这一站结束后再发。</small>}
          </section>
        )}

        {pending !== undefined && !viewing && (
          <section className={css.stop}>
            <div className={css.ask} style={{ background: colors.tint }}>
              <PromptView text={pending} images={pendingImages} title="正在发出的提问" />
            </div>
            <p className={css.waiting}>正在把 Local 的新变化带进这一路…</p>
          </section>
        )}
      </div>

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
                  <span>
                    {f.lines && `第 ${f.lines[0]}${f.lines[1] > f.lines[0] ? `–${f.lines[1]}` : ""} 行附近：`}
                    {REASONS[f.note] ?? f.note}
                    {f.by && whoChanged ? `。${whoChanged(f.by)}` : ""}
                  </span>
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
        route={route}
        terminals={terminals}
        stopLabel={(id) => {
          const s = id ? stops.find((x) => x.id === id) : undefined;
          return s ? `第 ${num(s)} 站` : null;
        }}
        onOpen={onOpenTerminal}
        onStop={onStopTerminal}
      />

      {viewing && (
        <div className={css.viewingNote}>
          <IconEye size={18} />
          <span>
            在看第 {num(viewing)} 站的记录。要从这里接着问，用地图底部的“从第 {num(viewing)} 站开新对话”。
            <button className={css.inlineLink} onClick={onBackToLatest}>
              回到最新
            </button>
          </span>
        </div>
      )}
      <footer className={css.composer} hidden={!!viewing}>
        {busy && (
          <div className={css.running}>
            <span style={{ color: route.status === "awaiting_permission" ? "var(--amber-text)" : colors.tag }}>
              <i style={{ background: route.status === "awaiting_permission" ? "var(--amber)" : colors.line }} />
              {route.status === "awaiting_permission" ? "等你批准" : pending !== undefined ? "同步中" : currentLive?.phase === "starting" ? "启动中" : currentLive?.phase === "finishing" ? "收尾中" : "回答中"}
            </span>
            <button onClick={() => stop(route.id)}>
              <IconStop size={12} /> 停车
            </button>
          </div>
        )}
        {busy && current && (
          <div className={css.statusRow}>
            <span className="ell">
              第 {num(current)} 站还在回答，写好的先进{queueMode === "unassigned" ? "候车区，先不派车" : ` ${route.express ? `快${route.express}` : `${route.number}路`} 候车`}
            </span>
            <div className={css.seg} role="radiogroup" aria-label="排队方式">
              {(["auto", "manual", "unassigned"] as const).map((m) => (
                <button key={m} role="radio" aria-checked={queueMode === m} onClick={() => setQueueMode(m)} title={m === "auto" ? "这一站正常答完就自动发出" : m === "manual" ? "到站后等你点“登车”再发" : "放进候车区，先不派给哪一路"}>
                  {m === "auto" ? "自动登车" : m === "manual" ? "手动登车" : "只放着"}
                </button>
              ))}
            </div>
          </div>
        )}
        {route.status === "interrupted" && (
          <p className={`${css.statusRow} ${css.afterStop}`}>
            <i aria-hidden />
            <span className="ell">上一站没答完，改动还在工作区。接着问，下一站答完一起进 Local</span>
          </p>
        )}
        {/* 设计稿 4-6：输入框、这一路的三个选择、发车按钮在同一个框里 */}
        <div className={css.box} data-disabled={blocked}>
          <PromptInput
            ref={input}
            text={draft}
            images={draftImages}
            onChange={(text, images) => setDraft(route.id, text, images)}
            onImage={(id, patch) => patchDraftImage(route.id, id, patch)}
            onEnter={send}
            newId={draftId}
            label="下一个问题"
            placeholder={blocked ? "先解决冲突" : busy ? "这一站还在路上。写下一个问题，到站后自动发" : route.status === "interrupted" ? "接着说，比如：继续，把测试也补上" : "写下一个问题。Enter 发车，Shift+Enter 换行；图片可以直接粘贴、拖进来"}
            disabled={blocked}
          />
          <div className={css.toolbar}>
            <div className={css.controls}>
              <button className={css.attach} aria-label="添加图片" title="添加图片（也可以直接粘贴或拖进来）" disabled={blocked} onClick={() => input.current?.pickFiles()}>
                <IconClip size={16} />
              </button>
              <PermissionModeControl mode={permissionMode} routeLabel={route.express ? `快${route.express}` : `${route.number}路`} options={claudeOptions} model={currentModel(claudeOptions, route.model)} onChange={onPermissionMode} />
              <ModelControl model={route.model} effort={route.effort} options={claudeOptions} routeLabel={route.express ? `快${route.express}` : `${route.number}路`} onChange={onModel} />
              <EffortControl effort={route.effort} model={currentModel(claudeOptions, route.model)} routeLabel={route.express ? `快${route.express}` : `${route.number}路`} onChange={(effort) => onModel(route.model, effort)} />
            </div>
            <button className={css.send} style={{ background: colors.tag }} disabled={blocked || status !== "ok"} title={status === "loading" ? "图片还在处理，等一下" : status === "bad" ? "有图片读不了：去掉它或换一张" : undefined} onClick={send}>
              {busy ? "排队" : route.status === "interrupted" ? "接着问" : "发车"} <kbd>↵</kbd>
            </button>
          </div>
        </div>
      </footer>
    </aside>
  );
}

function StatusLine({ route, n, phase }: { route: Route; n: number; phase?: LiveStop["phase"] | "syncing" }) {
  if (phase === "syncing") return <>第 {n + 1} 站 · 正在同步 Local</>;
  if (route.status === "awaiting_permission") return <>第 {n} 站暂停，等你批准</>;
  if (route.status === "answering") return <>第 {n} 站{phase === "starting" ? "正在启动 Claude" : phase === "finishing" ? "正在收尾" : "回答中"}</>;
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
            {streaming ? <StreamingMd>{b.text}</StreamingMd> : <Md>{b.text}</Md>}
          </div>
        ) : (
          <Tools key={i} tools={b.tools} running={!!streaming && i === blocks.length - 1} />
        ),
      )}
    </>
  );
}

/** 一组工具调用。超过 4 次时只显示最后 3 次，其余收起来 */
function Tools({ tools, running }: { tools: Extract<ChatItem, { kind: "tool" }>[]; running?: boolean }) {
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
          {running && i === shown.length - 1 && t.added === undefined && <span className={css.toolRunning} role="img" aria-label="正在运行" />}
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
