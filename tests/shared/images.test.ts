import { describe, expect, it } from "vitest";
import { imageMarks, splitPrompt, withoutImageMarks } from "../../src/shared";

describe("提问里的图片记号（设计稿 4-7 方案 B）", () => {
  it("按记号把提问切开：记号留在前面那段文字的末尾，图片紧跟在后面", () => {
    expect(splitPrompt("看 [图 1]。改完对比一下 [图 2] 的样子", 2)).toEqual([
      { kind: "text", text: "看 [图 1]" },
      { kind: "image", n: 1 },
      { kind: "text", text: "。改完对比一下 [图 2]" },
      { kind: "image", n: 2 },
      { kind: "text", text: " 的样子" },
    ]);
  });
  it("只有图、没写字：文字就是记号；没被提到的图接在最后，前面补上记号", () => {
    expect(splitPrompt("[图 1]", 1)).toEqual([{ kind: "text", text: "[图 1]" }, { kind: "image", n: 1 }]);
    expect(splitPrompt("这两张", 2)).toEqual([{ kind: "text", text: "这两张" }, { kind: "text", text: "[图 1]" }, { kind: "image", n: 1 }, { kind: "text", text: "[图 2]" }, { kind: "image", n: 2 }]);
  });
  it("自己打的“[图 9]”（没有第 9 张）、重复的记号：当普通文字", () => {
    expect(splitPrompt("[图 9] 和 [图 1][图 1]", 1)).toEqual([{ kind: "text", text: "[图 9] 和 [图 1]" }, { kind: "image", n: 1 }, { kind: "text", text: "[图 1]" }]);
    expect(splitPrompt("[图 1]", 0)).toEqual([{ kind: "text", text: "[图 1]" }]);
  });
  it("去掉记号给人看；数出记号", () => {
    expect(withoutImageMarks("看[图 1]这里 [图 2]")).toBe("看 这里");
    expect(imageMarks("[图 2] 和 [图 1]")).toEqual([2, 1]);
  });
});
