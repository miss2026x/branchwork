import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClaudeClient, createDemoClaudeClient } from "../claude";
import { BRANCHWORK_BRIEFING, createCore } from "../core";
import { openDb } from "../db";
import { createExtras } from "./extras";
import { registerIpc } from "./ipc";

// 开发时和命令行工具共用一份数据（~/.branchwork-dev），这样两边看到的是同一批项目和路；
// 打包后的正式版用系统给应用分配的数据目录
// 正式版的数据目录固定叫 Branchwork（改名叫 Lanes 之前就在这里），不跟着应用名走，免得改名后找不到原来的项目和对话
const home = process.env.BRANCHWORK_HOME ?? (app.isPackaged ? path.join(app.getPath("appData"), "Branchwork") : path.join(os.homedir(), ".branchwork-dev"));
fs.mkdirSync(home, { recursive: true });
// 指定了数据目录（测试、并排开两份）时，界面记住的东西（栏宽、提示看过没有）也放进去，不和别的实例混在一起
if (process.env.BRANCHWORK_HOME) app.setPath("userData", path.join(home, "chromium"));

const db = openDb(path.join(home, "bw.sqlite"));
// BRANCHWORK_DEMO=1：用假的 Claude（不联网、不用登录），其余全是真的——真的建工作区、真的同步
const demo = process.env.BRANCHWORK_DEMO === "1";
/**
 * 打包之后 Claude Code 程序本体在哪。
 * 它随 SDK 的平台包一起装进来，打包时被放到 app.asar.unpacked（压缩包里的程序没法直接启动）。
 * 开发时返回空，让 SDK 自己找。
 */
function packagedClaude(): string | undefined {
  if (!app.isPackaged) return undefined;
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const base = path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "@anthropic-ai");
  const names = [`claude-agent-sdk-${process.platform}-${process.arch}`, `claude-agent-sdk-${process.platform}-${process.arch}-musl`];
  return names.map((n) => path.join(base, n, exe)).find((p) => fs.existsSync(p));
}

const claude = demo ? createDemoClaudeClient() : createClaudeClient(undefined, { appendSystemPrompt: BRANCHWORK_BRIEFING, claudeExecutable: packagedClaude() });
// MCP 服务和内置浏览器（设计稿 9-12、9-13）
const extras = createExtras(db, claude, home);
const core = createCore({
  db,
  claude,
  worktreesRoot: path.join(home, "worktrees"),
  extras: extras.coreExtras,
});

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: "#EEF1F4",
    title: demo ? "Lanes（演示模式）" : "Lanes",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      // 界面不能直接碰 Node：只能通过 preload 暴露的 window.bw
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 界面里的链接不在应用窗口里打开
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  // 答完时任务栏图标闪过；回到窗口就停
  win.on("focus", () => win.flashFrame(false));

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
}

// Windows 上系统通知要认得出是哪个应用：和安装包的 appId 一样
if (process.platform === "win32") app.setAppUserModelId("app.branchwork.desktop");

void app.whenReady().then(async () => {
  // 先把浏览器代理开好：各路的 Claude 启动时要知道连到哪里（Chrome 本身等第一次要用时才启动）
  await extras.hub.start().catch((e: unknown) => console.error("[browser] 代理没开起来：", e));
  registerIpc(core, extras);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  core.dispose(); // 关掉提前启动好的 Claude
  void extras.hub.dispose(); // 关掉专用的 Chrome
  db.close();
});
