import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, canHide, dividerTarget, flexPane, loadLayout, move, normalize, sameSlot, saveLayout, setWidth, slotAt, toggle, visible, type Layout } from "../../src/renderer/app/layout";

const L = (order: Layout["order"], hidden: Layout["hidden"] = []): Layout => ({ ...DEFAULT_LAYOUT, order, hidden });

describe("面板布局", () => {
  it("收起和打开；只剩一个时收不起", () => {
    let l = toggle(DEFAULT_LAYOUT, "rail");
    expect(visible(l)).toEqual(["map", "chat"]);
    l = toggle(toggle(l, "map"), "chat");
    expect(visible(l)).toEqual(["chat"]);
    expect(canHide(l, "chat")).toBe(false);
    l = toggle(l, "rail");
    expect(visible(l)).toEqual(["rail", "chat"]); // 回到原来的位置
  });

  it("谁占剩下的宽度：地图 > 对话 > 项目列表", () => {
    expect(flexPane(["rail", "map", "chat"])).toBe("map");
    expect(flexPane(["chat", "rail"])).toBe("chat");
    expect(flexPane(["rail"])).toBe("rail");
  });

  it("挪位置：放到第几个缝里", () => {
    expect(move(DEFAULT_LAYOUT, "chat", 0).order).toEqual(["chat", "rail", "map"]);
    expect(move(DEFAULT_LAYOUT, "rail", 3).order).toEqual(["map", "chat", "rail"]);
    expect(move(DEFAULT_LAYOUT, "map", 1).order).toEqual(["rail", "map", "chat"]);
  });

  it("挪位置时收起的面板留在原来的相对位置", () => {
    // 地图收起着，把对话挪到项目前面：地图仍跟在项目后面
    const l = move(L(["rail", "map", "chat"], ["map"]), "chat", 0);
    expect(l.order).toEqual(["chat", "rail", "map"]);
    expect(visible(l)).toEqual(["chat", "rail"]);
  });

  it("按指针位置算缝，和原位一样的不算挪", () => {
    const rects = [
      { left: 0, right: 200 },
      { left: 200, right: 800 },
      { left: 800, right: 1200 },
    ];
    expect(slotAt(50, rects)).toBe(0);
    expect(slotAt(150, rects)).toBe(1);
    expect(slotAt(600, rects)).toBe(2);
    expect(slotAt(1100, rects)).toBe(3);
    expect(sameSlot(DEFAULT_LAYOUT, "map", 1)).toBe(true);
    expect(sameSlot(DEFAULT_LAYOUT, "map", 2)).toBe(true);
    expect(sameSlot(DEFAULT_LAYOUT, "map", 0)).toBe(false);
  });

  it("分隔条改的是不占剩下宽度的那个", () => {
    expect(dividerTarget("rail", "map", "map")).toEqual({ pane: "rail", sign: 1 });
    expect(dividerTarget("map", "chat", "map")).toEqual({ pane: "chat", sign: -1 });
    expect(dividerTarget("chat", "rail", "map")).toEqual({ pane: "chat", sign: 1 });
    expect(setWidth(DEFAULT_LAYOUT, "chat", 9999).width.chat).toBe(680);
  });

  it("记下来的布局坏了也能用；全收起的当没收起", () => {
    expect(normalize({ order: ["chat", "chat", "bogus" as never], hidden: ["rail", "map", "chat"] })).toEqual({ order: ["chat", "rail", "map"], hidden: [], width: DEFAULT_LAYOUT.width });
  });

  describe("记在这台电脑上", () => {
    // 单元测试跑在 Node 里，没有 localStorage：放一个最小的
    beforeEach(() => {
      const data = new Map<string, string>();
      globalThis.localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), clear: () => data.clear(), key: () => null, length: 0 } as Storage;
    });
    it("存了再读", () => {
      const l = move(toggle(DEFAULT_LAYOUT, "rail"), "chat", 0);
      saveLayout(l);
      expect(loadLayout()).toEqual(l);
    });
    it("认老版本的 bw.widths", () => {
      localStorage.setItem("bw.widths", JSON.stringify({ rail: 300, panel: 500 }));
      expect(loadLayout().width).toEqual({ rail: 300, map: null, chat: 500 });
    });
  });
});
