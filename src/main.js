const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { execFile } = require('child_process');
const { analyzeFolders, executeSync } = require('./syncEngine');

// Avoid Windows GPU disk cache file-lock collisions
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');

let mainWindow = null;
let cancelCurrentSync = false;

function getProfilesPath() {
  return path.join(app.getPath('userData'), 'mysync-profiles.json');
}

const DEFAULT_PROFILES = {
  activeJobId: 'job-ftemp-test',
  jobs: [
    {
      id: 'job-ftemp-test',
      name: 'F:\\temp Smart Test Suite',
      leftDir: 'F:\\temp\\SyncTest_Left',
      rightDir: 'F:\\temp\\SyncTest_Right',
      direction: 'left_to_right',
      propagateDeletions: false,
      excludePatterns: ['.git', 'node_modules', '*.tmp', 'Thumbs.db', '.DS_Store'],
    },
  ],
};

async function loadProfiles() {
  const file = getProfilesPath();
  try {
    const raw = await fsp.readFile(file, 'utf-8');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.jobs) && data.jobs.length > 0) {
      return data;
    }
  } catch {
    // Return default
  }
  return DEFAULT_PROFILES;
}

async function saveProfiles(payload) {
  const file = getProfilesPath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(payload, null, 2), 'utf-8');
  return true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1340,
    height: 880,
    minWidth: 960,
    minHeight: 660,
    title: 'MySync — Folder Synchronization Studio',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  ipcMain.handle('dialog:selectFolder', async (_event, defaultPath) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Folder to Synchronize',
      defaultPath: defaultPath && fs.existsSync(defaultPath) ? defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('profiles:load', async () => {
    return loadProfiles();
  });

  ipcMain.handle('profiles:save', async (_event, data) => {
    return saveProfiles(data);
  });

  ipcMain.handle('sync:analyze', async (_event, params) => {
    return analyzeFolders(params);
  });

  ipcMain.handle('sync:execute', async (event, params) => {
    cancelCurrentSync = false;
    return executeSync(
      params,
      (progress) => {
        event.sender.send('sync:progress', progress);
      },
      () => cancelCurrentSync
    );
  });

  ipcMain.handle('sync:cancel', async () => {
    cancelCurrentSync = true;
    return true;
  });

  ipcMain.handle('shell:openPath', async (_event, targetPath) => {
    if (targetPath && fs.existsSync(targetPath)) {
      await shell.openPath(targetPath);
      return true;
    }
    return false;
  });

  ipcMain.handle('shell:showItemInFolder', async (_event, targetPath) => {
    if (!targetPath || !fs.existsSync(targetPath)) {
      return { opened: false, reason: 'missing' };
    }
    const resolved = path.resolve(targetPath);
    const parentDir = path.dirname(resolved);
    const fileName = path.basename(resolved);

    // Check Windows file attributes via `attrib`
    const attrs = await new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve('');
      execFile('attrib.exe', [resolved], { windowsHide: true }, (_err, stdout) => {
        if (!stdout) return resolve('');
        // First ~20 chars before the drive letter contain attribute flags (A, S, H, R, etc.)
        const head = stdout.slice(0, 22);
        resolve(head);
      });
    });

    const isHidden = attrs.includes('H') || fileName.startsWith('.') || /^AlbumArt/i.test(fileName);
    const isSystem = attrs.includes('S') || /^AlbumArt/i.test(fileName);

    if (isHidden || isSystem) {
      // Because Windows Explorer ignores /select for +H +S Protected OS files when
      // "Hide protected operating system files" is enabled, open the parent directory directly!
      await shell.openPath(parentDir);
      return {
        opened: true,
        fallbackParentOpened: true,
        parentDir,
        isHidden,
        isSystem,
      };
    }

    shell.showItemInFolder(resolved);
    return {
      opened: true,
      fallbackParentOpened: false,
      parentDir,
      isHidden: false,
      isSystem: false,
    };
  });

  ipcMain.handle('shell:trashItem', async (_event, targetPath) => {
    if (!targetPath || !fs.existsSync(targetPath)) {
      throw new Error(`File does not exist: ${targetPath}`);
    }
    try {
      await shell.trashItem(path.resolve(targetPath));
    } catch {
      await fsp.unlink(path.resolve(targetPath));
    }
    return true;
  });

  ipcMain.handle('file:readPreview', async (_event, { leftFull, rightFull }) => {
    async function readSide(fullPath) {
      if (!fullPath || !fs.existsSync(fullPath)) return { exists: false };
      const stat = await fsp.stat(fullPath);
      const maxBytes = 64 * 1024;
      const fd = await fsp.open(fullPath, 'r');
      try {
        const buf = Buffer.alloc(Math.min(stat.size, maxBytes));
        const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
        const slice = buf.subarray(0, bytesRead);
        // Check for NUL bytes indicating binary file
        const isBinary = slice.includes(0);
        return {
          exists: true,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          isBinary,
          truncated: stat.size > maxBytes,
          text: isBinary ? null : slice.toString('utf-8'),
        };
      } finally {
        await fd.close();
      }
    }

    const [left, right] = await Promise.all([readSide(leftFull), readSide(rightFull)]);
    return { left, right };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

