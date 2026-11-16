import { useEffect, useState, type FormEvent } from "react";
import type { PermissionMode, Project, QueueItem } from "../../shared";
import { IconClose, IconFolder, IconSend, IconWait } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { ROUTE_COLORS, routeColors } from "../ui/route-color";
import { Select, type SelectOption } from "../ui/Select";
import { modelItems, type ModelsState } from "../ui/models";
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
  /** 这个项目能选的模型（从 Claude Code 读的）；没读过时 onLoadModels 去读 */
  models(projectId: string): ModelsState;
  onLoadModels(projectId: string): void;
  onCreate(opts: { projectId: string; name: string; color: number | null; model: string | null; question: string; itemId?: string }): void;
  /** “动手前”是整个项目的设置，这里改了就是改这个项目的 */
  onPermissionMode(projectId: string, mode: PermissionMode): void;
  onCancel(): void;
}

const MODES: SelectOption<PermissionMode>[] = [
  { value: "ask", label: "每次都问我" },
  { value: "edits", label: "改文件不问", hint: "运行命令前还是问我" },
  { value: "all", label: "都不问" },
];

/** “开一路新车”：选项目、起名、挑颜色和模型，写第一个问题（可以从候车区选） */
export function NewRouteDialog({ projects, projectId: initial, nextNumber, parked, onAddProject, models, onLoadModels, onCreate, onPermissionMode, onCancel }: Props) {
  const [projectId, setProjectId] = useState(initial);
  const [name, setName] = useState("");
  const [color, setColor] = useState<number | null>(null);
  const [model, setModel] = useState("");
  const [question, setQuestion] = useState("");
  const [from, setFrom] = useState<QueueItem | null>(null);
  const [picking, setPicking] = useState(false);
  const projectMode = projects.find((p) => p.id === projectId)?.permissionMode ?? "ask";
  const [mode, setMode] = useState<PermissionMode | null>(null);
  const number = nextNumber(projectId);
  const route = { number, express: null, color };
  const colors = routeColors(route);
  const items = parked(projectId);
  const modelState = models(projectId);
  useEffect(() => onLoadModels(projectId), [projectId, onLoadModels]);
  const modelOptions: SelectOption<string>[] = modelItems(modelState, null).map((m) => ({ value: m.value === "default" ? "" : m.value, label: m.label, hint: m.description }));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode && mode !== projectMode) onPermissionMode(projectId, mode);
    onCreate({ projectId, name, color, model: model || null, question, itemId: from && question.trim() === from.text ? from.id : undefined });
  };

  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && !name && !question && onCancel()}>
      <form className={`${css.dialog} ${own.two}`} role="dialog" aria-modal aria-label="开一路新车" onSubmit={submit}>
        <header>
          <span className={own.ghostPlate} style={{ background: colors.tag }}>
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
            <div className={own.pair}>
              <div className={css.field}>
                <span>模型</span>
                <Select label="模型" value={modelOptions.some((o) => o.value === model) ? model : ""} options={modelOptions} onChange={setModel} />
                {modelState === "loading" && <small className={own.from}>正在从 Claude Code 读取能用的模型…</small>}
              </div>
              <div className={css.field}>
                <span>动手前</span>
                <Select<PermissionMode> label="动手前" value={mode ?? projectMode} options={MODES} onChange={(m) => setMode(m)} />
              </div>
            </div>
            <p className={own.pairNote}>“动手前”是整个项目的设置，改了以后这个项目的每一路都一样。</p>
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
            <div className={own.note}>
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
