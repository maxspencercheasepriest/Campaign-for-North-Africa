// Downloads the Windows cloudflared binary into vendor/ so electron-builder can bundle it.
// Run before `npm run dist` (CI does this automatically).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'cloudflared.exe');

fs.mkdirSync(path.dirname(out), { recursive: true });
const res = await fetch(SOURCE, { redirect: 'follow' });
if (!res.ok) throw new Error(`Download failed: ${res.status}`);
fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
console.log(`Saved ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
