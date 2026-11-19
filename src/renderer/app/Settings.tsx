import { useEffect, useState } from "react";
import type { Environment } from "../../shared";
import { EnvironmentChecks } from "./Welcome";
import css from "./Welcome.module.css";

/** 右上角的设置面板：运行环境，MCP 服务和浏览器的入口；各项目自己的设置在项目菜单里 */
export function Settings({ load, onClose, onMcp }: { load(): Promise<Environment>; onClose(): void; /** 打开这个项目的 MCP 服务、浏览器设置；没有项目时不给 */ onMcp?(tab: "servers" | "browser"): void }) {
  const [env, setEnv] = useState<Environment | null>(null);
  useEffect(() => {
    void load().then(setEnv, () => setEnv({ claudeVersion: null, loggedIn: null, gitVersion: null }));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => !(e.target as Element).closest(`.${css.settings},[aria-label="设置"]`) && onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);
  return (
    <section className={css.settings} role="dialog" aria-label="设置">
      <h2>运行环境</h2>
      <EnvironmentChecks env={env} />
      {onMcp && (
        <div className={css.settingsLinks}>
          <button onClick={() => (onMcp("servers"), onClose())}>MCP 服务…</button>
          <button onClick={() => (onMcp("browser"), onClose())}>浏览器…</button>
        </div>
      )}
      <p>批准方式、模型在右边对话栏的底部改；同步记录、导入终端里的会话在左栏项目名旁边的菜单里。</p>
    </section>
  );
}
