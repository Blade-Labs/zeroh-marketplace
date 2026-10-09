// SPDX-License-Identifier: AGPL-3.0-only

// Only the diagnostic no-bookkeeping variant rewrites run.js at load time.
// loader-control measures the effect of Node's own loader thread separately.
import { appendFileSync } from 'node:fs';
let settings;
export function initialize(data) {
  settings = data;
}
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (settings.variant !== 'no-bookkeeping' || !url.endsWith('/hooks/run.js'))
    return result;
  let source = String(result.source);
  const start = source.indexOf(
    'function startWindowsBookkeeping(count, ok = true) {',
  );
  const end = source.indexOf('// Every hook run touches', start);
  const record = 'within(recordRun(true), 300, undefined)';
  if (start < 0 || end < 0 || source.split(record).length !== 2)
    throw new Error(
      'Crash probe no-bookkeeping transform no longer matches run.js',
    );
  source =
    source.slice(0, start) +
    'function startWindowsBookkeeping() { return Promise.resolve(undefined); }\n\n' +
    source.slice(end);
  source = source.replace(record, 'Promise.resolve()');
  appendFileSync(
    settings.trace,
    JSON.stringify({ action: 'bookkeeping-disabled' }) + '\n',
  );
  return { ...result, source };
}
