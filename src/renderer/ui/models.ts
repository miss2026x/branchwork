import type { Effort, ModelChoice } from "../../shared";

/** 读不到 Claude Code 的列表时先给这几个常见的（不知道能调哪几档思考强度） */
const FALLBACK: ModelChoice[] = [
  { value: "default", label: "默认", description: "用你账号的默认模型", efforts: [] },
  { value: "opus", label: "Opus", description: "最强，适合难的问题", efforts: [] },
  { value: "sonnet", label: "Sonnet", description: "均衡，日常写代码", efforts: [] },
  { value: "haiku", label: "Haiku", description: "最快最省，适合简单的事", efforts: [] },
];

export const EFFORT_LABEL: Record<Effort, string> = { low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高" };

export type ModelsState = ModelChoice[] | "loading" | "failed" | undefined;

/** 菜单里列哪些模型。这一路之前选的不在列表里（比如账号变了）时也列出来，免得看不到自己现在用的是什么 */
export function modelItems(state: ModelsState, current: string | null): ModelChoice[] {
  const list = Array.isArray(state) ? state : state === "failed" ? FALLBACK : [];
  const items = list.some((m) => m.value === "default") ? [...list] : [FALLBACK[0]!, ...list];
  if (current && !items.some((m) => m.value === current)) items.push({ value: current, label: current, description: "这一路之前选的", efforts: [] });
  return items;
}

/** 这一路现在用的那个（没选过就是“默认”） */
export function currentModel(state: ModelsState, current: string | null): ModelChoice {
  const items = modelItems(state, current);
  return items.find((m) => m.value === (current ?? "default")) ?? items[0]!;
}
