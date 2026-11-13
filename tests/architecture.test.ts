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
  renderer: { modules: ["shared"], packages: ["react", "react-dom/client", "zustand", "react-markdown", "remark-gfm"] },
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
