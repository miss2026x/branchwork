import { useEffect, useState, type FormEvent } from "react";
import type { Project, QueueItem } from "../../shared";
import { IconClose, IconFolder, IconSend, IconWait } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { ROUTE_COLORS, routeColors } from "../ui/route-color";
import css from "./Dialog.module.css";
import own from "./Extra.module.css";

interface Props {
  projects: Project[];
  projectId: string;
  /** 这个项目里下一路是几路 */
  nextNumber(projectId: string): number;
  /** 这个项目候车区里还没派车的问题 */
  parked(projectId: string): QueueItem[];
  onAddProject(): void;
  onCreate(opts: { projectId: string; name: string; color: number | null; model: string | null; question: string; itemId?: string }): void;
  onCancel(): void;
}

const MODELS: [string, string][] = [
  ["", "默认"],
  ["opus", "Opus"],
  ["sonnet", "Sonnet"],
  ["haiku", "Haiku"],
];

/** “开一路新车”：选项目、起名、挑颜色和模型，写第一个问题（可以从候车区选） */
export function NewRouteDialog({ projects, projectId: initial, nextNumber, parked, onAddProject, onCreate, onCancel }: Props) {
  const [projectId, setProjectId] = useState(initial);
  const [name, setName] = useState("");
  const [color, setColor] = useState<number | null>(null);
  const [model, setModel] = useState("");
  const [question, setQuestion] = useState("");
  const [from, setFrom] = useState<QueueItem | null>(null);
  const [picking, setPicking] = useState(false);
  const number = nextNumber(projectId);
  const route = { number, express: null, color };
  const colors = routeColors(route);
  const items = parked(projectId);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCreate({ projectId, name, color, model: model || null, question, itemId: from && question.trim() === from.text ? from.id : undefined });
  };

  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && !name && !question && onCancel()}>
      <form className={`${css.dialog} ${own.two}`} role="dialog" aria-modal aria-label="开一路新车" onSubmit={submit}>
        <header>
          <span className={own.ghostPlate} style={{ borderColor: colors.tag, color: colors.tag }}>
            {number}路
          </span>
          <h2>开一路新车</h2>
          <button type="button" aria-label="关闭" onClick={onCancel}>
            <IconClose />
          </button>
        </header>
        <div className={own.cols}>
          <div className={own.col}>
            <div className={css.field}>
              <span>项目</span>
              <div className={own.chips} role="radiogroup" aria-label="项目">
                {projects.map((p) => (
                  <button key={p.id} type="button" role="radio" aria-checked={p.id === projectId} onClick={() => (setProjectId(p.id), setFrom(null))}>
                    {p.name}
                  </button>
                ))}
                <button type="button" className={own.dashed} onClick={onAddProject}>
                  添加项目
                </button>
              </div>
            </div>
            <div className={own.nameColor}>
              <label className={css.field}>
                <span>线路名称</span>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="不填就用第一个问题起名" maxLength={40} />
              </label>
              <div className={css.field}>
                <span>颜色</span>
                <div className={own.swatches} role="radiogroup" aria-label="颜色">
                  {ROUTE_COLORS.map(([n, c], i) => (
                    <button key={n} type="button" role="radio" aria-checked={c === colors.line} aria-label={`颜色 ${i + 1}`} style={{ background: c }} onClick={() => setColor(n)} />
                  ))}
                </div>
              </div>
            </div>
            <label className={css.field}>
              <span>模型</span>
              <select className={own.select} value={model} onChange={(e) => setModel(e.target.value)}>
                {MODELS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={`${own.col} ${own.right}`}>
            <div className={css.field}>
              <span className={own.between}>
                第一个问题
                {items.length > 0 && (
                  <button type="button" className={own.pick} aria-expanded={picking} onClick={() => setPicking(!picking)}>
                    <IconWait size={14} /> 从候车区选
                  </button>
                )}
              </span>
              {picking && (
                <div className={own.pickList} role="listbox" aria-label="候车区里还没派车的问题">
                  {items.map((it) => (
                    <button key={it.id} type="button" role="option" aria-selected={from?.id === it.id} onClick={() => (setFrom(it), setQuestion(it.text), setPicking(false))}>
                      {it.text}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={4}
                placeholder="可以先不填，开好再问"
                aria-label="第一个问题"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e);
                }}
              />
              {from && question.trim() === from.text && <small className={own.from}>来自候车区，发车后从候车区移走</small>}
            </div>
            <div className={css.note}>
              <IconFolder size={16} />
              <span>
                <b>新对话有自己的工作区</b>，代码从 Local 的现在开始。每站答完，改动自动同步进 Local；下一站开始前，先拿到 Local 的最新代码。
              </span>
            </div>
          </div>
        </div>
        <footer>
          <span className={own.footNote}>
            等同于在新的工作区里运行 <code>claude</code>
          </span>
          <button type="button" className={css.ghost} onClick={onCancel}>
            取消
          </button>
          <button type="submit" className={css.confirm} style={{ background: colors.tag }}>
            {question.trim() ? "发车" : `开出 ${number}路`} <IconSend size={14} />
          </button>
        </footer>
      </form>
    </div>
  );
}
