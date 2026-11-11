import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClaudeClient, createDemoClaudeClient } from "../claude";
import { createCore } from "../core";
import { openDb } from "../db";
import { registerIpc } from "./ipc";

// 开发时和命令行工具共用一份数据（~/.branchwork-dev），这样两边看到的是同一批项目和路；
// 打包后的正式版用系统给应用分配的数据目录
const home = process.env.BRANCHWORK_HOME ?? (app.isPackaged ? app.getPath("userData") : path.join(os.homedir(), ".branchwork-dev"));
fs.mkdirSync(home, { recursive: true });

const db = openDb(path.join(home, "bw.sqlite"));
// BRANCHWORK_DEMO=1：用假的 Claude（不联网、不用登录），其余全是真的——真的建工作区、真的同步
const demo = process.env.BRANCHWORK_DEMO === "1";
const core = createCore({ db, claude: demo ? createDemoClaudeClient() : createClaudeClient(), worktreesRoot: path.join(home, "worktrees") });

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: "#EEF1F4",
    title: demo ? "Branchwork（演示模式）" : "Branchwork",
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

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
}

void app.whenReady().then(() => {
  registerIpc(core);
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
  db.close();
});
