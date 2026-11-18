import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Route } from "../../shared";
import { Plate } from "../ui/Plate";
import { routeColors, routeLabel } from "../ui/route-color";
import { useFit } from "../ui/useFit";
import css from "./RouteTabs.module.css";

/** 一路此刻要不要你注意：等你批准、冲突 > 回答中 */
function tone(r: Route): "amber" | "red" | "blue" | undefined {
  if (r.status === "awaiting_permission") return "amber";
  if (r.status === "conflict") return "red";
  if (r.status === "answering") return "blue";
  return undefined;
}
const urgent = (r: Route) => tone(r) === "amber" || tone(r) === "red";

type Size = "full" | "short" | "plate";
const GAP = 8;
/** 截短的标签至少留这么宽（路牌 + 两三个字）；再窄就只留路牌 */
const SHORT_MIN = 104;

interface Props {
  routes: Route[];
  selectedRouteId: string | null;
  onSelectRoute(routeId: string): void;
  /** 最左、固定的那一格（Local 专车）；compact：挤的时候只剩一个“L” */
  leading?: (compact: boolean) => ReactNode;
}

/**
 * 地图顶部的路线标签（设计稿 9-11）：放不下时一级一级收——
 * ① 全名 → ② 没选中的名字截短 → ③ 没选中的只留路牌（右上角一个点说状态）→ ④ 放不下的收进“+N”。
 * 选中的那一路始终是全名、始终露出来。宽度靠一排看不见的标签量出来，不靠猜
 */
export function RouteTabs({ routes, selectedRouteId, onSelectRoute, leading }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  const [sizes, setSizes] = useState<{ full: Record<string, number>; short: Record<string, number>; plate: Record<string, number>; lead: [number, number]; more: number } | null>(null);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useFit(menu, [open]);

  // 能用的宽度：跟着窗口和面板变
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    setRoom(el.clientWidth);
    const ro = new ResizeObserver(() => setRoom(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 量每个标签三种样子各有多宽（名字、路号、状态变了重新量）
  const key = routes.map((r) => `${r.id}:${r.name}:${r.number}:${r.express}:${r.status}`).join("|") + `|${selectedRouteId}`;
  const measure = () => {
    const el = ruler.current;
    if (!el) return;
    const w = (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)];
    const pick = (size: Size) => Object.fromEntries(w(`[data-measure="${size}"]`).map((x) => [x.dataset.id!, x.offsetWidth]));
    const lead = w("[data-measure=lead]").map((x) => x.offsetWidth);
    setSizes({ full: pick("full"), short: pick("short"), plate: pick("plate"), lead: [lead[0] ?? 0, lead[1] ?? 0], more: w("[data-measure=more]")[0]?.offsetWidth ?? 56 });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(measure, [key]);
  // 字体晚一点才加载好，加载好以后字变宽：再量一次；Local 标签上的状态变了也会变宽，隔一会儿量一次
  useEffect(() => {
    void document.fonts?.ready.then(measure);
    document.fonts?.addEventListener("loadingdone", measure);
    const ro = new ResizeObserver(measure);
    for (const lead of ruler.current?.querySelectorAll("[data-measure=lead]") ?? []) ro.observe(lead);
    return () => (document.fonts?.removeEventListener("loadingdone", measure), ro.disconnect());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !menu.current?.parentElement?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => (window.removeEventListener("pointerdown", onDown), window.removeEventListener("keydown", onKey));
  }, [open]);

  // 选哪一级、露出哪几路
  let level = 1;
  let shown = routes;
  /** 第 ② 级时没选中的标签最宽多少：把剩下的地方平分，最多 124px，少于 SHORT_MIN 就退到第 ③ 级 */
  let shortW = 124;
  let compactLead = false;
  if (sizes && room > 0) {
    const leadW = (compact: boolean) => (leading ? sizes.lead[compact ? 1 : 0] + 1 + GAP * 2 : 0);
    const width = (list: Route[], size: Size, compact: boolean, extra = 0) => leadW(compact) + list.reduce((s, r) => s + (r.id === selectedRouteId ? sizes.full[r.id]! : sizes[size][r.id]!), 0) + GAP * Math.max(0, list.length - 1) + extra;
    const share = (compact: boolean) => {
      const others = routes.filter((r) => r.id !== selectedRouteId);
      const sel = routes.find((r) => r.id === selectedRouteId);
      const left = room - leadW(compact) - (sel ? sizes.full[sel.id]! : 0) - GAP * Math.max(0, routes.length - 1);
      // 名字本来就短的不占满，多出来的分给别的
      let w = Math.floor(left / Math.max(1, others.length));
      for (let i = 0; i < 3; i++) {
        const small = others.filter((r) => sizes.full[r.id]! <= w);
        const rest = others.length - small.length;
        if (!rest) break;
        w = Math.floor((left - small.reduce((s, r) => s + sizes.full[r.id]!, 0)) / rest);
      }
      return Math.min(124, w);
    };
    if (width(routes, "full", false) <= room) level = 1;
    else if (share(false) >= SHORT_MIN) (level = 2), (shortW = share(false));
    else if (share(true) >= SHORT_MIN) (level = 2), (shortW = share(true)), (compactLead = true);
    else if (width(routes, "plate", true) <= room) level = 3;
    else {
      level = 4;
      // 按顺序放，放不下的收进“+N”；选中的在后面就换到前面来
      const sel = routes.find((r) => r.id === selectedRouteId);
      const rest = routes.filter((r) => r !== sel);
      const fit: Route[] = sel ? [sel] : [];
      for (const r of rest) if (width([...fit, r], "plate", true, sizes.more + GAP) <= room) fit.push(r);
      shown = routes.filter((r) => fit.includes(r));
    }
  }
  const hidden = routes.filter((r) => !shown.includes(r));
  const size: Size = level === 1 ? "full" : level === 2 ? "short" : "plate";

  const tab = (r: Route, s: Size, measure?: string) => {
    const on = r.id === selectedRouteId;
    const real = on ? "full" : s;
    const t = tone(r);
    return (
      <button
        key={r.id}
        className={css.tab}
        data-size={real}
        data-measure={measure}
        data-id={measure ? r.id : undefined}
        tabIndex={measure ? -1 : undefined}
        aria-current={measure ? undefined : on}
        aria-label={real === "plate" ? `${routeLabel(r)} ${r.name}` : undefined}
        title={real === "full" ? undefined : `${routeLabel(r)} ${r.name}`}
        style={{ ...(on ? { borderColor: routeColors(r).line, boxShadow: `0 0 0 1px ${routeColors(r).line}` } : {}), ...(real === "short" && !measure ? { maxWidth: shortW } : {}) }}
        onClick={measure ? undefined : () => onSelectRoute(r.id)}
      >
        <Plate route={r} />
        {real !== "plate" && <span className={css.name}>{r.name}</span>}
        {t && <i className={css.dot} data-tone={t} aria-hidden />}
      </button>
    );
  };

  return (
    <div ref={bar} className={css.bar}>
      {/* 量宽度用的一排，看不见 */}
      <div ref={ruler} className={css.ruler} aria-hidden>
        {leading && (
          <>
            <span data-measure="lead">{leading(false)}</span>
            <span data-measure="lead">{leading(true)}</span>
          </>
        )}
        {routes.map((r) => tab(r, "full", "full"))}
        {routes.map((r) => tab({ ...r, id: r.id }, "short", "short"))}
        {routes.map((r) => tab(r, "plate", "plate"))}
        <span className={css.more} data-measure="more">
          +{routes.length}
        </span>
      </div>

      {leading && (
        <>
          {leading(level >= 3 || compactLead)}
          <i className={css.divider} aria-hidden />
        </>
      )}
      <div className={css.tabs} data-level={level}>
        {shown.map((r) => tab(r, size))}
      </div>
      {hidden.length > 0 && (
        <span className={css.moreWrap}>
          <button className={css.more} aria-expanded={open} aria-label={`另外 ${hidden.length} 路`} onClick={() => setOpen(!open)}>
            +{hidden.length}
            {hidden.some(urgent) && <i className={css.dot} data-tone={hidden.some((r) => tone(r) === "red") ? "red" : "amber"} aria-hidden />}
          </button>
          {open && (
            <div ref={menu} className={css.menu} role="menu" aria-label={`另外 ${hidden.length} 路`}>
              <header>另外 {hidden.length} 路</header>
              {[...hidden]
                .sort((a, b) => Number(urgent(b)) - Number(urgent(a)) || Number(tone(b) === "blue") - Number(tone(a) === "blue"))
                .map((r) => (
                  <button key={r.id} role="menuitem" onClick={() => (setOpen(false), onSelectRoute(r.id))}>
                    <Plate route={r} />
                    <span className={`${css.menuName} ell`}>{r.name}</span>
                    {tone(r) && <em data-tone={tone(r)}>{tone(r) === "amber" ? "等你批准" : tone(r) === "red" ? "有冲突" : "回答中"}</em>}
                  </button>
                ))}
              <footer>也可以按 Ctrl+K 搜路名</footer>
            </div>
          )}
        </span>
      )}
    </div>
  );
}
