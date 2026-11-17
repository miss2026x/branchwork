import { imageMark, imageMarks, type PromptImage } from "../../shared";

/**
 * 输入框里的草稿（设计稿 4-7 方案 B）：文字里每张图占一个 OBJ 字符，第 k 个 OBJ 对应 images[k]。
 * 发出去时 OBJ 换成“[图 N]”，图片按顺序跟着发；改站把提问放回输入框时反过来。
 */
export const OBJ = "￼";

/** 输入框里的一张图：放进来以后要先读、缩小，好了才能发 */
export interface DraftImage {
  id: string;
  /** loading 正在读、缩小；ready 可以发；bad 读不了（reason 说为什么） */
  state: "loading" | "ready" | "bad";
  name: string;
  image?: PromptImage;
  reason?: string;
}

/** 草稿能不能发：有字或有图，而且图都处理好了 */
export function draftStatus(text: string, images: DraftImage[]): "empty" | "loading" | "bad" | "ok" {
  if (images.some((i) => i.state === "bad")) return "bad";
  if (images.some((i) => i.state === "loading")) return "loading";
  return text.replaceAll(OBJ, "").trim() || images.length > 0 ? "ok" : "empty";
}

/** 草稿 → 发出去的提问：OBJ 换成“[图 N]”，图片按出现的先后排 */
export function toPrompt(text: string, images: DraftImage[]): { text: string; images: PromptImage[] } {
  let k = 0;
  const out = text.replaceAll(OBJ, () => imageMark(++k)).trim();
  return { text: out, images: images.slice(0, k).flatMap((i) => (i.image ? [i.image] : [])) };
}

/** 存下来的提问 → 草稿（改站、发车失败时放回输入框）：“[图 N]”换回 OBJ；文字里没提到的图接在最后 */
export function fromPrompt(text: string, images: PromptImage[], newId: () => string): { text: string; images: DraftImage[] } {
  const order: number[] = [];
  let out = text.replace(/\[图 (\d+)\]/g, (m, n: string) => {
    const i = Number(n) - 1;
    if (!images[i] || order.includes(i)) return m;
    order.push(i);
    return OBJ;
  });
  images.forEach((_, i) => {
    if (!order.includes(i)) (order.push(i), (out += OBJ));
  });
  return { text: out, images: order.map((i) => ({ id: newId(), state: "ready" as const, name: images[i]!.name, image: images[i]! })) };
}

/** 提问里一共指到几张图（用来核对） */
export const markCount = (text: string) => imageMarks(text).length;

/** 图片的 data: 地址，放进 <img> 用 */
export const imageUrl = (img: PromptImage) => `data:${img.type};base64,${img.data}`;
