import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** 每个模块允许依赖哪些模块、哪些外部包 */
const RULES: Record<string, { modules: string[]; packages: string[] }> = {
  shared: { modules: [], packages: [] },
  sync: { modules: ["shared"], packages: [] },
  db: { modules: ["shared"], packages: [] },
  claude: { modules: ["shared"], packages: ["@anthropic-ai/claude-agent-sdk"] },
  core: { modules: ["shared", "sync", "db", "claude"], packages: [] },
};

const SRC = path.resolve(__dirname, "..", "src");
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []));
const imports = (file: string) => [...fs.readFileSync(file, "utf8").matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]!);

describe("模块规则", () => {
  it("src 下的每个目录都登记了规则，且都有 index.ts 作为入口", () => {
    const dirs = fs.readdirSync(SRC, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    expect(dirs.sort()).toEqual(Object.keys(RULES).sort());
    for (const d of dirs) expect(fs.existsSync(path.join(SRC, d, "index.ts")), `${d}/index.ts`).toBe(true);
  });

  it.each(Object.keys(RULES))("%s 只依赖允许的模块，且只从对方的入口引用", (mod) => {
    const rule = RULES[mod]!;
    const problems: string[] = [];
    for (const file of files(path.join(SRC, mod))) {
      for (const spec of imports(file)) {
        const where = `${path.relative(SRC, file)} → ${spec}`;
        if (spec.startsWith("node:")) continue;
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
});
