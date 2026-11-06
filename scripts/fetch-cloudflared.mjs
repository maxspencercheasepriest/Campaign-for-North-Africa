// Downloads the cloudflared binary into vendor/ so electron-builder can bundle it.
//   node scripts/fetch-cloudflared.mjs        -> Windows (cloudflared.exe)
//   node scripts/fetch-cloudflared.mjs mac    -> macOS Intel build (also runs on Apple Silicon via Rosetta)
// CI runs this before each build.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
const vendor = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor');
const platform = process.argv[2] || 'win';

fs.mkdirSync(vendor, { recursive: true });

async function download(name) {
  const res = await fetch(BASE + name, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download of ${name} failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

if (platform === 'mac') {
  const tgz = path.join(vendor, 'cloudflared-darwin.tgz');
  fs.writeFileSync(tgz, await download('cloudflared-darwin-amd64.tgz'));
  execFileSync('tar', ['-xzf', tgz, '-C', vendor]);
  fs.rmSync(tgz);
  const out = path.join(vendor, 'cloudflared');
  fs.chmodSync(out, 0o755);
  console.log(`Saved ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
} else {
  const out = path.join(vendor, 'cloudflared.exe');
  fs.writeFileSync(out, await download('cloudflared-windows-amd64.exe'));
  console.log(`Saved ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
}
