import { useRef, useState } from "react";
import type { ModelChoice, PermissionMode } from "../../shared";
import { useFit } from "../ui/useFit";
import { IconCheck, IconDown, IconShield, IconWarn } from "../ui/icons";
import { modeInfo, modeItems, type OptionsState } from "../ui/claude-options";
import css from "./PermissionModeControl.module.css";

interface Props {
  mode: PermissionMode;
  /** 这一路叫什么（“1路”） */
  routeLabel: string;
  /** 这个项目能用哪些批准方式（从这台电脑上的 Claude Code 读的） */
  options: OptionsState;
  /** 这一路现在用的模型：“自动判断”要模型支持 */
  model?: ModelChoice;
  onChange(mode: PermissionMode): void;
}

/** 这一路的批准方式。能选哪些是 Claude Code 给的；只收当前值、回传用户选的值 */
export function PermissionModeControl({ mode, routeLabel, options, model, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useFit(box, [open, confirming]);
  const items = modeItems(options, model);
  const current = modeInfo(mode);
  // 项目选了“自动判断”，这一路的模型却不支持：这一路实际按“每次都问”
  const fallback = mode === "auto" && items.find((m) => m.mode === "auto")?.disabled;
  const close = () => {
    setOpen(false);
    setConfirming(false);
  };

  return (
    <div className={css.wrap}>
      <button type="button"
        className={css.trigger}
        data-mode={mode}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`批准：${current.label}${fallback ? "（这一路按每次都问）" : ""}`}
        onClick={() => (open ? close() : setOpen(true))}
        title={fallback ? `动手前：${current.label}，但这一路的模型不支持，先按每次都问` : `动手前：${current.label}`}
      >
        {mode === "all" ? <IconWarn size={14} /> : <IconShield size={14} />}
        <span className="ell">
          {current.label}
          {fallback && "*"}
        </span>
        <IconDown size={12} />
      </button>

      {open && (
        <>
          <div className={css.backdrop} onClick={close} />
          {confirming ? (
            <div ref={box} className={css.menu} role="alertdialog" aria-label="开启全部不问">
              <b>
                <IconWarn size={16} /> 全部不问
              </b>
              <p>
                开启后，{routeLabel} 上 Claude 运行命令、改文件、联网都不再问你。它运行的命令能碰到这台电脑上你能碰到的任何东西，不限于这个项目。
              </p>
              <p>只在你信得过这个项目里的代码和你要它做的事时开启。随时可以在这里改回去；之后新开的路也会默认用它。</p>
              <div className={css.confirmRow}>
                <button type="button" onClick={close}>取消</button>
                <button type="button"
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
            <div ref={box} className={`${css.menu} ${css.wide}`} role="menu">
              <header>只对 {routeLabel} 生效，马上起作用。之后新开的路默认用你最后选的这个</header>
              {options === "loading" && <p className={css.loading}>正在从 Claude Code 读取能用的批准方式…</p>}
              {fallback && <p className={css.note}>这一路的模型（{model?.label}）不支持自动判断，这一路先按“每次都问”。</p>}
              {items.map((m) => (
                <button type="button"
                  key={m.mode}
                  role="menuitemradio"
                  aria-checked={m.mode === mode}
                  aria-disabled={!!m.disabled}
                  onClick={() => {
                    if (m.disabled) return;
                    if (m.mode === mode) return close();
                    if (m.mode === "all") return setConfirming(true);
                    onChange(m.mode);
                    close();
                  }}
                >
                  <i>{m.mode === mode ? <IconCheck size={14} /> : ""}</i>
                  <span>
                    {m.label}
                    {m.recommended && <span className={css.tag}>推荐</span>}
                    <small>{m.disabled ?? m.hint}</small>
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
