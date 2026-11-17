import { describe, expect, it } from "vitest";
import { plainText } from "../../src/renderer/ui/plain-text";

describe("Markdown 变一行纯文字", () => {
  it("去掉加粗、行内代码、标题、列表、引用和链接的写法", () => {
    expect(plainText("认证相关的代码分三层：\n1. **路由层** `src/auth/routes.ts`：登录\n2. *会话层*")).toBe("认证相关的代码分三层： 路由层 src/auth/routes.ts：登录 会话层");
    expect(plainText("## 结论\n> 先改 [路由](http://x)")).toBe("结论 先改 路由");
  });
  it("代码块只留代码，蛇形命名里的下划线不动", () => {
    expect(plainText("看这里：\n```ts\nconst a_b = 1;\n```")).toBe("看这里： const a_b = 1;");
  });
});
