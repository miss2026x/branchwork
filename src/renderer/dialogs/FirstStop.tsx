import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Effort, PermissionMode, QueueItem } from "../../shared";
import { EffortControl } from "../chat/EffortControl";
import { ModelControl } from "../chat/ModelControl";
import { PermissionModeControl } from "../chat/PermissionModeControl";
import { currentModel, modeItems, type OptionsState } from "../ui/claude-options";
import { agoFine } from "../ui/ago";
import { IconCheck, IconClose, IconWait, IconWarn } from "../ui/icons";
import { AttachButton } from "../chat/AttachButton";
import { PromptInput, type PromptInputHandle } from "../chat/PromptInput";
import type { Draft } from "../chat/use-draft";
import { draftId, useStore } from "../stores/store";
import { ROUTE_COLORS } from "../ui/route-color";
import { useFit } from "../ui/useFit";
import own from "./NewRoute.module.css";

/** 一路车按什么跑：模型、思考强度、动手前 */
export interface RunChoice {
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode;
}

/** 选好的设置里，这个模型真能用的那部分（强度不支持就回默认，自动判断不支持就每次都问） */
export function usableRun(run: RunChoice, options: OptionsState): RunChoice {
  const model = currentModel(options, run.model);
  const modes = modeItems(options, model).filter((m) => !m.disabled);
  return {
    model: run.model,
    effort: run.effort && model.efforts.includes(run.effort) ? run.effort : null,
    permissionMode: modes.some((m) => m.mode === run.permissionMode) ? run.permissionMode : "ask",
  };
}

const CLI_MODE: Record<PermissionMode, string> = { ask: "default", edits: "acceptEdits", auto: "auto", plan: "plan", dontAsk: "dontAsk", all: "bypassPermissions" };
/** 同样的设置在终端里怎么写（思考强度没有对应的参数，不写） */
export const cliCommand = (run: RunChoice, extra = "") =>
  ["claude", extra, run.model ? `--model ${run.model}` : "", run.permissionMode === "all" ? "--dangerously-skip-permissions" : run.permissionMode !== "ask" ? `--permission-mode ${CLI_MODE[run.permissionMode]}` : ""].filter(Boolean).join(" ");

/** 名称一行：左边标签，中间输入框，右边颜色 */
export function NameRow({ id, value, onChange, placeholder, color, onColor, autoFocus }: { id: string; value: string; onChange(v: string): void; placeholder: string; color: string; onColor(n: number): void; autoFocus?: boolean }) {
  return (
    <div className={own.row}>
      <label className={own.label} htmlFor={id}>
        名称
      </label>
      <input id={id} className={own.name} autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={40} />
      <div className={own.swatches} role="radiogroup" aria-label="颜色">
        {ROUTE_COLORS.map(([n, c], i) => (
          <button key={n} type="button" role="radio" aria-checked={c === color} aria-label={`颜色 ${i + 1}`} style={{ background: c }} onClick={() => onColor(n)} />
        ))}
      </div>
    </div>
  );
}

/**
 * 开什么（设计稿 9-16）：两张并排的选项卡，新的一路（自己的工作区）或 Local 专车（直接改项目文件夹）。
 * 选中的描这一路的颜色、淡淡的底。hasLocal：这个项目已经有专车了（选它就是接着它问）
 */
export function RouteKindSwitch({ local, onLocal, number, color, hasLocal }: { local: boolean; onLocal(local: boolean): void; number: number; color: string; hasLocal: boolean }) {
  return (
    <div className={own.kinds} role="radiogroup" aria-label="开什么">
      <button type="button" role="radio" aria-checked={!local} style={{ "--lane": color } as CSSProperties} onClick={() => onLocal(false)}>
        <span className={own.kindPlate} style={{ background: color }}>
          {number}
          <i>路</i>
        </span>
        <span className={own.kindText}>
          <b>新的一路</b>
          <span>自己的工作区，答完合进 Local</span>
        </span>
        <i className={own.kindDot} aria-hidden />
      </button>
      <button type="button" role="radio" aria-checked={local} style={{ "--lane": "var(--local)" } as CSSProperties} onClick={() => onLocal(true)}>
        <span className={own.kindPlate} data-local>
          L
        </span>
        <span className={own.kindText}>
          <b>Local 专车</b>
          <span>{hasLocal ? "已开着，接着它问" : "直接改项目文件夹，没有工作区"}</span>
        </span>
        <i className={own.kindDot} aria-hidden />
      </button>
    </div>
  );
}

interface Props {
  /** 框左上角的小标题（“第一站”“第 4 站”） */
  title: string;
  /** 第一个问题：能带图（设计稿 9-11），和对话栏的输入框同一个 */
  draft: Draft;
  placeholder: string;
  /** 回车 */
  onSubmit(): void;
  /** 这一路按什么跑；不给就不显示左下角的三个选择 */
  run?: RunChoice;
  onRun?(run: RunChoice): void;
  options?: OptionsState;
  /** 菜单里说“只对 4路 生效”用 */
  routeLabel: string;
  /** 候车区里还没派车的问题：可以挑一个 */
  waiting: QueueItem[];
  picked: QueueItem | null;
  onPick(item: QueueItem | null): void;
}

/**
 * 弹窗里“第一站”的输入框：和对话栏底下的输入框一个样子（设计稿 4-6、3-4）。
 * 左下角是这一路的批准方式、模型、思考强度（就是对话栏那三个按钮），右下角从候车区选
 */
export function FirstStop({ title, draft, placeholder, onSubmit, run, onRun, options, routeLabel, waiting, picked, onPick }: Props) {
  const input = useRef<PromptInputHandle>(null);
  const queuedImages = useStore((s) => s.queuedImages);
  const [picking, setPicking] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const pickWrap = useRef<HTMLDivElement>(null);
  useFit(list, [picking]);
  useEffect(() => {
    if (!picking) return;
    const onDown = (e: PointerEvent) => pickWrap.current?.contains(e.target as Node) || setPicking(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopImmediatePropagation(), setPicking(false));
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => (window.removeEventListener("pointerdown", onDown), window.removeEventListener("keydown", onKey, true));
  }, [picking]);
  const model = run ? currentModel(options, run.model) : null;
  const fromQueue = picked && draft.prompt().text === picked.text;
  return (
    <>
      <div className={own.box}>
        <span className={own.boxTitle}>{title}</span>
        <PromptInput ref={input} text={draft.text} images={draft.images} onChange={draft.set} onImage={draft.patch} onEnter={onSubmit} newId={draftId} label="第一个问题" placeholder={placeholder} />
        <div className={own.toolbar}>
          <div className={own.controls}>
            <AttachButton input={input} className={own.attach} />
            {run && onRun && model && (
              <>
                <PermissionModeControl mode={run.permissionMode} routeLabel={routeLabel} options={options} model={model} onChange={(permissionMode) => onRun({ ...run, permissionMode })} />
                <ModelControl model={run.model} effort={run.effort} options={options} routeLabel={routeLabel} onChange={(m, effort) => onRun({ ...run, model: m, effort })} />
                <EffortControl effort={run.effort} model={model} routeLabel={routeLabel} onChange={(effort) => onRun({ ...run, effort })} />
              </>
            )}
          </div>
          {waiting.length > 0 && (
            <div ref={pickWrap} className={own.pickWrap}>
              <button type="button" className={own.pick} aria-expanded={picking} onClick={() => setPicking(!picking)}>
                <IconWait size={13} /> 从候车区选 <span>{waiting.length}</span>
              </button>
              {picking && (
                <div ref={list} className={own.pickList}>
                  <header>候车区里还没派车的 {waiting.length} 个问题</header>
                  <div role="listbox" aria-label="候车区里没派车的问题">
                    {waiting.map((q) => (
                      <button key={q.id} type="button" role="option" aria-selected={picked?.id === q.id} title={q.text} onClick={() => (onPick(q), void queuedImages(q).then((imgs) => draft.fill(q.text, imgs)), setPicking(false))}>
                        <span>
                          <span className={own.pickText}>{q.text}</span>
                          <small>放进来 {agoFine(q.createdAt)}</small>
                        </span>
                        {picked?.id === q.id && <IconCheck size={14} />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {run?.permissionMode === "all" && (
        <p className={own.warn}>
          <IconWarn size={14} /> 全部不问：这一路运行命令、改文件、联网都不再问你，能碰到这台电脑上你能碰到的任何东西。
        </p>
      )}
      {fromQueue && (
        <span className={own.from}>
          <IconWait size={13} /> 来自候车区 · 发车后从候车区移走
          <button type="button" aria-label="改回自己写" onClick={() => (onPick(null), draft.clear())}>
            <IconClose size={11} />
          </button>
        </span>
      )}
    </>
  );
}
