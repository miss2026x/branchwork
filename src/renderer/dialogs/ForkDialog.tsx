import { useEffect, useState, type FormEvent } from "react";
import type { QueueItem, Route, Stop } from "../../shared";
import { firstStops } from "../stores/numbering";
import type { RunSettings } from "../stores/store";
import type { OptionsState } from "../ui/claude-options";
import { IconClose, IconFolder } from "../ui/icons";
import { SUBMIT_KEYS } from "../ui/keys";
import { Plate } from "../ui/Plate";
import { routeColors, routeLabel } from "../ui/route-color";
import css from "./Dialog.module.css";
import { FirstStop, NameRow, usableRun, type RunChoice } from "./FirstStop";
import own from "./NewRoute.module.css";

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
  /** 这个项目能选的模型和批准方式（从这台电脑上的 Claude Code 读的） */
  claudeOptions: OptionsState;
  onCancel(): void;
  onConfirm(name: string, firstQuestion: string, opts: { color: number | null; itemId?: string; switchTo: boolean; run: RunSettings }): void;
}

const SWITCH_KEY = "bw.fork.switch";
const remembered = () => {
  try {
    return localStorage.getItem(SWITCH_KEY) !== "0";
  } catch {
    return true;
  }
};

/**
 * “从第 N 站开新对话”（设计稿 3-3），和“开一路新车”一个样子：一栏，名称和颜色一行，
 * 下面是新的一路下一站的输入框。模型、强度、动手前默认沿用来源那一路
 */
export function ForkDialog({ parent, stop, stopNumber, nextNumber, contextTokens, waiting, claudeOptions, onCancel, onConfirm }: Props) {
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [color, setColor] = useState<number | null>(null);
  const [picked, setPicked] = useState<QueueItem | null>(null);
  const [switchTo, setSwitchTo] = useState(remembered);
  const [chosen, setChosen] = useState<Partial<RunChoice>>({});
  const run = usableRun({ model: parent.model, effort: parent.effort, permissionMode: parent.permissionMode, ...chosen }, claudeOptions);
  const colors = routeColors({ number: nextNumber, express: null, color });
  const parentLabel = routeLabel(parent);
  const label = `${nextNumber}路`;
  const context = contextTokens ? ` · 约 ${contextTokens >= 1000 ? `${(contextTokens / 1000).toFixed(1)}k` : contextTokens}` : "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const create = () => {
    try {
      localStorage.setItem(SWITCH_KEY, switchTo ? "1" : "0");
    } catch {
      // 记不住也没关系
    }
    onConfirm(name, question, { color, itemId: picked && question.trim() === picked.text ? picked.id : undefined, switchTo, run });
  };
  const submit = (e: FormEvent) => (e.preventDefault(), create());

  return (
    // 已经填了东西时，点弹窗外面不关闭，免得误触把填的内容弄丢
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && !name && !question && onCancel()}>
      <form className={`${css.dialog} ${own.dialog}`} role="dialog" aria-modal aria-label={`从第 ${stopNumber} 站开新对话`} onSubmit={submit}>
        <header className={own.head}>
          <span className={own.plate} style={{ background: colors.tag }}>
            {nextNumber}
            <small>路</small>
          </span>
          <h2>从第 {stopNumber} 站开新对话</h2>
          <button type="button" aria-label="关闭" onClick={onCancel}>
            <IconClose size={14} />
          </button>
        </header>
        <p className={own.sub}>
          <Plate route={parent} />
          <span>
            带着{firstStops(stopNumber)}（到「{stop.name}」为止）的完整历史{context}；会话是新的，{parentLabel} 不受影响
          </span>
        </p>

        <div className={own.body}>
          <NameRow id="fork-name" autoFocus value={name} onChange={setName} placeholder="不填就用第一个问题起名" color={colors.line} onColor={setColor} />
          <FirstStop
            title={`第 ${stopNumber + 1} 站`}
            value={question}
            onChange={setQuestion}
            placeholder={`接着第 ${stopNumber} 站往下问点别的。可以先不填，开好再问`}
            onSubmit={create}
            run={run}
            onRun={(r) => setChosen(r)}
            options={claudeOptions}
            routeLabel={label}
            waiting={waiting}
            picked={picked}
            onPick={setPicked}
          />
          <p className={own.workspace} title={`${label} 有自己的工作区，和 ${parentLabel} 可以同时改代码；每站答完自动同步进 Local`}>
            <IconFolder size={13} />
            <span>
              <b>代码从 Local 的现在开始，不回到第 {stopNumber} 站</b>，和 {parentLabel} 可以同时改
            </span>
          </p>
        </div>

        <footer className={own.foot}>
          <label className={own.switchTo}>
            <input type="checkbox" checked={switchTo} onChange={(e) => setSwitchTo(e.target.checked)} /> 开好后切过去
          </label>
          <span className={own.spacer} />
          <button type="button" className={own.cancel} onClick={onCancel}>
            取消
          </button>
          <button type="submit" className={own.go} style={{ background: colors.tag }}>
            {question.trim() ? "发车" : `开出 ${label}`}
            <kbd>{SUBMIT_KEYS}</kbd>
          </button>
        </footer>
      </form>
    </div>
  );
}
