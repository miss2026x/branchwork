/**
 * 交接摘要拆成一条一条：方便在界面上逐条改、逐条删。纯函数。
 * 摘要是 Markdown：“## 小节”下面一行一条。拆开再拼回去，内容不变（只统一成“- ”开头）。
 */
export interface SummaryGroup {
  /** 小节标题；摘要开头没有标题的那几行，标题为空 */
  title: string;
  items: string[];
}

const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^(?:[-*+•]|\d+[.)、])\s+(.*)$/;

export function parseSummary(text: string): SummaryGroup[] {
  const groups: SummaryGroup[] = [];
  let current: SummaryGroup | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = HEADING.exec(line) ?? /^\*\*(.+?)\*\*[:：]?$/.exec(line);
    if (h) {
      current = { title: h[1]!.trim(), items: [] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { title: "", items: [] };
      groups.push(current);
    }
    const b = BULLET.exec(line);
    // 缩进的续行并到上一条里
    if (!b && /^\s{2,}\S/.test(raw) && current.items.length > 0) current.items[current.items.length - 1] += ` ${line}`;
    else current.items.push(b ? b[1]!.trim() : line);
  }
  return groups;
}

export function formatSummary(groups: SummaryGroup[]): string {
  return groups
    .map((g) => ({ title: g.title.trim(), items: g.items.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean) }))
    .filter((g) => g.items.length > 0)
    .map((g) => [...(g.title ? [`## ${g.title}`] : []), ...g.items.map((x) => `- ${x}`)].join("\n"))
    .join("\n\n");
}

/** 粗略估一段文字占多少 token：中日韩文字一个字算一个，其余四个字符算一个 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[　-鿿가-힯＀-￯]/g) ?? []).length;
  return Math.round(cjk + (text.length - cjk) / 4);
}
