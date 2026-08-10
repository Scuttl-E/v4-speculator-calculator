import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

const WINDOW_CLOSE_CHANNEL = "window:close";
const INPUTS_LOAD_CHANNEL = "inputs:load";
const INPUTS_SAVE_CHANNEL = "inputs:save";
const OPEN_EXTERNAL_CHANNEL = "open:external";

const inputsPath = () => path.join(app.getPath("userData"), "calculator-inputs.json");

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1830,
    height: 1320,
    minWidth: 1400,
    minHeight: 1100,
    frame: false,
    backgroundColor: "#1f2022",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged)
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  else win.loadURL("http://localhost:5173");
};

ipcMain.on(WINDOW_CLOSE_CHANNEL, (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle(INPUTS_LOAD_CHANNEL, async () => {
  try {
    return JSON.parse(await readFile(inputsPath(), "utf8"));
  } catch {
    return null;
  }
});

ipcMain.handle(INPUTS_SAVE_CHANNEL, async (_event, inputs: unknown) => {
  await writeFile(inputsPath(), JSON.stringify(inputs), "utf8");
});

ipcMain.handle(OPEN_EXTERNAL_CHANNEL, async (_event, target: unknown) => {
  if (typeof target !== "string" || !target.startsWith("https://"))
    throw new Error("Only HTTPS links can be opened externally");
  await shell.openExternal(target);
});

app.whenReady().then(createWindow);
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
