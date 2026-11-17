import { useEffect, useState } from "react";
import { useStore } from "../stores/store";
import { IconClose } from "../ui/icons";
import { imageUrl } from "./draft";
import css from "./Images.module.css";

/** 看大图（设计稿 4-7）：深色底，下面一排小图，← → 切换，Esc 关闭 */
export function ImageViewer() {
  const viewer = useStore((s) => s.viewer);
  const close = useStore((s) => s.closeViewer);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(viewer?.index ?? 0), [viewer]);
  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(viewer.images.length - 1, i + 1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [viewer, close]);
  if (!viewer) return null;
  const img = viewer.images[index];
  if (!img) return null;
  return (
    <div className={css.viewer} role="dialog" aria-modal="true" aria-label="看大图" onClick={(e) => e.target === e.currentTarget && close()}>
      <img src={imageUrl(img)} alt={`图 ${index + 1}：${img.name}`} />
      <div className={css.viewerBar}>
        {viewer.images.length > 1 &&
          viewer.images.map((x, i) => (
            <button key={i} aria-label={`图 ${i + 1}`} aria-current={i === index} onClick={() => setIndex(i)}>
              <img src={imageUrl(x)} alt="" />
            </button>
          ))}
        <span>
          图 {index + 1} / {viewer.images.length} · {viewer.title} · {img.width} × {img.height}
          {viewer.images.length > 1 ? " · ← → 切换" : ""}，Esc 关闭
        </span>
      </div>
      <button className={css.viewerClose} aria-label="关闭" onClick={close}>
        <IconClose size={18} />
      </button>
    </div>
  );
}
