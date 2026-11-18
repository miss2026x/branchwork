import { memo, useEffect, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlight, type CodeLine } from "./highlight";
import css from "./ChatPanel.module.css";

/** hast 节点里的纯文字 */
type Hast = { type: string; value?: string; tagName?: string; properties?: { className?: unknown }; children?: Hast[] };
const textOf = (n: Hast): string => (n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(textOf).join(""));

/**
 * 代码块：先原样显示，高亮好了再换上带颜色的；语言不认识就一直原样。
 * 正在流出来的代码每一小段都在变：等它停下 300ms 再送去上色，期间已经上过色的那几行留着，新出来的行先原样接在后面
 */
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [done, setDone] = useState<{ code: string; lines: CodeLine[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => void highlight(code, lang).then((l) => alive && setDone(l ? { code, lines: l } : null));
    // 第一次马上上色；之后内容还在变的话等它停一下
    const timer = done ? window.setTimeout(run, 300) : (run(), undefined);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- done 只用来判断是不是第一次
  }, [code, lang]);
  // 上过色的是现在这段代码的开头：上过色的行照用，后面的原样
  const usable = done && code.startsWith(done.code) ? done : null;
  const colored = usable ? (usable.code === code ? usable.lines : usable.lines.slice(0, -1)) : null;
  const rest = colored ? code.split("\n").slice(colored.length).join("\n") : code;
  return (
    <pre className={css.code} data-lang={lang || undefined}>
      {lang && <span className={css.codeLang}>{lang}</span>}
      <code>
        {colored?.map((line, i) => (
          <span key={i}>
            {line.map((t, j) => (
              <span key={j} style={{ color: t.color, fontStyle: t.fontStyle && t.fontStyle & 1 ? "italic" : undefined, fontWeight: t.fontStyle && t.fontStyle & 2 ? 600 : undefined }}>
                {t.content}
              </span>
            ))}
            {"\n"}
          </span>
        ))}
        {rest}
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

/** 对话里的一段 Markdown（技术方案：react-markdown + GFM 表格，代码块用 shiki 高亮）。内容不变就不重新解析 */
export const Md = memo(function Md({ children }: { children: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </Markdown>
  );
});

/**
 * 正在流出来的回答：按空行切成几块，前面写完的块不再重新解析，只有最后一块跟着字变。
 * 代码块里的空行不切（```数是单数说明还在代码块里）。到站以后换回整段解析，样子以那个为准
 */
export function splitStreaming(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let fences = 0;
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text[i] !== "\n") continue;
    const line = text.slice(lineStart, i);
    if (/^\s*(```|~~~)/.test(line)) fences++;
    // 空行、不在代码块里：前面这一块写完了
    if (line.trim() === "" && fences % 2 === 0 && i > start && i < text.length) {
      parts.push(text.slice(start, i + 1));
      start = i + 1;
    }
    lineStart = i + 1;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

export function StreamingMd({ children }: { children: string }) {
  return (
    <>
      {splitStreaming(children).map((part, i) => (
        <Md key={i}>{part}</Md>
      ))}
    </>
  );
}
