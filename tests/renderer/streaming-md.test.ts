import { describe, expect, it } from "vitest";
import { splitStreaming } from "../../src/renderer/chat/Md";

describe("正在流出来的回答按空行切块（前面写完的块不再重新解析）", () => {
  it("空行处切开，拼回去和原文一样", () => {
    const text = "第一段\n\n- 一\n- 二\n\n最后一段还在写";
    const parts = splitStreaming(text);
    expect(parts).toEqual(["第一段\n\n", "- 一\n- 二\n\n", "最后一段还在写"]);
    expect(parts.join("")).toBe(text);
  });
  it("代码块里的空行不切；代码块还没写完时整块留在最后", () => {
    const text = "看这段：\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n然后\n\n```py\nx = 1\n\ny";
    const parts = splitStreaming(text);
    expect(parts).toEqual(["看这段：\n\n", "```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n", "然后\n\n", "```py\nx = 1\n\ny"]);
    expect(parts.join("")).toBe(text);
  });
});
