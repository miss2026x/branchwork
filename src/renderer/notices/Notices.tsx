import { useEffect, type ReactNode } from "react";
import type { Project, Route, Stop } from "../../shared";
import type { Notice } from "../stores/notices";
import { BusMark, IconAlert, IconClose, IconCompress, IconWarn } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import css from "./Notices.module.css";

interface Props {
  notices: Notice[];
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
  projects: Project[];
  /** 正在看的项目：别的项目的通知前面带上项目名 */
  currentProjectId: string | null;
  stopNumber(stop: Stop): number;
  onDismiss(id: string): void;
  onViewSummary(stopId: string): void;
  onGoToRoute(routeId: string): void;
  /** 接着答完没答完的那一站 */
  onContinue(routeId: string): void;
  onResync(routeId: string): void;
  onJump(stopId: string): void;
  onStop(routeId: string): void;
  onBoard(itemId: string): void;
  /** 先改一下再发：把问题放回那一路的输入框 */
  onEditFirst(itemId: string, routeId: string, text: string): void;
}

/** “已自动发出”只是告知，不用你处理：过一会儿自己消失 */
const ARRIVED_MS = 12_000;
const MAX = 4;

/** 右下角的通知：只提醒要你处理的事。只收数据、发事件 */
export function Notices(p: Props) {
  const shown = p.notices.filter((n) => p.routes[n.routeId]).slice(-MAX);
  if (shown.length === 0) return null;
  return (
    <div className={css.stack} role="region" aria-label="通知">
      {shown.map((n) => (
        <Card key={n.id} n={n} {...p} />
      ))}
    </div>
  );
}

function Card({ n, ...p }: Props & { n: Notice }) {
  const route = p.routes[n.routeId]!;
  const colors = routeColors(route);
  const project = route.projectId !== p.currentProjectId ? p.projects.find((x) => x.id === route.projectId)?.name : undefined;
  const close = () => p.onDismiss(n.id);
  const act = (fn: () => void) => () => {
    fn();
    close();
  };
  useEffect(() => {
    if (n.kind !== "arrived") return;
    const t = setTimeout(() => p.onDismiss(n.id), ARRIVED_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.id, n.kind]);

  const who = (
    <>
      {project && <span>{project} </span>}
      <Plate route={route} />
    </>
  );
  const frame = (tone: "plain" | "amber" | "red" | "dark", icon: ReactNode, title: ReactNode, body: ReactNode, actions: ReactNode) => (
    <div className={css.card} data-tone={tone} role={tone === "plain" ? "status" : "alert"}>
      <span className={css.icon}>{icon}</span>
      <div className={css.main}>
        <b className={css.title}>{title}</b>
        {body && <p>{body}</p>}
        <div className={css.actions}>{actions}</div>
      </div>
      <button className={css.close} aria-label="关掉这条通知" onClick={close}>
        <IconClose size={14} />
      </button>
    </div>
  );

  switch (n.kind) {
    case "summary":
      return frame(
        "plain",
        <i className={css.green}>
          <IconCompress size={16} />
        </i>,
        <>{who} 的摘要提炼好了，等你看一眼再发车</>,
        null,
        <button onClick={act(() => p.onViewSummary(n.stopId))}>查看摘要</button>,
      );
    case "conflict": {
      const stop = n.stopId ? p.stops[n.stopId] : undefined;
      const names = n.files.slice(0, 2).map((f) => f.path.split("/").at(-1));
      return frame(
        "amber",
        <i className={css.amber}>
          <IconWarn size={16} />
        </i>,
        <>
          {who} {stop ? `第 ${p.stopNumber(stop)} 站` : ""}有 {n.files.length || "几"} 个文件没法自动合进 Local
        </>,
        <>
          {names.length > 0 && `${names.join("、")}${n.files.length > 2 ? " 等" : ""} 和 Local 里的改动撞上了。`}Local 和其他线路都没受影响，改动留在 {route.express ? `快${route.express}` : `${route.number}路`} 的工作区。
        </>,
        <button className={css.primary} onClick={act(() => p.onGoToRoute(route.id))}>
          查看
        </button>,
      );
    }
    case "interrupted": {
      const stop = p.stops[n.stopId];
      return frame(
        "red",
        <i className={css.red}>
          <IconAlert size={16} />
        </i>,
        <>
          {who} {stop ? `第 ${p.stopNumber(stop)} 站` : "这一站"}中断了
        </>,
        <>
          {n.reason}。这站没正常答完，它的改动留在工作区，没进 Local{n.waiting > 0 ? `；排着的 ${n.waiting} 条先不发` : ""}。
        </>,
        <>
          <button className={css.primary} onClick={act(() => p.onContinue(route.id))}>
            接着答完
          </button>
          <button onClick={act(() => p.onGoToRoute(route.id))}>去看看</button>
        </>,
      );
    }
    case "sync-error":
      return frame(
        "red",
        <i className={css.red}>
          <IconAlert size={16} />
        </i>,
        <>{who} 的同步没有成功</>,
        <>{n.message}。Local 没有被改动，这一路的改动还在它的工作区里。</>,
        <>
          <button className={css.primary} onClick={act(() => p.onResync(route.id))}>
            重新同步
          </button>
          <button onClick={act(() => p.onGoToRoute(route.id))}>去看看</button>
        </>,
      );
    case "arrived": {
      const stop = p.stops[n.stopId];
      const num = stop ? p.stopNumber(stop) : 0;
      return frame(
        "plain",
        <i className={css.bus} style={{ background: colors.tint }}>
          <BusMark size={18} color={colors.line} />
        </i>,
        <>
          {who} 答完第 {num} 站
        </>,
        <>
          第 {num + 1} 站“{short(n.nextText)}”已自动发出
        </>,
        <>
          <button onClick={act(() => p.onJump(n.stopId))}>看第 {num} 站的回答</button>
          <button className={css.link} onClick={act(() => p.onStop(route.id))}>
            停下第 {num + 1} 站
          </button>
        </>,
      );
    }
    case "board":
      return frame(
        "dark",
        <Plate route={route} size="l" />,
        <>
          {project && `${project} `}
          {route.express ? `快${route.express}` : `${route.number}路`} 到站了，有一条等你登车
        </>,
        <>“{short(n.text)}”，你设的是手动登车</>,
        <>
          <button className={css.board} onClick={act(() => p.onBoard(n.itemId))}>
            登车
          </button>
          <button onClick={act(() => p.onEditFirst(n.itemId, route.id, n.text))}>先改一下再发</button>
          <button className={css.link} onClick={close}>
            稍后
          </button>
        </>,
      );
  }
}

const short = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 28 ? t.slice(0, 28) + "…" : t;
};
