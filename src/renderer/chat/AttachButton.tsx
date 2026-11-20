import { useEffect, useRef, useState, type RefObject } from "react";
import { IconClip, IconFile, IconFolder, IconImage } from "../ui/icons";
import type { PromptInputHandle } from "./PromptInput";
import css from "./AttachButton.module.css";

/**
 * 回形针（设计稿 9-16）：点开选放图片、文件还是文件夹。图片直接发给 Claude 看；
 * 文件和文件夹交给它的是在电脑上的位置，它用自己的工具读
 */
export function AttachButton({ input, className, size = 16, disabled }: { input: RefObject<PromptInputHandle | null>; className?: string; size?: number; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopImmediatePropagation(), setOpen(false));
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <span className={css.wrap} ref={wrap}>
      <button type="button" className={className} aria-label="添加图片或文件" aria-expanded={open} title="添加图片、文件或文件夹（也可以直接粘贴或拖进来）" disabled={disabled} onClick={() => setOpen(!open)}>
        <IconClip size={size} />
      </button>
      {open && (
        <div className={css.menu} role="menu">
          <button type="button" role="menuitem" onClick={pick(() => input.current?.pickFiles("image"))}>
            <IconImage size={14} />
            图片…
          </button>
          <button type="button" role="menuitem" onClick={pick(() => input.current?.pickFiles("file"))}>
            <IconFile size={14} />
            文件…
          </button>
          <button type="button" role="menuitem" onClick={pick(() => input.current?.pickFolder())}>
            <IconFolder size={14} />
            文件夹…
          </button>
          <p>也可以直接拖进来、粘贴。文件和文件夹不上传，Claude 按位置去读</p>
        </div>
      )}
    </span>
  );
}
