const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

// Configure app for better file handling
app.allowRendererProcessReuse = true;

// Security note: These switches reduce security - only use in development
if (process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('disable-web-security');
  app.commandLine.appendSwitch('allow-file-access-from-files');
  app.commandLine.appendSwitch('disable-site-isolation-trials');
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,  // Disabled for security
      contextIsolation: true,   // CHANGED to 'true' so contextBridge works
      enableRemoteModule: false,  // Disabled for security
      sandbox: false,  // (You can set to 'true' if you want deeper sandboxing)
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: process.platform === 'linux'
        ? ['--no-sandbox', '--disable-setuid-sandbox']
        : []
    }
  });

  // Load the index.html file
  mainWindow.loadFile(path.join(__dirname, 'parent.html'));
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Handle permissions
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      // Only allow these specific permissions
      const allowedPermissions = ['fullscreen', 'pointerLock'];
      callback(allowedPermissions.includes(permission));
    }
  );

  // Window event listeners
  mainWindow.on('closed', () => (mainWindow = null));
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDesc) => {
    console.error('Failed to load:', errorDesc);
  });
}

// App event listeners
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('check-file-exists', (event, filePath) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const normalizedPath = path.normalize(filePath);
    return fs.existsSync(normalizedPath);
  } catch (error) {
    console.error('File existence check failed:', error);
    return false;
  }
});

ipcMain.handle('open-file-dialog', async (event, options) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'avi', 'mov', 'mkv'] }],
      ...options
    });
    return result.canceled ? null : result.filePaths[0];
  } catch (error) {
    console.error('File dialog error:', error);
    return null;
  }
});

ipcMain.handle('open-files-dialog', async (event, options = {}) => {
  try {
    const dialogOpts = {
      properties: ['openFile', 'multiSelections', ...(options.properties || [])],
      filters: options.filters || [{ name: 'Videos', extensions: ['mp4','avi','mov','mkv'] }]
    };
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, dialogOpts);
    return canceled ? [] : filePaths;   // always return an array
  } catch (err) {
    console.error('Multi-file dialog error:', err);
    return [];
  }
});

ipcMain.handle('get-file-stats', (event, filePath) => {
  const fs = require('fs');
  return fs.statSync(filePath);
});

// Optional: Add handler for getting file path from file object
ipcMain.handle('get-file-path', (event, fileObject) => {
  return fileObject.path || null;
});

ipcMain.handle('open-directory-dialog', async (event, options) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      ...options
    });
    return result.canceled ? null : result.filePaths[0];
  } catch (error) {
    console.error('Directory dialog error:', error);
    return null;
  }
});

// NEW: Delete a file on disk
ipcMain.handle('delete-file', async (event, filePath) => {
  console.log("[MAIN] delete-file called with:", filePath);
  if (!filePath) {
    return { success: false, error: "No path specified." };
  }
  const fs = require('fs');
  const normalizedPath = path.normalize(filePath);

  try {
    fs.unlinkSync(normalizedPath);
    console.log("[MAIN] File deleted successfully:", normalizedPath);
    return { success: true };
  } catch (err) {
    console.error("[MAIN] Error deleting file:", err);
    return { success: false, error: err.message };
  }
});
