import { useEffect } from "react";
import { useStore } from "../stores/store";
import { imageUrl } from "./draft";
import css from "./Images.module.css";

/** 一站（或一个候车问题）带的图片：一排小图，点开看大图。地图的悬停卡片里用（设计稿 4-7） */
export function StopImages({ ownerId, count, title }: { ownerId: string; count: number; title: string }) {
  const loaded = useStore((s) => s.images[ownerId]);
  const loadImages = useStore((s) => s.loadImages);
  const openViewer = useStore((s) => s.openViewer);
  useEffect(() => {
    if (count > 0) loadImages(ownerId);
  }, [ownerId, count, loadImages]);
  if (count === 0) return null;
  const list = Array.isArray(loaded) ? loaded : [];
  return (
    <div className={css.thumbs}>
      {Array.from({ length: Math.min(count, 4) }, (_, i) => {
        const img = list[i];
        return (
          <button key={i} type="button" aria-label={`图 ${i + 1}，点开看大图`} disabled={!img} onClick={() => img && openViewer(list, i, title)}>
            {img ? <img src={imageUrl(img)} alt="" /> : <i />}
          </button>
        );
      })}
      {count > 4 && <span>+{count - 4}</span>}
    </div>
  );
}
