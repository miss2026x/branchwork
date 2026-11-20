import path from "node:path";
import type { ElementSource } from "../shared";

/**
 * 点选元素时在页面里跑的代码（设计稿 9-15）。写成字符串交给 Runtime.callFunctionOn，this 就是那个元素；
 * 用 String.raw 写，正则里的反斜杠照原样进页面。不能出现 ${，否则会被当成模板里的插值
 */

/**
 * 认源码位置：开发模式下框架在元素上记着它是哪个文件、哪一行写出来的。认不出返回 null。
 * 先看“点击跳源码”这类插件加的属性（最准），再看 React、Vue、Svelte 自己记的
 */
export const FIND_SOURCE = String.raw`function lanesFindSource(el) {
  var num = function (v) { var n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : null; };
  var clean = function (f) {
    f = String(f || "");
    try {
      if (/^(https?|file):\/\//.test(f)) f = decodeURIComponent(new URL(f).pathname);
    } catch (e) {}
    f = f.replace(/^webpack-internal:\/\/\/(\([^)]*\)\/)?/, "").replace(/^webpack:\/\/[^/]*\//, "").replace(/^\/@fs(?=\/)/, "").replace(/[?#].*$/, "");
    if (/^\/[A-Za-z]:\//.test(f)) f = f.slice(1);
    return f;
  };
  var out = function (file, line, column, components, via, approx) {
    var f = clean(file);
    return f ? { file: f, line: num(line), column: num(column), components: components || [], via: via, approx: !!approx } : null;
  };
  var push = function (list, n) {
    if (n && typeof n === "string" && !/^(Anonymous|_c\d*|Fragment)$/.test(n) && list.indexOf(n) < 0 && list.length < 3) list.unshift(n);
  };

  // 1. 插件加的属性：file:line:col[:tag]
  var ATTRS = ["data-insp-path", "data-v-inspector", "data-inspector-relative-path", "data-locator", "data-source-file", "data-sentry-source-file"];
  for (var e = el, d = 0; e && e.nodeType === 1 && d < 6; e = e.parentElement, d++) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      var v = e.getAttribute(a);
      if (!v) continue;
      if (a === "data-sentry-source-file") return out(v, null, null, e.getAttribute("data-sentry-component") ? [e.getAttribute("data-sentry-component")] : [], "attr");
      if (a === "data-inspector-relative-path") return out(v, e.getAttribute("data-inspector-line"), e.getAttribute("data-inspector-column"), [], "attr");
      if (a === "data-source-file") return out(v, e.getAttribute("data-source-line"), e.getAttribute("data-source-column"), [], "attr");
      var m = /^(.*?):(\d+)(?::(\d+))?(?::[^:/\\]*)?$/.exec(v);
      return m ? out(m[1], m[2], m[3], [], "attr") : out(v, null, null, [], "attr");
    }
  }

  // 2. React：元素上挂着 fiber；React 18 及以前有 _debugSource，React 19 只有创建时的调用栈 _debugStack
  var frame = function (err) {
    var st = (err && (err.stack || String(err))) || "";
    var lines = st.split("\n");
    for (var i = 1; i < lines.length; i++) {
      var m = /((?:https?|file|webpack-internal|webpack):\/\/[^\s()]+?|\/[^\s():]+?):(\d+):(\d+)\)?\s*$/.exec(lines[i]);
      if (!m || /node_modules|\/\.vite\/deps\/|react-dom|react_jsx|jsx-dev-runtime|jsx-runtime|@react-refresh/.test(m[1])) continue;
      return { fileName: m[1], lineNumber: m[2], columnNumber: m[3] };
    }
    return null;
  };
  var fiber = null;
  for (var e2 = el; e2 && !fiber; e2 = e2.parentElement) {
    var keys = Object.keys(e2);
    for (var k = 0; k < keys.length; k++) {
      if (keys[k].indexOf("__reactFiber$") === 0 || keys[k].indexOf("__reactInternalInstance$") === 0) { fiber = e2[keys[k]]; break; }
    }
  }
  if (fiber) {
    var comps = [];
    var src = null;
    var approx = false;
    for (var f = fiber, n = 0; f && n < 80; f = f.return, n++) {
      if (!src && f._debugSource && f._debugSource.fileName) src = f._debugSource;
      if (!src && f._debugStack) { var s = frame(f._debugStack); if (s) { src = s; approx = true; } }
      var t = f.type;
      if (t && typeof t !== "string") push(comps, t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)));
    }
    if (src) return out(src.fileName, src.lineNumber, src.columnNumber, comps, "react", approx);
  }

  // 3. Vue 3：组件实例上的 type.__file；Vue 2：$options.__file
  for (var e3 = el; e3; e3 = e3.parentElement) {
    var inst = e3.__vueParentComponent;
    if (inst) {
      var vc = [];
      var file = "";
      for (var x = inst, j = 0; x && j < 40; x = x.parent, j++) {
        var ty = x.type || {};
        if (!file && ty.__file) file = ty.__file;
        push(vc, ty.name || ty.__name || (ty.__file ? String(ty.__file).split("/").pop().replace(/\.\w+$/, "") : ""));
      }
      if (file) return out(file, null, null, vc, "vue");
    }
    var v2 = e3.__vue__;
    if (v2 && v2.$options && v2.$options.__file) return out(v2.$options.__file, null, null, v2.$options.name ? [v2.$options.name] : [], "vue");
  }

  // 4. Svelte：元素上的 __svelte_meta.loc
  for (var e4 = el, d4 = 0; e4 && d4 < 6; e4 = e4.parentElement, d4++) {
    var meta = e4.__svelte_meta;
    if (meta && meta.loc && meta.loc.file) return out(meta.loc.file, meta.loc.line, meta.loc.column, [], "svelte", true);
  }
  return null;
}`;

/** 描述被点选的元素：位置、大小、样式、文字、HTML、源码位置；最后给它打上 data-lanes-pick 标记 */
export const DESCRIBE = String.raw`function () {
  const el = this.nodeType === 1 ? this : this.parentElement;
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
  const part = (e) => {
    let s = e.tagName.toLowerCase();
    if (e.id) return s + "#" + esc(e.id);
    const cls = [...e.classList].filter((c) => !/^(css|sc|jsx|_)[-_]?[a-z0-9]{4,}$/i.test(c)).slice(0, 2);
    if (cls.length) s += "." + cls.map(esc).join(".");
    return s;
  };
  const chain = [];
  for (let e = el; e && e.nodeType === 1 && e !== document.body && e !== document.documentElement && chain.length < 4; e = e.parentElement) {
    chain.unshift(part(e));
    if (e.id) break;
  }
  if (chain.length === 0) chain.push(part(el));
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const keys = ["display", "position", "width", "height", "margin", "padding", "color", "background-color", "font-size", "font-weight", "line-height", "border", "border-radius", "gap", "justify-content", "align-items", "text-align"];
  const skip = new Set(["none", "normal", "0px", "auto", "rgba(0, 0, 0, 0)", "static", "start"]);
  const styles = keys.map((k) => [k, cs.getPropertyValue(k)]).filter(([, v]) => v && !skip.has(v)).map(([k, v]) => k + ": " + v + ";").join("\n");
  const text = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const tag = el.tagName.toLowerCase();
  const outer = el.outerHTML.replace(/ data-lanes-pick="\d+"/g, "");
  const html = outer.length > 1500 ? outer.slice(0, 1500) + "…" : outer;
  let source = null;
  try {
    source = (FIND_SOURCE)(el);
  } catch (e) {
    source = null;
  }
  // 页面标记：Claude 要看它现在的样子时，用 [data-lanes-pick="N"] 一下找到（刷新后就没了）
  window.__lanesPick = (window.__lanesPick || 0) + 1;
  const mark = String(window.__lanesPick);
  try {
    el.setAttribute("data-lanes-pick", mark);
  } catch (e) {}
  return {
    label: tag + (text ? "「" + text.slice(0, 24) + "」" : ""),
    selector: chain.join(" > "),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    x: Math.round(rect.left + scrollX),
    y: Math.round(rect.top + scrollY),
    styles,
    text,
    html,
    source,
    mark,
  };
}`.replace("(FIND_SOURCE)", () => `(${FIND_SOURCE})`);

/**
 * 源码文件写成项目里的相对路径：去掉 Local 或某一路工作区的前缀（开发服务器跑在哪份代码上都一样）。
 * 认不出前缀的绝对路径原样留着；Vite 给的“/src/…”这种是相对开发服务器根目录的，去掉开头的斜杠
 */
export function relativeSource(source: ElementSource, roots: string[]): ElementSource {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const file = norm(source.file);
  const win = /^[A-Za-z]:\//.test(file);
  // 长的先比：工作区可能放在 Local 里面
  for (const r of roots.filter(Boolean).map(norm).sort((a, b) => b.length - a.length)) {
    const hit = win ? file.toLowerCase().startsWith(r.toLowerCase() + "/") : file.startsWith(r + "/");
    if (hit) return { ...source, file: file.slice(r.length + 1) };
  }
  if (/^\/(src|app|pages|components|lib)\//.test(file)) return { ...source, file: file.slice(1) };
  return { ...source, file: path.isAbsolute(file) || win ? file : file.replace(/^\.\//, "") };
}
