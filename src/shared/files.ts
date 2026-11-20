/**
 * 输入框里附的文件和文件夹（设计稿 9-16）。不上传，在提问里写成“[文件 位置]”“[文件夹 位置]”交给 Claude，
 * 它用自己的工具去读；Lanes 让它读这些位置时不用再批准
 */

const FILE = /\[(文件|文件夹) ([^\]\n]+)\]/g;

/** 一个附件在提问里的记号 */
export const fileMark = (path: string, dir = false) => `[${dir ? "文件夹" : "文件"} ${path}]`;

/** 提问里附的文件和文件夹 */
export function fileMarks(text: string): { path: string; dir: boolean }[] {
  return [...text.matchAll(FILE)].map((m) => ({ path: m[2]!.trim(), dir: m[1] === "文件夹" }));
}

/** 按附件记号把文字切开 */
export function splitFiles(text: string): ({ kind: "text"; text: string } | { kind: "file"; path: string; dir: boolean })[] {
  const out: ({ kind: "text"; text: string } | { kind: "file"; path: string; dir: boolean })[] = [];
  let last = 0;
  for (const m of text.matchAll(FILE)) {
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "file", path: m[2]!.trim(), dir: m[1] === "文件夹" });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** 位置的最后一段（文件名、文件夹名） */
export const baseName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

/** 给人看的提问：附件记号换成文件名（起站名、通知里的一句话用） */
export function withFileNames(text: string): string {
  return text.replace(FILE, (_, _k: string, p: string) => baseName(p.trim()));
}
