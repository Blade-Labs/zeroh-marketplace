// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { cidPdfWithoutToUnicode } from './fixtures/format-fixtures.mjs';
import {
  formatReceiptLines,
  recordFormatOutcome,
} from '../lib/format-audit.js';
import {
  FAKE_STRIPE,
  PLUGIN,
  runHook,
  tempProject,
  stateDirOf,
} from './helpers.mjs';

const SHAPES = JSON.parse(
  readFileSync(
    new URL('./fixtures/read-response-shapes-2.1.281.json', import.meta.url),
    'utf8',
  ),
);

test('recorded PDF response with text becomes masked text without PDF bytes', () => {
  const project = withTurn();
  const file = path.join(project.dir, 'invoice.pdf');
  const bytes = simplePdf(
    `Invoice key ${FAKE_STRIPE} belongs to billing@example.com`,
  );
  writeFileSync(file, bytes);
  const response = structuredClone(SHAPES[0].tool_response);
  response.file.filePath = file;
  response.file.base64 = bytes.toString('base64');
  response.file.originalSize = bytes.length;

  const result = runHook(
    'post-tool-use',
    {
      tool_name: 'Read',
      tool_input: { file_path: file },
      tool_response: response,
    },
    { project },
  );
  assert.equal(result.code, 0, result.stderr);
  const output = result.json.hookSpecificOutput.updatedToolOutput;
  assert.equal(output.type, 'text');
  assert.match(output.file.content, /\[API_KEY-[0-9a-f]{6}\]/u);
  assert.match(output.file.content, /\[EMAIL-[0-9a-f]{6}\]/u);
  assert.ok(!JSON.stringify(result.json).includes(FAKE_STRIPE));
  assert.ok(!JSON.stringify(result.json).includes('%PDF'));
  assert.equal(
    result.json.systemMessage,
    'ZeroH Disclosure: invoice.pdf was sent as masked text; its layout and images were left out.',
  );
  assert.deepEqual(receipt(project).format_disclosure, {
    withheld: { 'pdf sent as masked text': 1 },
    passed_unmasked: {},
  });
});

test('sparse PDF text is still scrubbed when it contains a secret', () => {
  const project = withTurn();
  const file = path.join(project.dir, 'sparse-cover.pdf');
  const bytes = sparseSecretPdf(FAKE_STRIPE);
  const response = structuredClone(SHAPES[0].tool_response);
  response.file.filePath = file;
  response.file.base64 = bytes.toString('base64');
  response.file.originalSize = bytes.length;

  const result = readFormat(project, file, response);
  assert.equal(result.code, 0, result.stderr);
  const output = result.json.hookSpecificOutput.updatedToolOutput;
  assert.equal(output.type, 'text');
  assert.match(output.file.content, /\[API_KEY-[0-9a-f]{6}\]/u);
  assert.ok(!JSON.stringify(result.json).includes(FAKE_STRIPE));
  assert.equal(
    result.json.systemMessage,
    'ZeroH Disclosure: sparse-cover.pdf was sent as masked text; its layout and images were left out.',
  );
  assert.deepEqual(receipt(project).format_disclosure, {
    withheld: { 'pdf sent as masked text': 1 },
    passed_unmasked: {},
  });
});

test('recorded image-only PDF passes with one notice and a receipt line', () => {
  const project = withTurn();
  const file = path.join(project.dir, 'scan.pdf');
  const bytes = simplePdf(null);
  writeFileSync(file, bytes);
  const response = structuredClone(SHAPES[0].tool_response);
  response.file.filePath = file;
  response.file.base64 = bytes.toString('base64');

  const first = readFormat(project, file, response);
  assert.equal(first.json.hookSpecificOutput, undefined);
  assert.equal(
    first.json.systemMessage,
    "ZeroH Disclosure: scan.pdf was sent unmasked. Scanned PDFs aren't masked in the free plugin.",
  );
  const second = readFormat(project, file, response);
  assert.equal(second.json, null);
  assert.deepEqual(formatReceiptLines(receipt(project).format_disclosure), [
    'withheld:                -',
    'passed unmasked:         pdf passed, text layer sparse or absent × 2',
  ]);
});

test('CID glyph IDs without ToUnicode pass as a scanned PDF, never as text', () => {
  const project = withTurn();
  const file = path.join(project.dir, 'cid-scan.pdf');
  const bytes = cidPdfWithoutToUnicode();
  const response = structuredClone(SHAPES[0].tool_response);
  response.file.filePath = file;
  response.file.base64 = bytes.toString('base64');

  const result = readFormat(project, file, response);
  assert.equal(result.json.hookSpecificOutput, undefined);
  assert.equal(
    result.json.systemMessage,
    "ZeroH Disclosure: cid-scan.pdf was sent unmasked. Scanned PDFs aren't masked in the free plugin.",
  );
  assert.deepEqual(receipt(project).format_disclosure, {
    withheld: {},
    passed_unmasked: { 'pdf passed, text layer sparse or absent': 1 },
  });
});

test('recorded images pass and notify only once per session', () => {
  const project = withTurn();
  const firstResponse = structuredClone(SHAPES[1].tool_response);
  const first = readFormat(
    project,
    path.join(project.dir, 'screenshot.png'),
    firstResponse,
  );
  assert.equal(first.json.hookSpecificOutput, undefined);
  assert.equal(
    first.json.systemMessage,
    "ZeroH Disclosure: screenshot.png was sent unmasked. Images aren't masked in the free plugin.",
  );

  const second = readFormat(
    project,
    path.join(project.dir, 'second.png'),
    structuredClone(SHAPES[1].tool_response),
  );
  assert.equal(second.json, null);
  assert.deepEqual(receipt(project).format_disclosure.passed_unmasked, {
    image: 2,
  });
  const displayed = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'commands', 'scripts', 'receipt.js')],
    {
      cwd: project.dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: project.home,
        ZEROH_HOME: project.home,
        CLAUDE_SESSION_ID: 'test',
      },
    },
  );
  assert.equal(displayed.status, 0, displayed.stderr);
  // Images are never scanned, so they are not "sent" values: the slip keeps
  // sent at 0 and lists them as passed unchecked.
  assert.match(displayed.stdout, /^values sent to Claude +0$/mu);
  assert.match(displayed.stdout, /^passed unchecked: 2 files \(see below\)$/mu);
  assert.match(displayed.stdout, /^ {2}image ×2\./mu);
});

test('recorded notebook text parts are masked and image output stays intact', () => {
  const project = withTurn();
  const file = path.join(project.dir, 'analysis.ipynb');
  const response = structuredClone(SHAPES[2].tool_response);
  const plot = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  response.file.filePath = file;
  response.file.cells = [
    {
      cellType: 'code',
      source: `print('${FAKE_STRIPE}')`,
      execution_count: 1,
      cell_id: 'cell-0',
      language: 'python',
      outputs: [
        { output_type: 'stream', text: `${FAKE_STRIPE}\n` },
        {
          output_type: 'display_data',
          data: {
            'text/plain': `owner@example.com ${FAKE_STRIPE}`,
            'text/html': `<b>${FAKE_STRIPE}</b>`,
            'text/markdown': `**${FAKE_STRIPE}**`,
            'application/json': { key: FAKE_STRIPE },
            'image/png': plot,
          },
        },
        {
          output_type: 'error',
          evalue: FAKE_STRIPE,
          traceback: [`failure ${FAKE_STRIPE}`],
        },
      ],
    },
  ];

  const result = readFormat(project, file, response);
  const output = result.json.hookSpecificOutput.updatedToolOutput;
  assert.equal(output.type, 'notebook');
  assert.ok(!JSON.stringify(output).includes(FAKE_STRIPE));
  assert.match(output.file.cells[0].source, /\[API_KEY-[0-9a-f]{6}\]/u);
  assert.match(
    output.file.cells[0].outputs[1].data['text/plain'],
    /\[EMAIL-[0-9a-f]{6}\]/u,
  );
  assert.equal(output.file.cells[0].outputs[1].data['image/png'], plot);
  assert.match(result.json.systemMessage, /image output was sent unmasked/u);
  assert.deepEqual(receipt(project).format_disclosure.passed_unmasked, {
    image: 1,
  });
});

test('parallel format outcomes retain every child-process increment', async () => {
  const project = tempProject();
  const sessionId = 'parallel-format';
  // In this process (and its children) ZEROH_HOME is the test's own.
  const dir = path.join(
    stateDirOf(project, process.env.ZEROH_HOME),
    'sessions',
    sessionId,
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ turnCount: 1 }));
  writeFileSync(
    path.join(dir, 'turn-1.json'),
    JSON.stringify({
      format_disclosure: { withheld: {}, passed_unmasked: {} },
    }),
  );

  const workers = 6;
  const increments = 20;
  const moduleUrl = new URL('../lib/format-audit.js', import.meta.url).href;
  const program = `
    import { recordFormatOutcome } from ${JSON.stringify(moduleUrl)};
    const [cwd, sessionId, count] = process.argv.slice(1);
    for (let index = 0; index < Number(count); index += 1) {
      await recordFormatOutcome({ cwd, sessionId, passedUnmasked: { image: 1 } });
    }
  `;
  await Promise.all(
    Array.from({ length: workers }, () =>
      runChild([
        '--input-type=module',
        '-e',
        program,
        project.dir,
        sessionId,
        String(increments),
      ]),
    ),
  );

  const ledger = JSON.parse(readFileSync(path.join(dir, 'turn-1.json')));
  assert.equal(
    ledger.format_disclosure.passed_unmasked.image,
    workers * increments,
  );
});

test('format outcome retries a transient parse failure instead of dropping it', async () => {
  const project = tempProject();
  const sessionId = 'retry-format';
  const dir = path.join(
    stateDirOf(project, process.env.ZEROH_HOME),
    'sessions',
    sessionId,
  );
  const turn = path.join(dir, 'turn-1.json');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ turnCount: 1 }));
  writeFileSync(turn, '{');
  const repair = setTimeout(() => {
    writeFileSync(
      turn,
      JSON.stringify({
        format_disclosure: { withheld: {}, passed_unmasked: {} },
      }),
    );
  }, 15);

  await recordFormatOutcome({
    cwd: project.dir,
    sessionId,
    withheld: { notebook: 1 },
  });
  clearTimeout(repair);
  assert.equal(
    JSON.parse(readFileSync(turn)).format_disclosure.withheld.notebook,
    1,
  );
});

function withTurn() {
  const project = tempProject();
  const prompt = runHook(
    'user-prompt-submit',
    { prompt: 'Inspect the requested fixture.' },
    { project },
  );
  assert.equal(prompt.code, 0, prompt.stderr);
  return project;
}

function readFormat(project, file, response) {
  return runHook(
    'post-tool-use',
    {
      tool_name: 'Read',
      tool_input: { file_path: file },
      tool_response: response,
    },
    { project },
  );
}

function receipt(project) {
  return JSON.parse(
    readFileSync(
      path.join(stateDirOf(project), 'sessions', 'test', 'turn-1.json'),
      'utf8',
    ),
  );
}

function simplePdf(text) {
  const content = text
    ? `BT /F1 12 Tf 72 720 Td (${escapePdf(text)}) Tj ET`
    : 'q 100 0 0 100 0 0 cm /Im0 Do Q';
  return Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj',
      `4 0 obj << /Length ${Buffer.byteLength(content)} >> stream`,
      content,
      'endstream endobj',
      '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      '%%EOF',
    ].join('\n'),
  );
}

function sparseSecretPdf(secret) {
  const content = `BT /F1 12 Tf 72 720 Td (${escapePdf(secret)}) Tj ET`;
  const blank = 'q 100 0 0 100 0 0 cm /Im0 Do Q';
  return Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >> endobj',
      `4 0 obj << /Length ${Buffer.byteLength(content)} >> stream`,
      content,
      'endstream endobj',
      '5 0 obj << /Type /Page /Parent 2 0 R /Contents 6 0 R >> endobj',
      `6 0 obj << /Length ${Buffer.byteLength(blank)} >> stream`,
      blank,
      'endstream endobj',
      '7 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      '%%EOF',
    ].join('\n'),
  );
}

function escapePdf(value) {
  return value.replace(/[\\()]/gu, (character) => `\\${character}`);
}

function runChild(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { encoding: 'utf8' });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`format outcome worker exited ${code}: ${stderr}`));
    });
  });
}

test('recorded fixtures hold no paths from the recording machine', () => {
  const dir = new URL('./fixtures/', import.meta.url);
  for (const name of readdirSync(dir)) {
    const text = readFileSync(new URL(name, dir), 'utf8');
    assert.doesNotMatch(
      text,
      /\/tmp\/claude-\d+|scratchpad|\/home\/[a-z]|\/Users\/[A-Za-z]|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/scratchpad/u,
      name,
    );
  }
});
