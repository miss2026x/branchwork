import { useState } from "react";
import type { PermissionMode } from "../../shared";
import { IconChevron, IconWarn } from "../ui/icons";
import css from "./PermissionModeControl.module.css";

const MODES: { mode: PermissionMode; label: string; hint: string }[] = [
  { mode: "ask", label: "每次都问", hint: "Claude 改文件、运行命令前都等你批准" },
  { mode: "edits", label: "改文件不问", hint: "改文件直接做；运行命令等其他操作仍然问你" },
  { mode: "all", label: "全部不问", hint: "什么都不问，相当于 --dangerously-skip-permissions" },
];

/** 批准方式的开关。对整个项目生效。只收当前值、回传用户选的值 */
export function PermissionModeControl({ mode, projectName, onChange }: { mode: PermissionMode; projectName: string; onChange(mode: PermissionMode): void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const current = MODES.find((m) => m.mode === mode)!;
  const close = () => {
    setOpen(false);
    setConfirming(false);
  };

  return (
    <div className={css.wrap}>
      <button className={css.trigger} data-mode={mode} aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))} title="Claude 要做需要批准的事时怎么办">
        {mode === "all" && <IconWarn size={14} />}
        批准：{current.label}
        <IconChevron size={12} open={open} />
      </button>

      {open && (
        <>
          <div className={css.backdrop} onClick={close} />
          {confirming ? (
            <div className={css.menu} role="alertdialog" aria-label="开启全部不问">
              <b>
                <IconWarn size={16} /> 全部不问
              </b>
              <p>
                开启后，「{projectName}」里所有的路上，Claude 运行命令、改文件、联网都不再问你。它运行的命令能碰到这台电脑上你能碰到的任何东西，不限于这个项目。
              </p>
              <p>只在你信得过这个项目里的代码和你要它做的事时开启。随时可以在这里改回去。</p>
              <div className={css.confirmRow}>
                <button onClick={close}>取消</button>
                <button
                  className={css.danger}
                  onClick={() => {
                    onChange("all");
                    close();
                  }}
                >
                  开启全部不问
                </button>
              </div>
            </div>
          ) : (
            <div className={css.menu} role="menu">
              <header>对「{projectName}」里所有的路生效</header>
              {MODES.map((m) => (
                <button
                  key={m.mode}
                  role="menuitemradio"
                  aria-checked={m.mode === mode}
                  onClick={() => {
                    if (m.mode === mode) return close();
                    if (m.mode === "all") return setConfirming(true);
                    onChange(m.mode);
                    close();
                  }}
                >
                  <i>{m.mode === mode ? "●" : ""}</i>
                  <span>
                    {m.label}
                    <small>{m.hint}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
