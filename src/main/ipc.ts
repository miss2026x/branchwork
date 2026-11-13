import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { Core } from "../core";
import type { BwApi } from "../shared";

/** 界面能调用的操作，除了 onEvent（事件走单独的通道） */
type Calls = Omit<BwApi, "onEvent">;

/** 两个通道的名字。preload 里有一份同样的；它在沙箱里运行，不能引用这个文件 */
export const CALL = "bw:call";
export const EVENT = "bw:event";

/** 把 core 接到界面上：window.bw 的唯一实现 */
/**
 * 发出即返回，过程走事件。但“现在不能做”（正在回答、有冲突）这类错误是立刻就有的，要报给界面：
 * 等一拍，这一拍里已经失败的就抛出去，否则放它在后台跑。
 */
async function fire(running: Promise<unknown>): Promise<void> {
  const early = await Promise.race([running.then(() => null, (e: unknown) => e), new Promise<null>((r) => setImmediate(() => r(null)))]);
  if (early) throw early;
  running.catch((e: unknown) => console.error("[bw] 后台操作出错：", e));
}

export function registerIpc(core: Core): void {
  const calls: Calls = {
    listProjects: async () => core.listProjects(),
    snapshot: async (projectId) => core.snapshot(projectId),
    setPermissionMode: async (projectId, mode) => core.setPermissionMode(projectId, mode),
    addProject: (localDir, name) => core.addProject(localDir, name),
    inspectDirectory: (dir) => core.inspectDirectory(dir),
    projectLog: async (projectId) => core.projectLog(projectId),
    async openLocal(projectId) {
      const project = core.listProjects().find((p) => p.id === projectId);
      if (project) await shell.openPath(project.localDir);
    },
    createRoute: (projectId, name) => core.createRoute(projectId, name),
    renameRoute: async (routeId, name) => core.renameRoute(routeId, name),
    setRouteColor: async (routeId, color) => core.setRouteColor(routeId, color),
    renameStop: async (stopId, name) => void core.renameStop(stopId, name),
    setRouteModel: async (routeId, model) => core.setRouteModel(routeId, model),
    changes: (routeId) => core.changes(routeId),
    terminals: async (projectId) => core.terminals(projectId),
    terminalOutput: async (terminalId) => core.terminalOutput(terminalId),
    terminalStop: (terminalId) => core.terminalStop(terminalId),
    history: (routeId) => core.history(routeId),
    syncLog: async (routeId) => core.syncLog(routeId),
    stop: async (routeId) => core.stop(routeId),
    answerPermission: async (requestId, decision) => core.answerPermission(requestId, decision),
    warm: async (routeId) => core.warm(routeId),

    fork: (routeId, stopId, name) => core.fork(routeId, stopId, name),
    distill: (routeId, stopId, keep) => core.distill(routeId, stopId, keep),
    cancelDistill: async (routeId) => core.cancelDistill(routeId),
    createExpress: (routeId, stopId, summary, name) => core.createExpress(routeId, stopId, summary, name),
    queueAdd: async (projectId, text, routeId, mode) => core.queueAdd(projectId, text, routeId, mode),
    queueAssign: async (itemId, routeId, mode) => core.queueAssign(itemId, routeId, mode),
    queueRemove: async (itemId) => core.queueRemove(itemId),
    queueBoard: (itemId) => fire(core.queueBoard(itemId)),
    queueStartNew: (itemId) => core.queueStartNew(itemId),
    archiveRoute: async (routeId) => core.archiveRoute(routeId),
    unarchiveRoute: async (routeId) => core.unarchiveRoute(routeId),
    deleteRoute: (routeId, force) => core.deleteRoute(routeId, force),
    resync: async (routeId) => void (await core.resync(routeId)),
    resolveConflict: (routeId) => fire(core.resolveConflict(routeId)),

    async pickDirectory() {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const r = win ? await dialog.showOpenDialog(win, { title: "选择项目目录", properties: ["openDirectory"] }) : await dialog.showOpenDialog({ properties: ["openDirectory"] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },

    ask: (routeId, text) => fire(core.ask(routeId, text)),
  };

  ipcMain.handle(CALL, (_e, method: keyof Calls, args: unknown[]) => {
    if (!Object.hasOwn(calls, method)) throw new Error(`没有这个操作：${String(method)}`);
    return (calls[method] as (...a: unknown[]) => unknown)(...args);
  });

  core.on((event) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(EVENT, event);
  });
}
