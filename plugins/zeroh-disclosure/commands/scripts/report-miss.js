#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// /zeroh-disclosure:report-miss (1.0.1): with no arguments, the user reports
// a value ZeroH missed through the MCP tool's private form; `list` shows the
// local notes of reported values (their shape, never a value); `delete <id>`
// removes one, as the user (lib/user-authority.js: the CLI needs the user's
// own typed command). Reports stay on this computer.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listReports } from '../../lib/report-miss.js';
import { commandRoot } from './_helpers.js';

const CLI = fileURLToPath(
  new URL('../../bin/zeroh-disclosure.mjs', import.meta.url),
);
const args = process.argv.slice(2);
const action = String(args[0] ?? '').toLowerCase();

if (!action) {
  console.log(
    'Report a value: ZeroH opens a private form. Submit masks the value from now on and keeps a local note of its shape (never the value); Cancel changes nothing. Reports stay on this computer.',
  );
} else if (action === 'list') {
  const notes = listReports();
  console.log(
    notes.length
      ? [
          'Local notes of values reported as missed (shape only, never the value). Reports stay on this computer.',
          ...notes.map(
            (note) =>
              `${note.id}  ${note.date}  ${note.type}  ${note.shape?.length ?? '-'} chars  ${note.where}`,
          ),
          'Delete one with /zeroh-disclosure:report-miss delete <id>. The value stays masked.',
        ].join('\n')
      : 'No local notes of reported values.',
  );
} else if (action === 'delete' && args.length === 2) {
  const result = spawnSync(
    process.execPath,
    [CLI, 'reports', 'delete', args[1], '--cwd', commandRoot()],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  process.stdout.write(`${result.stdout || ''}${result.stderr || ''}`);
} else {
  console.log(
    'Use /zeroh-disclosure:report-miss to report a value, /zeroh-disclosure:report-miss list to see the local notes, or /zeroh-disclosure:report-miss delete <id> to remove one.',
  );
}
