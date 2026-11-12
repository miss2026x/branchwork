import { useEffect, useRef, useState } from "react";
import type { Route, Stop } from "../../shared";
import { firstStops } from "../stores/numbering";
import { IconClose } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import css from "./Dialog.module.css";

interface Props {
  source: Route;
  stop: Stop;
  /** 这一站显示的序号 */
  stopNumber: number;
  /** 新的快线会是快几 */
  nextExpress: number;
  /** 请 Claude 写摘要；失败时抛出带原因的错误 */
  distill(keep: string): Promise<string>;
  cancelDistill(): void;
  onClose(): void;
  onCreate(summary: string, name: string, firstQuestion: string): void;
  /** 上次为这一站提炼好、还没用掉的摘要（不小心关掉后再打开时接着用） */
  savedSummary?: string;
  /** 摘要有了或被改了：让外面记住，关掉也不丢 */
  onSummaryChange(summary: string): void;
}

/** “压缩成快线”：说明 → 提炼中 → 看一眼摘要、改一改 → 开出快线 */
export function CompressDialog({ source, stop, stopNumber, nextExpress, distill, cancelDistill, onClose, onCreate, savedSummary, onSummaryChange }: Props) {
  const [step, setStep] = useState<"intro" | "distilling" | "ready">(savedSummary ? "ready" : "intro");
  const [summary, setSummaryState] = useState(savedSummary ?? "");
  const setSummary = (text: string) => {
    setSummaryState(text);
    onSummaryChange(text);
  };
  /** 摘要已经出来了还点关闭：先问一句，别让等了半天的东西一下就没了 */
  const [askDiscard, setAskDiscard] = useState(false);
  const [keep, setKeep] = useState("");
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const alive = useRef(true);
  const express = { number: 0, express: nextExpress };
  const green = routeColors(express).tag;

  /** 点关闭按钮。有摘要时只是收起来，摘要留着，下次打开还在 */
  const close = () => {
    if (step === "distilling") cancelDistill();
    onClose();
  };
  /** 明确不要这条快线：摘要也丢掉 */
  const discard = () => {
    onSummaryChange("");
    onClose();
  };
  useEffect(() => {
    alive.current = true;
    // Esc 只在还没开始提炼时关闭弹窗；提炼中和摘要出来之后不响应，免得误触
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && step === "intro" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      alive.current = false;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  useEffect(() => {
    if (step !== "distilling") return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [step]);

  const run = async () => {
    setError(null);
    setStep("distilling");
    try {
      const text = await distill(keep);
      if (!alive.current) return;
      setSummary(text);
      setStep("ready");
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStep(summary ? "ready" : "intro");
    }
  };

  return (
    <div className={css.scrim}>
      <div className={`${css.dialog} ${css.wide}`} role="dialog" aria-modal aria-label="压缩成快线">
        <header>
          <Plate route={express} />
          <h2>{step === "ready" ? "摘要好了，看一眼再发车" : "压缩成快线"}</h2>
          <button type="button" aria-label="关闭" onClick={close}>
            <IconClose />
          </button>
        </header>
        <p className={css.sub}>
          来自 {source.number}路「{source.name}」的{firstStops(stopNumber)}（到「{stop.name}」为止）
        </p>

        {step === "intro" && (
          <>
            <div className={css.note}>
              <b>把前面的对话提炼成一份交接摘要，带着摘要开一条全新的对话。</b>
              对话很长、Claude 开始忘事或变慢时用。快线是新的会话、新的工作区，代码从 Local 的现在开始；{source.number}路 原样保留，不受影响。
            </div>
            <label className={css.field} style={{ marginTop: 14 }}>
              <span>有什么要特别保留的（可以不填）</span>
              <input value={keep} onChange={(e) => setKeep(e.target.value)} placeholder="比如：时区统一用 UTC 这个约定" />
            </label>
            {error && <p className={css.error}>没有成功：{error}</p>}
            <footer>
              <button type="button" className={css.ghost} onClick={close}>
                取消
              </button>
              <button type="button" className={css.confirm} style={{ background: green }} onClick={() => void run()}>
                开始提炼
              </button>
            </footer>
          </>
        )}

        {step === "distilling" && (
          <>
            <div className={css.working}>
              <i style={{ background: green }} />
              <div>
                <b>Claude 正在一个临时的对话里写摘要…</b>
                <span>已经 {seconds} 秒。它在那里什么都改不了，写完这个临时对话就删掉。要启动一次 Claude，可能得等一会儿。</span>
              </div>
            </div>
            <footer>
              <button type="button" className={css.ghost} onClick={close}>
                不等了，取消
              </button>
            </footer>
          </>
        )}

        {step === "ready" && (
          <>
            <label className={css.field}>
              <span>摘要站的内容（可以直接改）</span>
              <textarea className={css.summary} value={summary} onChange={(e) => setSummary(e.target.value)} rows={12} spellCheck={false} />
            </label>
            <div className={css.regen}>
              <input value={keep} onChange={(e) => setKeep(e.target.value)} placeholder="重新生成时特别保留…" />
              <button type="button" onClick={() => void run()}>
                重新生成
              </button>
            </div>
            {error && <p className={css.error}>重新生成没有成功：{error}</p>}
            <label className={css.field}>
              <span>线路名称</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${source.name} · 续`} maxLength={40} />
            </label>
            <label className={css.field}>
              <span>第一个问题（可以先不填）</span>
              <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} placeholder="Claude 会连同摘要一起看到它" />
            </label>
            <footer>
              {askDiscard ? (
                <>
                  <span className={css.ask}>摘要会丢掉，要重新等一次才能再有。</span>
                  <button type="button" className={css.ghost} onClick={() => setAskDiscard(false)}>
                    留着
                  </button>
                  <button type="button" className={css.destroy} onClick={discard}>
                    丢掉
                  </button>
                </>
              ) : (
                <>
                  <span className={css.ask}>点右上角关掉只是先收起来，摘要会留着。</span>
                  <button type="button" className={css.ghost} onClick={() => setAskDiscard(true)}>
                    不要这条快线
                  </button>
                  <button
                    type="button"
                    className={css.confirm}
                    style={{ background: green }}
                    disabled={!summary.trim()}
                    onClick={() => {
                      onSummaryChange("");
                      onCreate(summary, name, question);
                    }}
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
