// SPDX-License-Identifier: AGPL-3.0-only

// SPDX-License-Identifier: MIT
// Run each tier in a separate cold process: V8 flags and Parser.init are global.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createBashParser, parseWithBashParser } from './bash-adapter.mjs';
const commands = readFileSync(
  new URL('../destinations/seeds/spike-42.txt', import.meta.url),
  'utf8',
)
  .trimEnd()
  .split('\n')
  .map((line) => line.replaceAll('\\n', '\n'));
if (commands.length !== 60) throw new Error('Expected sixty commands');
const parser = await createBashParser({
  liftoff: process.argv[2] !== 'default',
});
try {
  const snapshots = commands.map((command) =>
    parseWithBashParser(parser, command),
  );
  process.stdout.write(
    JSON.stringify({
      count: snapshots.length,
      sha256: createHash('sha256')
        .update(JSON.stringify(snapshots))
        .digest('hex'),
    }),
  );
} finally {
  parser.delete();
}
