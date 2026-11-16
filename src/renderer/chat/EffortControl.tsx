import { useRef, useState } from "react";
import type { Effort, ModelChoice } from "../../shared";
import { useFit } from "../ui/useFit";
import { IconCheck, IconChevron } from "../ui/icons";
import { EFFORT_HINT, EFFORT_LABEL } from "../ui/claude-options";
import css from "./PermissionModeControl.module.css";

interface Props {
  effort: Effort | null;
  /** 这一路现在用的模型：能调哪几档是 Claude Code 说的 */
  model: ModelChoice;
  routeLabel: string;
  onChange(effort: Effort | null): void;
}

/** 这一路的思考强度。模型不支持调的时候不显示；只收当前值、回传用户选的值 */
export function EffortControl({ effort, model, routeLabel, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useFit(box, [open]);
  if (model.efforts.length === 0) return null;
  const shown = effort && model.efforts.includes(effort) ? effort : null;
  const pick = (e: Effort | null) => {
    if (e !== shown) onChange(e);
    setOpen(false);
  };
  return (
    <div className={css.wrap}>
      <button className={css.trigger} data-mode={shown ? "edits" : "ask"} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="这一路想得多深">
        <span className="ell">强度：{shown ? EFFORT_LABEL[shown] : "默认"}</span>
        <IconChevron size={12} open={open} />
      </button>
      {open && (
        <>
          <div className={css.backdrop} onClick={() => setOpen(false)} />
          <div ref={box} className={css.menu} role="menu">
            <header>只对 {routeLabel} 生效，下一站起用。越高想得越久、越贵</header>
            <button role="menuitemradio" aria-checked={!shown} onClick={() => pick(null)}>
              <i>{!shown ? <IconCheck size={14} /> : ""}</i>
              <span>
                默认
                <small>跟着模型自己的设定</small>
              </span>
            </button>
            {model.efforts.map((e) => (
              <button key={e} role="menuitemradio" aria-checked={shown === e} onClick={() => pick(e)}>
                <i>{shown === e ? <IconCheck size={14} /> : ""}</i>
                <span>
                  {EFFORT_LABEL[e]}
                  <small>{EFFORT_HINT[e]}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
