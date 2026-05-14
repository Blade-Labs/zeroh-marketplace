// FNV-1a 24-bit → 6 hex chars. Deterministic across a session, so duplicates
// collapse to the same token and the model can reason about "same value" without
// seeing the raw data. Matches the scheme described in
// research/ali-chat-masking.md.

export function hash6(input) {
  let h = 0x811c9dc5; // 32-bit FNV offset basis
  const s = String(input);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return (h & 0xffffff).toString(16).padStart(6, '0');
}

export function buildToken(type, value) {
  return `[${type}-${hash6(`${type}:${value}`)}]`;
}

export function isToken(s) {
  return /^\[[A-Z_]+-[0-9a-f]{6}\]$/.test(s);
}
