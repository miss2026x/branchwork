import type { LocalPreset, LocalStatus } from "../../shared";

/**
 * Local 专车的常用提示（设计稿 9-10）：自带的七条，按“现在用得上”出现；
 * 点一下只填进输入框，{主分支}、{开发命令}、{测试命令}、{冲突文件} 换成这个项目的
 */
export const BUILTIN_PRESETS: LocalPreset[] = [
  { id: "conflict", builtin: "conflict", label: "解决冲突", text: "Local 里有冲突：{冲突文件}。看看两边各想做什么，按两边都保留的意思合好，跑测试确认，再告诉我怎么合的。" },
  { id: "pull", builtin: "pull", label: "拉主分支", text: "把 origin/{主分支} 的新提交拉进 Local（git pull --autostash，保留没提交的改动）。有冲突先停下，告诉我冲突在哪些文件、两边各改了什么。" },
  { id: "commit", builtin: "commit", label: "提交改动", text: "把 Local 里没提交的改动按路分开提交：每一路一次，提交说明用那几站的站名写。提交前先把分组给我看，我说可以再提交。" },
  { id: "push", builtin: "push", label: "推送", text: "先跑一遍测试，通过了再把 Local 的提交推到 origin。没通过就告诉我哪里没过，先别推。" },
  { id: "dev", builtin: "dev", label: "启动项目", text: "在 Local 里启动项目：用后台终端跑 {开发命令}，跑起来后告诉我地址。已经在跑就不要再开一个。" },
  { id: "test", builtin: "test", label: "跑测试", text: "在 Local 里跑一遍 {测试命令}。有失败的，告诉我失败在哪、可能是哪一路哪一站改出来的，先别改。" },
  { id: "status", builtin: "status", label: "看看现状", text: "说说 Local 现在的情况：在哪个分支、和 origin 差多少、哪些文件没提交、各是哪一路哪一站改的。只看，不改。" },
];

/** 可以写进提示里的几个占位 */
export const PRESET_VARS = ["{主分支}", "{开发命令}", "{测试命令}", "{冲突文件}"];

/** 存下来的（可能是旧版本存的）和自带的合起来：自带的新增的那几条补在后面 */
export function mergePresets(saved: LocalPreset[] | null | undefined): LocalPreset[] {
  if (!saved) return BUILTIN_PRESETS;
  const have = new Set(saved.map((p) => p.builtin).filter(Boolean));
  return [...saved, ...BUILTIN_PRESETS.filter((b) => !have.has(b.builtin))];
}

export interface PresetChip {
  preset: LocalPreset;
  icon: string;
  label: string;
  /** 跟在名字后面的小字：新 3、1 个、pnpm dev */
  extra?: string;
  /** 有冲突：标红、排第一 */
  urgent?: boolean;
  /** 填进输入框的话 */
  text: string;
}

const ICON: Record<string, string> = { conflict: "!", pull: "↓", commit: "✓", push: "↑", dev: "▶", test: "✓", status: "?" };

/** 把提示里的占位换成这个项目的 */
export function fillPreset(text: string, s: LocalStatus | undefined): string {
  const main = s?.upstream?.split("/").slice(1).join("/") || s?.branch || "main";
  const conflicts = s?.files.filter((f) => f.state === "conflict").map((f) => f.path) ?? [];
  return text
    .replaceAll("{主分支}", main)
    .replaceAll("{开发命令}", s?.commands.dev ?? "开发服务器")
    .replaceAll("{测试命令}", s?.commands.test ?? "测试")
    .replaceAll("{冲突文件}", conflicts.join("、") || "（没有）");
}

/**
 * 现在该显示哪些、按什么顺序：有冲突时“解决冲突”排第一；
 * 自带的只在用得上时出现（有改动才有“提交”，有没推的提交才有“推送”…），自己加的一直在
 */
export function presetChips(saved: LocalPreset[] | null | undefined, s: LocalStatus | undefined, devRunning: boolean): PresetChip[] {
  const conflicts = s?.files.filter((f) => f.state === "conflict").length ?? 0;
  const changed = (s?.files.length ?? 0) - conflicts;
  const out: PresetChip[] = [];
  for (const p of mergePresets(saved)) {
    if (p.hidden) continue;
    const base = { preset: p, icon: ICON[p.builtin ?? ""] ?? "›", label: p.label, text: fillPreset(p.text, s) };
    const renamed = p.builtin && p.label !== BUILTIN_PRESETS.find((b) => b.builtin === p.builtin)?.label;
    switch (p.builtin) {
      case "conflict":
        if (conflicts) out.unshift({ ...base, urgent: true, extra: s!.files.find((f) => f.state === "conflict")!.path.split("/").pop() });
        break;
      case "pull":
        if (s?.upstream) out.push({ ...base, ...(s.behind ? { extra: `新 ${s.behind}` } : {}) });
        break;
      case "commit":
        if (changed > 0) out.push({ ...base, label: renamed ? p.label : `提交 ${changed} 处改动` });
        break;
      case "push":
        if (s?.upstream && s.ahead > 0) out.push({ ...base, extra: `${s.ahead} 个` });
        break;
      case "dev":
        if (s?.commands.dev && devRunning && !renamed) out.push({ ...base, icon: "↻", label: "重启项目", extra: s.commands.dev, text: fillPreset("把 Local 里跑着的 {开发命令} 停掉，再用后台终端重新启动，跑起来后告诉我地址。", s) });
        else if (s?.commands.dev) out.push({ ...base, extra: s.commands.dev });
        break;
      case "test":
        if (s?.commands.test) out.push(base);
        break;
      default:
        out.push(base);
    }
  }
  return out;
}
