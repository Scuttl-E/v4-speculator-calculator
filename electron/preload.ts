import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopWindow", {
  close: () => ipcRenderer.send("window:close"),
});
