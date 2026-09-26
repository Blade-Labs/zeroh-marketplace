// SPDX-License-Identifier: AGPL-3.0-only

// Ordinary work passes through the hooks untouched. Code, Markdown,
// prose, git and shell output, UUIDs, hashes, timestamps and configuration
// produce no tokens in PostToolUse and no rewrite or denial in PreToolUse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PROSE_FIXTURES,
  runHook,
  tempProject,
  stateDirOf,
} from './helpers.mjs';
import { NORMAL_CODE } from './fixtures/normal-code.mjs';
import { detectSensitiveData } from '../lib/detector.js';

const FILES = {
  'src/server.ts': `import express, { Request, Response } from 'express';
import { UserService } from './services/UserService';

export interface LoginBody {
  username: string;
  password: string;
  token?: string;
}

const MAX_SAFE = 9007199254740991;
const TIMEOUT_MS = 30000000;
const app = express();

// Returns Not Found when the user is missing.
app.get('/users/:id', async (req: Request, res: Response) => {
  const user = await UserService.find(req.params.id);
  if (!user) return res.status(404).send('Not Found');
  const token = await issueToken(user);
  res.json({ id: '550e8400-e29b-41d4-a716-446655440000', token: token.value });
});

app.listen(3000, () => console.log('Listening on http://localhost:3000'));
`,
  'app/settings.py': `import os
from getpass import getpass

DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]
DATABASES = {"default": {"ENGINE": "django.db.backends.postgresql", "PORT": 5432}}
password = os.environ.get("DB_PASSWORD")
api_key = settings.API_KEY


def connect(password=password, token=None):
    """Open a connection. Raises ValueError When The Password Is Empty."""
    if not password:
        password = getpass()
    return Client(password=password, timeout=30000000)
`,
  'main.go': `package main

import (
\t"fmt"
\t"time"
)

func main() {
\tstarted := time.Date(2026, 9, 25, 10, 11, 12, 0, time.UTC)
\tfmt.Printf("Build %s started at %s\\n", "4f9c2a1b", started.Format(time.RFC3339))
}
`,
  'README.md': `# Getting Started

Run the Build Script first, then open the Admin Console.

## Configuration

| Setting      | Default  |
| ------------ | -------- |
| Port         | 3000     |
| Timeout (ms) | 30000000 |

See [the Payment Service guide](docs/payment-service.md) and \`scripts/deploy.sh\`.
Released on 2026-09-25T10:11:12Z by the Platform Team.
`,
  'config.yaml': `version: "3.9"
services:
  web:
    image: node:20-alpine@sha256:3f1a2b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      REQUEST_TIMEOUT_MS: 30000
      MAX_TOKENS: 4096
    secrets:
      - db_password
secrets:
  db_password:
    file: ./secrets/db_password.txt
`,
  'Cargo.toml': `[package]
name = "zeroh-demo"
version = "1.0.0"
edition = "2021"

[dependencies]
serde = { version = "1.0.210", features = ["derive"] }
tokio = { version = "1.40", features = ["full"] }
`,
  'package.json': `{
  "name": "zeroh-demo",
  "version": "1.0.0",
  "scripts": { "test": "node --test", "build": "tsc -p ." },
  "dependencies": { "express": "^4.21.0" },
  "packageManager": "pnpm@9.12.1+sha512.e5a7e52a4183a02d5931057f7a0dbff9d5e9ce3161e33fa68ae392125b79282a8a8a470a51dfc8a0ed86221442eb2fb57019b0990ed24fab519bf0e1bc5ccfc4"
}
`,
};
import { wrapBashExitStatus } from '../lib/exit-status.js';

// PreToolUse may only add the exit-status wrapper (lib/exit-status.js) to an
// ordinary Bash command; anything else counts as a rewrite.
function onlyExitWrapper(tool, input, json) {
  if (json === null) return true;
  if (tool !== 'Bash') return false;
  const cmd = json?.hookSpecificOutput?.updatedInput?.command;
  return (
    Object.keys(json.hookSpecificOutput.updatedInput).length === 1 &&
    cmd === wrapBashExitStatus(input.command)
  );
}

const OUTPUTS = [
  `commit 4f9c2a1b7e3d5c6a8b9f0e1d2c3b4a5f6e7d8c9b
Author: Dev <1234567+dev@users.noreply.github.com>
Date:   Thu Sep 25 10:11:12 2026 +0300

    Fix Login Page redirect

    Co-authored-by: Claude <noreply@anthropic.com>

commit 0123456789abcdef0123456789abcdef01234567
Date:   Wed Sep 24 09:00:00 2026 +0300

    Add Payment Service refunds
`,
  `On branch feature/login
Your branch is up to date with 'origin/feature/login'.

Changes not staged for commit:
  modified:   src/server.ts
  modified:   app/settings.py
  new file:   scripts/deploy.sh
`,
  `diff --git a/src/server.ts b/src/server.ts
index 3f1a2b4..5d6e7f8 100644
--- a/src/server.ts
+++ b/src/server.ts
@@ -12,7 +12,7 @@ const app = express();
-const TIMEOUT_MS = 3000;
+const TIMEOUT_MS = 30000000;
+const SIZES = [2048, 4096, 8192];
+2048 4096 8192
+1 2026 0925 1011
`,
  `origin\tgit@github.com:acme/shop.git (fetch)
origin\tgit@github.com:acme/shop.git (push)
`,
  `> zeroh-demo@1.0.0 test
> node --test

✔ Getting Started renders (12.345678ms)
✔ UserService finds Jane (3.2ms)
ℹ tests 2
ℹ pass 2
ℹ duration_ms 1758792672000
`,
  `REPOSITORY   TAG       IMAGE ID       CREATED        SIZE
node         20        9f8e7d6c5b4a   2 weeks ago    1.1GB
sha256:3f1a2b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081
`,
  `PWD=/srv/projects/demo
HOME=/home/dev
LANG=en_US.UTF-8
SHLVL=1
_=/usr/bin/env
`,
  `2026-09-25T10:11:12.345Z INFO  Request 7c9e6679-7425-40de-944b-e07fc1f90ae7 completed in 1234 ms
2026-09-25T10:11:13.001Z WARN  Retry 3 of 5 for job 1758792672123
`,
];

const INPUTS = [
  ['Bash', { command: 'git commit -m "Fix Login Page"' }],
  ['Bash', { command: 'git log --since 2026-09-25 --format="%h %ad %s"' }],
  ['Bash', { command: 'python app.py --port 3000 && ./scripts/deploy.sh' }],
  ['Bash', { command: 'git config user.email && npm test' }],
  [
    'Bash',
    { command: 'docker run --rm node:20-alpine node -e "console.log(1)"' },
  ],
  [
    'Bash',
    {
      command:
        'curl -s http://localhost:3000/users/550e8400-e29b-41d4-a716-446655440000',
    },
  ],
  [
    'Agent',
    {
      description: 'Explore',
      prompt: 'Find where Payment Service handles refunds',
    },
  ],
  [
    'WebFetch',
    {
      url: 'https://docs.python.org/3/library/getpass.html',
      prompt: 'How Does getpass Work?',
    },
  ],
  [
    'mcp__github__create_issue',
    {
      title: 'Crash On Startup',
      body: 'Steps To Reproduce: run the Build Script.',
    },
  ],
];

test('ordinary files and command output pass PostToolUse unchanged', () => {
  const p = tempProject({ env: false });
  const events = [
    ...Object.entries(FILES).map(([name, content], i) => {
      const filePath = path.join(p.dir, name);
      const lines = content.split('\n').length;
      return {
        tool_name: 'Read',
        tool_use_id: `nw-read-${i}`,
        tool_input: { file_path: filePath },
        tool_response: {
          type: 'text',
          file: {
            filePath,
            content,
            numLines: lines,
            startLine: 1,
            totalLines: lines,
          },
        },
      };
    }),
    ...OUTPUTS.map((stdout, i) => ({
      tool_name: 'Bash',
      tool_use_id: `nw-bash-${i}`,
      tool_input: { command: 'x' },
      tool_response: { stdout, stderr: '', interrupted: false, isImage: false },
    })),
    {
      tool_name: 'Grep',
      tool_use_id: 'nw-grep',
      tool_input: { pattern: 'password' },
      tool_response: {
        mode: 'content',
        numFiles: 2,
        filenames: [],
        content:
          'src/server.ts:6:  password: string;\napp/settings.py:7:password = os.environ.get("DB_PASSWORD")',
        numLines: 2,
      },
    },
  ];
  for (const event of events) {
    const r = runHook('post-tool-use', event, { project: p });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(
      r.json,
      null,
      `${event.tool_use_id}: ${JSON.stringify(r.json)?.slice(0, 400)}`,
    );
  }
});

test('ordinary tool input passes PreToolUse unchanged', () => {
  const p = tempProject({ env: false });
  const inputs = [
    ...INPUTS,
    ...Object.entries(FILES).map(([name, content]) => [
      'Write',
      { file_path: path.join(p.dir, name), content },
    ]),
    ...Object.entries(FILES).map(([name, content]) => [
      'Edit',
      {
        file_path: path.join(p.dir, name),
        old_string: content.split('\n')[0],
        new_string: content.split('\n').slice(0, 3).join('\n'),
      },
    ]),
  ];
  for (const [i, [tool, input]] of inputs.entries()) {
    const r = runHook(
      'pre-tool-use',
      { tool_name: tool, tool_use_id: `nw-pre-${i}`, tool_input: input },
      { project: p },
    );
    assert.equal(r.code, 0, r.stderr);
    assert.ok(
      onlyExitWrapper(tool, input, r.json),
      `${tool} ${JSON.stringify(input).slice(0, 80)}: ${JSON.stringify(r.json)?.slice(0, 400)}`,
    );
  }
});

test('typed prose with no secret or pattern personal data passes UserPromptSubmit untouched', () => {
  const p = tempProject({ env: false });
  for (const [i, prompt] of PROSE_FIXTURES.entries()) {
    const session = `nw-prose-${i}`;
    const r = runHook(
      'user-prompt-submit',
      { session_id: session, prompt },
      { project: p },
    );
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json, null, `${prompt}: ${r.stdout}`);
    const ledger = JSON.parse(
      readFileSync(
        path.join(stateDirOf(p), 'sessions', session, 'turn-1.json'),
        'utf8',
      ),
    );
    assert.equal(ledger.phase, 'allowed_no_findings', prompt);
    assert.equal(ledger.sanitized_text, prompt);
  }
});

// ---- code that names secrets without holding any (test/fixtures) -----------

test('the code corpus has no finding in any profile', () => {
  for (const [name, content] of Object.entries(NORMAL_CODE)) {
    for (const profile of ['tool', 'secrets', 'prompt']) {
      const found = detectSensitiveData(content, { profile }).map((f) =>
        content.slice(f.start, f.end),
      );
      assert.deepEqual(found, [], `${name} (${profile})`);
    }
  }
});

test('the code corpus passes Read unchanged and is not rewritten or denied on the way in', () => {
  const p = tempProject({ env: false });
  for (const [i, [name, content]] of Object.entries(NORMAL_CODE).entries()) {
    const filePath = path.join(p.dir, name);
    const lines = content.split('\n').length;
    const read = runHook(
      'post-tool-use',
      {
        tool_name: 'Read',
        tool_use_id: `nc-read-${i}`,
        tool_input: { file_path: filePath },
        tool_response: {
          type: 'text',
          file: {
            filePath,
            content,
            numLines: lines,
            startLine: 1,
            totalLines: lines,
          },
        },
      },
      { project: p },
    );
    assert.equal(read.code, 0, read.stderr);
    assert.equal(read.json, null, `Read ${name}: ${JSON.stringify(read.json)}`);
    for (const [tool, input] of [
      ['Write', { file_path: filePath, content }],
      ['Edit', { file_path: filePath, old_string: 'x', new_string: content }],
      ['Bash', { command: `mkdir -p x && cat > x/f <<'EOF'\n${content}EOF` }],
      [
        'mcp__github__create_or_update_file',
        { owner: 'acme', repo: 'shop', path: name, message: 'Add', content },
      ],
    ]) {
      const r = runHook(
        'pre-tool-use',
        { tool_name: tool, tool_use_id: `nc-${tool}-${i}`, tool_input: input },
        { project: p },
      );
      assert.equal(r.code, 0, r.stderr);
      assert.ok(
        onlyExitWrapper(tool, input, r.json),
        `${tool} ${name}: ${JSON.stringify(r.json)?.slice(0, 400)}`,
      );
    }
  }
});

test('a key-name value seen once does not mask identifiers in later output', () => {
  const p = tempProject({ env: false });
  const first = runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_use_id: 'nc-cfg',
      tool_input: { command: 'cat config.yml' },
      tool_response: { stdout: 'db:\n  password: hunter2abc\n', stderr: '' },
    },
    { project: p },
  );
  assert.match(
    first.json.hookSpecificOutput.updatedToolOutput.stdout,
    /password: \[PASSWORD-[0-9a-f]{6}\]/,
  );
  const later = `DJANGO_SECRET_KEY=... see settings
export STRIPE_API_KEY and OPENAI_API_KEY
const k = process.env.API_KEY_ROTATION_DAYS;
const hunter2abcdef = MY_hunter2abc;
`;
  const r = runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_use_id: 'nc-later',
      tool_input: { command: 'grep -r KEY docs' },
      tool_response: { stdout: later, stderr: '' },
    },
    { project: p },
  );
  assert.equal(r.json, null, JSON.stringify(r.json));
});
