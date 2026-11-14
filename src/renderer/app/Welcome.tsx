import { useEffect, useState } from "react";
import type { Environment } from "../../shared";
import css from "./Welcome.module.css";

interface Props {
  /** 点一下：让用户选文件夹 */
  onPick(): void;
  /** 拖进来一个文件夹 */
  onDrop(file: File): void;
  loadEnvironment(): Promise<Environment>;
}

/** 运行环境的三项检查；设置面板里也用 */
export function EnvironmentChecks({ env }: { env: Environment | null }) {
  if (!env) return <p className={css.wait}>正在检查…</p>;
  const row = (state: "ok" | "bad" | "unknown", text: React.ReactNode) => (
    <li data-state={state}>
      <i>{state === "ok" ? "✓" : state === "bad" ? "!" : "?"}</i>
      <span>{text}</span>
    </li>
  );
  return (
    <ul className={css.checks}>
      {env.claudeVersion
        ? row(
            "ok",
            <>
              找到 claude 命令 <code>{env.claudeVersion}</code>
            </>,
          )
        : row("bad", "没有找到 claude 命令。重新安装 Branchwork 试试")}
      {env.loggedIn === true && row("ok", "已登录 Claude 账号")}
      {env.loggedIn === false &&
        row(
          "bad",
          <>
            还没有登录 Claude 账号。在终端里运行一次 <code>claude</code>，按提示登录后再回来
          </>,
        )}
      {env.loggedIn === null && row("unknown", "登录状态在这里确认不了（凭据存在系统钥匙串里），第一次提问时就知道了")}
      {env.gitVersion
        ? row("ok", "git 可用，用来给每一路建独立工作区")
        : row("bad", "没有找到 git。Branchwork 靠 git 给每一路建独立工作区，先装好 git")}
    </ul>
  );
}

/** 还没有项目时的第一页：拖一个文件夹进来，或者点一下选 */
export function Welcome({ onPick, onDrop, loadEnvironment }: Props) {
  const [over, setOver] = useState(false);
  const [env, setEnv] = useState<Environment | null>(null);
  useEffect(() => {
    let alive = true;
    void loadEnvironment().then(
      (e) => alive && setEnv(e),
      () => alive && setEnv({ claudeVersion: null, loggedIn: null, gitVersion: null }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={css.page}>
      <div className={css.inner}>
        <h1>先加一个项目</h1>
        <p>选一个代码文件夹。之后在里面每开一个对话就是一路车，每问一个问题就是一站。</p>
        <button
          className={css.drop}
          data-over={over}
          aria-label="选择项目目录"
          onClick={onPick}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const file = e.dataTransfer.files[0];
            if (file) onDrop(file);
          }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6.5A1.5 1.5 0 014.5 5H9l2 2.5h8.5A1.5 1.5 0 0121 9v9.5a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5v-12zM12 11v6M9 14h6" />
          </svg>
          <b>{over ? "松手就加进来" : "把项目文件夹拖到这里"}</b>
          <span>或者点一下选择文件夹</span>
        </button>

        <svg className={css.diagram} viewBox="0 0 620 80" role="img" aria-label="一个对话是一路车，一次提问是一站，从某站分出就是新的一路">
          <text x="20" y="16">一个对话 = 一路车</text>
          <text x="300" y="16">一次提问 = 一站</text>
          <text x="470" y="50">从某站分出 = 新一路</text>
          <path d="M 20 30 H 600" stroke="var(--route-1)" strokeWidth="5" strokeLinecap="round" />
          <path d="M 220 30 C 250 30, 255 58, 290 58 H 490" stroke="var(--route-2)" strokeWidth="5" strokeLinecap="round" fill="none" />
          <circle cx="100" cy="30" r="8" fill="#fff" stroke="var(--route-1)" strokeWidth="4" />
          <circle cx="360" cy="30" r="8" fill="#fff" stroke="var(--route-1)" strokeWidth="4" />
          <circle cx="380" cy="58" r="8" fill="#fff" stroke="var(--route-2)" strokeWidth="4" />
          <circle cx="220" cy="30" r="9" fill="#fff" stroke="var(--text-1)" strokeWidth="4" />
        </svg>

        <section className={css.env} aria-label="运行环境">
          <h2>运行环境</h2>
          <EnvironmentChecks env={env} />
        </section>
      </div>
    </div>
  );
}
