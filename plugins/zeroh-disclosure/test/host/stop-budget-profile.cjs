// Test-only preload, inherited by the hook's worker via NODE_OPTIONS. Count
// actual built-in operations without adding instrumentation to product code.
const fs = require('node:fs');
const promises = require('node:fs/promises');
const { syncBuiltinESMExports } = require('node:module');
const { isMainThread, threadId } = require('node:worker_threads');

const output = process.env.ZEROH_STOP_PROFILE;
if (!output) throw new Error('Stop profiling requires an isolated output path');
const writeFileSync = fs.writeFileSync;
const counts = {
  fileReads: 0,
  fileBytes: 0,
  ledgerReads: {},
  parses: 0,
  parsedBytes: 0,
  verifications: 0,
};

function countRead(file) {
  counts.fileReads++;
  const turn = /(?:^|[/\\])turn-(\d+)\.json$/u.exec(String(file))?.[1];
  if (turn) counts.ledgerReads[turn] = (counts.ledgerReads[turn] || 0) + 1;
}

const readFileSync = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
  countRead(file);
  const value = readFileSync.call(this, file, ...args);
  counts.fileBytes += Buffer.byteLength(value);
  return value;
};
const readFile = promises.readFile;
promises.readFile = async function (file, ...args) {
  countRead(file);
  const value = await readFile.call(this, file, ...args);
  counts.fileBytes += Buffer.byteLength(value);
  return value;
};
syncBuiltinESMExports();

const parse = JSON.parse;
JSON.parse = function (value, ...args) {
  counts.parses++;
  counts.parsedBytes += Buffer.byteLength(String(value));
  return parse.call(this, value, ...args);
};
const subtle = globalThis.crypto.subtle;
const verify = subtle.verify;
subtle.verify = function (...args) {
  counts.verifications++;
  return verify.apply(this, args);
};

process.on('exit', () => {
  // cpuUsage on the main thread includes the worker and crypto pool. Only
  // record it once; each thread's work counters are added by the parent test.
  const cpu = isMainThread ? process.cpuUsage() : null;
  writeFileSync(
    `${output}.${threadId}.json`,
    JSON.stringify({ ...counts, cpu, isMainThread }),
  );
});
