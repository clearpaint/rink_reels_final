// frontend/main.js

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── GLOBAL STATE ─────────────────────────────────────────────────────────────
let mainWindow = null;
let backendProcess = null;
let isBackendReady = false;

// ─── ERROR HANDLING ───────────────────────────────────────────────────────────
process.on('uncaughtException', err => console.error('[MAIN][uncaughtException]', err));
process.on('unhandledRejection', err => console.error('[MAIN][unhandledRejection]', err));

// ─── LAUNCH BACKEND EXECUTABLE ─────────────────────────────────────────────────
function launchBackend() {
  const isDev = !app.isPackaged;
  const devExe = path.join(__dirname, 'rink_reels_server', 'rink_reels_server');
  const unpackedBase = path.join(process.resourcesPath, 'app.asar.unpacked');
  const prodExe = path.join(unpackedBase, 'frontend', 'rink_reels_server', 'rink_reels_server');

  const exePath = isDev ? devExe : prodExe;
  console.log('[MAIN] Backend executable path:', exePath);

  if (!fs.existsSync(exePath)) {
    console.error('[MAIN] ERROR: Backend not found at', exePath);
    return;
  }

  try { fs.chmodSync(exePath, 0o755); }
  catch (err) { console.warn('[MAIN] chmod failed:', err.message); }

  backendProcess = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    stdio: 'inherit'
  });

  console.log('[MAIN] Spawned backend, PID=', backendProcess.pid);
  backendProcess.on('error', err => console.error('[MAIN] Backend spawn error:', err));
  backendProcess.on('exit', code => console.log('[MAIN] Backend exited with', code));

  setTimeout(() => {
    isBackendReady = true;
    console.log('[MAIN] Backend ready flag set');
  }, 2000);
}

// ─── CREATE THE MAIN WINDOW ───────────────────────────────────────────────────
function createWindow() {
  console.log('[MAIN] __dirname =', __dirname);
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    title: 'Rink Reels',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const loadingPage = path.join(__dirname, 'loading.html');
  console.log('[MAIN] Loading page:', loadingPage);
  mainWindow.loadFile(loadingPage);

  mainWindow.once('ready-to-show', () => {
    console.log('[MAIN] BrowserWindow ready-to-show');
    mainWindow.show();
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  launchBackend();

  mainWindow.on('closed', () => {
    console.log('[MAIN] mainWindow closed, killing backend if running');
    if (backendProcess) backendProcess.kill();
    mainWindow = null;
  });
}

// ─── IPC HANDLERS ─────────────────────────────────────────────────────────────
ipcMain.handle('check-server-ready', () => isBackendReady);

ipcMain.handle('open-file-dialog', async (e, opts) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Videos', extensions: ['mp4','avi','mov','mkv'] }],
    ...opts
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('open-directory-dialog', async (e, opts) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory','createDirectory'],
    ...opts
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('delete-file', async (e, p) => {
  try {
    fs.unlinkSync(path.normalize(p));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('check-file-exists', (e, p) => fs.existsSync(path.normalize(p)));
ipcMain.handle('get-file-stats',    (e, p) => fs.statSync(path.normalize(p)));
ipcMain.handle('get-file-path',     (e, f) => f.path || null);

// ─── APP LIFECYCLE ───────────────────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  console.log('[MAIN] All windows closed');
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
