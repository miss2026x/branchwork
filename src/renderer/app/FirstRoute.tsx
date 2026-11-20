import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Effort, PermissionMode, Project, PromptImage, QueueItem } from "../../shared";
import { useDraft } from "../chat/use-draft";
import { cliCommand, FirstStop, NameRow, RouteKindSwitch, usableRun, type RunChoice } from "../dialogs/FirstStop";
import { useStore, type Opening } from "../stores/store";
import type { OptionsState } from "../ui/claude-options";
import { IconFolder } from "../ui/icons";
import { SUBMIT_KEYS } from "../ui/keys";
import { routeColors } from "../ui/route-color";
import css from "./FirstRoute.module.css";

interface Props {
  project: Project;
  /** 这个项目已经有 Local 专车了 */
  hasLocal: boolean;
  /** 候车区里还没派车的问题 */
  parked: QueueItem[];
  options: OptionsState;
  onLoadOptions(projectId: string): void;
  /** 这个项目正在后台开的那一路（发车后、建好之前） */
  opening: Opening | undefined;
  onCreate(opts: { projectId: string; local: boolean; name: string; color: number | null; model: string | null; effort: Effort | null; permissionMode: PermissionMode; question: string; images?: PromptImage[]; itemId?: string }): void;
  onRetry(key: string): void;
}

/**
 * 项目还没有车（设计稿 9-16）：地图那一栏直接是开车的表单，不再是“空状态 + 弹窗”两层。
 * 上面选新的一路（自己的工作区）还是 Local 专车；背景是一条还没跑起来的线，跟着选的颜色变
 */
export function FirstRoute({ project, hasLocal, parked, options, onLoadOptions, opening, onCreate, onRetry }: Props) {
  const [local, setLocal] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<number | null>(null);
  const question = useDraft();
  const [from, setFrom] = useState<QueueItem | null>(null);
  const [chosen, setChosen] = useState<Partial<RunChoice>>({});
  useEffect(() => onLoadOptions(project.id), [project.id, onLoadOptions]);
  const run = usableRun({ model: null, effort: null, permissionMode: project.permissionMode, ...chosen }, options);
  const colors = routeColors({ number: 1, express: null, color });
  const line = local ? "var(--local)" : colors.line;
  const tag = local ? "var(--local)" : colors.tag;
  const busy = !!opening && !opening.error;
  // 点“新对话”时：光标进第一站的输入框；第一次出现时也是
  const form = useRef<HTMLFormElement>(null);
  const firstFocus = useStore((s) => s.firstFocus);
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('[role="textbox"]')?.focus();
  }, [firstFocus]);

  // 正在开的时候计秒
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [busy]);

  const create = () => {
    if (busy || question.status === "loading" || question.status === "bad") return;
    const q = question.prompt();
    onCreate({ projectId: project.id, local, name, color, ...run, question: q.text, images: q.images, itemId: from && q.text === from.text ? from.id : undefined });
    question.clear();
  };

  return (
    <div className={css.page} style={{ "--lane": line } as CSSProperties}>
      {/* 一条还没跑起来的线：起点是这一路的牌子，后面两站是虚的 */}
      <div className={css.track} aria-hidden>
        <span className={css.plate} style={{ background: tag }}>
          {local ? (
            "L"
          ) : (
            <>
              1<small>路</small>
            </>
          )}
        </span>
        <i className={css.stop} />
        <i className={css.ghost} />
        <i className={css.ghost} data-far />
      </div>
      <form
        ref={form}
        className={css.body}
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <header className={css.head}>
          <h1>{project.name}</h1>
          <p>{local ? "在 Local 专车上，直接改这个文件夹。" : "还没有车。问第一个问题，就开出 1路；之后从任何一站都能分出新的一路。"}</p>
        </header>
        <div className={css.card}>
          <RouteKindSwitch local={local} onLocal={setLocal} number={1} color={colors.tag} hasLocal={hasLocal} />
          {!local && <NameRow id="first-name" value={name} onChange={setName} placeholder="不填就用第一个问题起名" color={colors.line} onColor={setColor} />}
          <FirstStop
            title="第一站"
            draft={question}
            placeholder={local ? "想让 Claude 在项目里做什么？" : "想让 Claude 做什么？可以先不填，开好再问"}
            onSubmit={create}
            run={run}
            onRun={(r) => setChosen(r)}
            options={options}
            routeLabel={local ? "Local 专车" : "1路"}
            waiting={parked}
            picked={from}
            onPick={setFrom}
          />
          <p className={css.where}>
            <IconFolder size={13} />
            {local ? (
              <span>
                直接在 <code>{project.localDir}</code> 里改，没有单独的工作区
              </span>
            ) : (
              <span>有自己的工作区，代码从 Local 的现在开始；每站答完，改动自动同步进 Local</span>
            )}
          </p>
          {opening?.error && (
            <p className={css.error} role="alert">
              1路 没开成：{opening.error}
              <button type="button" onClick={() => onRetry(opening.key)}>
                再试一次
              </button>
            </p>
          )}
          <footer className={css.foot}>
            <code className="ell" title="同样的设置在终端里这样写（思考强度没有对应的参数）">
              $ {cliCommand(run)}
            </code>
            <button type="submit" className={css.go} style={{ background: tag }} disabled={busy}>
              {busy ? (
                <>
                  <i className={css.spin} />
                  正在开出 1路 · {opening!.step}
                  {now - opening!.since >= 2000 ? ` · ${Math.round((now - opening!.since) / 1000)} 秒` : ""}
                </>
              ) : (
                <>
                  {local ? "上 Local 专车" : question.status !== "empty" ? "发车" : "开出 1路"}
                  <kbd>{SUBMIT_KEYS}</kbd>
                </>
              )}
            </button>
          </footer>
        </div>
      </form>
    </div>
  );
}
