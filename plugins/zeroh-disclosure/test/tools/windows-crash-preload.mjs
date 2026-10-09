// SPDX-License-Identifier: AGPL-3.0-only

// Test-only preload. It is also inherited by real Worker threads, so ACL
// stubbing applies there without touching a production import or environment API.
import childProcess from 'node:child_process';
import threads from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { register, syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';

const variant = process.env.ZEROH_CRASH_PROBE_VARIANT;
const trace = (action) =>
  appendFileSync(
    process.env.ZEROH_CRASH_PROBE_TRACE,
    JSON.stringify({ action, pid: process.pid, thread: threads.threadId }) +
      '\n',
  );
if (variant === 'no-acl') {
  const spawn = childProcess.spawn;
  childProcess.spawn = (file, args, options) => {
    if (!/(?:^|[\\/])(?:whoami|icacls)\.exe$/iu.test(String(file)))
      return spawn(file, args, options);
    const identity = /whoami\.exe$/iu.test(String(file));
    trace(identity ? 'stub-whoami' : 'stub-icacls');
    if (args.includes('/save'))
      writeFileSync(
        args[args.indexOf('/save') + 1],
        `\uFEFF${path.basename(args[0])}\r\nD:P(A;OICI;FA;;;S-1-5-21-123)(A;OICI;FA;;;SY)\r\n`,
        'utf16le',
      );
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      child.stdout.end(identity ? '"ZEROHFAKE","S-1-5-21-123"' : '');
      child.emit('close', 0, null);
    });
    return child;
  };
  const execute = childProcess.execFileSync;
  childProcess.execFileSync = (file, ...args) => {
    if (/(?:^|[\\/])whoami\.exe$/iu.test(String(file))) {
      trace('stub-whoami');
      return '"ZEROHFAKE","S-1-5-21-123"';
    }
    if (/(?:^|[\\/])icacls\.exe$/iu.test(String(file))) {
      trace('stub-icacls');
      const toolArgs = args[0];
      if (toolArgs.includes('/save'))
        writeFileSync(
          toolArgs[toolArgs.indexOf('/save') + 1],
          `\uFEFF${path.basename(toolArgs[0])}\r\nD:P(A;OICI;FA;;;S-1-5-21-123)(A;OICI;FA;;;SY)\r\n`,
          'utf16le',
        );
      return '';
    }
    return execute(file, ...args);
  };
  syncBuiltinESMExports();
}
if (threads.isMainThread) {
  if (['no-bookkeeping', 'loader-control'].includes(variant))
    register(new URL('./windows-crash-loader.mjs', import.meta.url), {
      data: { variant, trace: process.env.ZEROH_CRASH_PROBE_TRACE },
    });
  const Worker = threads.Worker;
  threads.Worker = class extends Worker {
    constructor(url, options) {
      trace(
        String(url).endsWith('/timeout-bookkeeping.js')
          ? 'bookkeeping-worker'
          : 'main-worker',
      );
      super(url, options);
    }
  };
  syncBuiltinESMExports();
  if (variant === 'no-main-worker') {
    // Use the existing worker entry in this process. Actual process.exit
    // remains intact, as it would be in a dedicated hook process. This bypasses
    // run.js's loader/watchdog/status path, and is labelled accordingly.
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const stdout = process.stdout.write.bind(process.stdout);
    const stderr = process.stderr.write.bind(process.stderr);
    threads.workerData = {
      name: process.argv[2],
      input: raw,
      hookStartEpoch: performance.timeOrigin + performance.now(),
    };
    threads.parentPort = {
      postMessage(message) {
        if (message.type === 'stdout') stdout(message.data);
        if (message.type === 'stderr') stderr(message.data);
        if (message.type === 'error')
          stderr(
            `ZEROHFAKE in-process hook error: ${JSON.stringify(message.error)}\n`,
          );
      },
    };
    syncBuiltinESMExports();
    trace('in-process-worker-entry');
    await import('../../hooks/worker.js');
    await new Promise((resolve) => stdout('', resolve));
    process.exit(0);
  }
}
