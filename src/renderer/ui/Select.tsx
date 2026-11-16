import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { IconCheck, IconChevron } from "./icons";
import { useFit } from "./useFit";
import css from "./Select.module.css";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** 选项下面一行小字 */
  hint?: string;
}

interface Props<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange(value: T): void;
  /** 给读屏用的名字 */
  label: string;
}

/**
 * 下拉选择。系统自带的 <select> 展开后是操作系统的样子（Windows 上是一块灰框蓝条），
 * 和其他地方对不上，所以自己画：按钮 + 浮出的列表，方向键 / Enter / Esc 都能用。
 */
export function Select<T extends string>({ value, options, onChange, label }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // 下面放不下就往上开，别盖住按钮
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useFit(list, [open]);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0]!;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const show = () => {
    const r = root.current?.getBoundingClientRect();
    const need = options.length * 44 + 16;
    setUp(!!r && r.bottom + need > window.innerHeight - 8 && r.top - need > 8);
    setActive(Math.max(0, options.indexOf(current)));
    setOpen(true);
  };
  const pick = (o: SelectOption<T>) => {
    onChange(o.value);
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      // 只收起列表，别把外面的弹窗也关了
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return show();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if ((e.key === "Enter" || e.key === " ") && open) {
      e.preventDefault();
      pick(options[active]!);
    }
  };

  return (
    <div className={css.select} ref={root} onKeyDown={onKey}>
      <button type="button" className={css.button} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}：${current.label}`} aria-controls={id} onClick={() => (open ? setOpen(false) : show())}>
        <span className="ell">{current.label}</span>
        <IconChevron size={14} open />
      </button>
      {open && (
        <ul ref={list} className={css.list} data-up={up} role="listbox" id={id} aria-label={label}>
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
            >
              <span>
                {o.label}
                {o.hint && <small>{o.hint}</small>}
              </span>
              {o.value === value && <IconCheck size={14} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
