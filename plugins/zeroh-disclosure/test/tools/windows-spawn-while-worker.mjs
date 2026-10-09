// SPDX-License-Identifier: AGPL-3.0-only

// Minimal upstream reproduction candidate: no Disclosure imports or preload.
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';

const worker = new Worker(
  `
  const { parentPort } = require('node:worker_threads');
  setInterval(() => {}, 1000);
  parentPort.postMessage('ready');
`,
  { eval: true },
);
await once(worker, 'message');
const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
  stdio: 'ignore',
  windowsHide: true,
});
const [code] = await once(child, 'exit');
await worker.terminate();
if (code !== 0) throw new Error(`trivial child exited ${code}`);
console.log('ZEROHFAKE-control-ok');
