/**
 * 代码高亮（技术方案：“代码高亮用 shiki”）。整个应用只有这个文件碰 shiki。
 * - 用 JavaScript 正则引擎，不加载 wasm；语言按需加载，第一次遇到某种语言时才下载它的语法
 * - 颜色不用 shiki 自带的主题，用 tokens.css 里的 --shiki-* 变量，跟着样式规范走，深色模式也只换变量
 */
import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const theme = createCssVariablesTheme({ name: "branchwork", variablePrefix: "--shiki-", fontStyle: true });

/** 支持的语言：名字 → 按需加载 */
const LANGS = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
} as const;
type Lang = keyof typeof LANGS;

const ALIAS: Record<string, Lang> = {
  ts: "typescript", mts: "typescript", cts: "typescript", js: "javascript", mjs: "javascript", cjs: "javascript", node: "javascript",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", shell: "shellscript", console: "shellscript", ps1: "powershell", pwsh: "powershell",
  py: "python", python3: "python", htm: "html", md: "markdown", yml: "yaml", rs: "rust", golang: "go", kt: "kotlin", "c++": "cpp", cc: "cpp", h: "c", hpp: "cpp",
  cs: "csharp", "c#": "csharp", rb: "ruby", patch: "diff", docker: "dockerfile", svg: "xml", env: "ini", conf: "ini",
};

/** 代码块标的语言名 → 支持的语言；不认识的返回 null（不高亮，原样显示） */
export function resolveLang(name: string | undefined): Lang | null {
  if (!name) return null;
  const key = name.toLowerCase().trim();
  if (key in LANGS) return key as Lang;
  return ALIAS[key] ?? null;
}

let core: Promise<HighlighterCore> | null = null;
const loaded = new Map<Lang, Promise<void>>();

async function highlighter(lang: Lang): Promise<HighlighterCore> {
  core ??= createHighlighterCore({ themes: [theme], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) });
  const h = await core;
  if (!loaded.has(lang)) loaded.set(lang, LANGS[lang]().then((m) => h.loadLanguage(m.default)));
  await loaded.get(lang);
  return h;
}

export type CodeLine = Pick<ThemedToken, "content" | "color" | "fontStyle">[];

/** 把一段代码切成带颜色的词；语言不认识或出错时返回 null，调用方原样显示 */
export async function highlight(code: string, langName: string | undefined): Promise<CodeLine[] | null> {
  const lang = resolveLang(langName);
  if (!lang) return null;
  try {
    const h = await highlighter(lang);
    return h.codeToTokens(code, { lang, theme: "branchwork" }).tokens.map((line) => line.map(({ content, color, fontStyle }) => ({ content, color, fontStyle })));
  } catch {
    return null;
  }
}
