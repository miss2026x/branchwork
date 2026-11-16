import type { ClaudeOptions, Effort, ModelChoice, PermissionMode } from "../../shared";

/**
 * 模型、思考强度、批准方式：能选哪些都以这台电脑上的 Claude Code 报的为准（core 去读、记下来）。
 * 这里只负责排顺序、给常用的几个配一句中文提示，以及读不到时的退路。
 */
export type OptionsState = ClaudeOptions | "loading" | "failed" | undefined;

/** 常用别名的一句话提示；Claude Code 自己的英文说明放在下一行 */
const MODEL_HINT: Record<string, string> = {
  default: "跟着你的账号走；拿不准就选它",
  best: "你能用的里最强的那个",
  opus: "大多数任务的首选：难题、改动大的活",
  sonnet: "日常写代码，快一些、省一些",
  fable: "最强：最难、最长的任务；最慢也最贵",
  haiku: "最快最省：小改动、查点东西",
  opusplan: "出计划用 Opus，动手用 Sonnet",
};

/** 读不到 Claude Code 的列表时先给这几个（不知道能调哪几档思考强度） */
const FALLBACK: ModelChoice[] = [
  { value: "default", label: "默认", description: "", efforts: [], autoMode: false },
  { value: "opus", label: "Opus", description: "", efforts: [], autoMode: false },
  { value: "sonnet", label: "Sonnet", description: "", efforts: [], autoMode: false },
  { value: "haiku", label: "Haiku", description: "", efforts: [], autoMode: false },
];

/**
 * 中文提示只配给真是 Claude 模型的别名。接了别家网关时，sonnet 这样的别名可能被设成了别的模型
 * （比如 DeepSeek），那句“日常写代码”就不对了，只留 Claude Code 自己的说明
 */
export const modelHint = (m: ModelChoice) => (m.resolved && !m.resolved.startsWith("claude-") ? "" : (MODEL_HINT[m.value] ?? ""));

/** 别名（default、opus、sonnet…）是常用的；具体型号、自定义的、网关给的收在“更多型号”里 */
const isCommon = (m: ModelChoice) => m.value in MODEL_HINT;

/** 菜单里列哪些模型。这一路之前选的不在列表里（比如换了账号）时也列出来，免得看不到自己现在用的是什么 */
export function modelItems(state: OptionsState, current: string | null): { common: ModelChoice[]; more: ModelChoice[] } {
  const list = typeof state === "object" ? state.models : state === "failed" ? FALLBACK : [];
  const items = list.some((m) => m.value === "default") ? [...list] : [FALLBACK[0]!, ...list];
  if (current && !items.some((m) => m.value === current)) items.push({ value: current, label: current, description: "这一路之前选的", efforts: [], autoMode: false });
  return { common: items.filter((m) => isCommon(m) || m.value === current), more: items.filter((m) => !isCommon(m) && m.value !== current) };
}

/** 这一路现在用的那个（没选过就是“默认”） */
export function currentModel(state: OptionsState, current: string | null): ModelChoice {
  const { common, more } = modelItems(state, current);
  return [...common, ...more].find((m) => m.value === (current ?? "default")) ?? common[0]!;
}

export const EFFORT_LABEL: Record<Effort, string> = { low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高" };
export const EFFORT_HINT: Record<Effort, string> = {
  low: "最快：简单的事",
  medium: "大多数事够用",
  high: "多想一会儿：难一点的问题",
  xhigh: "想得更久：复杂的改动",
  max: "想到最充分：最慢、最贵",
};

export interface ModeInfo {
  mode: PermissionMode;
  label: string;
  hint: string;
  /** 推荐的那个 */
  recommended?: boolean;
  /** 能看到但这一路用不了，写着为什么 */
  disabled?: string;
}

const MODES: ModeInfo[] = [
  { mode: "ask", label: "每次都问", hint: "改文件、运行命令前都等你批准" },
  { mode: "edits", label: "改文件不问", hint: "改文件直接做；运行命令等其他操作还是问你" },
  { mode: "auto", label: "自动判断", hint: "另一个模型在后台替你把关：看着安全的直接做，拿不准才问你", recommended: true },
  { mode: "plan", label: "先出计划", hint: "先只读代码、写计划；你批准计划后才动手" },
  { mode: "dontAsk", label: "只做允许过的", hint: "不问你；没事先允许过的操作直接拒绝" },
  { mode: "all", label: "全部不问", hint: "什么都不问，相当于 --dangerously-skip-permissions" },
];

export const modeInfo = (mode: PermissionMode) => MODES.find((m) => m.mode === mode) ?? MODES[0]!;

/**
 * 批准方式列哪些：Claude Code 肯切过去的那些（管理员关掉的、账号没有的不列）。
 * “自动判断”还要这一路的模型支持；model 不传就不管模型（比如开新车时还没选）
 */
export function modeItems(state: OptionsState, model?: ModelChoice): ModeInfo[] {
  const ok = typeof state === "object" ? state.modes : (["ask", "edits", "all"] as PermissionMode[]);
  return MODES.filter((m) => ok.includes(m.mode)).map((m) => (m.mode === "auto" && model && typeof state === "object" && !model.autoMode ? { ...m, disabled: `${model.label} 不支持，换个模型才能用` } : m));
}
