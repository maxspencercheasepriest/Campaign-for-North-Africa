import { app, BrowserWindow, ipcMain, shell, clipboard } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/server.js';
import { findCloudflared, startTunnel } from './tunnel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let win;
let hosting = null; // { server, tunnel }

const savesDir = () => path.join(app.getPath('userData'), 'saves');

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#1d1a14',
    title: 'Desert Command',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(here, '..', 'launcher', 'index.html'));
  // Open external links in the real browser rather than inside the game window.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

// Only the bundled launcher page may start hosting or touch saves — not a remote game page.
const fromLauncher = (e) => e.senderFrame?.url?.startsWith('file://');
const guarded = (fn) => (e, ...args) => {
  if (!fromLauncher(e)) throw new Error('Not allowed from this page.');
  return fn(e, ...args);
};

ipcMain.handle('saves:list', guarded(() => {
  fs.mkdirSync(savesDir(), { recursive: true });
  return fs.readdirSync(savesDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: f.replace(/\.json$/, ''), modified: fs.statSync(path.join(savesDir(), f)).mtimeMs }))
    .sort((a, b) => b.modified - a.modified);
}));

ipcMain.handle('host:start', guarded(async (_e, { campaign, useTunnel }) => {
  await stopHosting();
  const safe = String(campaign || 'campaign').replace(/[^\w\- ]+/g, '').trim() || 'campaign';
  const server = await startServer({ port: 0, savePath: path.join(savesDir(), `${safe}.json`) });
  hosting = { server, tunnel: null };
  let publicUrl = null;
  let tunnelError = null;
  if (useTunnel) {
    try {
      const bin = findCloudflared({ resourcesPath: process.resourcesPath, appPath: app.getAppPath() });
      hosting.tunnel = await startTunnel(bin, server.url);
      publicUrl = hosting.tunnel.url;
    } catch (e) {
      tunnelError = e.message;
    }
  }
  return { localUrl: server.url, publicUrl, tunnelError, hostToken: server.hostToken };
}));

ipcMain.handle('host:open', guarded((_e, { localUrl, hostToken, publicUrl }) => {
  const q = new URLSearchParams({ host: hostToken });
  if (publicUrl) q.set('invite', publicUrl);
  win.loadURL(`${localUrl}/?${q}`);
}));

ipcMain.handle('join:open', guarded((_e, url) => {
  let u;
  try { u = new URL(url.trim()); } catch { return 'That does not look like a link.'; }
  if (!/^https?:$/.test(u.protocol)) return 'Links must start with https://';
  win.loadURL(u.origin + '/');
  return null;
}));

ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text)));
ipcMain.handle('app:launcher', async () => {
  await stopHosting();
  win.loadFile(path.join(here, '..', 'launcher', 'index.html'));
});

async function stopHosting() {
  if (!hosting) return;
  hosting.tunnel?.stop();
  await hosting.server.close();
  hosting = null;
}

app.whenReady().then(createWindow);
app.on('window-all-closed', async () => {
  await stopHosting();
  app.quit();
});
