import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Route, Terminal } from "../../shared";
import { IconClose, IconStop, IconWarn } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { since } from "./TerminalStrip";
import css from "./Terminal.module.css";

interface Props {
  terminal: Terminal;
  route: Route;
  output: string;
  stopLabel: string | null;
  onStop(): void;
  onClose(): void;
}

/** 一个后台终端的输出。只能看，不能往里打字 */
export function TerminalDialog({ terminal: t, route, output, stopLabel, onStop, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [output]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const label = route.express ? `快${route.express}` : `${route.number}路`;
  const running = t.status === "running";

  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={css.window} role="dialog" aria-modal aria-label={`后台终端：${t.name}`}>
        <header>
          <Plate route={route} />
          <div className={css.title}>
            <h2 className="ell">{t.name}</h2>
            <p className="ell">
              <code>{t.command}</code>
            </p>
          </div>
          <span className={css.badge} data-status={t.status}>
            {running ? `运行中 · ${since(t.startedAt)}` : t.exitCode === 0 ? "已结束" : `已退出${t.exitCode !== null ? ` · 退出码 ${t.exitCode}` : ""}`}
          </span>
          {t.port !== null && running && <span className={css.port}>localhost:{t.port}</span>}
          <button aria-label="关闭" onClick={onClose}>
            <IconClose />
          </button>
        </header>
        <p className={css.note}>
          <IconWarn size={14} />
          这里跑的是 {label} 工作区里的代码，不是 Local。{stopLabel ? `Claude 在${stopLabel}开的；` : ""}这一站结束后它还会继续跑，直到你停掉、这一路归档或删除，或者退出 Branchwork。
        </p>
        <pre
          ref={box}
          className={css.output}
          tabIndex={0}
          aria-label="输出"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {output || (running ? "还没有输出…" : "没有输出。")}
        </pre>
        <footer>
          <span className="ell" title={t.cwd}>
            {t.cwd}
          </span>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(output).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "已复制" : "复制输出"}
          </button>
          <button className={running ? css.stop : undefined} onClick={onStop}>
            {running ? (
              <>
                <IconStop size={12} /> 停止
              </>
            ) : (
              "从列表里清掉"
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
