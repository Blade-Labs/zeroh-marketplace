// SPDX-License-Identifier: AGPL-3.0-only

import { commandParts, referenceOnly } from './shell-references.js';

// A name-specific allow rule can authorize a proven pure variable reference
// without reading its value. Unknown destinations and any literal fail closed.
export function referencesAllowed(perField, shell, rules, hosts) {
  if (!hosts.length || !['bash', 'powershell'].includes(shell)) return false;
  let names = 0;
  for (const field of perField) {
    if (field.path?.join('.') !== 'command') return false;
    const parts = commandParts(field.original, shell);
    if (!parts) return false;
    for (const entry of field.replacements ?? []) {
      if (!referenceOnly(field.original, entry.start, entry.end, shell, parts))
        return false;
      const text = field.original.slice(entry.start, entry.end);
      const variables = [
        ...text.matchAll(
          /\$(?:\{(?:env:)?([A-Za-z_]\w*)\}|(?:env:)?([A-Za-z_]\w*))/giu,
        ),
      ];
      if (!variables.length) return false;
      for (const match of variables) {
        const name = match[1] ?? match[2];
        const allowed = rules[name];
        if (
          !Array.isArray(allowed) ||
          !hosts.every((host) =>
            allowed.some((item) => {
              const pattern = String(item).toLowerCase();
              return (
                host === pattern ||
                (pattern.startsWith('*.') &&
                  (host === pattern.slice(2) ||
                    host.endsWith(pattern.slice(1))))
              );
            }),
          )
        )
          return false;
        names += 1;
      }
    }
  }
  return names > 0;
}
