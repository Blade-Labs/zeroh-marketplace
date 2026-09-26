// SPDX-License-Identifier: AGPL-3.0-only

// Shared by the vendoring scripts: download a pinned npm tarball, check its
// registry integrity (sha512) and read its entries. Node built-ins only.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

// Minimal reader for the ustar (and pax) archives npm serves.
export function* untar(buffer) {
  let offset = 0;
  let longName = null;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) return;
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .replace(/\0.*$/su, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1) || '0';
    const prefix = field(345, 155);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const data = buffer.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/u.exec(data.toString('utf8'));
      if (m) longName = m[1];
      continue;
    }
    if (type === 'g') continue;
    yield { name: longName ?? name, type, data };
    longName = null;
  }
}

// The regular files of a pinned npm tarball, by path inside the archive.
export async function fetchNpmTarball({ url, integrity }) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`${url}: download failed (${response.status})`);
  const archive = Buffer.from(await response.arrayBuffer());
  const actual = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
  if (actual !== integrity)
    throw new Error(`${url}: integrity ${actual} does not match the pin`);
  const files = new Map();
  for (const entry of untar(gunzipSync(archive)))
    if (entry.type === '0') files.set(entry.name, entry.data);
  return files;
}
