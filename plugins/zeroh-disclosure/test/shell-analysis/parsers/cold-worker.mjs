// SPDX-License-Identifier: AGPL-3.0-only

// SPDX-License-Identifier: MIT
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';

const commands = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const start = performance.now();
let loadMs;
let perCommandMs;
let passMs;
if (process.argv[2] === 'pwsh' || process.argv[2] === 'powershell-5.1') {
  const { parsePowerShellCommands } = await import('./powershell-adapter.mjs');
  const result = parsePowerShellCommands(commands, {
    executable: process.argv[4],
  });
  const wallMs = performance.now() - start;
  loadMs = Math.max(0, wallMs - result.passMs);
  perCommandMs =
    result.results.reduce((sum, row) => sum + row.parseMs, 0) / commands.length;
  passMs = result.passMs;
} else {
  const { createBashParser, parseWithBashParser } =
    await import('./bash-adapter.mjs');
  const parser = await createBashParser();
  loadMs = performance.now() - start;
  const parseStart = performance.now();
  for (const command of commands) parseWithBashParser(parser, command);
  passMs = performance.now() - parseStart;
  perCommandMs = passMs / commands.length;
  parser.delete();
}
process.stdout.write(JSON.stringify({ loadMs, perCommandMs, passMs }));
