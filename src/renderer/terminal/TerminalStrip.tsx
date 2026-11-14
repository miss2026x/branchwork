import { useState } from "react";
import type { Route, Terminal } from "../../shared";
import { Plate } from "../ui/Plate";
import { IconChevron, IconClose, IconStop, IconTerminal } from "../ui/icons";
import css from "./Terminal.module.css";

interface Props {
  route: Route;
  /** 这一路的后台终端 */
  terminals: Terminal[];
  /** 是第几站开的，显示用；不知道就不显示 */
  stopLabel(stopId: string | null): string | null;
  onOpen(terminalId: string): void;
  /** 还在跑的停掉；已退出的从列表里拿掉 */
  onStop(terminalId: string): void;
}

/** 多久了 */
export function since(from: number, to = Date.now()): string {
  const m = Math.max(0, Math.round((to - from) / 60_000));
  if (m < 1) return "不到 1 分钟";
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} 小时 ${m % 60} 分` : `${Math.floor(h / 24)} 天`;
}

/** 输入框上面的一条：这一路开着哪些后台终端。只收数据、发事件 */
export function TerminalStrip({ route, terminals, stopLabel, onOpen, onStop }: Props) {
  const running = terminals.filter((t) => t.status === "running").length;
  const [open, setOpen] = useState(true);
  if (terminals.length === 0) return null;
  return (
    <section className={css.strip} aria-label="后台终端">
      <button className={css.stripHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconChevron size={12} open={open} />
        <b>{terminals.length} 个后台终端</b>
        <span data-running={running > 0}>{running > 0 ? "运行中" : "都已退出"}</span>
      </button>
      {open && (
        <ul>
          {terminals.map((t) => {
            const from = stopLabel(t.stopId);
            return (
              <li key={t.id} data-status={t.status}>
                <button className={css.row} onClick={() => onOpen(t.id)} title="看输出">
                  <IconTerminal size={14} />
                  <Plate route={route} />
                  <span className={css.rowText}>
                    <b className="ell">{t.name}</b>
                    <small className="ell">
                      <code>{t.command}</code> · {route.express ? `快${route.express}` : `${route.number}路`} 的工作区{from && <>，{from}开的</>}
                    </small>
                  </span>
                  {t.port !== null && t.status === "running" && <em>{`:${t.port}`}</em>}
                  <span className={css.state}>{t.status === "running" ? since(t.startedAt) : t.exitCode === 0 ? "已结束" : `已退出${t.exitCode !== null ? `（${t.exitCode}）` : ""}`}</span>
                </button>
                <button className={css.rowStop} onClick={() => onStop(t.id)} aria-label={t.status === "running" ? `停止 ${t.name}` : `清掉 ${t.name}`} title={t.status === "running" ? "停止" : "从列表里清掉"}>
                  {t.status === "running" ? "停止" : <IconClose size={14} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
