import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Route, Stop } from "../../shared";
import { firstStops } from "../stores/numbering";
import { IconClose } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import css from "./Dialog.module.css";

interface Props {
  parent: Route;
  stop: Stop;
  /** 这一站显示的序号 */
  stopNumber: number;
  /** 新的一路会是几路 */
  nextNumber: number;
  onCancel(): void;
  onConfirm(name: string, firstQuestion: string): void;
}

/** “从第 N 站开新对话”。只收数据、回传用户填的内容 */
export function ForkDialog({ parent, stop, stopNumber, nextNumber, onCancel, onConfirm }: Props) {
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const next = { number: nextNumber, express: null };

  useEffect(() => {
    nameInput.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onConfirm(name, question);
  };

  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className={css.dialog} role="dialog" aria-modal aria-label={`从第 ${stopNumber} 站开新对话`} onSubmit={submit}>
        <header>
          <Plate route={parent} />
          <h2>从第 {stopNumber} 站开新对话</h2>
          <button type="button" aria-label="关闭" onClick={onCancel}>
            <IconClose />
          </button>
        </header>
        <p className={css.sub}>
          新对话带着{firstStops(stopNumber)}（到「{stop.name}」为止）的完整历史出发。会话是新的，{parent.number}路 不受影响。
        </p>

        <label className={css.field}>
          <span>线路名称</span>
          <div className={css.nameRow}>
            <input ref={nameInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="新对话" maxLength={40} />
            <Plate route={next} />
          </div>
        </label>

        <label className={css.field}>
          <span>第一个问题（可以先不填）</span>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            placeholder="开好后马上问这个问题"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e);
            }}
          />
        </label>

        <div className={css.note}>
          <b>代码从 Local 的现在开始，不回到第 {stopNumber} 站当时的样子。</b>
          {nextNumber}路 有自己的工作区，和 {parent.number}路 可以同时改代码。每站答完自动同步进 Local。
        </div>

        <footer>
          <button type="button" className={css.ghost} onClick={onCancel}>
            取消
          </button>
          <button type="submit" className={css.confirm} style={{ background: routeColors(next).tag }}>
            开出 {nextNumber}路
          </button>
        </footer>
      </form>
    </div>
  );
}
