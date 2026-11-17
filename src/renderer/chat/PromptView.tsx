import { useEffect } from "react";
import { splitPrompt, type PromptImage } from "../../shared";
import { useStore } from "../stores/store";
import { imageUrl } from "./draft";
import css from "./Images.module.css";

/**
 * 提问气泡里的文字：还是写的时候的样子，“[图 N]”的位置是一个白底的小标签，点开看大图（设计稿 4-7）。
 * 图片要么直接给（刚发出、站还没出现），要么按站的 id 去取
 */
export function PromptView({ text, images, ownerId, count = 0, title }: { text: string; images?: PromptImage[]; ownerId?: string; count?: number; title: string }) {
  const loaded = useStore((s) => (ownerId ? s.images[ownerId] : undefined));
  const loadImages = useStore((s) => s.loadImages);
  const openViewer = useStore((s) => s.openViewer);
  useEffect(() => {
    if (ownerId && count > 0) loadImages(ownerId);
  }, [ownerId, count, loadImages]);

  const list = images ?? (Array.isArray(loaded) ? loaded : []);
  const n = images ? images.length : count;
  if (n === 0) return <>{text}</>;
  const parts = splitPrompt(text, n);
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "text") {
          // 记号本身不显示：它在后面的标签上
          const shown = p.text.replace(/\[图 \d+\]$/, "");
          return shown ? <span key={i}>{shown}</span> : null;
        }
        const img = list[p.n - 1];
        return (
          <button key={i} type="button" className={css.tag} data-sent data-state={img ? "ready" : "loading"} aria-label={`图 ${p.n}${img ? `：${img.name}` : ""}，点开看大图`} disabled={!img} onClick={() => img && openViewer(list, p.n - 1, title)}>
            {img ? <img src={imageUrl(img)} alt="" /> : <i />}
            <b>图 {p.n}</b>
          </button>
        );
      })}
    </>
  );
}
