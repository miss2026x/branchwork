import { contextBridge, ipcRenderer } from "electron";
import type { BwApi, BwEvent, BwListener } from "../shared";

// 和 src/main/ipc.ts 里的名字一致。这个文件在沙箱里运行，只能引用 electron，所以各写一份
const CALL = "bw:call";
const EVENT = "bw:event";

const call =
  <K extends keyof BwApi>(method: K) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(CALL, method, args);

/** 界面能看到的只有这个对象。没有 Node，没有 ipcRenderer 本身 */
const api: BwApi = {
  listProjects: call("listProjects"),
  pickDirectory: call("pickDirectory"),
  addProject: call("addProject"),
  snapshot: call("snapshot"),
  setPermissionMode: call("setPermissionMode"),
  createRoute: call("createRoute"),
  renameRoute: call("renameRoute"),
  setRouteColor: call("setRouteColor"),
  renameStop: call("renameStop"),
  setRouteModel: call("setRouteModel"),
  changes: call("changes"),
  terminals: call("terminals"),
  terminalOutput: call("terminalOutput"),
  terminalStop: call("terminalStop"),
  ask: call("ask"),
  fork: call("fork"),
  distill: call("distill"),
  cancelDistill: call("cancelDistill"),
  createExpress: call("createExpress"),
  queueAdd: call("queueAdd"),
  queueAssign: call("queueAssign"),
  queueRemove: call("queueRemove"),
  queueBoard: call("queueBoard"),
  queueStartNew: call("queueStartNew"),
  archiveRoute: call("archiveRoute"),
  unarchiveRoute: call("unarchiveRoute"),
  deleteRoute: call("deleteRoute"),
  resolveConflict: call("resolveConflict"),
  resync: call("resync"),
  stop: call("stop"),
  answerPermission: call("answerPermission"),
  history: call("history"),
  syncLog: call("syncLog"),
  warm: call("warm"),
  onEvent(listener: BwListener) {
    const handler = (_e: unknown, event: BwEvent) => listener(event);
    ipcRenderer.on(EVENT, handler);
    return () => ipcRenderer.removeListener(EVENT, handler);
  },
};

contextBridge.exposeInMainWorld("bw", api);
