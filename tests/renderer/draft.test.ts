import { describe, expect, it } from "vitest";
import { draftStatus, fromPrompt, OBJ, toPrompt, type DraftImage } from "../../src/renderer/chat/draft";
import type { PromptImage } from "../../src/shared";

const img = (name: string): PromptImage => ({ type: "image/png", data: name, name, width: 10, height: 10 });
const ready = (id: string, name = id): DraftImage => ({ id, state: "ready", name, image: img(name) });
let n = 0;
const newId = () => `d${++n}`;

describe("输入框的草稿：文字里每张图占一个 OBJ", () => {
  it("发出去：OBJ 依次换成“[图 N]”，图片按出现的先后排", () => {
    expect(toPrompt(` 看${OBJ}。对比${OBJ}的样子 `, [ready("a"), ready("b")])).toEqual({ text: "看[图 1]。对比[图 2]的样子", images: [img("a"), img("b")] });
  });
  it("放回输入框（改站、发车失败）：记号换回 OBJ；文字里没提到的图接在最后", () => {
    const back = fromPrompt("看[图 2]和[图 1]", [img("a"), img("b"), img("c")], newId);
    expect(back.text).toBe(`看${OBJ}和${OBJ}${OBJ}`);
    expect(back.images.map((i) => i.image!.name)).toEqual(["b", "a", "c"]);
    // 再发出去：编号按新的先后重排
    expect(toPrompt(back.text, back.images)).toEqual({ text: "看[图 1]和[图 2][图 3]", images: [img("b"), img("a"), img("c")] });
  });
  it("能不能发：空的不能；图还在处理、有读不了的图都不能；只有图也能发", () => {
    expect(draftStatus("  ", [])).toBe("empty");
    expect(draftStatus(OBJ, [ready("a")])).toBe("ok");
    expect(draftStatus(`看${OBJ}`, [{ id: "x", state: "loading", name: "x" }])).toBe("loading");
    expect(draftStatus(`看${OBJ}`, [{ id: "x", state: "bad", name: "x.heic", reason: "读不了" }])).toBe("bad");
  });
});
