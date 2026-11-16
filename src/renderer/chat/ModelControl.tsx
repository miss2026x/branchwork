import { useRef, useState } from "react";
import type { Effort, ModelChoice } from "../../shared";
import { useFit } from "../ui/useFit";
import { IconCheck, IconChevron } from "../ui/icons";
import { currentModel, modelHint, modelItems, type OptionsState } from "../ui/claude-options";
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

/** 这一路用哪个模型。能选哪些是 Claude Code 给的；只收当前值、回传用户选的值。思考强度在旁边单独的 EffortControl */
export function ModelControl({ model, effort, options, routeLabel, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useFit(box, [open, showMore, typeof options === "object"]);
  const { common, more } = modelItems(options, model);
  const current = currentModel(options, model);
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

  return (
    <div className={css.wrap}>
      <button className={css.trigger} data-mode={model || effort ? "edits" : "ask"} aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))} title="这一路用哪个模型">
        <span className="ell">模型：{short(current.label)}</span>
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
          </div>
        </>
      )}
    </div>
  );
}
