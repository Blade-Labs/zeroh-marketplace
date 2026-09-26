// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { cidPdfWithoutToUnicode } from './fixtures/format-fixtures.mjs';
import {
  extractPdfText,
  extractPdfTextFromBuffer,
  pdftotextCommand,
} from '../lib/pdf-text.js';

test('built-in PDF extractor reads an uncompressed text stream', () => {
  const result = extractPdfTextFromBuffer(
    pdf(
      Buffer.from('BT /F1 12 Tf 72 720 Td (Invoice secret@example.com) Tj ET'),
    ),
  );
  assert.match(result.text, /Invoice secret@example\.com/);
  assert.equal(result.pageCount, 1);
});

test('built-in PDF extractor inflates FlateDecode streams', () => {
  const content = Buffer.from(
    'BT /F1 12 Tf 72 720 Td (Compressed invoice reference 12345) Tj ET',
  );
  const result = extractPdfTextFromBuffer(pdf(deflateSync(content), true));
  assert.match(result.text, /Compressed invoice reference 12345/);
});

test('built-in PDF extractor joins TJ arrays and honors text line breaks', () => {
  const content = Buffer.from(
    "BT /F1 12 Tf 72 720 Td [(Account) -180 ( owner@example.com)] TJ T* (Second line) ' ET",
  );
  const result = extractPdfTextFromBuffer(pdf(content));
  assert.match(result.text, /Account\s+owner@example\.com/);
  assert.match(result.text, /Second line/);
});

test('built-in PDF extractor applies a simple ToUnicode CMap', () => {
  const source = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 /Resources 7 0 R >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj',
    '4 0 obj << /Length 31 >> stream',
    'BT /F1 12 Tf <0102> Tj ET',
    'endstream endobj',
    '5 0 obj << /Type /Font /Subtype /Type0 /ToUnicode 6 0 R >> endobj',
    '6 0 obj << /Length 80 >> stream',
    '2 beginbfchar',
    '<01> <005A>',
    '<02> <0065>',
    'endbfchar',
    'endstream endobj',
    '7 0 obj << /Font 8 0 R >> endobj',
    '8 0 obj << /F1 5 0 R >> endobj',
    '%%EOF',
  ].join('\n');
  assert.equal(extractPdfTextFromBuffer(Buffer.from(source)).text, 'Ze');
});

test('built-in PDF extractor returns no text for image-only and corrupt PDFs', () => {
  const imageOnly = extractPdfTextFromBuffer(
    pdf(Buffer.from('q 100 0 0 100 0 0 cm /Im0 Do Q')),
  );
  assert.equal(imageOnly.text, '');
  assert.doesNotThrow(() =>
    extractPdfTextFromBuffer(Buffer.from('%PDF-broken')),
  );
  assert.equal(extractPdfTextFromBuffer(Buffer.from('%PDF-broken')).text, '');
});

test('built-in PDF extractor rejects CID glyph IDs without a ToUnicode map', () => {
  const result = extractPdfTextFromBuffer(cidPdfWithoutToUnicode());
  assert.equal(result.source, 'built-in');
  assert.equal(result.text, '');
});

test('pdftotext command selection follows the operating system', () => {
  assert.equal(pdftotextCommand('linux'), 'pdftotext');
  assert.equal(pdftotextCommand('darwin'), 'pdftotext');
  // Windows: only absolute PATH entries, never the project directory.
  const planted = new Set([
    'C:\\work\\repo\\pdftotext.exe',
    'C:\\Tools\\poppler\\pdftotext.exe',
  ]);
  const options = {
    env: { Path: '.;relative\\bin;C:\\work\\repo;"C:\\Tools\\poppler"' },
    cwd: 'C:\\work\\repo',
    fileExists: (file) => planted.has(file),
  };
  assert.equal(
    pdftotextCommand('win32', options),
    'C:\\Tools\\poppler\\pdftotext.exe',
  );
  assert.equal(
    pdftotextCommand('win32', { ...options, fileExists: () => false }),
    null,
  );

  const calls = [];
  const result = extractPdfText('invoice.pdf', {
    platform: 'win32',
    env: options.env,
    fileExists: options.fileExists,
    cwd: options.cwd,
    run(command, args) {
      calls.push([command, args]);
      return { status: 0, stdout: 'Windows PDF text\f' };
    },
  });
  assert.equal(calls[0][0], 'C:\\Tools\\poppler\\pdftotext.exe');
  assert.deepEqual(calls[0][1], [
    '-layout',
    '-enc',
    'UTF-8',
    'invoice.pdf',
    '-',
  ]);
  assert.equal(result.source, 'pdftotext');
});

test('Windows clipboard uses clip.exe from System32, never a bare name', async () => {
  const { pickCandidates } = await import('../lib/clipboard.js');
  assert.deepEqual(pickCandidates('win32', { SystemRoot: 'D:\\Windows' }), [
    ['D:\\Windows\\System32\\clip.exe', []],
  ]);
  assert.equal(pickCandidates('darwin', {})[0][0], 'pbcopy');
});

test('missing pdftotext falls back to the built-in extractor', () => {
  const result = extractPdfText('invoice.pdf', {
    run() {
      return { status: null, error: { code: 'ENOENT' } };
    },
    readFile() {
      return pdf(Buffer.from('BT (Fallback text remains readable) Tj ET'));
    },
  });
  assert.equal(result.source, 'built-in');
  assert.match(result.text, /Fallback text remains readable/);
});

const installed = spawnSync(pdftotextCommand(), ['-v'], {
  encoding: 'utf8',
  windowsHide: true,
});
test(
  'installed pdftotext is used for a real PDF',
  { skip: installed.error?.code === 'ENOENT' },
  () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'zeroh-pdf-'));
    const file = path.join(dir, 'real.pdf');
    writeFileSync(
      file,
      pdf(Buffer.from('BT /F1 12 Tf 72 720 Td (Real pdftotext path) Tj ET')),
    );
    const result = extractPdfText(file);
    assert.equal(result.source, 'pdftotext');
    assert.match(result.text, /Real pdftotext path/);
  },
);

function pdf(content, compressed = false) {
  const stream = Buffer.concat([
    Buffer.from(
      `<< /Length ${content.length}${compressed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`,
    ),
    content,
    Buffer.from('\nendstream'),
  ]);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    ),
    stream,
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ];
  const parts = [Buffer.from('%PDF-1.4\n%\xff\xff\xff\xff\n', 'latin1')];
  const offsets = [0];
  let offset = parts[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(offset);
    const wrapped = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    parts.push(wrapped);
    offset += wrapped.length;
  }
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets
      .slice(1)
      .map((value) => `${String(value).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`,
  ].join('');
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}
