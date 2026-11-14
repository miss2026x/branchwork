import { useEffect, useRef, useState, type FormEvent } from "react";
import type { QueueItem, Route, Stop } from "../../shared";
import { firstStops } from "../stores/numbering";
import { IconClose, IconFold, IconWait } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { ROUTE_COLORS, routeColors } from "../ui/route-color";
import css from "./Dialog.module.css";
import pick from "./Compress.module.css";
import own from "./Extra.module.css";

interface Props {
  parent: Route;
  stop: Stop;
  /** 这一站显示的序号 */
  stopNumber: number;
  /** 新的一路会是几路 */
  nextNumber: number;
  /** 父路的会话现在占多少上下文（只有从最新一站分叉时才说得准） */
  contextTokens: number | null;
  /** 候车区里还没派车的问题 */
  waiting: QueueItem[];
  onCancel(): void;
  onConfirm(name: string, firstQuestion: string, opts: { color: number | null; itemId?: string; switchTo: boolean }): void;
}

const SWITCH_KEY = "bw.fork.switch";
const remembered = () => {
  try {
    return localStorage.getItem(SWITCH_KEY) !== "0";
  } catch {
    return true;
  }
};

/** “从第 N 站开新对话”。只收数据、回传用户填的内容 */
export function ForkDialog({ parent, stop, stopNumber, nextNumber, contextTokens, waiting, onCancel, onConfirm }: Props) {
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [color, setColor] = useState<number | null>(null);
  const [coloring, setColoring] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [switchTo, setSwitchTo] = useState(remembered);
  const nameInput = useRef<HTMLInputElement>(null);
  const next = { number: nextNumber, express: null, color };

  useEffect(() => {
    nameInput.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem(SWITCH_KEY, switchTo ? "1" : "0");
    } catch {
      // 记不住也没关系
    }
    onConfirm(name, question, { color, itemId: picked && question.trim() === waiting.find((q) => q.id === picked)?.text ? picked : undefined, switchTo });
  };

  return (
    // 已经填了东西时，点弹窗外面不关闭，免得误触把填的内容弄丢
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && !name && !question && onCancel()}>
      <form className={css.dialog} role="dialog" aria-modal aria-label={`从第 ${stopNumber} 站开新对话`} onSubmit={submit}>
        <header>
          <Plate route={parent} />
          <h2>从第 {stopNumber} 站开新对话</h2>
          <button type="button" aria-label="关闭" onClick={onCancel}>
            <IconClose />
          </button>
        </header>
        <p className={css.sub}>
          新对话带着{firstStops(stopNumber)}（到「{stop.name}」为止）的完整历史出发{contextTokens ? `，约 ${contextTokens >= 1000 ? `${(contextTokens / 1000).toFixed(1)}k` : contextTokens}` : ""}。会话 ID 是新的，{parent.number}路 不受影响。
        </p>

        <div className={own.nameColor}>
          <label className={css.field}>
            <span>线路名称</span>
            <input ref={nameInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="新对话" maxLength={40} />
          </label>
          <div className={css.field}>
            <span>编号和颜色</span>
            <div className={own.numberColor}>
              <Plate route={next} />
              <button type="button" aria-expanded={coloring} onClick={() => setColoring(!coloring)}>
                换色
              </button>
              {coloring && (
                <div className={own.swatches} role="radiogroup" aria-label="颜色" data-pop>
                  {ROUTE_COLORS.map(([n, c], i) => (
                    <button key={n} type="button" role="radio" aria-checked={c === routeColors(next).line} aria-label={`颜色 ${i + 1}`} style={{ background: c }} onClick={() => (setColor(n), setColoring(false))} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={pick.head}>
          <span>第一个问题</span>
          {waiting.length > 0 && (
            <div className={pick.pick}>
              <button type="button" aria-expanded={picking} onClick={() => setPicking(!picking)}>
                <IconWait size={14} /> 从候车区选
              </button>
              {picking && (
                <ul role="listbox" aria-label="候车区里没派车的问题">
                  {waiting.map((q) => (
                    <li key={q.id}>
                      <button type="button" role="option" aria-selected={picked === q.id} onClick={() => (setQuestion(q.text), setPicked(q.id), setPicking(false))}>
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
          <textarea
            aria-label="第一个问题"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            placeholder="可以先不填。开好后马上问这个问题"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e);
            }}
          />
        </label>

        <div className={own.codeNote}>
          <IconFold />
          <div>
            <b>代码从 Local 的现在开始，不回到第 {stopNumber} 站。</b>
            {nextNumber}路 有自己的工作区，和 {parent.number}路 可以同时改代码。每站答完自动同步进 Local。
          </div>
        </div>

        <footer>
          <label className={own.switchTo}>
            <input type="checkbox" checked={switchTo} onChange={(e) => setSwitchTo(e.target.checked)} /> 开好后切过去
          </label>
          <button type="button" className={css.ghost} onClick={onCancel}>
            取消
          </button>
          <button type="submit" className={css.confirm} style={{ background: routeColors(next).tag }}>
            开出 {nextNumber}路
          </button>
        </footer>
      </form>
    </div>
  );
}
