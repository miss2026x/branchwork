import { useLayoutEffect, type DependencyList, type RefObject } from "react";

const MARGIN = 8;

/** 元素真正能被看见的范围：窗口，再和每一层会裁剪内容的祖先（overflow 不是 visible）取交集 */
function visibleBox(el: HTMLElement) {
  const box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  if (getComputedStyle(el).position === "fixed") return box;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX !== "visible" || s.overflowY !== "visible") {
      const r = p.getBoundingClientRect();
      if (s.overflowX !== "visible") (box.left = Math.max(box.left, r.left)), (box.right = Math.min(box.right, r.right));
      if (s.overflowY !== "visible") (box.top = Math.max(box.top, r.top)), (box.bottom = Math.min(box.bottom, r.bottom));
    }
    // 固定定位的祖先之外的东西管不到它
    if (s.position === "fixed") break;
  }
  return box;
}

/**
 * 浮出来的菜单、卡片、下拉列表画完后量一下：超出窗口或被外面的栏裁掉时，整体挪回能看见的地方。
 * 用 CSS 的 translate 属性挪，不碰元素自己的 transform（很多卡片靠 transform 居中）。
 * 放不下时（比窗口还高）贴着上边，剩下的交给元素自己的 max-height / 滚动。
 */
export function useFit(ref: RefObject<HTMLElement | null>, deps: DependencyList) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.translate = "";
    const r = el.getBoundingClientRect();
    const box = visibleBox(el);
    let dx = 0;
    let dy = 0;
    if (r.right > box.right - MARGIN) dx = box.right - MARGIN - r.right;
    if (r.left + dx < box.left + MARGIN) dx = box.left + MARGIN - r.left;
    if (r.bottom > box.bottom - MARGIN) dy = box.bottom - MARGIN - r.bottom;
    if (r.top + dy < box.top + MARGIN) dy = box.top + MARGIN - r.top;
    if (dx || dy) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
