import type { LocalStatus, Route, Stop, SyncLogEntry } from "../shared";
import type { LocalGit } from "../sync";

/** Local 专车的名字（设计稿 9-10） */
export const LOCAL_ROUTE_NAME = "Local 专车";

/** 一路的叫法：1路、快2、Local 专车 */
export function routeLabel(r: Route): string {
  return r.local ? LOCAL_ROUTE_NAME : r.express ? `快${r.express}` : `${r.number}路`;
}

/**
 * 把 git 读到的 Local 和同步记录拼成 LocalStatus：每个没提交的文件，最近一次是哪一路哪一站带进 Local 的。
 * log 是这个项目的同步记录，新的在前
 */
export function localStatus(projectId: string, g: LocalGit, log: SyncLogEntry[], at = Date.now()): LocalStatus {
  const by = new Map<string, { routeId: string; stopId: string | null }>();
  for (const e of log) {
    if (e.direction !== "push" || e.status !== "ok") continue;
    for (const f of e.files) if (!by.has(f.path)) by.set(f.path, { routeId: e.routeId, stopId: e.stopId });
  }
  return {
    projectId,
    missing: g.missing,
    branch: g.branch,
    upstream: g.upstream,
    ahead: g.ahead,
    behind: g.behind,
    files: g.files.map((f) => ({ ...f, by: by.get(f.path) ?? null })),
    commands: g.commands,
    at,
  };
}

const STATE: Record<LocalStatus["files"][number]["state"], string> = { modified: "改了", added: "新加", deleted: "删了", renamed: "改名", untracked: "新文件，git 还没跟踪", conflict: "有冲突" };

/**
 * 每一站开始时附在提问后面交给专车的 Claude 的一段说明（设计稿 9-10 “Claude 知道什么”）：
 * 它在哪、其他路是怎么回事、Local 现在的分支和没提交的文件各是哪一路改的。
 * 只交给 Claude，界面上那一站的提问还是你写的原话
 */
export function localBrief(localDir: string, s: LocalStatus | null, routes: Route[], stops: Stop[], terminals: { command: string; port: number | null }[]): string {
  const name = (routeId: string, stopId: string | null) => {
    const r = routes.find((x) => x.id === routeId);
    if (!r) return "一条已经删掉的对话";
    const st = stopId ? stops.find((x) => x.id === stopId) : undefined;
    return `${routeLabel(r)}「${r.name}」${st ? `第 ${st.seq} 站「${st.name}」` : ""}`;
  };
  const lines = [
    "<branchwork-local>",
    "（这一段是 Lanes 自动附上的，不是用户写的。）",
    `你现在直接在用户的项目文件夹（Local）里工作：${localDir}。这里没有单独的工作区，你改的就是用户真正的文件。`,
    "同一个项目里还有别的对话（1路、2路……）在各自的工作区里改代码，每一站结束时它们的改动会自动合进 Local；你回答期间它们先等着，你这一站结束后再合进来。",
  ];
  if (s && !s.missing) {
    const where = s.branch ? `分支 ${s.branch}` : "没有在任何分支上（detached HEAD）";
    const remote = s.upstream ? `，跟踪 ${s.upstream}${s.ahead || s.behind ? `（领先 ${s.ahead}、落后 ${s.behind} 个提交，按上次 fetch 的结果）` : "（和它一致）"}` : "，没有跟踪远端分支";
    lines.push("", `Local 现在：${where}${remote}。`);
    const conflicts = s.files.filter((f) => f.state === "conflict");
    if (conflicts.length) lines.push(`有冲突没解决：${conflicts.map((f) => f.path).join("、")}。`);
    const files = s.files.filter((f) => f.state !== "conflict");
    if (files.length === 0) lines.push("没有没提交的改动。");
    else {
      lines.push(`没提交的改动（${files.length} 个文件；括号里是这个文件最近一次是哪一路带进 Local 的）：`);
      for (const f of files.slice(0, 40)) lines.push(`- ${f.path}（${STATE[f.state]}；${f.by ? name(f.by.routeId, f.by.stopId) : "不是哪一路带进来的，多半是用户自己直接改的"}）`);
      if (files.length > 40) lines.push(`- ……还有 ${files.length - 40} 个`);
    }
  }
  if (terminals.length) lines.push("", `这辆车开着的后台终端：${terminals.map((t) => `${t.command}${t.port ? `（端口 ${t.port}）` : ""}`).join("、")}。`);
  lines.push("</branchwork-local>");
  return lines.join("\n");
}
