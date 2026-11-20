import { describe, expect, it } from "vitest";
import { browserBriefText } from "../../src/browser/brief";
import type { BrowserState } from "../../src/shared";

const dev = (ports: number[], command = "pnpm dev") => ({ command, ports });

describe("发车时附上的浏览器说明（设计稿 9-15）", () => {
  it("没开窗口、也没有开发服务器：什么都不附", () => {
    expect(browserBriefText({ local: false, mine: [], inLocal: [dev([])] })).toBeNull();
  });

  it("这一路自己没起：写出 Local 的地址，提醒它这一站的改动 Local 还看不到", () => {
    const t = browserBriefText({ local: false, mine: [], inLocal: [dev([5176, 3000])] })!;
    expect(t).toContain("Local 的（用户项目文件夹里的代码");
    expect(t).toContain("http://localhost:5176、http://localhost:3000  ← pnpm dev");
    expect(t).toContain("用 terminal_start 在这一路的工作区里另起一个");
    expect(t).not.toContain("这一路自己的");
  });

  it("两边都有：分两组写，说明看自己的改动用哪个", () => {
    const t = browserBriefText({ local: false, mine: [dev([5180])], inLocal: [dev([5176])] })!;
    expect(t.indexOf("这一路自己的")).toBeLessThan(t.indexOf("Local 的"));
    expect(t).toContain("要看自己的改动，用上面这一路自己的");
  });

  it("Local 专车：只有一组；开着窗口时接着写页面和报错", () => {
    const state: BrowserState = { routeId: "l", open: true, url: "http://localhost:5176/", title: "首页", pages: [{ url: "http://localhost:5176/", title: "首页", active: true }], issues: [{ id: "i1", kind: "error", text: "boom", source: "", at: 1 }], picking: false, lastUrl: null, error: null };
    const t = browserBriefText({ local: true, mine: [dev([5176])], inLocal: [dev([9999])], state })!;
    expect(t).toContain("Local 里的（就是你现在改的这份代码）");
    expect(t).not.toContain("9999");
    expect(t).toContain("1. 首页 · http://localhost:5176/（当前）");
    expect(t).toContain("报错 boom");
  });
});
