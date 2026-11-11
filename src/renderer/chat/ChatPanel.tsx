import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatItem, Route, Stop } from "../../shared";
import { useStore, type LiveStop } from "../stores/store";
import { IconSend, IconStop, IconWarn } from "../ui/icons";
import { Plate } from "../ui/Plate";
import { routeColors } from "../ui/route-color";
import css from "./ChatPanel.module.css";

/** 右侧面板：当前这一路的对话、状态、输入框 */
export function ChatPanel({ route, stops }: { route: Route; stops: Stop[] }) {
  const content = useStore((s) => s.content);
  const live = useStore((s) => s.live);
  const pending = useStore((s) => s.pendingAsk[route.id]);
  const permission = useStore((s) => s.permissions[route.id]);
  const lastSync = useStore((s) => s.lastSync[route.id]);
  const draft = useStore((s) => s.drafts[route.id] ?? "");
  const setDraft = useStore((s) => s.setDraft);
  const ask = useStore((s) => s.ask);
  const stop = useStore((s) => s.stop);
  const answerPermission = useStore((s) => s.answerPermission);

  const colors = routeColors(route);
  const busy = route.status === "answering" || route.status === "awaiting_permission";
  const blocked = route.status === "conflict";
  const current = stops.find((s) => s.status === "answering");
  const currentLive = current ? live[current.id] : undefined;

  // 新内容出来时，如果本来就在底部，跟着滚到底
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = log.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => {
    stick.current = true;
  }, [route.id]);

  const send = () => {
    if (!busy && !blocked && draft.trim()) void ask(route.id, draft);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <aside className={css.panel}>
      <header className={css.head} style={{ borderColor: colors.tag }}>
        <Plate route={route} size="l" />
        <div className={css.headText}>
          <h2 className="ell">{route.name}</h2>
          <p className="ell">
            <StatusLine route={route} stops={stops} phase={pending !== undefined ? "syncing" : currentLive?.phase} />
          </p>
        </div>
      </header>

      <div
        ref={log}
        className={css.log}
        role="log"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {stops.length === 0 && pending === undefined && <p className={css.hint}>这一路还没有站。在下面写第一个问题，发车。</p>}

        {stops.map((s) => {
          const l = live[s.id];
          const items = l ? l.items : (content[s.id] ?? []);
          return (
            <section key={s.id} className={css.stop}>
              <div className={css.ask} style={{ background: colors.tint }}>
                {s.prompt}
              </div>
              <div className={css.who}>
                Claude <span>第 {s.seq} 站 · {s.name}</span>
              </div>
              <Items items={items} streaming={l?.phase === "answering"} />
              {l && items.length === 0 && <p className={css.waiting}>{l.phase === "starting" ? "正在启动 Claude…" : "Claude 在想…"}</p>}
              {s.status === "interrupted" && (
                <p className={css.noteAmber}>
                  没答完{s.error && s.error !== "已停车" ? `：${s.error}` : "（已停车）"}。这一站的改动留在这一路的工作区里，没有进 Local；接着问，下一站正常到站后会一起带过去。
                </p>
              )}
              {s.status === "done" && s.syncState === "synced" && <p className={css.synced}>改动已进 Local</p>}
              {s.syncState === "conflict" && (
                <p className={css.noteRed}>
                  <IconWarn size={14} /> 这一站的改动和 Local 冲突，没有写进 Local。
                </p>
              )}
            </section>
          );
        })}

        {pending !== undefined && (
          <section className={css.stop}>
            <div className={css.ask} style={{ background: colors.tint }}>
              {pending}
            </div>
            <p className={css.waiting}>正在把 Local 的新变化带进这一路…</p>
          </section>
        )}
      </div>

      {permission && (
        <div className={css.permission} role="alertdialog" aria-label="等你批准">
          <b>等你批准：{permission.tool}</b>
          <code>{permission.detail}</code>
          <div>
            <button className={css.allow} onClick={() => answerPermission(route.id, "allow")}>
              允许
            </button>
            {permission.canRemember && <button onClick={() => answerPermission(route.id, "allow-always")}>这一路以后都允许</button>}
            <button onClick={() => answerPermission(route.id, "deny")}>拒绝</button>
          </div>
        </div>
      )}

      {blocked && (
        <div className={css.conflict}>
          <b>
            <IconWarn size={14} /> 有同步冲突，解决后才能问下一站
          </b>
          {lastSync?.status === "conflict" && (
            <ul>
              {lastSync.files.map((f) => (
                <li key={f.path}>
                  <code>{f.path}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <footer className={css.composer}>
        {busy && (
          <div className={css.running}>
            <span style={{ color: colors.tag }}>
              <i style={{ background: colors.line }} />
              {route.status === "awaiting_permission" ? "等你批准" : pending !== undefined ? "同步中" : currentLive?.phase === "starting" ? "启动中" : currentLive?.phase === "finishing" ? "收尾中" : "回答中"}
            </span>
            <button onClick={() => stop(route.id)}>
              <IconStop size={12} /> 停车
            </button>
          </div>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(route.id, e.target.value)}
          onKeyDown={onKey}
          placeholder={blocked ? "先解决冲突" : busy ? "这一站还在路上，到站后再问下一站" : "写下一个问题。Enter 发车，Shift+Enter 换行"}
          disabled={blocked}
          rows={3}
        />
        <div className={css.actions}>
          <span>{route.status === "interrupted" ? "上一站没答完，可以接着问" : ""}</span>
          <button className={css.send} style={{ background: colors.tag }} disabled={busy || blocked || !draft.trim()} onClick={send}>
            发车 <IconSend size={14} />
          </button>
        </div>
      </footer>
    </aside>
  );
}

function StatusLine({ route, stops, phase }: { route: Route; stops: Stop[]; phase?: LiveStop["phase"] | "syncing" }) {
  const n = stops.length;
  if (phase === "syncing") return <>第 {n + 1} 站 · 正在同步 Local</>;
  if (route.status === "awaiting_permission") return <b>第 {n} 站 · 等你批准</b>;
  if (route.status === "answering") return <b>第 {n} 站 · {phase === "starting" ? "正在启动 Claude" : phase === "finishing" ? "正在收尾" : "回答中"}</b>;
  if (route.status === "interrupted") return <>第 {n} 站没答完</>;
  if (route.status === "conflict") return <>有同步冲突</>;
  return <>{n === 0 ? "还没发车" : `已到第 ${n} 站`}</>;
}

function Items({ items, streaming }: { items: ChatItem[]; streaming?: boolean }) {
  return (
    <>
      {items.map((it, i) =>
        it.kind === "text" ? (
          <div key={i} className={css.md} data-streaming={streaming && i === items.length - 1}>
            <Markdown remarkPlugins={[remarkGfm]}>{it.text}</Markdown>
          </div>
        ) : (
          <div key={i} className={css.tool}>
            <span>{it.tool}</span>
            <code className="ell">{it.detail}</code>
          </div>
        ),
      )}
    </>
  );
}
