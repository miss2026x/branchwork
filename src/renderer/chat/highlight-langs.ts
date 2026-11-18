/** 支持高亮的语言和别名（不碰 shiki：界面主线程也要用它判断认不认识这种语言） */
export const LANG_NAMES = ["typescript", "tsx", "javascript", "jsx", "json", "jsonc", "shellscript", "powershell", "python", "css", "scss", "html", "vue", "markdown", "yaml", "toml", "sql", "go", "rust", "java", "kotlin", "swift", "c", "cpp", "csharp", "php", "ruby", "diff", "dockerfile", "xml", "ini"] as const;
export type Lang = (typeof LANG_NAMES)[number];

export const ALIAS: Record<string, Lang> = {
  ts: "typescript", mts: "typescript", cts: "typescript", js: "javascript", mjs: "javascript", cjs: "javascript", node: "javascript",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", shell: "shellscript", console: "shellscript", ps1: "powershell", pwsh: "powershell",
  py: "python", python3: "python", htm: "html", md: "markdown", yml: "yaml", rs: "rust", golang: "go", kt: "kotlin", "c++": "cpp", cc: "cpp", h: "c", hpp: "cpp",
  cs: "csharp", "c#": "csharp", rb: "ruby", patch: "diff", docker: "dockerfile", svg: "xml", env: "ini", conf: "ini",
};

/** 代码块标的语言名 → 支持的语言；不认识的返回 null（不高亮，原样显示） */
export function resolveLang(name: string | undefined): Lang | null {
  if (!name) return null;
  const key = name.toLowerCase().trim();
  if ((LANG_NAMES as readonly string[]).includes(key)) return key as Lang;
  return ALIAS[key] ?? null;
}

