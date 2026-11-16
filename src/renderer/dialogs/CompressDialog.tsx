import { useEffect, useMemo, useState } from "react";
import type { QueueItem, Route, Stop } from "../../shared";
import type { RunSettings } from "../stores/store";
import type { OptionsState } from "../ui/claude-options";
import { IconClose, IconCompress, IconFolder } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import { Select } from "../ui/Select";
import css from "./Dialog.module.css";
import own from "./Compress.module.css";
import { FirstStop, usableRun, type RunChoice } from "./FirstStop";
import sheet from "./NewRoute.module.css";
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
  onCreate(summary: string, name: string, firstQuestion: string, itemId?: string, run?: RunSettings): void;
  /** 这个项目能选的模型和批准方式（从这台电脑上的 Claude Code 读的）：快线默认沿用来源那一路 */
  claudeOptions: OptionsState;
}

/** “压缩成快线”：选范围、说要求 → （在后台提炼）→ 看一眼摘要、改一改 → 开出快线 */
export function CompressDialog({ source, stop, stopNumber, choices, contextTokens, nextExpress, distill, waiting, claudeOptions, onRange, onStart, onSummaryChange, onDiscard, onClose, onCreate }: Props) {
  const step = distill && (distill.status === "ready" || distill.summary) ? "ready" : "intro";
  const error = distill?.error ?? null;
  const running = distill?.status === "running";
  /** 摘要已经出来了还点“不要”：先问一句，别让等了半天的东西一下就没了 */
  const [askDiscard, setAskDiscard] = useState(false);
  const [keep, setKeep] = useState("");
  const [name, setName] = useState(distill?.name ?? "");
  const [direct, setDirect] = useState(false);
  const [question, setQuestion] = useState("");
  const [picked, setPicked] = useState<QueueItem | null>(null);
  const [chosen, setChosen] = useState<Partial<RunChoice>>({});
  const run = usableRun({ model: source.model, effort: source.effort, permissionMode: source.permissionMode, ...chosen }, claudeOptions);
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

  const create = () => onCreate(distill!.summary, name, question, picked && question.trim() === picked.text ? picked.id : undefined, run);

  const plate = (
    <span className={own.dashedPlate} style={{ borderColor: green }}>
      <b style={{ background: green }}>快{nextExpress}</b>
      <span className="ell">{shownName}</span>
    </span>
  );

  return (
    <div className={css.scrim} data-low={step === "intro"}>
      <div className={`${css.dialog} ${sheet.dialog} ${sheet.tall}`} role="dialog" aria-modal aria-label="压缩成快线">
        <header className={sheet.head}>
          {plate}
          <h2>{step === "ready" ? "摘要好了，看一眼再发车" : "压缩成快线"}</h2>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <IconClose size={14} />
          </button>
        </header>

        {step === "intro" && (
          <>
            <div className={sheet.body}>
              <div className={sheet.row}>
                <span className={sheet.label}>范围</span>
                <Plate route={source} />
                <span className={own.rangeText}>第 1 站 →</span>
                <div className={own.rangePick}>
                  <Select label="压缩到哪一站" value={stop.id} options={choices.map((c) => ({ value: c.stop.id, label: `第 ${c.number} 站：${c.stop.name}` }))} onChange={(id) => !running && onRange(id)} />
                </div>
                <small className={own.rangeText}>
                  {stopNumber} 站{before ? ` · ${tokens(before)}` : ""}
                </small>
              </div>
              <div className={sheet.row}>
                <label className={sheet.label} htmlFor="cp-name">
                  名称
                </label>
                <input id="cp-name" className={sheet.name} value={name} onChange={(e) => setName(e.target.value)} placeholder={`${source.name} · 续`} maxLength={40} />
              </div>
              <div className={sheet.box}>
                <label htmlFor="cp-keep">
                  特别保留 <span className={own.optional}>可选</span>
                </label>
                <textarea id="cp-keep" rows={3} value={keep} onChange={(e) => setKeep(e.target.value)} placeholder="比如：保留改过的文件路径，和还没定下来的问题" />
              </div>
              <div className={sheet.row}>
                <span className={sheet.label}>提炼好</span>
                <div className={own.seg} role="radiogroup" aria-label="提炼好之后">
                  {(
                    [
                      [false, "等我看一眼"],
                      [true, "直接开出"],
                    ] as const
                  ).map(([value, title]) => (
                    <button key={title} type="button" role="radio" aria-checked={direct === value} onClick={() => setDirect(value)}>
                      {title}
                    </button>
                  ))}
                </div>
                <small className={own.rangeText}>{direct ? "快线停在摘要站，等你提问" : "改摘要、写第一个问题再发车"}</small>
              </div>
              <p className={sheet.workspace} title={`快${nextExpress} 有自己的工作区，代码从 Local 的现在开始，和 ${sourceLabel} 可以同时开发`}>
                <IconFolder size={13} />
                <span>
                  临时分出一个<b>只读</b>对话请 Claude 写交接摘要，用完就删；{sourceLabel} 不受影响，提炼时可以接着问
                </span>
              </p>
              {error && <p className={css.error}>没有成功：{error}</p>}
            </div>
            <footer className={sheet.foot}>
              <span className={own.cost}>{running ? "正在提炼，可以先关掉去做别的" : before ? `要启动一次 Claude，读一遍 ${tokens(before)} 上下文` : "要启动一次 Claude，可能得等一会儿"}</span>
              <button type="button" className={sheet.cancel} onClick={onClose}>
                {running ? "先收起来" : "取消"}
              </button>
              <button type="button" className={sheet.go} style={{ background: green }} disabled={running} onClick={() => onStart(keep, name, direct)}>
                <IconCompress size={14} /> {running ? "提炼中…" : "开始提炼"}
              </button>
            </footer>
          </>
        )}

        {step === "ready" && (
          <>
            <p className={sheet.sub}>
              <Plate route={source} />
              <span>
                第 1–{stopNumber} 站 · 上下文{" "}
                {before ? (
                  <>
                    <b>{tokens(before)}</b> →{" "}
                  </>
                ) : (
                  "约 "
                )}
                <b style={{ color: green }}>{tokens(estimateTokens(distill?.summary ?? ""))}</b> · 临时对话已删除
              </span>
            </p>
            <div className={`${sheet.body} ${sheet.scroll}`}>
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
              <div className={sheet.row}>
                <label className={sheet.label} htmlFor="cp-name2">
                  名称
                </label>
                <input id="cp-name2" className={sheet.name} value={name} onChange={(e) => setName(e.target.value)} placeholder={`${source.name} · 续`} maxLength={40} />
              </div>
              <FirstStop
                title="第一个问题"
                value={question}
                onChange={setQuestion}
                placeholder="可以先不填。Claude 会连同摘要一起看到它"
                onSubmit={() => (distill?.summary ?? "").trim() && create()}
                run={run}
                onRun={(r) => setChosen(r)}
                options={claudeOptions}
                routeLabel={`快${nextExpress}`}
                waiting={waiting}
                picked={picked}
                onPick={setPicked}
              />
            </div>
            <footer className={sheet.foot}>
              {askDiscard ? (
                <>
                  <span className={own.cost}>摘要会丢掉，要重新等一次才能再有。</span>
                  <button type="button" className={sheet.cancel} onClick={() => setAskDiscard(false)}>
                    留着
                  </button>
                  <button type="button" className={css.destroy} onClick={onDiscard}>
                    丢掉
                  </button>
                </>
              ) : (
                <>
                  <span className={own.cost}>关掉就先放在候车区“在建快线”里，随时回来接着发车</span>
                  <button type="button" className={own.discard} onClick={() => setAskDiscard(true)}>
                    不要这条快线
                  </button>
                  <button type="button" className={sheet.go} style={{ background: green }} disabled={!(distill?.summary ?? "").trim()} onClick={create}>
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
