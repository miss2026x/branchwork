import { useEffect, useState, type FormEvent } from "react";
import type { Effort, PermissionMode, Project, QueueItem } from "../../shared";
import { type OptionsState } from "../ui/claude-options";
import { IconClose, IconFolder } from "../ui/icons";
import { SUBMIT_KEYS } from "../ui/keys";
import { routeColors } from "../ui/route-color";
import css from "./Dialog.module.css";
import { cliCommand, FirstStop, NameRow, usableRun, type RunChoice } from "./FirstStop";
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

/**
 * “开一路新车”（设计稿 3-4）：一栏。项目、名称和颜色在上；下面就是这一路第一站的输入框，
 * 和对话栏底下的输入框一个样子，左下角是这一路的批准方式、模型、思考强度，右下角从候车区选
 */
export function NewRouteDialog({ projects, projectId: initial, nextNumber, parked, onAddProject, claudeOptions, onLoadClaudeOptions, onCreate, onCancel }: Props) {
  const [projectId, setProjectId] = useState(initial);
  const [name, setName] = useState("");
  const [color, setColor] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [from, setFrom] = useState<QueueItem | null>(null);
  // 动手前默认沿用项目上次选的
  const projectMode = projects.find((p) => p.id === projectId)?.permissionMode ?? "ask";
  const [chosen, setChosen] = useState<Partial<RunChoice>>({});
  const options = claudeOptions(projectId);
  useEffect(() => onLoadClaudeOptions(projectId), [projectId, onLoadClaudeOptions]);
  const run = usableRun({ model: null, effort: null, permissionMode: projectMode, ...chosen }, options);
  const number = nextNumber(projectId);
  const colors = routeColors({ number, express: null, color });
  const label = `${number}路`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const create = () => onCreate({ projectId, name, color, ...run, question, itemId: from && question.trim() === from.text ? from.id : undefined });
  const submit = (e: FormEvent) => (e.preventDefault(), create());

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
          <NameRow id="nr-name" autoFocus value={name} onChange={setName} placeholder="不填就用第一个问题起名" color={colors.line} onColor={setColor} />
          <FirstStop
            title="第一站"
            value={question}
            onChange={setQuestion}
            placeholder="想让 Claude 做什么？可以先不填，开好再问"
            onSubmit={create}
            run={run}
            onRun={(r) => setChosen(r)}
            options={options}
            routeLabel={label}
            waiting={parked(projectId)}
            picked={from}
            onPick={setFrom}
          />
          <p className={own.workspace} title="每站答完，改动自动同步进 Local；下一站开始前，先拿到 Local 的最新代码">
            <IconFolder size={13} /> 有自己的工作区，代码从 Local 的现在开始
          </p>
        </div>

        <footer className={own.foot}>
          <code className="ell" title="同样的设置在终端里这样写（思考强度没有对应的参数）">$ {cliCommand(run)}</code>
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
