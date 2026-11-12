import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ChatItem, Project, QueueItem, Stop } from "../../shared";
import { IconPlus, IconSearch } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import { dayLabel, excerpt, highlight, search, terms, type Hit, type SearchInput } from "./search";
import css from "./CommandPalette.module.css";

interface Props {
  data: SearchInput;
  /** 已经读回来的各站回答，预览用 */
  content: Record<string, ChatItem[]>;
  currentProject: Project | undefined;
  /** 站在界面上显示的序号 */
  stopNumber(stop: Stop): number;
  /** 预览到了某一路的站：外面可以趁机把这一路的回答读回来 */
  onPreview(routeId: string): void;
  onJump(stop: Stop): void;
  onFork(stop: Stop): void;
  onOpenQueue(item: QueueItem): void;
  onNewRoute(name: string): void;
  onQueueAdd(text: string): void;
  onClose(): void;
}

const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const MOD = mac ? "⌘" : "Ctrl ";

/** 命令面板（Ctrl/⌘ K）：搜提问、候车区和命令。只收数据、发事件 */
export function CommandPalette({ data, content, currentProject, stopNumber, onPreview, onJump, onFork, onOpenQueue, onNewRoute, onQueueAdd, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [scoped, setScoped] = useState(false);
  const [index, setIndex] = useState(0);
  const result = useMemo(() => search(data, query, scoped ? (currentProject?.id ?? null) : null), [data, query, scoped, currentProject]);
  const words = useMemo(() => terms(query.replace(/^\s*>/, "")), [query]);
  const hit = result.all[Math.min(index, result.all.length - 1)];
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => setIndex(0), [query, scoped]);
  useEffect(() => {
    if (hit?.kind === "stop") onPreview(hit.route.id);
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit?.id]);

  const open = (h: Hit | undefined, fork = false) => {
    if (!h) return;
    if (h.kind === "stop") {
      if (fork && !canFork(h.stop)) return;
      (fork ? onFork : onJump)(h.stop);
    } else if (h.kind === "queue") onOpenQueue(h.item);
    else if (h.command === "new-route") onNewRoute(h.text);
    else onQueueAdd(h.text);
    onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = result.all.length;
      if (n) setIndex((i) => (Math.min(i, n - 1) + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(hit, e.ctrlKey || e.metaKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const mark = (text: string): ReactNode => highlight(text, words).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text));
  const row = (h: Hit, children: ReactNode) => (
    <button key={h.id} role="option" aria-selected={h.id === hit?.id} className={css.row} onMouseMove={() => setIndex(result.all.indexOf(h))} onClick={() => open(h)}>
      {children}
      {h.id === hit?.id && <kbd className={css.enter}>↵</kbd>}
    </button>
  );

  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={css.palette} role="dialog" aria-modal aria-label="搜索" onKeyDown={onKey}>
        <div className={css.input}>
          <IconSearch size={18} />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜提问、候车区，或输入 > 只搜命令" spellCheck={false} aria-label="搜索" />
          <div className={css.scope} role="radiogroup" aria-label="范围">
            <button role="radio" aria-checked={!scoped} onClick={() => setScoped(false)}>
              全部项目
            </button>
            {currentProject && (
              <button role="radio" aria-checked={scoped} onClick={() => setScoped(true)}>
                只看 {currentProject.name}
              </button>
            )}
          </div>
        </div>

        <div className={css.body}>
          <div className={css.list} ref={list} role="listbox">
            {result.stops.length > 0 && <h3>{words.length ? `提问 · ${result.stops.length} 条` : "最近的站"}</h3>}
            {result.stops.map((h) =>
              row(
                h,
                <>
                  <Plate route={h.route} />
                  <span className={css.text}>
                    <b className="ell">
                      {h.stop.kind === "summary" ? "摘要站" : `第 ${stopNumber(h.stop)} 站`}：{mark(h.stop.kind === "summary" ? oneLine(h.stop.prompt) : h.stop.name)}
                    </b>
                    <small className="ell">
                      {h.project.name} · {dayLabel(h.stop.startedAt)}
                      {h.stop.kind !== "summary" && h.stop.prompt !== h.stop.name && <> · {mark(excerpt(h.stop.prompt, words, 60))}</>}
                    </small>
                  </span>
                </>,
              ),
            )}
            {result.queue.length > 0 && <h3>候车区 · {result.queue.length} 条</h3>}
            {result.queue.map((h) =>
              row(
                h,
                <>
                  {h.route ? <Plate route={h.route} /> : <i className={css.slot} />}
                  <span className={css.text}>
                    <b className="ell">{mark(oneLine(h.item.text))}</b>
                  </span>
                  <em>{h.route ? (h.item.mode === "auto" ? "自动登车" : "手动登车") : "未派车"}</em>
                </>,
              ),
            )}
            {!query.trimStart().startsWith(">") && words.length > 0 && result.stops.length + result.queue.length === 0 && <p className={css.none}>没有找到含“{query.trim()}”的提问。</p>}
            <h3>命令</h3>
            {result.commands.map((h) =>
              row(
                h,
                <>
                  <i className={css.cmd}>{h.command === "new-route" ? <IconPlus size={14} /> : "≡"}</i>
                  <span className={css.text}>
                    <b className="ell">
                      {h.command === "new-route" ? (h.text ? <>开一路新车，名叫“{mark(h.text)}”</> : "开一路新车") : <>把“{mark(h.text)}”放进候车区</>}
                    </b>
                  </span>
                </>,
              ),
            )}
          </div>

          <div className={css.preview}>
            {hit?.kind === "stop" && <StopPreview hit={hit} data={data} content={content[hit.stop.id]} words={words} n={stopNumber(hit.stop)} mark={mark} onJump={() => open(hit)} onFork={() => open(hit, true)} />}
            {hit?.kind === "queue" && (
              <>
                <header>
                  {hit.route ? <Plate route={hit.route} /> : <i className={css.slot} />}
                  <b>{hit.route ? `派给了 ${hit.route.name}` : "还没派车"}</b>
                </header>
                <h4>候车的问题</h4>
                <p className={css.ask}>{mark(hit.item.text)}</p>
                <p className={css.dim}>{hit.route ? (hit.item.mode === "auto" ? "这一路到站后自动发出。" : "这一路到站后等你点“登车”。") : "在候车区里派给一路车，或者为它开一路新车。"}</p>
                <footer>
                  <button className={css.primary} onClick={() => open(hit)}>
                    {hit.route ? "去这一路" : "去候车区"}
                  </button>
                </footer>
              </>
            )}
            {hit?.kind === "command" && (
              <>
                <header>
                  <b>{hit.command === "new-route" ? "开一路新车" : "放进候车区"}</b>
                </header>
                <p className={css.dim}>
                  {hit.command === "new-route"
                    ? `在${currentProject ? ` ${currentProject.name} ` : "当前项目"}里开一条新的对话${hit.text ? `，名叫“${hit.text}”` : ""}。新的会话、新的工作区，代码从 Local 的现在开始。`
                    : `把“${hit.text}”作为一个问题放进${currentProject ? ` ${currentProject.name} ` : ""}的候车区，先不派车。`}
                </p>
              </>
            )}
          </div>
        </div>

        <div className={css.keys}>
          <span>
            <kbd>↑↓</kbd> 选择
          </span>
          <span>
            <kbd>↵</kbd> 打开
          </span>
          <span>
            <kbd>{MOD}↵</kbd> 从这站开新对话
          </span>
          <span>
            <kbd>&gt;</kbd> 只搜命令
          </span>
          <span className={css.esc}>
            <kbd>Esc</kbd> 关闭
          </span>
        </div>
      </div>
    </div>
  );
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 80);
const canFork = (stop: Stop) => stop.status !== "answering" && !!stop.lastMessageId;

function StopPreview({ hit, data, content, words, n, mark, onJump, onFork }: { hit: Extract<Hit, { kind: "stop" }>; data: SearchInput; content: ChatItem[] | undefined; words: string[]; n: number; mark(text: string): ReactNode; onJump(): void; onFork(): void }) {
  const colors = routeColors(hit.route);
  const stops = Object.values(data.stops)
    .filter((s) => s.routeId === hit.route.id)
    .sort((a, b) => a.seq - b.seq);
  const answer = (content ?? [])
    .filter((it) => it.kind === "text")
    .map((it) => it.text)
    .join("\n");
  return (
    <>
      <header>
        <Plate route={hit.route} />
        <b className="ell">
          {hit.route.name}，{hit.stop.kind === "summary" ? "摘要站" : `第 ${n} 站`}
        </b>
      </header>
      {/* 这一路的缩略线：实心的是选中的这一站 */}
      <div className={css.mini} aria-hidden>
        {stops.slice(-14).map((s) => (
          <i key={s.id} data-on={s.id === hit.stop.id} style={{ borderColor: colors.line, background: s.id === hit.stop.id ? colors.line : undefined, ["--line" as string]: colors.line }} />
        ))}
      </div>
      <h4>{hit.stop.kind === "summary" ? "交接摘要" : "你的提问"}</h4>
      <p className={css.ask}>{mark(hit.stop.prompt.length > 400 ? hit.stop.prompt.slice(0, 400) + "……" : hit.stop.prompt)}</p>
      {hit.stop.kind !== "summary" && (
        <>
          <h4>Claude</h4>
          <p className={css.answer}>{answer ? mark(excerpt(answer, words, 220)) : hit.stop.status === "answering" ? "还在回答…" : content ? "这一站没有文字回答。" : "正在读取回答…"}</p>
        </>
      )}
      <footer>
        <button className={css.primary} onClick={onJump}>
          跳到这站
        </button>
        <button onClick={onFork} disabled={!canFork(hit.stop)} title={canFork(hit.stop) ? undefined : "这一站还不能分叉"}>
          从这站开新对话
        </button>
      </footer>
    </>
  );
}
