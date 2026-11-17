import { useEffect, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlight, type CodeLine } from "./highlight";
import css from "./ChatPanel.module.css";

/** hast 节点里的纯文字 */
type Hast = { type: string; value?: string; tagName?: string; properties?: { className?: unknown }; children?: Hast[] };
const textOf = (n: Hast): string => (n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(textOf).join(""));

/** 代码块：先原样显示，高亮好了再换上带颜色的；语言不认识就一直原样 */
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [lines, setLines] = useState<CodeLine[] | null>(null);
  useEffect(() => {
    let alive = true;
    setLines(null);
    void highlight(code, lang).then((l) => alive && setLines(l));
    return () => {
      alive = false;
    };
  }, [code, lang]);
  return (
    <pre className={css.code} data-lang={lang || undefined}>
      {lang && <span className={css.codeLang}>{lang}</span>}
      <code>
        {lines
          ? lines.map((line, i) => (
              <span key={i}>
                {line.map((t, j) => (
                  <span key={j} style={{ color: t.color, fontStyle: t.fontStyle && t.fontStyle & 1 ? "italic" : undefined, fontWeight: t.fontStyle && t.fontStyle & 2 ? 600 : undefined }}>
                    {t.content}
                  </span>
                ))}
                {"\n"}
              </span>
            ))
          : code}
      </code>
    </pre>
  );
}

const components: Components = {
  // ``` 代码块：react-markdown 给的是 <pre><code class="language-ts">，整块换成自己的
  pre({ node }) {
    const code = (node?.children?.[0] ?? null) as Hast | null;
    if (!code || code.tagName !== "code") return <pre>{node ? textOf(node as Hast) : null}</pre>;
    const cls = code.properties?.className;
    const lang = (Array.isArray(cls) ? cls : [cls]).map(String).find((c) => c.startsWith("language-"))?.slice("language-".length);
    return <CodeBlock code={textOf(code).replace(/\n$/, "")} lang={lang} />;
  },
};

/** 对话里的一段 Markdown（技术方案：react-markdown + GFM 表格，代码块用 shiki 高亮） */
export function Md({ children }: { children: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </Markdown>
  );
}
