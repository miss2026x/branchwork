import { useEffect, useRef, useState } from "react";
import type { LocalPreset } from "../../shared";
import { BUILTIN_PRESETS, mergePresets, PRESET_VARS } from "../chat/local-presets";
import { IconClose } from "../ui/icons";
import css from "./Dialog.module.css";
import own from "./LocalPresets.module.css";

interface Props {
  projectName: string;
  /** 存下来的；null 是没改过 */
  saved: LocalPreset[] | null | undefined;
  onSave(presets: LocalPreset[] | null): void;
  onClose(): void;
}

/** 管理 Local 专车的常用提示（设计稿 9-10）：拖着排顺序、隐藏、改名改话、自己加；每个项目一套 */
export function LocalPresetsDialog({ projectName, saved, onSave, onClose }: Props) {
  const [list, setList] = useState<LocalPreset[]>(() => mergePresets(saved).map((p) => ({ ...p })));
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patch = (id: string, p: Partial<LocalPreset>) => setList((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const current = list.find((p) => p.id === editing);
  const add = () => {
    const id = `c${Date.now().toString(36)}`;
    setList((l) => [...l, { id, label: "新的提示", text: "" }]);
    setEditing(id);
  };
  const move = (from: number, to: number) =>
    setList((l) => {
      const next = [...l];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x!);
      return next;
    });
  const insertVar = (v: string) => {
    const el = textRef.current;
    if (!el || !current) return;
    const at = el.selectionStart ?? current.text.length;
    patch(current.id, { text: current.text.slice(0, at) + v + current.text.slice(el.selectionEnd ?? at) });
    requestAnimationFrame(() => (el.focus(), el.setSelectionRange(at + v.length, at + v.length)));
  };
  const builtinText = (p: LocalPreset) => BUILTIN_PRESETS.find((b) => b.builtin === p.builtin);

  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={css.dialog} role="dialog" aria-modal aria-label="Local 专车的常用提示">
        <header>
          <h2>
            Local 专车的常用提示 <small className={own.project}>{projectName}</small>
          </h2>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <IconClose />
          </button>
        </header>
        <p className={css.sub}>自带的几条只在用得上时出现（有改动才有“提交”）。拖着排顺序；点一下只填进输入框，不直接发。</p>
        <ul className={own.list}>
          {list.map((p, i) => (
            <li
              key={p.id}
              className={own.row}
              data-hidden={p.hidden || undefined}
              data-editing={editing === p.id || undefined}
              data-drop={drag !== null && drag !== i ? true : undefined}
              draggable
              onDragStart={(e) => (setDrag(i), e.dataTransfer.setData("text/plain", p.id), (e.dataTransfer.effectAllowed = "move"))}
              onDragOver={(e) => drag !== null && e.preventDefault()}
              onDrop={(e) => (e.preventDefault(), drag !== null && drag !== i && move(drag, i), setDrag(null))}
              onDragEnd={() => setDrag(null)}
            >
              <span className={own.handle} aria-hidden>
                ⋮⋮
              </span>
              <b className="ell">{p.label || "（没有名字）"}</b>
              {!p.builtin && <em className={own.custom}>自己加的</em>}
              <span className={own.spacer} />
              <button type="button" className={own.link} data-off={p.hidden || undefined} aria-label={`${p.hidden ? "显示" : "隐藏"} ${p.label}`} onClick={() => patch(p.id, { hidden: !p.hidden })}>
                {p.hidden ? "已隐藏" : "显示"}
              </button>
              <button type="button" className={own.link} data-strong aria-expanded={editing === p.id} onClick={() => setEditing(editing === p.id ? null : p.id)}>
                编辑
              </button>
              {i > 0 && (
                <button type="button" className={own.link} aria-label={`把 ${p.label} 往上挪`} onClick={() => move(i, i - 1)}>
                  ↑
                </button>
              )}
            </li>
          ))}
        </ul>
        {current && (
          <div className={own.edit}>
            <span className={own.editTitle}>编辑 · {current.label || "新的提示"}</span>
            <input aria-label="按钮上的字" value={current.label} maxLength={20} onChange={(e) => patch(current.id, { label: e.target.value })} />
            <textarea ref={textRef} aria-label="点了填进去的话" rows={3} value={current.text} placeholder="点了以后填进输入框的话，比如：用 docker build 构建镜像，失败了告诉我卡在哪一步" onChange={(e) => patch(current.id, { text: e.target.value })} />
            <div className={own.vars}>
              <span>可以插入：</span>
              {PRESET_VARS.map((v) => (
                <button key={v} type="button" onClick={() => insertVar(v)}>
                  {v}
                </button>
              ))}
              <span>填进去时换成这个项目的</span>
            </div>
            <div className={own.editActions}>
              {current.builtin ? (
                <button type="button" className={own.link} onClick={() => patch(current.id, { label: builtinText(current)!.label, text: builtinText(current)!.text })}>
                  改回自带的
                </button>
              ) : (
                <button type="button" className={own.link} data-danger onClick={() => (setList((l) => l.filter((x) => x.id !== current.id)), setEditing(null))}>
                  删掉这一条
                </button>
              )}
            </div>
          </div>
        )}
        <footer className={own.foot}>
          <button type="button" className={own.add} onClick={add}>
            ＋ 加一条
          </button>
          <span className={own.spacer} />
          <button type="button" className={css.ghost} onClick={() => (onSave(null), onClose())}>
            恢复默认
          </button>
          <button type="button" className={css.confirm} style={{ background: "var(--fg-1)" }} onClick={() => (onSave(list.filter((p) => p.label.trim() && p.text.trim())), onClose())}>
            好了
          </button>
        </footer>
      </div>
    </div>
  );
}
