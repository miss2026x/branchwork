import { describe, expect, it } from "vitest";
import { baseName, fileMark, fileMarks, splitFiles, withFileNames } from "../../src/shared";

describe("输入框附的文件和文件夹（设计稿 9-16）", () => {
  const text = `照着 ${fileMark("C:\\Users\\me\\需求说明.pdf")} 第 3 节改，看 [图 1]；字段在 ${fileMark("/home/me/api-spec", true)} 里`;
  it("记号写进提问、能读回来", () => {
    expect(fileMarks(text)).toEqual([
      { path: "C:\\Users\\me\\需求说明.pdf", dir: false },
      { path: "/home/me/api-spec", dir: true },
    ]);
    expect(splitFiles(text).map((p) => p.kind)).toEqual(["text", "file", "text", "file", "text"]);
    expect(splitFiles("没有附件")).toEqual([{ kind: "text", text: "没有附件" }]);
  });
  it("给人看的：写成文件名", () => {
    expect(withFileNames(text)).toBe("照着 需求说明.pdf 第 3 节改，看 [图 1]；字段在 api-spec 里");
    expect(baseName("C:\\a\\b\\")).toBe("b");
  });
});
