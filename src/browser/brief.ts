import type { BrowserState } from "../shared";

/** 一个在跑、认出了端口的后台终端 */
export interface DevServer {
  command: string;
  ports: number[];
}

export interface BriefInput {
  /** 这一路是不是 Local 专车（它自己的就是 Local 的，不分两组） */
  local: boolean;
  /** 这一路自己的开发服务器 */
  mine: DevServer[];
  /** Local 专车里的开发服务器（这一路是 Local 时为空） */
  inLocal: DevServer[];
  /** 浏览器窗口的现状；没开窗口、或设置里关了“附上浏览器现状”时不给 */
  state?: BrowserState | null;
}

const urls = (list: DevServer[]) => list.map((s) => `    ${s.ports.map((p) => `http://localhost:${p}`).join("、")}  ← ${s.command}`);

/**
 * 发车时附上的浏览器说明（设计稿 9-12、9-15）：有哪些开发服务器、各跑的是哪份代码；窗口里有哪些页面、上一站以来的报错。
 * 什么都没有时返回空
 */
export function browserBriefText({ local, mine, inLocal, state }: BriefInput): string | null {
  const own = mine.filter((s) => s.ports.length > 0);
  const lo = local ? [] : inLocal.filter((s) => s.ports.length > 0);
  const open = !!state?.open;
  if (!open && own.length === 0 && lo.length === 0) return null;
  const lines = ["<lanes-browser>", "（这一段是 Lanes 自动附上的，不是用户写的。）"];
  if (own.length || lo.length) {
    lines.push("开发服务器：");
    if (local) lines.push("  Local 里的（就是你现在改的这份代码）：", ...urls(own));
    else {
      if (own.length) lines.push("  这一路自己的（这一路工作区里的代码，你改了马上看得到）：", ...urls(own));
      if (lo.length) {
        lines.push("  Local 的（用户项目文件夹里的代码，各路答完一站合进去）：", ...urls(lo));
        lines.push(
          own.length
            ? "  你这一站改的要等这一站答完才合进 Local，Local 的服务器现在还看不到；要看自己的改动，用上面这一路自己的。"
            : "  你这一站改的要等这一站答完才合进 Local，Local 的服务器现在还看不到。要在答完前看到自己的改动，用 terminal_start 在这一路的工作区里另起一个（别和上面的端口撞了）。",
        );
      }
    }
  }
  if (open && state) {
    lines.push("这一路有自己的浏览器窗口（Lanes 专用的 Chrome），用 browser 这组工具看和操作它；列出来的页面都是这一路的。", "窗口里的页面：");
    state.pages.forEach((p, i) => lines.push(`  ${i + 1}. ${p.title || "（没有标题）"} · ${p.url}${p.active ? "（当前）" : ""}`));
    const issues = state.issues.filter((i) => i.kind !== "warning").slice(-12);
    if (issues.length) {
      lines.push("上一站以来：");
      for (const i of issues) lines.push(`  ${i.kind === "request" ? "请求失败" : "报错"} ${i.text}${i.source && i.kind !== "request" ? `  ${i.source}` : ""}`);
    }
  }
  lines.push("</lanes-browser>");
  return lines.join("\n");
}
