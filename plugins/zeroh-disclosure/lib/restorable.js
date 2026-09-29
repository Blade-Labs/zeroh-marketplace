// SPDX-License-Identifier: AGPL-3.0-only

// Product rule 8 (docs/product-principles.md): never mask what ZeroH can't
// restore. A token only helps if ZeroH can put the real value back for the
// user's commands, edits and screen, and it can do that only for a value its
// vault holds on disk. One primitive for every mask path (the proxy,
// PostToolUse, PreToolUse; UserPromptSubmit says the same):
//
//   maskRestorably(vault, mask) runs mask(vault), which may mint tokens into
//   the vault in memory, then saves the vault. When the save fails (a lock
//   held by another writer, an I/O error) and a new token was minted, it runs
//   mask(view) again with a read-only view of the values already on disk
//   (knownValueMasker(persistedEntries(vault)).vault): those stay masked as
//   before, and every new value passes unmasked. The caller records the pass
//   as `vault-unsaveable` (lib/unchecked.js) and shows the standard line;
//   block mode withholds or stops instead.
//
// A vault that can't be opened at all is the caller's `vault-unavailable`
// case: nothing is masked.
import { saveQuietly } from './vault.js';

export const UNSAVEABLE_REASON = 'vault-unsaveable';

// The values a vault holds on disk: those it loaded, not those minted in
// this process since (a failed save leaves them pending).
export function persistedEntries(vault) {
  const inserted = vault?.inserted instanceof Set ? vault.inserted : new Set();
  const out = [];
  for (const [token, entry] of vault?.entries ?? []) {
    if (!inserted.has(token)) out.push({ token, ...entry });
  }
  return out;
}

// Replaces known values by the tokens they already have, from memory, and
// never mints one. Two uses:
//   - a retired daemon (bin/proxy-daemon.mjs, `/_zeroh/retire` after `proxy
//     off` or doctor --fix): the values its vaults held when it retired, each
//     to the token the model already saw. The vault and hooks still exist, so
//     those tokens can still be put back; a new value passes as it would
//     without ZeroH. After uninstall nothing can put a token back, so the
//     daemon retires without one (it passes everything).
//   - the fallback of maskRestorably: `vault` is a read-only vault view over
//     the persisted values that scrub() and scrubBody() mask with. Its
//     tokenFor() answers null for any other value, which scrub leaves as it
//     is.
// `replaceText` is the plain text replacement the retired daemon uses.
export function knownValueMasker(entries = []) {
  const byValue = new Map();
  const byToken = new Map();
  const kept = new Map();
  for (const entry of entries) {
    const { token, value } = entry ?? {};
    if (typeof token !== 'string' || typeof value !== 'string') continue;
    // Very short values would mask ordinary words.
    if (value.length < 4 || byValue.has(value)) continue;
    byValue.set(value, token);
    byToken.set(token, value);
    const { token: _token, ...rest } = entry;
    void _token;
    kept.set(token, rest);
  }
  const values = [...byValue.keys()].sort((a, b) => b.length - a.length);
  const pattern = values.length
    ? new RegExp(
        values
          .map((value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
          .join('|'),
        'gu',
      )
    : null;
  const view = {
    persistedOnly: true,
    entries: kept,
    tokenFor: (_type, value) => byValue.get(value) ?? null,
    register: (_token, _type, value) => byValue.get(value) ?? null,
    valueOf: (token) => byToken.get(token) ?? null,
    entryOf: (token) =>
      kept.has(token) ? { ...kept.get(token), token } : null,
    touch: (token) => kept.get(token) ?? null,
    knownValues: () =>
      [...kept.entries()].map(([token, entry]) => ({ token, ...entry })),
    save: () => false,
    hasPendingChanges: () => false,
  };
  return {
    size: byValue.size,
    replaceText: (text) =>
      pattern ? text.replace(pattern, (match) => byValue.get(match)) : text,
    vault: view,
  };
}

// Saves `vault` after masking. { saved, fallback }: `fallback` is the
// read-only view of the values on disk when the save failed while a token
// minted by this process was pending (it could never be put back), else
// null. A save that fails with only use bookkeeping pending loses nothing a
// restore needs. A token conflict still throws (lib/vault.js saveQuietly).
export function saveRestorably(vault, label = 'ZeroH Disclosure') {
  const minted = vault?.inserted instanceof Set && vault.inserted.size > 0;
  if (saveQuietly(vault, label)) return { saved: true, fallback: null };
  if (!minted) return { saved: false, fallback: null };
  return {
    saved: false,
    fallback: knownValueMasker(persistedEntries(vault)).vault,
  };
}

// mask(vault) → result, then save. { result, restorable }: `restorable`
// false means the save failed and `result` is mask(view) over the values on
// disk only (see above); the caller records UNSAVEABLE_REASON.
export function maskRestorably(vault, mask, label) {
  const first = mask(vault);
  const { fallback } = saveRestorably(vault, label);
  if (!fallback) return { result: first, restorable: true };
  return { result: mask(fallback), restorable: false };
}

// The same for a mask function that returns a promise.
export async function maskRestorablyAsync(vault, mask, label) {
  const first = await mask(vault);
  const { fallback } = saveRestorably(vault, label);
  if (!fallback) return { result: first, restorable: true };
  return { result: await mask(fallback), restorable: false };
}
