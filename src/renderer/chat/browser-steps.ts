import { BROWSER_SERVER, splitMcpTool, type ChatItem } from "../../shared";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/** 内置浏览器的工具（mcp__browser__…） */
export const isBrowserTool = (name: string) => splitMcpTool(name)?.[0] === BROWSER_SERVER;
/** 别的 MCP 服务的工具 */
export const isOtherMcpTool = (name: string) => {
  const s = splitMcpTool(name);
  return !!s && s[0] !== BROWSER_SERVER && s[0] !== "branchwork";
};

const VERBS: Record<string, string> = {
  navigate_page: "跳转",
  new_page: "新开",
  select_page: "切到",
  close_page: "关掉",
  list_pages: "看页面",
  click: "点击",
  click_at: "点击",
  fill: "输入",
  fill_form: "填表",
  type_text: "输入",
  hover: "悬停",
  press_key: "按键",
  drag: "拖动",
  upload_file: "上传",
  handle_dialog: "弹窗",
  wait_for: "等待",
  take_screenshot: "截图",
  take_snapshot: "读页面",
  list_console_messages: "控制台",
  get_console_message: "看报错",
  list_network_requests: "网络",
  get_network_request: "看请求",
  evaluate_script: "运行",
  emulate: "模拟",
  resize_page: "改大小",
  performance_start_trace: "录性能",
  performance_stop_trace: "停录",
  performance_analyze_insight: "分析",
  lighthouse_audit: "检查",
  take_heapsnapshot: "内存",
  get_css_styles: "看样式",
  set_logpoints: "日志点",
  screencast_start: "录屏",
  screencast_stop: "停录屏",
  configure_webauthn: "通行密钥",
};

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v));

/** 浏览器的一步：动词和对象（“点击 · 元素 1_8”、“跳转 · /login”） */
export function browserStep(t: ToolItem): { verb: string; object: string } {
  const name = splitMcpTool(t.tool)?.[1] ?? t.tool;
  const i = t.input ?? {};
  const verb = VERBS[name] ?? name;
  let object = "";
  switch (name) {
    case "navigate_page":
      object = i.type === "back" ? "后退" : i.type === "forward" ? "前进" : i.type === "reload" ? "刷新" : str(i.url);
      break;
    case "new_page":
      object = str(i.url);
      break;
    case "fill":
    case "type_text":
      object = str(i.value ?? i.text);
      break;
    case "press_key":
      object = str(i.key);
      break;
    case "wait_for":
      object = Array.isArray(i.text) ? i.text.map(str).join("、") : str(i.text);
      break;
    case "evaluate_script":
      object = str(i.function ?? i.sourcePath).replace(/\s+/g, " ");
      break;
    case "emulate":
      object = Object.entries(i)
        .filter(([k]) => k !== "pageId")
        .map(([k, v]) => `${k}: ${str(v)}`)
        .join("，");
      break;
    case "resize_page":
      object = `${str(i.width)} × ${str(i.height)}`;
      break;
    case "click_at":
      object = `(${str(i.x)}, ${str(i.y)})`;
      break;
    case "upload_file":
      object = Array.isArray(i.filePaths) ? i.filePaths.map(str).join("、") : "";
      break;
    case "take_screenshot":
      object = i.fullPage ? "整页" : "看得到的部分";
      break;
    default:
      object = i.uid ? `元素 ${str(i.uid)}` : t.detail;
  }
  return { verb, object };
}

/** 一组浏览器操作现在在哪一页：最后一次跳转或新开的网址 */
export function lastUrl(tools: ToolItem[]): string {
  for (const t of [...tools].reverse()) {
    const name = splitMcpTool(t.tool)?.[1];
    const url = t.input?.url;
    if ((name === "navigate_page" || name === "new_page") && typeof url === "string") return url;
  }
  return "";
}

/** 网址只留路径（同一个开发服务器下，主机名没有信息量） */
export function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol.startsWith("http") ? u.pathname + u.search || "/" : url;
  } catch {
    return url;
  }
}

/** Claude 正在跑的浏览器工具 → 一句话（“点击「登录」”这类，给浏览器条用） */
export function browserDoing(tool: string, detail: string): string | null {
  if (!isBrowserTool(tool)) return null;
  const name = splitMcpTool(tool)![1];
  return `${VERBS[name] ?? name}${detail ? ` ${detail}` : ""}`;
}
