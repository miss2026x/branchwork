import { describe, expect, it } from "vitest";
import { estimateTokens, formatSummary, parseSummary } from "../../src/renderer/ui/summary-items";

describe("摘要拆成一条一条", () => {
  const text = ["## 做完了", "- 梳理了认证结构", "- 令牌中间件写完，在 `src/auth/jwt.ts`", "", "## 还没定", "1. refresh token 的有效期", "登录失败要不要限流"].join("\n");

  it("按小节拆开，去掉列表符号", () => {
    expect(parseSummary(text)).toEqual([
      { title: "做完了", items: ["梳理了认证结构", "令牌中间件写完，在 `src/auth/jwt.ts`"] },
      { title: "还没定", items: ["refresh token 的有效期", "登录失败要不要限流"] },
    ]);
  });

  it("开头没有标题的几行自成一组；缩进的续行并进上一条", () => {
    expect(parseSummary("先说一句\n- 第一条\n    接着写\n**注意：**\n- 别动 Local")).toEqual([
      { title: "", items: ["先说一句", "第一条 接着写"] },
      { title: "注意：", items: ["别动 Local"] },
    ]);
  });

  it("拼回去再拆，结果一样；空的条目和空的小节不留", () => {
    const groups = parseSummary(text);
    expect(parseSummary(formatSummary(groups))).toEqual(groups);
    expect(formatSummary([{ title: "做完了", items: ["  "] }, { title: "还没定", items: ["有效期", ""] }])).toBe("## 还没定\n- 有效期");
  });

  it("估 token：中文一个字一个，英文四个字符一个", () => {
    expect(estimateTokens("令牌中间件")).toBe(5);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});
