import { useEffect, useState } from "react";
import type { Route, Stop } from "../../shared";
import { IconClose } from "../ui/icons";
import { Plate } from "../ui/Plate";
import css from "./Dialog.module.css";
import own from "./Extra.module.css";

interface Props {
  route: Route;
  stop: Stop;
  stopNumber: number;
  /** 这一路最后一站的序号 */
  lastNumber: number;
  /** 从要被截掉的站分出去的路（它们是独立的对话，不受影响） */
  forks: Route[];
  /** 一开始是否勾上“把问题放回输入框”（从“改站”进来时勾上） */
  requeue: boolean;
  onCancel(): void;
  onConfirm(requeue: boolean): void;
}

/** 截线确认：删掉这一站和后面所有站。只删对话，代码不动 */
export function TruncateDialog({ route, stop, stopNumber, lastNumber, forks, requeue: initial, onCancel, onConfirm }: Props) {
  const [requeue, setRequeue] = useState(initial);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const range = lastNumber > stopNumber ? `第 ${stopNumber}–${lastNumber} 站` : `第 ${stopNumber} 站`;
  const label = (r: Route) => (r.express ? `快${r.express}` : `${r.number}路`);
  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={css.dialog} role="alertdialog" aria-modal aria-label={`从第 ${stopNumber} 站截线`}>
        <header>
          <Plate route={route} />
          <h2>从第 {stopNumber} 站截线</h2>
          <button type="button" aria-label="关闭" onClick={onCancel}>
            <IconClose />
          </button>
        </header>
        <p className={css.sub}>
          {range}会{lastNumber > stopNumber ? "一起" : ""}删掉。后面的站都是带着前面的内容答出来的，只抽掉中间一站，后面的上下文就不干净了，所以截线总是从这一站删到底。
        </p>
        {forks.length > 0 && <p className={own.plain}>{forks.map(label).join(" 和 ")} 是从这几站分出去的独立对话，不受影响。</p>}
        <div className={css.note}>
          <span>
            <b>代码不动。</b>
            {range}已经同步进 Local 的改动保持现在的样子，截线只删对话。重新问的时候，Claude 会先拿到 Local 的最新代码，所以它能看到这些改动。
          </span>
        </div>
        <label className={own.checkRow}>
          <input type="checkbox" checked={requeue} onChange={(e) => setRequeue(e.target.checked)} />
          <span>
            把第 {stopNumber} 站的问题放回输入框，改完重新问
            <small>这就是改站：截线之后在同一站换个问法</small>
          </span>
        </label>
        <footer>
          <button type="button" className={css.ghost} onClick={onCancel}>
            取消
          </button>
          <button type="button" className={css.confirm} style={{ background: "var(--red)" }} onClick={() => onConfirm(requeue)}>
            截线
          </button>
        </footer>
      </div>
    </div>
  );
}
