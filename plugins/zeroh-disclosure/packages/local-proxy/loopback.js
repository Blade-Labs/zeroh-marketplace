// SPDX-License-Identifier: AGPL-3.0-only

// The one rule for "this host is this machine": localhost, 127.0.0.0/8,
// 0.0.0.0 and ::1, with or without IPv6 brackets. Used by the proxy's loop
// check, its settings entries and reports, and by the destination check.
export function isLoopbackHost(hostname) {
  const host = String(hostname ?? '')
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '');
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true;
  if (host === '0:0:0:0:0:0:0:1') return true;
  const parts = host.split('.');
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
  );
}

// The port of a URL on this machine, else 0.
export function loopbackPort(value, { protocols = ['http:'] } = {}) {
  try {
    const parsed = new URL(String(value));
    if (!protocols.includes(parsed.protocol)) return 0;
    if (!isLoopbackHost(parsed.hostname)) return 0;
    return Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  } catch {
    return 0;
  }
}
