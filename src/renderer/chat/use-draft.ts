import { useCallback, useMemo, useState } from "react";
import type { PromptImage } from "../../shared";
import { draftId } from "../stores/store";
import { draftStatus, fromPrompt, toPrompt, type DraftImage } from "./draft";

/**
 * 对话栏以外能带图的输入框（设计稿 9-11：候车区、开新车的第一个问题……）各自的草稿。
 * 和对话栏一样：文字里每张图占一个 OBJ，图片按顺序在 images 里，处理好之前不能发
 */
export function useDraft() {
  const [draft, setDraft] = useState<{ text: string; images: DraftImage[] }>({ text: "", images: [] });
  const set = useCallback((text: string, images: DraftImage[] = []) => setDraft({ text, images }), []);
  const patch = useCallback((id: string, p: Partial<DraftImage>) => setDraft((d) => ({ ...d, images: d.images.map((i) => (i.id === id ? { ...i, ...p } : i)) })), []);
  const clear = useCallback(() => setDraft({ text: "", images: [] }), []);
  /** 放进一个已有的提问（候车区里挑的问题）：图一起带进来 */
  const fill = useCallback(async (text: string, images: PromptImage[]) => setDraft(fromPrompt(text, images, draftId)), []);
  return useMemo(
    () => ({ text: draft.text, images: draft.images, set, patch, clear, fill, status: draftStatus(draft.text, draft.images), prompt: () => toPrompt(draft.text, draft.images) }),
    [draft, set, patch, clear, fill],
  );
}
export type Draft = ReturnType<typeof useDraft>;
