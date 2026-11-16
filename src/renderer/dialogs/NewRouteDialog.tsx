import { useEffect, useState, type FormEvent } from "react";
import type { Effort, PermissionMode, Project, QueueItem } from "../../shared";
import { EffortControl } from "../chat/EffortControl";
import { ModelControl } from "../chat/ModelControl";
import { PermissionModeControl } from "../chat/PermissionModeControl";
import { currentModel, modeItems, type OptionsState } from "../ui/claude-options";
import { IconClose, IconFolder, IconWait, IconWarn } from "../ui/icons";
import { ROUTE_COLORS, routeColors } from "../ui/route-color";
import css from "./Dialog.module.css";
import own from "./NewRoute.module.css";

interface Props {
  projects: Project[];
  projectId: string;
  /** 这个项目里下一路是几路 */
  nextNumber(projectId: string): number;
  /** 这个项目候车区里还没派车的问题 */
  parked(projectId: string): QueueItem[];
  onAddProject(): void;
  /** 这个项目能选的模型和批准方式（从这台电脑上的 Claude Code 读的）；没读过时 onLoadClaudeOptions 去读 */
  claudeOptions(projectId: string): OptionsState;
  onLoadClaudeOptions(projectId: string): void;
  onCreate(opts: { projectId: string; name: string; color: number | null; model: string | null; effort: Effort | null; permissionMode: PermissionMode; question: string; itemId?: string }): void;
  onCancel(): void;
}

/** 底部那行用：同样的设置在终端里怎么写 */
const CLI_MODE: Record<PermissionMode, string> = { ask: "default", edits: "acceptEdits", auto: "auto", plan: "plan", dontAsk: "dontAsk", all: "bypassPermissions" };

/**
 * “开一路新车”（设计稿 3-4）：一栏。项目、名称和颜色在上；下面就是这一路第一站的输入框，
 * 和对话栏底下的输入框一个样子，左下角是这一路的批准方式、模型、思考强度，右下角从候车区选
 */
export function NewRouteDialog({ projects, projectId: initial, nextNumber, parked, onAddProject, claudeOptions, onLoadClaudeOptions, onCreate, onCancel }: Props) {
  const [projectId, setProjectId] = useState(initial);
  const [name, setName] = useState("");
  const [color, setColor] = useState<number | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<Effort | null>(null);
  const [question, setQuestion] = useState("");
  const [from, setFrom] = useState<QueueItem | null>(null);
  const [picking, setPicking] = useState(false);
  const [mode, setMode] = useState<PermissionMode | null>(null);
  const number = nextNumber(projectId);
  const colors = routeColors({ number, express: null, color });
  const items = parked(projectId);
  const options = claudeOptions(projectId);
  useEffect(() => onLoadClaudeOptions(projectId), [projectId, onLoadClaudeOptions]);
  const picked = currentModel(options, model);
  // 动手前默认沿用项目上次选的；那个方式这一路的模型用不了（比如自动判断）就退回每次都问
  const projectMode = projects.find((p) => p.id === projectId)?.permissionMode ?? "ask";
  const usable = modeItems(options, picked).filter((m) => !m.disabled);
  const chosenMode: PermissionMode = usable.some((m) => m.mode === (mode ?? projectMode)) ? (mode ?? projectMode) : "ask";
  const label = `${number}路`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const command = ["claude", model ? `--model ${model}` : "", chosenMode === "all" ? "--dangerously-skip-permissions" : chosenMode !== "ask" ? `--permission-mode ${CLI_MODE[chosenMode]}` : ""].filter(Boolean).join(" ");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCreate({
      projectId,
      name,
      color,
      model,
      effort: effort && picked.efforts.includes(effort) ? effort : null,
      permissionMode: chosenMode,
      question,
      itemId: from && question.trim() === from.text ? from.id : undefined,
    });
  };

  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && !name && !question && onCancel()}>
      <form className={`${css.dialog} ${own.dialog}`} role="dialog" aria-modal aria-label="开一路新车" onSubmit={submit}>
        <header className={own.head}>
          <span className={own.plate} style={{ background: colors.tag }}>
            {number}
            <small>路</small>
          </span>
          <h2>开一路新车</h2>
          <button type="button" aria-label="关闭" onClick={onCancel}>
            <IconClose size={14} />
          </button>
        </header>

        <div className={own.body}>
          <div className={own.row}>
            <span className={own.label}>项目</span>
            <div className={own.chips} role="radiogroup" aria-label="项目">
              {projects.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={p.id === projectId} onClick={() => (setProjectId(p.id), setFrom(null))}>
                  {p.name}
                </button>
              ))}
              <button type="button" className={own.dashed} onClick={onAddProject}>
                + 添加项目
              </button>
            </div>
          </div>

          <div className={own.row}>
            <label className={own.label} htmlFor="nr-name">
              名称
            </label>
            <input id="nr-name" className={own.name} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="不填就用第一个问题起名" maxLength={40} />
            <div className={own.swatches} role="radiogroup" aria-label="颜色">
              {ROUTE_COLORS.map(([n, c], i) => (
                <button key={n} type="button" role="radio" aria-checked={c === colors.line} aria-label={`颜色 ${i + 1}`} style={{ background: c }} onClick={() => setColor(n)} />
              ))}
            </div>
          </div>

          {/* 第一站：和对话栏的输入框同一个样子 */}
          <div className={own.box}>
            <label htmlFor="nr-q">第一站</label>
            <textarea
              id="nr-q"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={4}
              placeholder="想让 Claude 做什么？可以先不填，开好再问"
              aria-label="第一个问题"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e);
              }}
            />
            <div className={own.toolbar}>
              <div className={own.controls}>
                <PermissionModeControl mode={chosenMode} routeLabel={label} options={options} model={picked} onChange={setMode} />
                <ModelControl model={model} effort={effort} options={options} routeLabel={label} onChange={(m, e) => (setModel(m), setEffort(e))} />
                <EffortControl effort={effort} model={picked} routeLabel={label} onChange={setEffort} />
              </div>
              {items.length > 0 && (
                <div className={own.pickWrap}>
                  <button type="button" className={own.pick} aria-expanded={picking} onClick={() => setPicking(!picking)}>
                    <IconWait size={13} /> 从候车区选 <span>{items.length}</span>
                  </button>
                  {picking && (
                    <div className={own.pickList} role="listbox" aria-label="候车区里还没派车的问题">
                      {items.map((it) => (
                        <button key={it.id} type="button" role="option" aria-selected={from?.id === it.id} onClick={() => (setFrom(it), setQuestion(it.text), setPicking(false))}>
                          {it.text}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {chosenMode === "all" && (
            <p className={own.warn}>
              <IconWarn size={14} /> 全部不问：这一路运行命令、改文件、联网都不再问你，能碰到这台电脑上你能碰到的任何东西。
            </p>
          )}
          <div className={own.under}>
            {from && question.trim() === from.text ? (
              <span className={own.from}>
                <IconWait size={13} /> 来自候车区 · 发车后从候车区移走
                <button type="button" aria-label="改回自己写" onClick={() => (setFrom(null), setQuestion(""))}>
                  <IconClose size={11} />
                </button>
              </span>
            ) : (
              <span />
            )}
            <span className={own.workspace} title="每站答完，改动自动同步进 Local；下一站开始前，先拿到 Local 的最新代码">
              <IconFolder size={13} /> 有自己的工作区，代码从 Local 的现在开始
            </span>
          </div>
        </div>

        <footer className={own.foot}>
          <code className="ell" title="同样的设置在终端里这样写（思考强度没有对应的参数）">$ {command}</code>
          <button type="button" className={own.cancel} onClick={onCancel}>
            取消
          </button>
          <button type="submit" className={own.go} style={{ background: colors.tag }}>
            {question.trim() ? "发车" : `开出 ${label}`}
            <kbd>Ctrl ↵</kbd>
          </button>
        </footer>
      </form>
    </div>
  );
}
