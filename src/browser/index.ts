/** Lanes 内置的浏览器（设计稿 9-12）：专用 Chrome、每路一个窗口、给每一路的 chrome-devtools-mcp 只看自己窗口的代理。本模块唯一的对外入口 */
export { createBrowserHub, type BrowserHub, type BrowserHubOptions } from "./hub";
export { findChrome } from "./chrome";
