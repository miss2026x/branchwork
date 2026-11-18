import { useRef } from "react";
import type { PromptImage } from "../../shared";
import { draftId } from "../stores/store";
import { IconClip } from "../ui/icons";
import { PromptInput, type PromptInputHandle } from "./PromptInput";
import { useDraft } from "./use-draft";
import css from "./QuickAsk.module.css";

/**
 * 一行高的提问框（设计稿 9-11）：候车区里“写个问题，先放着”。
 * 和对话栏同一个输入框，能粘贴、拖进、点回形针放图；Enter 交出去
 */
export function QuickAsk({ label, placeholder, button, disabled, onSubmit }: { label: string; placeholder: string; button: string; disabled?: boolean; onSubmit(text: string, images: PromptImage[]): void }) {
  const draft = useDraft();
  const input = useRef<PromptInputHandle>(null);
  const ok = !disabled && draft.status === "ok";
  const submit = () => {
    if (!ok) return;
    const q = draft.prompt();
    onSubmit(q.text, q.images);
    draft.clear();
  };
  return (
    <div className={css.quick} data-disabled={disabled || undefined}>
      <div className={css.field}>
        <PromptInput ref={input} compact text={draft.text} images={draft.images} onChange={draft.set} onImage={draft.patch} onEnter={submit} newId={draftId} label={label} placeholder={placeholder} disabled={disabled} />
      </div>
      <button type="button" className={css.attach} aria-label="添加图片" title="添加图片（也可以直接粘贴或拖进来）" disabled={disabled} onClick={() => input.current?.pickFiles()}>
        <IconClip size={15} />
      </button>
      <button type="button" className={css.go} disabled={!ok} title={draft.status === "loading" ? "图片还在处理，等一下" : draft.status === "bad" ? "有图片读不了：去掉它或换一张" : undefined} onClick={submit}>
        {button}
      </button>
    </div>
  );
}
