import { useEffect, useState } from "react";
import type { ChromeDownload } from "../../shared";
import { IconClose, IconDownload, IconGlobe } from "../ui/icons";
import css from "./Dialog.module.css";
import own from "./Chrome.module.css";

interface Props {
  download: ChromeDownload;
  /** 问现在的稳定版和大小 */
  latest(): Promise<{ version: string; size: number }>;
  onDownload(): void;
  onCancelDownload(): void;
  /** 打开浏览器设置写 Chrome 的位置；没有项目时不给 */
  onPickPath?(): void;
  onClose(): void;
}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/**
 * 没找到 Chrome（设计稿 9-15）：问一下，再下载 Chrome for Testing。
 * 下载中可以关掉对话框，下载接着进行；下好后右下角提示，接着做刚才要做的事
 */
export function ChromeDialog({ download, latest, onDownload, onCancelDownload, onPickPath, onClose }: Props) {
  const [info, setInfo] = useState<{ version: string; size: number } | "loading" | { error: string }>("loading");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    let live = true;
    latest().then(
      (v) => live && setInfo(v),
      (e: unknown) => live && setInfo({ error: (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "") }),
    );
    return () => {
      live = false;
    };
  }, [latest]);

  const busy = download.status === "checking" || download.status === "downloading" || download.status === "unpacking";
  const pct = download.total ? Math.min(100, Math.round((download.received / download.total) * 100)) : 0;

  if (busy)
    return (
      <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className={css.dialog} role="dialog" aria-modal aria-label="正在下载 Chrome for Testing">
          <header>
            <IconDownload size={18} />
            <h2>{download.status === "unpacking" ? "正在解开 Chrome for Testing" : "正在下载 Chrome for Testing"}</h2>
            <button type="button" aria-label="关闭" onClick={onClose}>
              <IconClose />
            </button>
          </header>
          <div className={own.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={download.status === "unpacking" ? 100 : pct}>
            <i style={{ width: `${download.status === "unpacking" ? 100 : pct}%` }} />
          </div>
          <p className={own.meta}>
            <code>{download.status === "checking" ? "查版本…" : download.total ? `${mb(download.received)} / ${mb(download.total)}` : mb(download.received)}</code>
            <span>{download.status === "unpacking" ? "解开中" : download.total ? `${pct}%` : ""}</span>
          </p>
          <p className={css.sub}>可以关掉这个窗口，下载会接着进行；好了右下角提示。下完自动解开，接着打开你刚才要开的页面。</p>
          <footer>
            <button type="button" className={css.ghost} onClick={onCancelDownload}>
              取消下载
            </button>
            <button type="button" className={own.btn} onClick={onClose}>
              在后台下载
            </button>
          </footer>
        </div>
      </div>
    );

  const unsupported = typeof info === "object" && "error" in info;
  return (
    <div className={css.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={css.dialog} role="dialog" aria-modal aria-label="没找到 Chrome">
        <header>
          <IconGlobe size={18} />
          <h2>没找到 Chrome</h2>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <IconClose />
          </button>
        </header>
        <p className={css.sub}>Lanes 的浏览器要用 Chrome（Edge、Chromium 也行），这台电脑上没找到。</p>
        <p className={css.sub}>
          可以下载一个 <b>Chrome for Testing</b>：Google 给自动化测试出的 Chrome，只给 Lanes 用，放在 Lanes 自己的文件夹里，不装进系统，不改你的默认浏览器。
        </p>
        <div className={own.facts}>
          {info === "loading" ? (
            <span>正在查最新的版本…</span>
          ) : unsupported ? (
            <span className={own.err}>{info.error}</span>
          ) : (
            <>
              <span>
                版本 <code>{info.version}</code>
              </span>
              {info.size > 0 && (
                <span>
                  约 <code>{mb(info.size)}</code>
                </span>
              )}
            </>
          )}
        </div>
        {download.status === "error" && download.error && <p className={own.err}>上次没下成：{download.error}</p>}
        <footer>
          {onPickPath && (
            <button type="button" className={own.btn} onClick={onPickPath}>
              指定 Chrome 位置…
            </button>
          )}
          <span className={own.fill} />
          <button type="button" className={css.ghost} onClick={onClose}>
            先不用
          </button>
          <button type="button" className={own.primary} disabled={info === "loading" || unsupported} onClick={onDownload}>
            <IconDownload size={14} />
            {download.status === "error" ? "再试一次" : "下载"}
          </button>
        </footer>
      </div>
    </div>
  );
}
