import { describe, expect, it } from "vitest";
import { DESCRIBE, FIND_SOURCE, relativeSource } from "../../src/browser/describe";
import type { ElementSource } from "../../src/shared";

/** 在 Node 里跑页面里那段认源码位置的代码：元素用普通对象假装 */
const findSource = new Function(`return (${FIND_SOURCE})`)() as (el: unknown) => ElementSource | null;

type Fake = { nodeType: 1; parentElement: Fake | null; getAttribute(name: string): string | null; [k: string]: unknown };
function el(attrs: Record<string, string> = {}, parent: Fake | null = null, extra: Record<string, unknown> = {}): Fake {
  return { nodeType: 1, parentElement: parent, getAttribute: (n: string) => attrs[n] ?? null, ...extra };
}

describe("点选元素：认源码位置（设计稿 9-15）", () => {
  it("“点击跳源码”插件加的属性：file:line:col（Windows 盘符也认）", () => {
    expect(findSource(el({ "data-insp-path": "/home/me/app/src/Login.vue:12:5:div" }))).toMatchObject({ file: "/home/me/app/src/Login.vue", line: 12, column: 5, via: "attr" });
    expect(findSource(el({ "data-v-inspector": "C:/work/app/src/App.vue:3:1" }))).toMatchObject({ file: "C:/work/app/src/App.vue", line: 3, column: 1 });
    // 往上找最近的
    const parent = el({ "data-sentry-source-file": "Header.tsx", "data-sentry-component": "Header" });
    expect(findSource(el({}, parent))).toMatchObject({ file: "Header.tsx", line: null, components: ["Header"] });
  });

  it("React 18：fiber 上的 _debugSource；组件名从外到里取最近三个", () => {
    const Page = function LoginPage() {};
    const Form = function LoginForm() {};
    const root = { type: Page, return: null };
    const form = { type: Form, return: root };
    const host = { type: "button", _debugSource: { fileName: "/home/me/app/src/pages/Login.tsx", lineNumber: 42, columnNumber: 7 }, return: form };
    const s = findSource(el({}, null, { "__reactFiber$abc123": host }));
    expect(s).toEqual({ file: "/home/me/app/src/pages/Login.tsx", line: 42, column: 7, components: ["LoginPage", "LoginForm"], via: "react", approx: false });
  });

  it("React 19：只有创建时的调用栈，跳过 React 自己和依赖，行号算大概", () => {
    const stack = [
      "Error: react-stack-top-frame",
      "    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1a2b:250:30)",
      "    at LoginForm (http://localhost:5173/src/pages/Login.tsx?t=1700000000:42:7)",
      "    at react-stack-bottom-frame (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=1a2b:17424:20)",
    ].join("\n");
    const host = { type: "button", _debugStack: { stack }, return: { type: function LoginForm() {}, return: null } };
    expect(findSource(el({}, null, { "__reactFiber$x": host }))).toEqual({ file: "/src/pages/Login.tsx", line: 42, column: 7, components: ["LoginForm"], via: "react", approx: true });
  });

  it("Vue 3：组件实例上的 __file；Svelte：__svelte_meta；都没有返回空", () => {
    const inst = { type: { __name: "LoginForm", __file: "/home/me/app/src/components/LoginForm.vue" }, parent: { type: { name: "App" }, parent: null } };
    expect(findSource(el({}, null, { __vueParentComponent: inst }))).toMatchObject({ file: "/home/me/app/src/components/LoginForm.vue", components: ["App", "LoginForm"], via: "vue" });
    expect(findSource(el({}, null, { __svelte_meta: { loc: { file: "src/routes/+page.svelte", line: 8, column: 2 } } }))).toMatchObject({ file: "src/routes/+page.svelte", line: 8, via: "svelte" });
    expect(findSource(el())).toBeNull();
  });

  it("写成项目里的相对路径：去掉 Local 或工作区的前缀；Vite 的 /src/… 去掉开头的斜杠", () => {
    const s = (file: string): ElementSource => ({ file, line: 1, column: null, components: [], via: "react", approx: false });
    expect(relativeSource(s("/home/me/app/src/a.tsx"), ["/home/me/app", "/home/me/app/.lanes/wt/r1"]).file).toBe("src/a.tsx");
    expect(relativeSource(s("/home/me/app/.lanes/wt/r1/src/a.tsx"), ["/home/me/app", "/home/me/app/.lanes/wt/r1"]).file).toBe("src/a.tsx");
    expect(relativeSource(s("C:/Work/App/src/a.tsx"), ["c:\\work\\app"]).file).toBe("src/a.tsx");
    expect(relativeSource(s("/src/pages/Login.tsx"), ["/home/me/app"]).file).toBe("src/pages/Login.tsx");
    expect(relativeSource(s("/elsewhere/x.tsx"), ["/home/me/app"]).file).toBe("/elsewhere/x.tsx");
  });

  it("页面里跑的整段代码是合法的 JavaScript", () => {
    expect(() => new Function(`return (${DESCRIBE})`)()).not.toThrow();
  });
});
