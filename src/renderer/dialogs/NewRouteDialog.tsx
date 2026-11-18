import { useEffect, useState, type FormEvent } from "react";
import type { Effort, PermissionMode, Project, PromptImage, QueueItem } from "../../shared";
import { type OptionsState } from "../ui/claude-options";
import { IconClose, IconFolder } from "../ui/icons";
import { SUBMIT_KEYS } from "../ui/keys";
import { routeColors } from "../ui/route-color";
import css from "./Dialog.module.css";
import { useDraft } from "../chat/use-draft";
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
  onCreate(opts: { projectId: string; name: string; color: number | null; model: string | null; effort: Effort | null; permissionMode: PermissionMode; question: string; images?: PromptImage[]; itemId?: string }): void;
  /** 点了发车、正在建工作区：做到哪一步（设计稿 4-8 的做法：按钮马上变样，显示步骤和计时） */
  preparing?: { step: string; since: number } | null;
  onCancel(): void;
}

/**
 * “开一路新车”（设计稿 3-4）：一栏。项目、名称和颜色在上；下面就是这一路第一站的输入框，
 * 和对话栏底下的输入框一个样子，左下角是这一路的批准方式、模型、思考强度，右下角从候车区选
 */
export function NewRouteDialog({ projects, projectId: initial, nextNumber, parked, onAddProject, claudeOptions, onLoadClaudeOptions, onCreate, preparing, onCancel }: Props) {
  const [projectId, setProjectId] = useState(initial);
  const [name, setName] = useState("");
  const [color, setColor] = useState<number | null>(null);
  const question = useDraft();
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

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!preparing) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [preparing]);
  const create = () => {
    if (preparing || question.status === "loading" || question.status === "bad") return;
    const q = question.prompt();
    onCreate({ projectId, name, color, ...run, question: q.text, images: q.images, itemId: from && q.text === from.text ? from.id : undefined });
  };
  const submit = (e: FormEvent) => (e.preventDefault(), create());

  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && !name && question.status === "empty" && onCancel()}>
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
            draft={question}
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
          {preparing ? (
            <span className={`${own.preparing} ell`} role="status">
              正在建工作区 · {preparing.step}
              {now - preparing.since >= 2000 ? ` · ${Math.round((now - preparing.since) / 1000)} 秒` : ""}
            </span>
          ) : (
            <code className="ell" title="同样的设置在终端里这样写（思考强度没有对应的参数）">$ {cliCommand(run)}</code>
          )}
          <button type="button" className={own.cancel} onClick={onCancel} disabled={!!preparing}>
            取消
          </button>
          <button type="submit" className={own.go} style={{ background: colors.tag }} disabled={!!preparing}>
            {preparing ? (
              <>
                <i className={own.spin} /> 正在开出 {label}…
              </>
            ) : (
              <>
                {question.status !== "empty" ? "发车" : `开出 ${label}`}
                <kbd>{SUBMIT_KEYS}</kbd>
              </>
            )}
          </button>
        </footer>
      </form>
    </div>
  );
}
