import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopWindow", {
  close: () => ipcRenderer.send("window:close"),
  loadInputs: () => ipcRenderer.invoke("inputs:load"),
  saveInputs: (inputs: unknown) => ipcRenderer.invoke("inputs:save", inputs),
  openExternal: (target: string) => ipcRenderer.invoke("open:external", target),
});
