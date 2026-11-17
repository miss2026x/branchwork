import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** 每个模块允许依赖哪些模块、哪些外部包 */
const RULES: Record<string, { modules: string[]; packages: string[] }> = {
  shared: { modules: [], packages: [] },
  sync: { modules: ["shared"], packages: [] },
  db: { modules: ["shared"], packages: [] },
  claude: { modules: ["shared"], packages: ["@anthropic-ai/claude-agent-sdk", "zod"] },
  terminal: { modules: [], packages: [] },
  core: { modules: ["shared", "sync", "db", "claude", "terminal"], packages: [] },
  // Electron 只进这两个模块
  main: { modules: ["shared", "core", "db", "claude"], packages: ["electron"] },
  preload: { modules: ["shared"], packages: ["electron"] },
  // 界面只认识 shared 里的类型；数据只能经 window.bw 来
  renderer: { modules: ["shared"], packages: ["react", "react-dom/client", "zustand", "react-markdown", "remark-gfm", "@fontsource-variable/schibsted-grotesk", "@fontsource-variable/noto-sans-sc", "@fontsource-variable/jetbrains-mono"] },
};

const SRC = path.resolve(__dirname, "..", "src");
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
const imports = (file: string) => [...fs.readFileSync(file, "utf8").matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]!);

describe("模块规则", () => {
  it("src 下的每个目录都登记了规则，且都有 index.ts 作为入口", () => {
    const dirs = fs.readdirSync(SRC, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    expect(dirs.sort()).toEqual(Object.keys(RULES).sort());
    // 界面的入口是 main.tsx（它是一个页面，不被别的模块引用）
    for (const d of dirs) expect(fs.existsSync(path.join(SRC, d, d === "renderer" ? "main.tsx" : "index.ts")), `${d} 的入口`).toBe(true);
  });

  it.each(Object.keys(RULES))("%s 只依赖允许的模块，且只从对方的入口引用", (mod) => {
    const rule = RULES[mod]!;
    const problems: string[] = [];
    for (const file of files(path.join(SRC, mod))) {
      for (const spec of imports(file)) {
        const where = `${path.relative(SRC, file)} → ${spec}`;
        if (spec.startsWith("node:")) continue;
        if (/\.css$/.test(spec)) continue;
        if (!spec.startsWith(".")) {
          if (!rule.packages.includes(spec)) problems.push(`${where}（不允许的外部包）`);
          continue;
        }
        const target = path.relative(SRC, path.resolve(path.dirname(file), spec)).split(path.sep);
        const targetMod = target[0]!;
        if (targetMod === mod) continue; // 模块内部随便引用
        if (!rule.modules.includes(targetMod)) problems.push(`${where}（${mod} 不能依赖 ${targetMod}）`);
        else if (target.length > 1) problems.push(`${where}（要从 ${targetMod} 的入口引用，不能伸手进内部文件）`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("界面里只有数据仓库碰 window.bw；组件只收数据、发事件", () => {
    const allowed = ["stores/store.ts", "dev/mock-bw.ts", "main.tsx", "env.d.ts"];
    const offenders = files(path.join(SRC, "renderer"))
      .filter((f) => /window\.bw\b/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(path.join(SRC, "renderer"), f).split(path.sep).join("/"))
      .filter((f) => !allowed.includes(f));
    expect(offenders).toEqual([]);
  });
});

describe("界面的动效", () => {
  it("CSS Modules 里用到的动画名，同一个文件里都有 @keyframes（模块会把名字按文件改掉，用别处定义的会悄悄失效）", () => {
    const problems: string[] = [];
    for (const f of files(path.join(SRC, "renderer")).filter((x) => x.endsWith(".module.css"))) {
      const text = fs.readFileSync(f, "utf8");
      const defined = new Set([...text.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
      for (const m of text.matchAll(/animation(?:-name)?\s*:\s*([\w-]+)/g)) {
        const name = m[1]!;
        if (["none", "inherit", "initial", "unset"].includes(name)) continue;
        if (!defined.has(name)) problems.push(`${path.relative(SRC, f)}：${name}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("设计稿的样式规范（第 0 站）：组件样式只用 tokens.css 里的变量", () => {
  const css = () => files(path.join(SRC, "renderer")).filter((x) => x.endsWith(".module.css"));
  const tokens = fs.readFileSync(path.join(SRC, "renderer/styles/tokens.css"), "utf8");
  const defined = new Set([...tokens.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));

  /** 每个文件里的声明：[属性, 值, 出处]。行里写了“例外：原因”的跳过（几何算出来的、设计稿就这么写的） */
  function decls() {
    const out: [string, string, string][] = [];
    for (const f of css())
      fs.readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const m = /^\s*([a-z-]+)\s*:\s*(.+?);/.exec(line);
          if (m && !line.includes("例外：")) out.push([m[1]!, m[2]!, `${path.relative(SRC, f)}:${i + 1}`]);
        });
    return out;
  }
  const check = (bad: (prop: string, value: string) => boolean) =>
    decls()
      .filter(([p, v]) => bad(p, v))
      .map(([p, v, at]) => `${at}  ${p}: ${v}`);

  it("用到的变量都在 tokens.css 里定义过（写错名字会悄悄失效）", () => {
    const problems: string[] = [];
    for (const f of [...css(), ...files(path.join(SRC, "renderer")).filter((x) => /\.tsx?$/.test(x))])
      for (const m of fs.readFileSync(f, "utf8").matchAll(/var\((--[\w-]+)/g))
        if (!m[1]!.endsWith("-") && !defined.has(m[1]!) && !["--fx", "--fy", "--c", "--p", "--panel-w", "--lane", "--lane-text"].includes(m[1]!)) problems.push(`${path.relative(SRC, f)}：${m[1]}`);
    expect([...new Set(problems)]).toEqual([]);
  });

  it("颜色：不写色值", () => {
    expect(check((p, v) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(v) || (p !== "white-space" && /\b(white|black)\b/.test(v)))).toEqual([]);
  });

  it("字号和行高：只用字阶的 10 级", () => {
    expect(check((p, v) => p === "font-size" && !/^(var\(--fs-\d+\)|inherit)$/.test(v))).toEqual([]);
    expect(check((p, v) => p === "line-height" && /\d+px/.test(v))).toEqual([]);
  });

  it("间距：内边距和间隔只用 13 档（1px 的细线除外）", () => {
    expect(check((p, v) => /^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)*$/.test(p) && /(?<![\w-])(?!1px)\d+px/.test(v))).toEqual([]);
  });

  it("控件高度、圆角、阴影、时长：用变量", () => {
    expect(check((p, v) => /^(min-)?height$/.test(p) && /^(28|32|34|36|38|40|44)px$/.test(v))).toEqual([]);
    expect(check((p, v) => /^border(-[a-z]+)*-radius$/.test(p) && /\d+(px|%)/.test(v))).toEqual([]);
    expect(check((p, v) => /^(transition|animation)(-duration)?$/.test(p) && /(?<![\w-])\d+(\.\d+)?m?s\b/.test(v))).toEqual([]);
  });

  it("变量名照设计稿画板左边的写：fg-1…4、line-1/2、border、divider、canvas、surface…", () => {
    for (const name of ["--fg-1", "--fg-2", "--fg-3", "--fg-4", "--line-1", "--line-2", "--border", "--divider", "--canvas", "--surface-2", "--surface-1", "--surface", "--e1", "--e2", "--e3", "--e4"])
      expect(defined.has(name), name).toBe(true);
  });

  it("字体打包在应用里：西文 Schibsted Grotesk、中文 Noto Sans SC、代码 JetBrains Mono", () => {
    const main = fs.readFileSync(path.join(SRC, "renderer/main.tsx"), "utf8");
    for (const pkg of ["schibsted-grotesk", "noto-sans-sc", "jetbrains-mono"]) expect(main).toContain(`@fontsource-variable/${pkg}`);
    expect(tokens).toMatch(/--font:\s*"Schibsted Grotesk Variable", "Noto Sans SC Variable"/);
    expect(tokens).toMatch(/--mono:\s*"JetBrains Mono Variable"/);
  });
});

describe("安装能跑通（pnpm 11）", () => {
  const root = path.resolve(__dirname, "..");

  it("pnpm-workspace.yaml：带安装脚本的依赖都明确写了 true 或 false，没有留占位文字", () => {
    const text = fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
    const block = /^allowBuilds:\n((?:[ \t]+.*\n?)+)/m.exec(text)?.[1] ?? "";
    const entries = Object.fromEntries(
      block
        .split("\n")
        .map((l) => l.replace(/#.*$/, "").trim())
        .filter(Boolean)
        .map((l) => l.split(/:\s*/) as [string, string]),
    );
    // 已有的批准项不能丢
    expect(entries).toMatchObject({ esbuild: "true", "electron-winstaller": "true" });
    for (const [name, value] of Object.entries(entries)) expect(["true", "false"], `allowBuilds 里的 ${name} 必须是 true 或 false`).toContain(value);
    for (const name of ["electron", "esbuild", "electron-winstaller"]) expect(text).toMatch(new RegExp(`^  - ${name}$`, "m"));
  });

  it("package.json 保留 postinstall：Electron 45 不自带安装脚本，靠它下载程序本体", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.postinstall).toBe("install-electron");
  });
});
