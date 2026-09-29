// SPDX-License-Identifier: AGPL-3.0-only

// `allow --list` (DEST-1): for every value this project knows by name (.env,
// credential files, the environment), where it may go and why: the provider's
// built-in hosts and the user's own signed rules. Values are never printed.
import { builtInDestinations } from './secrets.js';

const MORE = 3;

function ruleLabel(key, name) {
  if (key === name) return 'your rule';
  if (key === '*') return 'your rule for every value';
  return `your rule for ${key}`;
}

// One row per known name, then the rules no known name uses.
// `known` is loadKnownSecrets() output: [{ name, value, type }].
// `typed` are vault entries the user typed ([{ token, type, value }]):
// they have no name, so each is listed by its token (Mac /try review M1).
// Claude Code's own variables (`own`) are masked but never offered (M2).
export function destinationSummary(known, rules = {}, { typed = [] } = {}) {
  const byName = new Map();
  for (const entry of known) {
    if (entry.own) continue;
    const row = byName.get(entry.name) ?? {
      name: entry.name,
      provider: null,
      builtIn: [],
      types: new Set(),
    };
    const builtIn = builtInDestinations(entry.value);
    if (builtIn && !row.provider) {
      row.provider = builtIn.provider;
      row.builtIn = builtIn.hosts;
    }
    if (entry.type) row.types.add(entry.type);
    byName.set(entry.name, row);
  }
  const used = new Set();
  const values = [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => {
      const ruled = [];
      const seen = new Set(row.builtIn);
      for (const key of [row.name, ...row.types, '*']) {
        if (!Array.isArray(rules[key])) continue;
        used.add(key);
        for (const host of rules[key]) {
          if (seen.has(host)) continue;
          seen.add(host);
          ruled.push({ host, rule: key, why: ruleLabel(key, row.name) });
        }
      }
      return {
        name: row.name,
        builtIn: row.provider
          ? { provider: row.provider, hosts: row.builtIn }
          : null,
        rules: ruled,
      };
    });
  const typedRows = [];
  for (const entry of typed) {
    if (!entry?.token || byName.has(entry.token)) continue;
    const builtIn = builtInDestinations(entry.value);
    const seen = new Set(builtIn?.hosts ?? []);
    const ruled = [];
    for (const key of [entry.token]) {
      if (!Array.isArray(rules[key])) continue;
      used.add(key);
      for (const host of rules[key]) {
        if (seen.has(host)) continue;
        seen.add(host);
        ruled.push({ host, rule: key, why: 'your rule' });
      }
    }
    typedRows.push({
      name: entry.token,
      typed: true,
      kind: /KEY|TOKEN|SECRET/u.test(String(entry.type)) ? 'key' : 'value',
      builtIn: builtIn
        ? { provider: builtIn.provider, hosts: builtIn.hosts }
        : null,
      rules: ruled,
    });
  }
  values.push(...typedRows.sort((a, b) => a.name.localeCompare(b.name)));
  const otherRules = Object.entries(rules)
    .filter(([key]) => !used.has(key) && !byName.has(key))
    .map(([rule, hosts]) => ({ rule, hosts: [...hosts] }));
  return { values, otherRules };
}

function hostList(hosts) {
  return hosts.length > MORE + 1
    ? `${hosts.slice(0, MORE).join(', ')} …`
    : hosts.join(', ');
}

function rulesPart(rules) {
  const groups = new Map();
  for (const { host, why } of rules) {
    groups.set(why, [...(groups.get(why) ?? []), host]);
  }
  return [...groups].map(([why, hosts]) => `${hosts.join(', ')} (${why})`);
}

export function formatDestinationSummary({ values, otherRules }) {
  const lines = [];
  if (!values.length && !otherRules.length) {
    return [
      'No known values in this project and no rules yet.',
      'ZeroH learns names from .env files and your environment. Allow one with /zeroh-disclosure:allow NAME <host>',
    ];
  }
  if (values.length) {
    lines.push('Where each known value may go (values are never shown):');
    for (const row of values) {
      const parts = [];
      if (row.builtIn) {
        parts.push(
          `${hostList(row.builtIn.hosts)} (built-in: ${row.builtIn.provider})`,
        );
      }
      parts.push(...rulesPart(row.rules));
      // A typed value shows as its token in the form Claude names it, so
      // the screen doesn't turn it back into the value.
      const label = row.typed
        ? `typed ${row.kind} ⟦${row.name.slice(1, -1)}⟧`
        : row.name;
      const argument = row.typed ? `⟦${row.name.slice(1, -1)}⟧` : row.name;
      lines.push(
        parts.length
          ? `  ${label} → ${parts.join(' + ')}`
          : `  ${label} → nowhere yet · allow with /zeroh-disclosure:allow ${argument} <host>`,
      );
    }
  }
  if (otherRules.length) {
    if (lines.length) lines.push('');
    lines.push('Other rules:');
    for (const { rule, hosts } of otherRules) {
      lines.push(`  ${rule} → ${hosts.join(', ')} (${ruleLabel(rule, rule)})`);
    }
  }
  lines.push(
    '',
    'Add: /zeroh-disclosure:allow NAME <host> · remove: /zeroh-disclosure:allow --remove NAME <host>',
  );
  return lines;
}
