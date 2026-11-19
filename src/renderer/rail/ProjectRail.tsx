import { useEffect, useRef, useState } from "react";
import { useFit } from "../ui/useFit";
import type { Route } from "../../shared";
import { useStore } from "../stores/store";
import { IconChevron, IconMore, IconPlus, IconWarn, IconTerminal, IconPin } from "../ui/icons";
import { RouteMenu } from "./RouteMenu";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import css from "./ProjectRail.module.css";
import { ago, lastTime } from "../ui/ago";
import { lastActive } from "../stores/seen";
import { useUnread } from "../stores/useUnread";
import { portsOf } from "../ui/ports";

/** 左栏：项目和每个项目里的路 */
export function ProjectRail({
  onDelete,
  compact = false,
}: {
  onDelete(routeId: string): void;
  /** 窗口窄：收成一列图标，点项目图标展开成浮层 */ compact?: boolean;
}) {
  const [floating, setFloating] = useState(false);
  const archiveRoute = useStore((s) => s.archiveRoute);
  const renameRoute = useStore((s) => s.renameRoute);
  const setRouteColor = useStore((s) => s.setRouteColor);
  const stops = useStore((s) => s.stops);
  // 菜单里这一路用的 MCP 服务（设计稿 9-13）
  const mcp = useStore((s) => s.mcp);
  const loadMcp = useStore((s) => s.loadMcp);
  const openMcp = useStore((s) => s.openMcp);
  const getRouteMcp = useStore((s) => s.routeMcp);
  const setRouteMcp = useStore((s) => s.setRouteMcp);
  const [routeMcp, setRouteMcpState] = useState<{ routeId: string; off: string[] } | null>(null);
  const routeMcpList = (projectId: string, off: string[]) => {
    if (!mcp || mcp.projectId !== projectId) return null;
    const servers: { name: string; note: string }[] = [];
    if (mcp.browser.enabled) servers.push({ name: "browser", note: "内置 · Chrome DevTools" });
    for (const s of mcp.servers) {
      if (!s.enabled || s.shadowedBy || s.replacedByBrowser || s.untrusted) continue;
      const st = mcp.states[s.name];
      servers.push({ name: s.name, note: st?.status === "connected" ? `${st.tools?.length ?? 0} 个工具` : st?.status === "needs-auth" ? "要登录" : st?.status === "failed" ? "连不上" : "" });
    }
    return { servers, off };
  };
  const unarchiveRoute = useStore((s) => s.unarchiveRoute);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState({ top: 0, left: 0 });
  const [projectMenu, setProjectMenu] = useState<string | null>(null);
  const projectMenuBox = useRef<HTMLDivElement>(null);
  useFit(projectMenuBox, [projectMenu]);
  const requestArchive = useStore((s) => s.requestArchive);
  const openCompress = useStore((s) => s.openCompress);
  const exportRoute = useStore((s) => s.exportRoute);
  const setRouteFlags = useStore((s) => s.setRouteFlags);
  const pendingAsk = useStore((s) => s.pendingAsk);
  const openImport = useStore((s) => s.openImport);
  const openRemoveProject = useStore((s) => s.openRemoveProject);
  const lastSync = useStore((s) => s.lastSync);
  /** 已归档里点开看详情的那一路 */
  const [archivedOpen, setArchivedOpen] = useState<string | null>(null);
  const terminals = useStore((s) => s.terminals);
  const queue = useStore((s) => s.queue);
  const openNewRoute = useStore((s) => s.openNewRoute);
  const openAddProject = useStore((s) => s.openAddProject);
  const viewLog = useStore((s) => s.viewLog);
  const openLocal = useStore((s) => s.openLocal);
  const [showArchived, setShowArchived] = useState<Record<string, boolean>>({});
  const projects = useStore((s) => s.projects);
  const routes = useStore((s) => s.routes);
  const projectId = useStore((s) => s.selectedProjectId);
  const routeId = useStore((s) => s.selectedRouteId);
  const selectProject = useStore((s) => s.selectProject);
  const selectRoute = useStore((s) => s.selectRoute);
  const addProject = useStore((s) => s.addProject);
  const createRoute = useStore((s) => s.createRoute);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const viewTerminal = useStore((s) => s.viewTerminal);
  const unread = useUnread();
  // 时间每分钟走一下（“3 分钟前”）
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const stopList = Object.values(stops);

  const strip = compact && (
    <aside className={css.strip} aria-label="项目和线路">
      <div className={css.stripList}>
        {projects.map((p) => {
          const list = Object.values(routes)
            .filter((r) => r.projectId === p.id && r.status !== "archived" && !r.local)
            .sort((a, b) => a.number - b.number);
          return (
            <section key={p.id} className={css.projectSection}>
              <button
                className={css.avatar}
                aria-current={p.id === projectId}
                title={`${p.name}（点开看全部）`}
                aria-label={`展开项目栏：${p.name}`}
                onClick={() =>
                  p.id === projectId ? setFloating(true) : selectProject(p.id)
                }
              >
                {[...p.name][0]?.toUpperCase()}
              </button>
              {p.id === projectId &&
                list.map((r) => (
                  <button
                    key={r.id}
                    className={css.chip}
                    aria-current={r.id === routeId}
                    title={r.name}
                    aria-label={r.name}
                    style={
                      r.id === routeId
                        ? { background: routeColors(r).tint }
                        : undefined
                    }
                    onClick={() => selectRoute(r.id)}
                  >
                    <Plate route={r} />
                    {r.status === "conflict" ? (
                      <i className={css.pipRed} />
                    ) : r.status === "interrupted" ||
                      r.status === "awaiting_permission" ? (
                      <i className={css.pipAmber} />
                    ) : r.status === "answering" ? (
                      <i
                        className={css.pip}
                        style={{ background: routeColors(r).line }}
                      />
                    ) : unread.has(r.id) && r.id !== routeId ? (
                      <i className={css.pipGreen} />
                    ) : null}
                  </button>
                ))}
            </section>
          );
        })}
      </div>
      <button
        className={css.stripNew}
        disabled={!projectId}
        title="新对话"
        aria-label="新对话"
        onClick={() => openNewRoute()}
      >
        <IconPlus />
      </button>
    </aside>
  );
  if (compact && !floating) return strip;

  return (
    <>
      {strip}
      {compact && (
        <div className={css.floatBackdrop} onClick={() => setFloating(false)} />
      )}
      <aside className={compact ? `${css.rail} ${css.floating}` : css.rail}>
        <div className={css.head}>
          <span>项目</span>
          <button
            title="添加项目"
            aria-label="添加项目"
            onClick={() => void openAddProject()}
          >
            <IconPlus />
          </button>
        </div>

        <div className={css.list}>
          {projects.map((p) => {
            const mine = Object.values(routes)
              .filter((r) => r.projectId === p.id && !r.local)
              .sort((a, b) => a.number - b.number);
            const list = mine.filter((r) => r.status !== "archived");
            const archived = mine.filter((r) => r.status === "archived");
            const open = !closed[p.id];
            // Local 专车里在跑、认出了端口的后台终端（设计稿 9-14）
            const localId = Object.values(routes).find((r) => r.projectId === p.id && r.local)?.id;
            const running = localId ? Object.values(terminals).filter((t) => t.routeId === localId && t.status === "running" && portsOf(t).length > 0) : [];
            const ports = [...new Set(running.flatMap(portsOf))];
            const toggle = () => {
              if (p.id === projectId) setClosed((c) => ({ ...c, [p.id]: open }));
              else selectProject(p.id);
            };
            return (
              <section key={p.id} className={css.projectSection}>
                <div className={css.projectHead}>
                <button
                  className={css.project}
                  data-fit={ports.length > 0}
                  aria-expanded={open}
                  onClick={toggle}
                >
                  <IconChevron size={14} open={open} />
                  <b className="ell">{p.name}</b>
                  {!open && <small>{list.length} 路车</small>}
                </button>
                {ports.length > 0 && (
                  <>
                    <button
                      className={css.ports}
                      title={`Local 里在跑：\n${running.map((t) => `${t.command}  ${portsOf(t).map((x) => `:${x}`).join(" ")}`).join("\n")}\n点开看输出`}
                      aria-label={`Local 里在跑的终端，端口 ${ports.join("、")}`}
                      onClick={() => viewTerminal(running[0]!.id)}
                    >
                      <IconTerminal size={12} />
                      {ports.map((x) => (
                        <code key={x}>:{x}</code>
                      ))}
                    </button>
                    <span className={css.headFill} onClick={toggle} aria-hidden />
                  </>
                )}
                <button className={css.projectMore} aria-label={`${p.name} 的菜单`} aria-expanded={projectMenu === p.id} onClick={() => setProjectMenu(projectMenu === p.id ? null : p.id)}>
                  <IconMore />
                </button>
                </div>
                {projectMenu === p.id && (
                  <>
                    <div className={css.backdrop} onClick={() => setProjectMenu(null)} />
                    <div ref={projectMenuBox} className={`${css.menu} ${css.projectMenu}`} role="menu">
                      <button role="menuitem" onClick={() => (setProjectMenu(null), selectProject(p.id), openNewRoute())}>
                        在此项目开新对话
                      </button>
                      <button role="menuitem" onClick={() => (setProjectMenu(null), viewLog(p.id))}>
                        同步记录
                      </button>
                      <button role="menuitem" onClick={() => (setProjectMenu(null), openImport(p.id))}>
                        导入终端里的会话…
                      </button>
                      {archived.length > 0 && (
                        <button role="menuitem" onClick={() => (setProjectMenu(null), setClosed((c) => ({ ...c, [p.id]: false })), setShowArchived((v) => ({ ...v, [p.id]: true })))}>
                          已归档 · {archived.length}
                        </button>
                      )}
                      <button role="menuitem" onClick={() => (setProjectMenu(null), void openLocal(p.id))}>
                        在文件夹中打开 Local
                      </button>
                      <hr />
                      <button role="menuitem" className={css.danger} onClick={() => (setProjectMenu(null), openRemoveProject(p.id))}>
                        从 Lanes 移除…
                      </button>
                    </div>
                  </>
                )}
                {open &&
                  asTree(list).map(({ route: r, depth }) => {
                    const fresh = unread.has(r.id) && r.id !== routeId;
                    const at = lastActive(stopList, r.id);
                    // 回答中、等批准、冲突、没答完、同步中：右边写状态，不写时间
                    // 有问题在候车的也不写（“可登车”、条数更要紧，左栏窄，挤掉名字就看不出是哪一路了）
                    const quiet = r.status === "idle" && pendingAsk[r.id] === undefined && !(queue[p.id] ?? []).some((q) => q.routeId === r.id);
                    return (
                    <div
                      key={r.id}
                      className={css.row}
                      data-unread={fresh}
                      aria-current={r.id === routeId}
                      style={
                        r.id === routeId
                          ? { background: routeColors(r).tint }
                          : undefined
                      }
                    >
                      <button
                        className={css.route}
                        onClick={() => selectRoute(r.id)}
                      >
                        {depth > 0 && <i className={css.branch} data-express={!!r.express} style={{ marginLeft: (depth - 1) * 14 }} aria-hidden />}
                        <Plate route={r} />
                        <span className={`ell ${css.label}`}>{r.name}</span>
                        {r.pinned && (
                          <span className={css.term} title="已置顶">
                            <IconPin size={12} />
                          </span>
                        )}
                        {Object.values(terminals).some((t) => t.routeId === r.id && t.status === "running") && (
                          <span className={css.term} title="有后台终端在跑">
                            <IconTerminal size={13} />
                          </span>
                        )}
                        <RouteBadge route={r} syncing={pendingAsk[r.id] !== undefined} />
                        {fresh && <i className={css.unread} title="答完了，还没看" role="img" aria-label="答完了，还没看" />}
                        {(() => {
                          const mine = (queue[p.id] ?? []).filter((q) => q.routeId === r.id);
                          if (mine.length === 0) return null;
                          const boardable = (r.status === "idle" || r.status === "interrupted") && mine.some((q) => q.mode === "manual");
                          return boardable ? <em className={css.board}>可登车</em> : <b className={css.count} title={`候车 ${mine.length} 条`}>{mine.length}</b>;
                        })()}
                      </button>
                      <span className={css.tail} data-time={quiet && at !== null}>
                      {quiet && at !== null && (
                        <time className={css.when} dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>
                          {lastTime(at)}
                        </time>
                      )}
                      <button
                        className={css.more}
                        aria-label={`${r.name} 的更多操作`}
                        aria-expanded={menuFor === r.id}
                        onClick={(e) => {
                          const box = e.currentTarget.getBoundingClientRect();
                          setMenuAt({ top: box.bottom + 4, left: Math.max(8, box.right - 240) });
                          setMenuFor(menuFor === r.id ? null : r.id);
                          if (menuFor !== r.id) {
                            void loadMcp(r.projectId);
                            void getRouteMcp(r.id).then((off) => setRouteMcpState({ routeId: r.id, off }), () => {});
                          }
                        }}
                      >
                        <IconMore />
                      </button>
                      </span>
                      {menuFor === r.id && (
                        <RouteMenu
                          route={r}
                          stopCount={Object.values(stops).filter((x) => x.routeId === r.id && x.kind !== "summary").length}
                          syncNote={r.status === "conflict" ? "有改动没法自动合进 Local，等你处理" : r.status === "interrupted" ? "上一站没答完，改动留在工作区，没进 Local" : r.status === "answering" || r.status === "awaiting_permission" ? "正在回答，答完后改动同步进 Local" : "自己的工作区，改动都已进 Local"}
                          syncTone={r.status === "conflict" || r.status === "interrupted" ? "warn" : "ok"}
                          onRename={(name) => void renameRoute(r.id, name)}
                          onColor={(color) => void setRouteColor(r.id, color)}
                          onArchive={() => requestArchive(r.id)}
                          onCompressAll={(() => {
                            const last = Object.values(stops).filter((x) => x.routeId === r.id).sort((x, y) => y.seq - x.seq)[0];
                            return last && last.status !== "answering" && last.lastMessageId ? () => openCompress(last.id) : undefined;
                          })()}
                          onExport={() => void exportRoute(r.id)}
                          onDelete={() => onDelete(r.id)}
                          onPin={(pinned) => void setRouteFlags(r.id, { pinned })}
                          onFold={(folded) => void setRouteFlags(r.id, { folded })}
                          onClose={() => setMenuFor(null)}
                          at={menuAt}
                          mcp={routeMcp?.routeId === r.id ? routeMcpList(r.projectId, routeMcp.off) : null}
                          onMcpOff={(off) => (setRouteMcpState({ routeId: r.id, off }), void setRouteMcp(r.id, off))}
                          onManageMcp={() => openMcp(r.projectId)}
                        />
                      )}
                    </div>
                    );
                  })}
                {open && list.length === 0 && (
                  <p className={css.none}>还没有路</p>
                )}
                {open && archived.length > 0 && (
                  <>
                    <button
                      className={css.archivedToggle}
                      aria-expanded={!!showArchived[p.id]}
                      onClick={() =>
                        setShowArchived((v) => ({ ...v, [p.id]: !v[p.id] }))
                      }
                    >
                      <IconChevron size={12} open={!!showArchived[p.id]} />{" "}
                      已归档 {archived.length}
                    </button>
                    {showArchived[p.id] &&
                      archived.map((r) => {
                        const count = Object.values(stops).filter((x) => x.routeId === r.id && x.kind !== "summary").length;
                        const dirty = Object.values(stops).some((x) => x.routeId === r.id && (x.syncState === "unsynced" || x.syncState === "conflict")) || lastSync[r.id]?.status === "conflict";
                        const on = archivedOpen === r.id;
                        return (
                          <div key={r.id} className={css.archived} data-open={on}>
                            <button className={css.archivedHead} aria-expanded={on} onClick={() => setArchivedOpen(on ? null : r.id)}>
                              <Plate route={r} />
                              <span className="ell">{r.name}</span>
                              {dirty && !on ? <i className={css.half} title="还有改动没进 Local" /> : <small>{r.archivedAt ? ago(r.archivedAt) : ""}</small>}
                            </button>
                            {on && (
                              <>
                                <p>
                                  {count} 站 · {dirty ? "还有改动留在工作区，没进 Local" : "改动都已进 Local"}
                                </p>
                                <div>
                                  <button className={css.restore} onClick={() => void unarchiveRoute(r.id)}>
                                    恢复
                                  </button>
                                  <button className={css.danger} onClick={() => onDelete(r.id)}>
                                    删除
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                  </>
                )}
              </section>
            );
          })}
        </div>

        <button
          className={css.newChat}
          disabled={!projectId}
          onClick={() => openNewRoute()}
        >
          <IconPlus /> 新对话
        </button>
      </aside>
    </>
  );
}


/** 把路排成树：分叉出来的路跟在它的父路后面，记下深了几层 */
function asTree(list: Route[]): { route: Route; depth: number }[] {
  const ids = new Set(list.map((r) => r.id));
  const out: { route: Route; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const r of list) {
      const parent = r.parentRouteId && ids.has(r.parentRouteId) ? r.parentRouteId : null;
      if (parent !== parentId) continue;
      if (depth === 0 && pass !== !!r.pinned) continue;
      out.push({ route: r, depth });
      walk(r.id, depth + 1);
    }
  };
  // 置顶的（连同从它分出去的）排在前面
  let pass = true;
  walk(null, 0);
  pass = false;
  walk(null, 0);
  return out;
}

function RouteBadge({ route, syncing }: { route: Route; syncing?: boolean }) {
  // 站前同步中：还没开始回答，正在从 Local 拿更新
  if (syncing) return <i className={css.syncing} title="同步中" role="img" aria-label="同步中" />;
  if (route.status === "answering")
    return (
      <i
        className={css.dot}
        style={{ background: routeColors(route).line }}
        title="回答中"
      />
    );
  if (route.status === "awaiting_permission")
    return <em className={css.amber}>等你批准</em>;
  if (route.status === "interrupted") return <i className={css.halfDark} title="没答完" role="img" aria-label="没答完" />;
  if (route.status === "conflict")
    return (
      <em className={css.red}>
        <IconWarn size={12} /> 冲突
      </em>
    );
  return null;
}
