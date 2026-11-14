import { useMemo, useState } from "react";
import type { Project, QueueItem, Route, Stop } from "../../shared";
import { layoutMap } from "../map/layout";
import { dayLabel } from "../palette/search";
import { IconWarn } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import css from "./Overview.module.css";

interface Props {
  projects: Project[];
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
  queue: Record<string, QueueItem[]>;
  currentProjectId: string | null;
  onOpenProject(projectId: string): void;
  onOpenRoute(routeId: string): void;
  onNewRoute(projectId: string): void;
  onAddProject(): void;
}

/** 一个项目的缩略线路图：只画线和站，不画字 */
function MiniMap({ routes, stops }: { routes: Route[]; stops: Stop[] }) {
  const layout = useMemo(() => layoutMap(routes, stops), [routes, stops]);
  if (layout.lanes.length === 0) return <div className={css.mini} data-empty />;
  const xs = layout.lanes.flatMap((l) => [l.from.x, ...l.stops.map((s) => s.x)]);
  const ys = layout.lanes.flatMap((l) => [l.from.y, l.y]);
  const pad = 40;
  const box = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2 + 40, Math.max(...ys) - Math.min(...ys) + pad * 2];
  return (
    <div className={css.mini}>
      <svg viewBox={box.join(" ")} preserveAspectRatio="xMidYMid meet" aria-hidden>
        {layout.lanes.map((l) => (
          <path key={l.route.id} d={l.link ? `${l.link} ${l.run}` : l.run} fill="none" stroke={routeColors(l.route).line} strokeWidth={5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {layout.lanes.flatMap((l) =>
          l.stops
            .filter((s) => s.stop.kind !== "minor")
            .map((s) => <circle key={s.stop.id} cx={s.x} cy={s.y} r={s.stop.status === "answering" ? 13 : 9} fill={s.stop.status === "answering" ? routeColors(l.route).line : "#fff"} stroke={s.junction ? "#161b22" : routeColors(l.route).line} strokeWidth={6} />),
        )}
      </svg>
    </div>
  );
}

/** “全部项目”：每个项目一张卡片，一眼看到各有几路车、谁在回答、谁有冲突 */
export function Overview({ projects, routes, stops, queue, currentProjectId, onOpenProject, onOpenRoute, onNewRoute, onAddProject }: Props) {
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const cards = projects
    .map((p) => {
      const rs = Object.values(routes)
        .filter((r) => r.projectId === p.id && r.status !== "archived")
        .sort((a, b) => a.number - b.number);
      const ss = Object.values(stops).filter((s) => rs.some((r) => r.id === s.routeId));
      const last = Math.max(p.createdAt, ...rs.map((r) => r.createdAt), ...ss.map((s) => s.endedAt ?? s.startedAt));
      return { p, rs, ss, last, waiting: (queue[p.id] ?? []).length };
    })
    .sort((a, b) => (sort === "name" ? a.p.name.localeCompare(b.p.name) : b.last - a.last));
  const busy = (r: Route) => r.status === "answering" || r.status === "awaiting_permission";
  const label = (r: Route) => (r.express ? `快${r.express}` : `${r.number}路`);

  return (
    <div className={css.page} data-ov>
      <header>
        <h1>全部项目</h1>
        <div className={css.sort} role="radiogroup" aria-label="排序">
          <button role="radio" aria-checked={sort === "recent"} onClick={() => setSort("recent")}>
            最近活动
          </button>
          <button role="radio" aria-checked={sort === "name"} onClick={() => setSort("name")}>
            按名称
          </button>
        </div>
        <button className={css.add} onClick={onAddProject}>
          ＋ 添加项目
        </button>
      </header>
      <div className={css.grid}>
        {cards.map(({ p, rs, ss, last, waiting }) => (
          <article key={p.id} className={css.card} aria-current={p.id === currentProjectId}>
            <button className={css.open} onClick={() => onOpenProject(p.id)} aria-label={`打开 ${p.name}`}>
              <MiniMap routes={rs} stops={ss} />
              <h2 className="ell">{p.name}</h2>
              <code className="ell" title={p.localDir}>
                {p.localDir}
              </code>
            </button>
            <div className={css.plates}>
              {rs.map((r) => (
                <button key={r.id} onClick={() => onOpenRoute(r.id)} title={r.name} aria-label={`${label(r)} ${r.name}`}>
                  <Plate route={r} />
                </button>
              ))}
            </div>
            <p className={css.stats}>
              {rs.length === 0 ? "还没有车" : `${rs.length} 路车`}
              {waiting > 0 && ` · 候车 ${waiting} 条`}
              {rs.length > 0 && !rs.some(busy) && " · 都停着"} · 最近：{dayLabel(last)}
            </p>
            <ul className={css.flags}>
              {rs.filter(busy).map((r) => (
                <li key={r.id} style={{ color: routeColors(r).tag }}>
                  <i style={{ background: routeColors(r).line }} />
                  {label(r)} {r.status === "awaiting_permission" ? "等你批准" : "回答中"}
                </li>
              ))}
              {rs
                .filter((r) => r.status === "conflict")
                .map((r) => (
                  <li key={r.id} className={css.warn}>
                    <IconWarn size={12} />
                    {label(r)} 有同步冲突
                  </li>
                ))}
              {rs
                .filter((r) => r.status === "interrupted")
                .map((r) => (
                  <li key={r.id} className={css.warn}>
                    <IconWarn size={12} />
                    {label(r)} 上一站没答完
                  </li>
                ))}
            </ul>
            <footer>
              <button onClick={() => onNewRoute(p.id)}>在此项目开新对话</button>
            </footer>
          </article>
        ))}
        {projects.length === 0 && <p className={css.none}>还没有项目。点右上角“添加项目”。</p>}
      </div>
    </div>
  );
}
