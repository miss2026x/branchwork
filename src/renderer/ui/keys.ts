/** 快捷键怎么写：Mac 上是 ⌘，别处是 Ctrl */
export const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";
/** 发车之类“Ctrl/⌘ + 回车”的提示 */
export const SUBMIT_KEYS = isMac ? "⌘↵" : "Ctrl ↵";
