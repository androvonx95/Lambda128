/**
 * lambda128 Desktop — Standalone AI Coding IDE
 *
 * Electron main process. Creates the application window and manages
 * the lifecycle. The renderer process loads Monaco Editor + the
 * lambda128 AI extension, providing a clean, dedicated IDE with
 * no extension conflicts.
 */

import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IS_DEV = process.env.NODE_ENV === 'development' || !app.isPackaged;
const APP_NAME = 'lambda128';
const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: APP_NAME,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Needed for filesystem access via preload
    },
    // Use native title bar on Linux for better integration
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  });

  // Load the renderer
  if (IS_DEV) {
    mainWindow.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------------

function buildMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              properties: ['openDirectory'],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow?.webContents.send('workspace:open', result.filePaths[0]);
            }
          },
        },
        {
          label: 'Open Recent',
          role: 'recentDocuments',
          submenu: [
            {
              label: 'Clear Recent',
              role: 'clearRecentDocuments',
            },
          ],
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('editor:save'),
        },
        {
          label: 'Save All',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('editor:saveAll'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('editor:find'),
        },
        {
          label: 'Replace',
          accelerator: 'CmdOrCtrl+H',
          click: () => mainWindow?.webContents.send('editor:replace'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Toggle AI Panel',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow?.webContents.send('panel:toggle'),
        },
        {
          label: 'Toggle File Explorer',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => mainWindow?.webContents.send('explorer:toggle'),
        },
        {
          label: 'Toggle Terminal',
          accelerator: 'CmdOrCtrl+`',
          click: () => mainWindow?.webContents.send('terminal:toggle'),
        },
      ],
    },
    {
      label: 'AI',
      submenu: [
        {
          label: 'Open Chat',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => mainWindow?.webContents.send('ai:openChat'),
        },
        {
          label: 'Start Agent Mode',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => mainWindow?.webContents.send('ai:startAgent'),
        },
        { type: 'separator' },
        {
          label: 'Explain Selected Code',
          click: () => mainWindow?.webContents.send('ai:explainCode'),
        },
        {
          label: 'Fix Selected Code',
          click: () => mainWindow?.webContents.send('ai:fixCode'),
        },
        {
          label: 'Refactor Selected Code',
          click: () => mainWindow?.webContents.send('ai:refactorCode'),
        },
        { type: 'separator' },
        {
          label: 'Open Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('ai:openSettings'),
        },
      ],
    },
    {
      label: 'Terminal',
      submenu: [
        {
          label: 'New Terminal',
          accelerator: 'CmdOrCtrl+Shift+`',
          click: () => mainWindow?.webContents.send('terminal:new'),
        },
        { type: 'separator' },
        {
          label: 'Run Build Task',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => mainWindow?.webContents.send('terminal:build'),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://github.com/androvonx95/Lambda128'),
        },
        {
          label: 'Report Issue',
          click: () =>
            shell.openExternal('https://github.com/androvonx95/Lambda128/issues/new'),
        },
        { type: 'separator' },
        {
          label: `About ${APP_NAME}`,
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: `About ${APP_NAME}`,
              message: `${APP_NAME} v${app.getVersion()}`,
              detail:
                'An agentic AI coding assistant.\n\nBuilt on Code-OSS, inspired by Cursor.',
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

function registerIpcHandlers(): void {
  // File operations
  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, content };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return {
        success: true,
        entries: entries.map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
          isFile: e.isFile(),
          isSymlink: e.isSymbolicLink(),
        })),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs:stat', async (_event, filePath: string) => {
    try {
      const stat = fs.statSync(filePath);
      return {
        success: true,
        size: stat.size,
        mtime: stat.mtimeMs,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs:exists', async (_event, filePath: string) => {
    return fs.existsSync(filePath);
  });

  // Dialog operations
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'TypeScript', extensions: ['ts', 'tsx'] },
        { name: 'JavaScript', extensions: ['js', 'jsx', 'mjs'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'Markdown', extensions: ['md'] },
      ],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, filePath: result.filePaths[0] };
    }
    return { success: false };
  });

  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, folderPath: result.filePaths[0] };
    }
    return { success: false };
  });

  ipcMain.handle('dialog:saveFile', async (_event, defaultPath?: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath,
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'TypeScript', extensions: ['ts', 'tsx'] },
        { name: 'JavaScript', extensions: ['js', 'jsx'] },
      ],
    });
    if (!result.canceled && result.filePath) {
      return { success: true, filePath: result.filePath };
    }
    return { success: false };
  });

  // Shell / terminal
  ipcMain.handle(
    'shell:exec',
    async (_event, command: string, cwd?: string) => {
      try {
        const output = execSync(command, {
          cwd: cwd || process.cwd(),
          encoding: 'utf-8',
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        });
        return { success: true, stdout: output, stderr: '' };
      } catch (err: any) {
        return {
          success: false,
          stdout: err.stdout || '',
          stderr: err.stderr || err.message,
          exitCode: err.status,
        };
      }
    }
  );

  ipcMain.handle('shell:spawn', async (_event, command: string, args: string[], cwd?: string) => {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: cwd || process.cwd(),
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        mainWindow?.webContents.send('terminal:stdout', data.toString());
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        mainWindow?.webContents.send('terminal:stderr', data.toString());
      });

      child.on('close', (code) => {
        resolve({ success: code === 0, stdout, stderr, exitCode: code });
      });

      child.on('error', (err) => {
        resolve({ success: false, stdout, stderr: err.message, exitCode: -1 });
      });
    });
  });

  // App info
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getPath', (_event, name: string) => app.getPath(name as any));
  ipcMain.handle('app:getPlatform', () => process.platform);

  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window:close', () => mainWindow?.close());

  // Settings
  ipcMain.handle('settings:get', (_event, key: string) => {
    // Store settings in Electron's userData directory
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    try {
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        return settings[key];
      }
    } catch {
      // Ignore
    }
    return undefined;
  });

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    try {
      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }
      settings[key] = value;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('settings:getAll', () => {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    try {
      if (fs.existsSync(settingsPath)) {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }
    } catch {
      // Ignore
    }
    return {};
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  buildMenu();
  registerIpcHandlers();
  createWindow();

  // macOS: re-create window when dock icon clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Open folder from command line
  const openPath = process.argv.find((arg) => !arg.startsWith('-') && arg !== process.execPath);
  if (openPath && fs.existsSync(openPath)) {
    mainWindow?.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('workspace:open', openPath);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Focus existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // Open folder from second instance
    const openPath = commandLine.find(
      (arg) => !arg.startsWith('-') && arg !== commandLine[0]
    );
    if (openPath && fs.existsSync(openPath)) {
      mainWindow?.webContents.send('workspace:open', openPath);
    }
  });
}