import { useRef, useState } from "react";
import type { Effort } from "../../shared";
import { useFit } from "../ui/useFit";
import { IconCheck, IconChevron } from "../ui/icons";
import { currentModel, EFFORT_LABEL, modelItems, type ModelsState } from "../ui/models";
import css from "./PermissionModeControl.module.css";

interface Props {
  model: string | null;
  effort: Effort | null;
  /** 这个项目能选的模型（从 Claude Code 读的） */
  models: ModelsState;
  routeLabel: string;
  onChange(model: string | null, effort: Effort | null): void;
}

/** 按钮上放不下“Default (recommended)”这样的长名字：去掉括号里的说明 */
const short = (label: string) => label.replace(/\s*[(（][^)）]*[)）]\s*$/, "") || label;

/** 这一路用哪个模型、思考强度多少。列表是 Claude Code 给的；只收当前值、回传用户选的值 */
export function ModelControl({ model, effort, models, routeLabel, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useFit(box, [open, Array.isArray(models)]);
  const items = modelItems(models, model);
  const current = currentModel(models, model);
  const shownEffort = effort && current.efforts.includes(effort) ? effort : null;

  const pickModel = (value: string) => {
    const next = value === "default" ? null : value;
    const m = items.find((x) => x.value === value)!;
    // 新模型不支持现在的思考强度：回到它的默认
    onChange(next, effort && m.efforts.includes(effort) ? effort : null);
  };

  return (
    <div className={css.wrap}>
      <button className={css.trigger} data-mode={model || effort ? "edits" : "ask"} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="这一路用哪个模型、思考强度多少">
        <span className="ell">
          模型：{short(current.label)}
          {shownEffort && ` · ${EFFORT_LABEL[shownEffort]}`}
        </span>
        <IconChevron size={12} open={open} />
      </button>
      {open && (
        <>
          <div className={css.backdrop} onClick={() => setOpen(false)} />
          <div ref={box} className={`${css.menu} ${css.wide}`} role="menu">
            <header>只对 {routeLabel} 生效，下一站起用。换了以后第一站要重新启动 Claude，会慢一点</header>
            {models === "loading" && <p className={css.loading}>正在从 Claude Code 读取你能用的模型…</p>}
            {models === "failed" && <p className={css.loading}>没读到你的账号能用哪些模型，先列出常见的几个</p>}
            {items.map((m) => (
              <button key={m.value} role="menuitemradio" aria-checked={m === current} onClick={() => (m !== current && pickModel(m.value), setOpen(false))}>
                <i>{m === current ? <IconCheck size={14} /> : ""}</i>
                <span>
                  {m.label}
                  {m.description && <small>{m.description}</small>}
                </span>
              </button>
            ))}
            {current.efforts.length > 0 && (
              <div className={css.effort}>
                <span>思考强度</span>
                <div role="radiogroup" aria-label="思考强度">
                  <button role="radio" aria-checked={!shownEffort} onClick={() => (shownEffort && onChange(model, null), setOpen(false))}>
                    默认
                  </button>
                  {current.efforts.map((e) => (
                    <button key={e} role="radio" aria-checked={shownEffort === e} onClick={() => (e !== shownEffort && onChange(model, e), setOpen(false))}>
                      {EFFORT_LABEL[e]}
                    </button>
                  ))}
                </div>
                <small>越高想得越久、越贵；“默认”跟着模型自己的设定</small>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
