import { BrowserWindow, dialog, ipcMain } from "electron";
import type { Core } from "../core";
import type { BwApi } from "../shared";

/** 界面能调用的操作，除了 onEvent（事件走单独的通道） */
type Calls = Omit<BwApi, "onEvent">;

/** 两个通道的名字。preload 里有一份同样的；它在沙箱里运行，不能引用这个文件 */
export const CALL = "bw:call";
export const EVENT = "bw:event";

/** 把 core 接到界面上：window.bw 的唯一实现 */
export function registerIpc(core: Core): void {
  const calls: Calls = {
    listProjects: async () => core.listProjects(),
    snapshot: async (projectId) => core.snapshot(projectId),
    addProject: (localDir) => core.addProject(localDir),
    createRoute: (projectId, name) => core.createRoute(projectId, name),
    history: (routeId) => core.history(routeId),
    syncLog: async (routeId) => core.syncLog(routeId),
    stop: async (routeId) => core.stop(routeId),
    answerPermission: async (requestId, decision) => core.answerPermission(requestId, decision),
    warm: async (routeId) => core.warm(routeId),

    async pickDirectory() {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const r = win ? await dialog.showOpenDialog(win, { title: "选择项目目录", properties: ["openDirectory"] }) : await dialog.showOpenDialog({ properties: ["openDirectory"] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },

    async ask(routeId, text) {
      // 发出即返回，过程走事件。但“现在不能问”（正在回答、有冲突）这类错误是立刻就有的，要报给界面
      const running = core.ask(routeId, text);
      const early = await Promise.race([running.then(() => null, (e: unknown) => e), new Promise<null>((r) => setImmediate(() => r(null)))]);
      if (early) throw early;
      running.catch((e: unknown) => console.error("[bw] 问一站时出错：", e));
    },
  };

  ipcMain.handle(CALL, (_e, method: keyof Calls, args: unknown[]) => {
    if (!Object.hasOwn(calls, method)) throw new Error(`没有这个操作：${String(method)}`);
    return (calls[method] as (...a: unknown[]) => unknown)(...args);
  });

  core.on((event) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(EVENT, event);
  });
}
