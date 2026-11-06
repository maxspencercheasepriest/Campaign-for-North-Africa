// Starts a Cloudflare "quick tunnel" (no account needed) pointing at the local game server
// and resolves with the public https://*.trycloudflare.com link to share with players.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function findCloudflared({ resourcesPath, appPath }) {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const candidates = [
    resourcesPath && path.join(resourcesPath, 'bin', exe), // packaged build
    appPath && path.join(appPath, 'vendor', exe), // dev checkout
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || exe; // fall back to PATH
}

export function startTunnel(binary, localUrl, { timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binary, ['tunnel', '--no-autoupdate', '--url', localUrl], { windowsHide: true });
    } catch (e) {
      reject(e);
      return;
    }
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => done(reject, new Error('Timed out waiting for Cloudflare to hand out a link.')), timeoutMs);
    const scan = (buf) => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) done(resolve, { url: m[0], stop: () => child.kill() });
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    child.on('error', (e) => done(reject, e.code === 'ENOENT' ? new Error('cloudflared was not found. The installer bundles it; in a dev checkout run "npm run fetch-cloudflared" or install it on PATH.') : e));
    child.on('exit', (code) => done(reject, new Error(`cloudflared exited (code ${code}) before giving a link.`)));
  });
}
