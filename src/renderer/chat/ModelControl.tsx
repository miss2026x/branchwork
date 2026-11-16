import { useRef, useState } from "react";
import type { Effort, ModelChoice } from "../../shared";
import { useFit } from "../ui/useFit";
import { IconCheck, IconChevron } from "../ui/icons";
import { currentModel, EFFORT_HINT, EFFORT_LABEL, modelHint, modelItems, type OptionsState } from "../ui/claude-options";
import css from "./PermissionModeControl.module.css";

interface Props {
  model: string | null;
  effort: Effort | null;
  /** 这个项目能选的模型（从这台电脑上的 Claude Code 读的） */
  options: OptionsState;
  routeLabel: string;
  onChange(model: string | null, effort: Effort | null): void;
}

/** 按钮上放不下“Default (recommended)”这样的长名字：去掉括号里的说明 */
const short = (label: string) => label.replace(/\s*[(（][^)）]*[)）]\s*$/, "") || label;

/** 这一路用哪个模型、思考强度多少。能选哪些是 Claude Code 给的；只收当前值、回传用户选的值 */
export function ModelControl({ model, effort, options, routeLabel, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [hoverEffort, setHoverEffort] = useState<Effort | "default" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useFit(box, [open, showMore, typeof options === "object"]);
  const { common, more } = modelItems(options, model);
  const current = currentModel(options, model);
  const shownEffort = effort && current.efforts.includes(effort) ? effort : null;
  const close = () => (setOpen(false), setShowMore(false));

  const pickModel = (m: ModelChoice) => {
    // 新模型不支持现在的思考强度：回到它的默认
    if (m !== current) onChange(m.value === "default" ? null : m.value, effort && m.efforts.includes(effort) ? effort : null);
    close();
  };
  const row = (m: ModelChoice) => (
    <button key={m.value} role="menuitemradio" aria-checked={m === current} onClick={() => pickModel(m)}>
      <i>{m === current ? <IconCheck size={14} /> : ""}</i>
      <span>
        {m.label}
        {modelHint(m) && <em>{modelHint(m)}</em>}
        {m.description && <small>{m.description}</small>}
      </span>
    </button>
  );
  const effortTip = hoverEffort === "default" || (!hoverEffort && !shownEffort) ? "跟着模型自己的设定" : EFFORT_HINT[(hoverEffort as Effort) ?? shownEffort!];

  return (
    <div className={css.wrap}>
      <button className={css.trigger} data-mode={model || effort ? "edits" : "ask"} aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))} title="这一路用哪个模型、思考强度多少">
        <span className="ell">
          模型：{short(current.label)}
          {shownEffort && ` · ${EFFORT_LABEL[shownEffort]}`}
        </span>
        <IconChevron size={12} open={open} />
      </button>
      {open && (
        <>
          <div className={css.backdrop} onClick={close} />
          <div ref={box} className={`${css.menu} ${css.wide}`} role="menu">
            <header>只对 {routeLabel} 生效，下一站起用。换了以后第一站要重新启动 Claude，会慢一点</header>
            {options === "loading" && <p className={css.loading}>正在从 Claude Code 读取你能用的模型…</p>}
            {options === "failed" && <p className={css.loading}>没读到你的账号能用哪些模型，先列出常见的几个</p>}
            {common.map(row)}
            {more.length > 0 && (
              <>
                <button className={css.more} aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
                  <IconChevron size={12} open={showMore} /> {showMore ? "收起" : `更多型号（${more.length}）`}
                </button>
                {showMore && more.map(row)}
              </>
            )}
            {current.efforts.length > 0 && (
              <div className={css.effort} onMouseLeave={() => setHoverEffort(null)}>
                <span>思考强度</span>
                <div role="radiogroup" aria-label="思考强度">
                  <button role="radio" aria-checked={!shownEffort} onMouseEnter={() => setHoverEffort("default")} onClick={() => (shownEffort && onChange(model, null), close())}>
                    默认
                  </button>
                  {current.efforts.map((e) => (
                    <button key={e} role="radio" aria-checked={shownEffort === e} title={EFFORT_HINT[e]} onMouseEnter={() => setHoverEffort(e)} onClick={() => (e !== shownEffort && onChange(model, e), close())}>
                      {EFFORT_LABEL[e]}
                    </button>
                  ))}
                </div>
                <small>{effortTip}。越高想得越久、越贵</small>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
