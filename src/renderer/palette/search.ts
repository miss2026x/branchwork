import type { Project, QueueItem, Route, Stop } from "../../shared";

/** 命令面板里的一行 */
export type Hit =
  | { kind: "stop"; id: string; stop: Stop; route: Route; project: Project }
  | { kind: "queue"; id: string; item: QueueItem; route: Route | undefined; project: Project }
  | { kind: "command"; id: string; command: "new-route" | "queue-add"; text: string };

export interface SearchInput {
  projects: Project[];
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
  queue: Record<string, QueueItem[]>;
}

export interface SearchResult {
  stops: Extract<Hit, { kind: "stop" }>[];
  queue: Extract<Hit, { kind: "queue" }>[];
  commands: Extract<Hit, { kind: "command" }>[];
  /** 按显示顺序排好的全部结果（上下键在这上面走） */
  all: Hit[];
}

const MAX_STOPS = 30;

/** 把输入拆成词；每个词都要出现才算匹配，不分大小写 */
export function terms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}
const matches = (text: string, words: string[]) => {
  const t = text.toLowerCase();
  return words.every((w) => t.includes(w));
};

/**
 * 搜提问、候车区和命令。纯函数，不取数据。
 * 以 ">" 开头只搜命令；scope 给了项目就只看那个项目；什么都没输入时列出最近的站。
 */
export function search(input: SearchInput, rawQuery: string, scopeProjectId: string | null): SearchResult {
  const onlyCommands = rawQuery.trimStart().startsWith(">");
  const query = rawQuery.trimStart().replace(/^>/, "").trim();
  const words = terms(query);
  const projects = new Map(input.projects.map((p) => [p.id, p]));
  const inScope = (projectId: string) => !scopeProjectId || projectId === scopeProjectId;

  const stops: SearchResult["stops"] = [];
  const queue: SearchResult["queue"] = [];
  if (!onlyCommands) {
    for (const stop of Object.values(input.stops)) {
      const route = input.routes[stop.routeId];
      const project = route && projects.get(route.projectId);
      if (!route || !project || route.status === "archived" || !inScope(project.id)) continue;
      if (words.length === 0 || matches(`${stop.name}\n${stop.prompt}`, words)) stops.push({ kind: "stop", id: `stop:${stop.id}`, stop, route, project });
    }
    stops.sort((a, b) => b.stop.startedAt - a.stop.startedAt);
    stops.splice(words.length === 0 ? 8 : MAX_STOPS);

    if (words.length > 0) {
      for (const [projectId, items] of Object.entries(input.queue)) {
        const project = projects.get(projectId);
        if (!project || !inScope(projectId)) continue;
        for (const item of items) if (matches(item.text, words)) queue.push({ kind: "queue", id: `queue:${item.id}`, item, route: item.routeId ? input.routes[item.routeId] : undefined, project });
      }
    }
  }

  const commands: SearchResult["commands"] = [
    { kind: "command", id: "cmd:new-route", command: "new-route", text: query },
    ...(query ? [{ kind: "command" as const, id: "cmd:queue-add", command: "queue-add" as const, text: query }] : []),
  ];
  return { stops, queue, commands, all: [...stops, ...queue, ...commands] };
}

/** 把一段文字按匹配到的词切开，界面给 hit 的那几段加底色 */
export function highlight(text: string, words: string[]): { text: string; hit: boolean }[] {
  if (words.length === 0 || !text) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const marks = new Array<boolean>(text.length).fill(false);
  for (const w of words) for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + w.length)) marks.fill(true, i, i + w.length);
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; ) {
    let j = i;
    while (j < text.length && marks[j] === marks[i]) j++;
    parts.push({ text: text.slice(i, j), hit: marks[i]! });
    i = j;
  }
  return parts;
}

/** 回答里匹配处前后的一小段；没匹配到就取开头 */
export function excerpt(text: string, words: string[], length = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const at = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0), Infinity);
  const from = at === Infinity ? 0 : Math.max(0, at - 30);
  const cut = flat.slice(from, from + length);
  return (from > 0 ? "…" : "") + cut + (from + length < flat.length ? "……" : "");
}

/** 今天 / 昨天 / 周几 / 月日 */
export function dayLabel(at: number, now = Date.now()): string {
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff < 7) return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(at).getDay()]!;
  const d = new Date(at);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
