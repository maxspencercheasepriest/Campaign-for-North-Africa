// Downloads the cloudflared binary into vendor/ so electron-builder can bundle it.
//   node scripts/fetch-cloudflared.mjs        -> Windows (cloudflared.exe)
//   node scripts/fetch-cloudflared.mjs mac    -> macOS universal binary (Intel + Apple Silicon), needs `lipo` (macOS)
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
  // Fetch both architectures and fuse them into one universal binary.
  const slices = [];
  for (const arch of ['amd64', 'arm64']) {
    const dir = fs.mkdtempSync(path.join(vendor, `tmp-${arch}-`));
    const tgz = path.join(dir, 'cf.tgz');
    fs.writeFileSync(tgz, await download(`cloudflared-darwin-${arch}.tgz`));
    execFileSync('tar', ['-xzf', tgz, '-C', dir]);
    slices.push({ dir, bin: path.join(dir, 'cloudflared') });
  }
  const out = path.join(vendor, 'cloudflared');
  execFileSync('lipo', ['-create', ...slices.map((s) => s.bin), '-output', out]);
  for (const s of slices) fs.rmSync(s.dir, { recursive: true, force: true });
  fs.chmodSync(out, 0o755);
  console.log(execFileSync('lipo', ['-archs', out]).toString().trim());
  console.log(`Saved ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
} else {
  const out = path.join(vendor, 'cloudflared.exe');
  fs.writeFileSync(out, await download('cloudflared-windows-amd64.exe'));
  console.log(`Saved ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
}
