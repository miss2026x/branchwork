import { useState } from "react";
import { IconChevron } from "../ui/icons";
import css from "./PermissionModeControl.module.css";

const MODELS: { model: string | null; label: string; hint: string }[] = [
  { model: null, label: "默认", hint: "用 Claude Code 里设的模型" },
  { model: "opus", label: "Opus", hint: "最强，适合难的问题；慢一些、贵一些" },
  { model: "sonnet", label: "Sonnet", hint: "均衡，日常写代码够用" },
  { model: "haiku", label: "Haiku", hint: "最快最省，适合简单的小改动" },
];

/** 这一路用哪个模型。只收当前值、回传用户选的值 */
export function ModelControl({ model, routeLabel, onChange }: { model: string | null; routeLabel: string; onChange(model: string | null): void }) {
  const [open, setOpen] = useState(false);
  const current = MODELS.find((m) => m.model === model);
  return (
    <div className={css.wrap}>
      <button className={css.trigger} data-mode={model ? "edits" : "ask"} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="这一路用哪个模型">
        模型：{current?.label ?? model}
        <IconChevron size={12} open={open} />
      </button>
      {open && (
        <>
          <div className={css.backdrop} onClick={() => setOpen(false)} />
          <div className={css.menu} role="menu">
            <header>只对 {routeLabel} 生效，下一站起用。换模型后的第一站要重新启动 Claude，会慢一点</header>
            {MODELS.map((m) => (
              <button
                key={m.label}
                role="menuitemradio"
                aria-checked={m.model === model}
                onClick={() => {
                  if (m.model !== model) onChange(m.model);
                  setOpen(false);
                }}
              >
                <i>{m.model === model ? "●" : ""}</i>
                <span>
                  {m.label}
                  <small>{m.hint}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
