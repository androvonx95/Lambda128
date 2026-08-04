/**
 * Preload script for lambda128 Desktop.
 *
 * Exposes a safe, typed API to the renderer process via contextBridge.
 * The renderer uses this to interact with the filesystem, terminal,
 * dialogs, and settings — all mediated through the main process.
 */

import { contextBridge, ipcRenderer } from 'electron';

// ---------------------------------------------------------------------------
// Type definitions for the exposed API
// ---------------------------------------------------------------------------

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

export interface FileStat {
  size: number;
  mtime: number;
  isDirectory: boolean;
  isFile: boolean;
}

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
}

export interface SpawnResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface Lambda128API {
  // File operations
  readFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }>;
  writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }>;
  readDir(dirPath: string): Promise<{ success: boolean; entries?: FileEntry[]; error?: string }>;
  stat(filePath: string): Promise<{ success: boolean } & Partial<FileStat> & { error?: string }>;
  exists(filePath: string): Promise<boolean>;

  // Dialogs
  openFile(): Promise<{ success: boolean; filePath?: string }>;
  openFolder(): Promise<{ success: boolean; folderPath?: string }>;
  saveFile(defaultPath?: string): Promise<{ success: boolean; filePath?: string }>;

  // Shell / terminal
  exec(command: string, cwd?: string): Promise<ExecResult>;
  spawn(command: string, args: string[], cwd?: string): Promise<SpawnResult>;

  // App info
  getVersion(): Promise<string>;
  getPath(name: string): Promise<string>;
  getPlatform(): Promise<string>;

  // Window controls
  minimize(): void;
  maximize(): void;
  close(): void;

  // Settings
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<boolean>;
  getAllSettings(): Promise<Record<string, unknown>>;

  // Event listeners (renderer → main)
  on(channel: string, callback: (...args: unknown[]) => void): void;
  off(channel: string, callback: (...args: unknown[]) => void): void;
}

// ---------------------------------------------------------------------------
// Expose API to renderer
// ---------------------------------------------------------------------------

const api: Lambda128API = {
  // File operations
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
  stat: (filePath: string) => ipcRenderer.invoke('fs:stat', filePath),
  exists: (filePath: string) => ipcRenderer.invoke('fs:exists', filePath),

  // Dialogs
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  saveFile: (defaultPath?: string) => ipcRenderer.invoke('dialog:saveFile', defaultPath),

  // Shell / terminal
  exec: (command: string, cwd?: string) => ipcRenderer.invoke('shell:exec', command, cwd),
  spawn: (command: string, args: string[], cwd?: string) =>
    ipcRenderer.invoke('shell:spawn', command, args, cwd),

  // App info
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  getAllSettings: () => ipcRenderer.invoke('settings:getAll'),

  // Event listeners
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args);
    ipcRenderer.on(channel, subscription);
    // Store for cleanup
    (api as any).__listeners = (api as any).__listeners || new Map();
    (api as any).__listeners.set(callback, { channel, subscription });
  },
  off: (channel: string, callback: (...args: unknown[]) => void) => {
    const listeners = (api as any).__listeners;
    if (listeners?.has(callback)) {
      const { subscription } = listeners.get(callback);
      ipcRenderer.removeListener(channel, subscription);
      listeners.delete(callback);
    }
  },
};

contextBridge.exposeInMainWorld('lambda128', api);
