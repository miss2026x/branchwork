import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, PRESETS, applyPreset, canHide, dividerTarget, edgeHidden, flexPane, hiddenBetween, isPreset, loadLayout, move, moveTo, normalize, sameSlot, saveLayout, setWidth, slotAt, targetWidths, toggle, visible, type Layout } from "../../src/renderer/app/layout";

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

describe("面板布局：布局小窗和收起", () => {
  it("在整条顺序里挪（收起的也算位置）", () => {
    expect(moveTo(DEFAULT_LAYOUT, "chat", 0).order).toEqual(["chat", "rail", "map"]);
    expect(moveTo(DEFAULT_LAYOUT, "rail", 2).order).toEqual(["map", "chat", "rail"]);
  });
  it("两个面板中间夹着的收起的面板；贴在窗口两边的收起的面板", () => {
    const l = toggle(DEFAULT_LAYOUT, "map");
    expect(hiddenBetween(l, "rail", "chat")).toEqual(["map"]);
    expect(edgeHidden(l)).toEqual({ left: [], right: [] });
    const r = toggle(toggle(DEFAULT_LAYOUT, "rail"), "chat");
    expect(edgeHidden(r)).toEqual({ left: ["rail"], right: ["chat"] });
  });
  it("常用排列", () => {
    expect(PRESETS.filter((p) => isPreset(DEFAULT_LAYOUT, p)).map((p) => p.label)).toEqual(["项目｜地图｜对话"]);
    const chatOnly = applyPreset(DEFAULT_LAYOUT, PRESETS[3]!);
    expect(visible(chatOnly)).toEqual(["chat"]);
    expect(isPreset(chatOnly, PRESETS[3]!)).toBe(true);
  });
  it("动画的目标宽度：占剩下宽度的拿走其余的", () => {
    expect(targetWidths(["rail", "map", "chat"], "map", (id) => (id === "rail" ? 264 : 420), 1440)).toEqual({ rail: 264, chat: 420, map: 1440 - 264 - 420 - 2 });
    expect(targetWidths(["rail", "chat"], "chat", () => 264, 1000)).toEqual({ rail: 264, chat: 1000 - 264 - 1 });
  });
});
