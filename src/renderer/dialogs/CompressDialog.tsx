import { useEffect, useMemo, useState } from "react";
import type { QueueItem, Route, Stop } from "../../shared";
import { IconClose, IconCompress, IconFolder, IconWait } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import css from "./Dialog.module.css";
import own from "./Compress.module.css";
import { estimateTokens, formatSummary, parseSummary, type SummaryGroup } from "../ui/summary-items";

/** 这一站的提炼进行到哪了（数据在外面，弹窗关了也还在） */
export interface DistillView {
  status: "running" | "ready" | "failed";
  summary: string;
  error: string | null;
  startedAt: number;
  /** 开始提炼时填的快线名称 */
  name: string;
}

export const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

interface Props {
  source: Route;
  stop: Stop;
  /** 这一站显示的序号 */
  stopNumber: number;
  /** 可以改成压缩到哪一站：这一路上答完了的站，带显示的序号 */
  choices: { stop: Stop; number: number }[];
  /** 这一路的会话现在占多少上下文；不知道为空 */
  contextTokens: number | null;
  /** 新的快线会是快几 */
  nextExpress: number;
  /** 还没开始提炼时为空 */
  distill?: DistillView;
  /** 候车区里还没派车的问题：可以挑一个当第一个问题 */
  waiting: QueueItem[];
  onRange(stopId: string): void;
  /** 开始提炼，或带着新的要求重新生成。direct：提炼好之后不用等我看，直接开出 */
  onStart(keep: string, name: string, direct: boolean): void;
  onSummaryChange(summary: string): void;
  /** 明确不要这条快线：摘要也丢掉 */
  onDiscard(): void;
  /** 只是收起弹窗：提炼继续，摘要留着 */
  onClose(): void;
  onCreate(summary: string, name: string, firstQuestion: string, itemId?: string): void;
}

/** “压缩成快线”：选范围、说要求 → （在后台提炼）→ 看一眼摘要、改一改 → 开出快线 */
export function CompressDialog({ source, stop, stopNumber, choices, contextTokens, nextExpress, distill, waiting, onRange, onStart, onSummaryChange, onDiscard, onClose, onCreate }: Props) {
  const step = distill && (distill.status === "ready" || distill.summary) ? "ready" : "intro";
  const error = distill?.error ?? null;
  const running = distill?.status === "running";
  /** 摘要已经出来了还点“不要”：先问一句，别让等了半天的东西一下就没了 */
  const [askDiscard, setAskDiscard] = useState(false);
  const [keep, setKeep] = useState("");
  const [name, setName] = useState(distill?.name ?? "");
  const [direct, setDirect] = useState(false);
  const [question, setQuestion] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const express = { number: 0, express: nextExpress };
  const green = routeColors(express).tag;
  const shownName = name.trim() || `${source.name} · 续`;
  const sourceLabel = source.express ? `快${source.express}` : `${source.number}路`;
  const isLast = choices.at(-1)?.stop.id === stop.id;
  const before = contextTokens && isLast ? contextTokens : null;

  useEffect(() => {
    // Esc 只在还没开始提炼时关闭弹窗；摘要出来之后不响应，免得误触
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && step === "intro" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  const groups = useMemo(() => parseSummary(distill?.summary ?? ""), [distill?.summary]);
  const change = (next: SummaryGroup[]) => onSummaryChange(formatSummary(next));
  const editItem = (g: number, i: number, text: string) => change(groups.map((x, gi) => (gi === g ? { ...x, items: x.items.map((it, ii) => (ii === i ? text : it)) } : x)));
  const dropItem = (g: number, i: number) => change(groups.map((x, gi) => (gi === g ? { ...x, items: x.items.filter((_, ii) => ii !== i) } : x)));
  const [adding, setAdding] = useState<string | null>(null);
  const addItem = () => {
    const text = (adding ?? "").trim();
    setAdding(null);
    if (!text) return;
    const next = groups.length > 0 ? groups.map((x, gi) => (gi === groups.length - 1 ? { ...x, items: [...x.items, text] } : x)) : [{ title: "", items: [text] }];
    change(next);
  };

  const plate = (
    <span className={own.dashedPlate} style={{ borderColor: green }}>
      <b style={{ background: green }}>快{nextExpress}</b>
      <span className="ell">{shownName}</span>
    </span>
  );

  return (
    <div className={css.scrim} data-low={step === "intro"}>
      <div className={`${css.dialog} ${css.wide}`} role="dialog" aria-modal aria-label="压缩成快线">
        <header>
          {plate}
          <h2>{step === "ready" ? "摘要好了，看一眼再发车" : "压缩成快线"}</h2>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <IconClose />
          </button>
        </header>

        {step === "intro" && (
          <>
            <div className={css.field} style={{ marginTop: 14 }}>
              <span>范围</span>
              <div className={own.range}>
                <Plate route={source} />
                <span>起点</span>
                <i>→</i>
                <select aria-label="压缩到哪一站" value={stop.id} onChange={(e) => onRange(e.target.value)} disabled={running}>
                  {choices.map((c) => (
                    <option key={c.stop.id} value={c.stop.id}>
                      第 {c.number} 站：{c.stop.name}
                    </option>
                  ))}
                </select>
                <small>
                  {stopNumber} 站{before ? ` · ${tokens(before)}` : ""}
                </small>
              </div>
            </div>
            <div className={`${css.note} ${own.inline}`}>
              会临时从第 {stopNumber} 站分出一个<b>只读</b>对话，请 Claude 把这 {stopNumber} 站提炼成一份交接摘要，用完就删。{sourceLabel} 不受影响，提炼的时候你可以接着在 {sourceLabel} 提问。
            </div>
            <label className={css.field} style={{ marginTop: 14 }}>
              <span>
                特别保留 <em className={own.optional}>可选</em>
              </span>
              <textarea rows={2} value={keep} onChange={(e) => setKeep(e.target.value)} placeholder="比如：保留改过的文件路径，和还没定下来的问题" />
            </label>
            <label className={css.field}>
              <span>快线名称</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${source.name} · 续`} maxLength={40} />
            </label>
            <div className={css.field}>
              <span>提炼好之后</span>
              <div className={own.after} role="radiogroup" aria-label="提炼好之后">
                {(
                  [
                    [false, "等我看一眼", "改摘要、写第一个问题再发车"],
                    [true, "直接开出", "快线停在摘要站，等你提问"],
                  ] as const
                ).map(([value, title, note]) => (
                  <label key={title} data-on={direct === value}>
                    <input type="radio" name="after-distill" checked={direct === value} onChange={() => setDirect(value)} />
                    <span>
                      <b>{title}</b>
                      <small>{note}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <p className={own.folder}>
              <IconFolder size={14} /> 快{nextExpress} 有自己的工作区，代码从 Local 的现在开始，和 {sourceLabel} 可以同时开发。
            </p>
            {error && <p className={css.error}>没有成功：{error}</p>}
            <footer>
              <span className={css.ask}>{running ? "正在提炼，可以先关掉去做别的" : before ? `提炼要启动一次 Claude，会用掉一次读完 ${tokens(before)} 上下文的量` : "提炼要启动一次 Claude，可能得等一会儿"}</span>
              <button type="button" className={css.ghost} onClick={onClose}>
                {running ? "先收起来" : "取消"}
              </button>
              <button type="button" className={css.confirm} style={{ background: green }} disabled={running} onClick={() => onStart(keep, name, direct)}>
                <IconCompress size={14} /> {running ? "提炼中…" : "开始提炼"}
              </button>
            </footer>
          </>
        )}

        {step === "ready" && (
          <>
            <p className={css.sub}>
              来自 <Plate route={source} /> 第 1–{stopNumber} 站 · 上下文{" "}
              {before ? (
                <>
                  <b>{tokens(before)}</b> →{" "}
                </>
              ) : (
                "约 "
              )}
              <b style={{ color: green }}>{tokens(estimateTokens(distill?.summary ?? ""))}</b> · 临时对话已删除
            </p>
            <div className={own.head}>
              <span>摘要站的内容</span>
              <small>点文字直接改</small>
            </div>
            <div className={own.items} aria-label="摘要站的内容">
              {groups.map((g, gi) => (
                <section key={gi}>
                  {g.title && <h3>{g.title}</h3>}
                  {g.items.map((item, i) => (
                    <div key={`${gi}-${i}-${g.items.length}`} className={own.item}>
                      <i style={{ background: green }} />
                      <span
                        role="textbox"
                        aria-label={`${g.title || "摘要"} 第 ${i + 1} 条`}
                        contentEditable
                        suppressContentEditableWarning
                        spellCheck={false}
                        onBlur={(e) => {
                          const text = (e.currentTarget.textContent ?? "").trim();
                          if (!text) dropItem(gi, i);
                          else if (text !== item) editItem(gi, i, text);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.preventDefault(), e.currentTarget.blur());
                        }}
                      >
                        {item}
                      </span>
                      <button type="button" aria-label="删掉这一条" onClick={() => dropItem(gi, i)}>
                        <IconClose size={12} />
                      </button>
                    </div>
                  ))}
                </section>
              ))}
              {adding === null ? (
                <button type="button" className={own.add} onClick={() => setAdding("")}>
                  + 加一条
                </button>
              ) : (
                <input
                  autoFocus
                  className={own.addInput}
                  aria-label="新的一条"
                  value={adding}
                  placeholder="写好按 Enter"
                  onChange={(e) => setAdding(e.target.value)}
                  onBlur={addItem}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "Enter") addItem();
                    if (e.key === "Escape") setAdding(null);
                  }}
                />
              )}
            </div>
            <div className={css.regen}>
              <input value={keep} onChange={(e) => setKeep(e.target.value)} placeholder="重新生成时特别保留…" />
              <button type="button" disabled={running} onClick={() => onStart(keep, name, false)}>
                {running ? "生成中…" : "重新生成"}
              </button>
            </div>
            {error && <p className={css.error}>重新生成没有成功：{error}</p>}
            <div className={own.head} style={{ marginTop: 14 }}>
              <span>第一个问题</span>
              {waiting.length > 0 && (
                <div className={own.pick}>
                  <button type="button" aria-expanded={picking} onClick={() => setPicking(!picking)}>
                    <IconWait size={14} /> 从候车区选
                  </button>
                  {picking && (
                    <ul role="listbox" aria-label="候车区里没派车的问题">
                      {waiting.map((q) => (
                        <li key={q.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={picked === q.id}
                            onClick={() => {
                              setQuestion(q.text);
                              setPicked(q.id);
                              setPicking(false);
                            }}
                          >
                            {q.text}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <label className={css.field} style={{ marginTop: 0 }}>
              <textarea aria-label="第一个问题" value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} placeholder="可以先不填。Claude 会连同摘要一起看到它" />
            </label>
            <label className={css.field}>
              <span>快线名称</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${source.name} · 续`} maxLength={40} />
            </label>
            <footer>
              {askDiscard ? (
                <>
                  <span className={css.ask}>摘要会丢掉，要重新等一次才能再有。</span>
                  <button type="button" className={css.ghost} onClick={() => setAskDiscard(false)}>
                    留着
                  </button>
                  <button type="button" className={css.destroy} onClick={onDiscard}>
                    丢掉
                  </button>
                </>
              ) : (
                <>
                  <span className={css.ask}>关掉就先放在候车区“在建快线”里，随时回来接着发车。</span>
                  <button type="button" className={own.discard} onClick={() => setAskDiscard(true)}>
                    不要这条快线
                  </button>
                  <button
                    type="button"
                    className={css.confirm}
                    style={{ background: green }}
                    disabled={!(distill?.summary ?? "").trim()}
                    onClick={() => onCreate(distill!.summary, name, question, picked && question.trim() === waiting.find((q) => q.id === picked)?.text ? picked : undefined)}
                  >
                    开出快{nextExpress}
                  </button>
                </>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
