import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";

const WINDOW_CLOSE_CHANNEL = "window:close";

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1500,
    height: 1060,
    minWidth: 1180,
    minHeight: 860,
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

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
