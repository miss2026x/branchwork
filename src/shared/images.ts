/**
 * 提问里的图片（设计稿 4-7 方案 B）：
 * 输入框里图片是文字里的小标签；发出去时提问的文字里在标签的位置留一个“[图 N]”，第 N 张图紧跟在它后面。
 * 存下来的提问文字也带着这些记号，回看时按记号把小标签放回原处。
 */

/** Claude 收的图片格式 */
export type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** 提问里带的一张图：已经在界面里缩好（长边不超过 IMAGE_MAX_EDGE），base64 */
export interface PromptImage {
  type: ImageType;
  /** 图片内容的 base64（不带 data: 前缀） */
  data: string;
  /** 文件名；粘贴的截图没有名字，用“粘贴的图片” */
  name: string;
  width: number;
  height: number;
}

/** 长边超过这个就在发送前缩小（Claude 收到更大的也会自己缩到这么大，先缩省流量和上下文） */
export const IMAGE_MAX_EDGE = 1568;
/** 一张图最大多少字节（Claude 的上限是 base64 之后 5MB） */
export const IMAGE_MAX_BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4);
/** 一个问题最多带几张 */
export const IMAGE_MAX_COUNT = 20;

/** 第 n 张图在文字里的记号 */
export const imageMark = (n: number) => `[图 ${n}]`;
const MARK = /\[图 (\d+)\]/g;

/** 文字里的记号依次指向第几张图（1 起） */
export function imageMarks(text: string): number[] {
  return [...text.matchAll(MARK)].map((m) => Number(m[1]));
}

/** 按记号把提问切成一段段：文字、第几张图、文字……（记号本身留在它前面那段文字的末尾） */
export function splitPrompt(text: string, count: number): ({ kind: "text"; text: string } | { kind: "image"; n: number })[] {
  const out: ({ kind: "text"; text: string } | { kind: "image"; n: number })[] = [];
  const used = new Set<number>();
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    const n = Number(m[1]);
    if (n < 1 || n > count || used.has(n)) continue;
    const end = m.index! + m[0].length;
    out.push({ kind: "text", text: text.slice(last, end) });
    out.push({ kind: "image", n });
    used.add(n);
    last = end;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  // 文字里没写记号的图（比如只发了图）：接在最后，前面补上记号
  for (let n = 1; n <= count; n++) {
    if (used.has(n)) continue;
    out.push({ kind: "text", text: imageMark(n) });
    out.push({ kind: "image", n });
  }
  return out.filter((p) => p.kind === "image" || p.text !== "");
}

/** 给人看的提问：去掉图片记号（起站名、通知里的一句话用） */
export function withoutImageMarks(text: string): string {
  return text.replace(MARK, " ").replace(/[ \t]+/g, " ").trim();
}

/** 一张图大约占多少 token（Claude 的估算：宽 × 高 / 750） */
export const imageTokens = (img: { width: number; height: number }) => Math.ceil((img.width * img.height) / 750);
