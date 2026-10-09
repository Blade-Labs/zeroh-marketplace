// SPDX-License-Identifier: AGPL-3.0-only

// Test only: exercise Windows branches on every OS and make a synchronous
// Node subprocess in any worker an observable failure, even if caught.
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  appendFileSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import threads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import { isMainThread, threadId, workerData } from 'node:worker_threads';

Object.defineProperty(process, 'platform', { value: 'win32' });
let liveWorkers = 0;
const trace = (action, extra = {}) =>
  appendFileSync(
    process.env.ZEROH_WORKER_TEST_TRACE,
    JSON.stringify({
      action,
      pid: process.pid,
      threadId,
      liveWorkers,
      ...extra,
    }) + '\n',
  );
if (isMainThread) {
  const Worker = threads.Worker;
  threads.Worker = class extends Worker {
    constructor(...args) {
      super(...args);
      liveWorkers += 1;
      trace('worker-created', {
        bookkeeping: args[1]?.workerData?.count !== undefined,
      });
      this.once('exit', () => {
        liveWorkers -= 1;
        trace('worker-exit');
      });
    }
  };
}
const dacl = new Map();
const protectedDacl = 'D:P(A;OICI;FA;;;S-1-5-21-123)(A;OICI;FA;;;SY)';
function aclResult(file, args, options = {}) {
  if (/whoami\.exe$/iu.test(file)) return '"ZEROHFAKE","S-1-5-21-123"';
  if (!/icacls\.exe$/iu.test(file)) return '';
  if (args.includes('/save')) {
    const target = args[0];
    const state = dacl.get(target) || 'D:AI(A;OICI;FA;;;WD)';
    writeFileSync(
      args[args.indexOf('/save') + 1],
      `\uFEFF${path.basename(target)}\r\n${state}\r\n`,
      'utf16le',
    );
  }
  if (args.includes('/restore')) {
    const input = readFileSync(args[args.indexOf('/restore') + 1], 'utf16le')
      .replace(/^\uFEFF/u, '')
      .split(/\r?\n/u);
    dacl.set(path.join(args[0], input[0]), input[1]);
  }
  return '';
}
if (isMainThread) {
  childProcess.execFileSync = (file, args, options) => {
    const replacement = args.includes('/restore');
    const target = replacement
      ? path.join(
          args[0],
          readFileSync(args[args.indexOf('/restore') + 1], 'utf16le')
            .replace(/^\uFEFF/u, '')
            .split(/\r?\n/u)[0],
        )
      : args[0];
    trace('sync-child', {
      file,
      args,
      target,
      cwd: options?.cwd,
      timeout: options?.timeout,
    });
    if (
      (replacement &&
        ['stall', 'replace-stall', 'reset-stall', 'grant-stall'].includes(
          process.env.ZEROH_WORKER_TEST_ACL_FAILURE,
        )) ||
      process.env.ZEROH_WORKER_TEST_ACL_FAILURE === 'hang'
    ) {
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        options.timeout,
      );
      trace('kill-child');
      throw Object.assign(new Error('ZEROHFAKE timed out'), {
        code: 'ETIMEDOUT',
      });
    }
    if (
      replacement &&
      (['yes', 'grant'].includes(process.env.ZEROH_WORKER_TEST_ACL_FAILURE) ||
        (process.env.ZEROH_WORKER_TEST_ACL_FAILURE === 'home-only' &&
          target === process.env.ZEROH_HOME))
    )
      throw new Error('ZEROHFAKE ACL refusal');
    return aclResult(file, args, options);
  };
  childProcess.spawnSync = () => ({ status: 1, stdout: '' });
}
if (!isMainThread) {
  trace('worker-entry', { bookkeeping: workerData?.count !== undefined });
  for (const name of ['execFileSync', 'spawnSync', 'execSync']) {
    childProcess[name] = () => {
      trace('forbidden-sync', { name });
      throw new Error(`Windows worker called ${name}`);
    };
  }
}
const original = childProcess.spawn;
childProcess.spawn = (file, args, options) => {
  if (liveWorkers) trace('spawn-with-worker', { file, args });
  const host = args.some((arg) =>
    /[\\/]subprocess-host\.js$/u.test(String(arg)),
  );
  if (host) {
    trace('host-start', { cwd: options.cwd });
    if (process.env.ZEROH_WORKER_TEST_HOST_FAILURE === 'yes') {
      const child = new EventEmitter();
      setImmediate(() =>
        child.emit(
          'error',
          Object.assign(new Error('ZEROHFAKE host start refused'), {
            code: 'EACCES',
          }),
        ),
      );
      return child;
    }
  }
  const task = /schtasks\.exe$/iu.test(String(file));
  const replacement = args.includes('/restore');
  const acl =
    /(?:^|[\\/])(?:whoami|icacls)\.exe$/iu.test(String(file)) || replacement;
  if (!acl && !task && !String(file).startsWith('ZEROHFAKE-')) {
    trace('native-child', { file, args, cwd: options.cwd });
    const child = original(file, args, options);
    if (host && process.env.ZEROH_WORKER_TEST_HOST_DEATH === 'error') {
      const send = child.send.bind(child);
      child.send = (...values) => {
        child.send = send;
        setImmediate(() =>
          child.emit(
            'error',
            Object.assign(new Error('ZEROHFAKE IPC error'), { code: 'EPIPE' }),
          ),
        );
        return true;
      };
    }
    return child;
  }
  trace('async-child', {
    file,
    args,
    ...(replacement
      ? {
          target: path.join(
            args[0],
            readFileSync(args[args.indexOf('/restore') + 1], 'utf16le')
              .replace(/^\uFEFF/u, '')
              .split(/\r?\n/u)[0],
          ),
          sid: 'S-1-5-21-123',
        }
      : {}),
  });
  const child = new EventEmitter();
  child.pid = 123;
  child.unref = () => {
    trace('detach-child');
    return child;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    trace('kill-child');
    setImmediate(() => child.emit('close', null, 'SIGTERM'));
    return true;
  };
  const failure = process.env.ZEROH_WORKER_TEST_ACL_FAILURE;
  // Model the inherited DACL exposed by the old reset-first sequence. A
  // populated directory's files can inherit that broader DACL immediately.
  if (args.includes('/reset') && process.env.ZEROH_WORKER_TEST_ACL_STATE)
    writeFileSync(process.env.ZEROH_WORKER_TEST_ACL_STATE, 'broad');
  if (
    (replacement &&
      ['reset-stall', 'grant-stall', 'replace-stall'].includes(failure)) ||
    (args.includes('/reset') && failure === 'reset-stall') ||
    (args.includes('/grant:r') && failure === 'grant-stall')
  )
    return child;
  if (
    file === 'ZEROHFAKE-hang' ||
    (acl && process.env.ZEROH_WORKER_TEST_ACL_FAILURE === 'hang')
  )
    return child;
  const complete = () => {
    let status = 0;
    if (task) {
      if (
        args.includes('/Query') ||
        process.env.ZEROH_WORKER_TEST_TASK_FAILURE === 'yes'
      )
        status = 5;
      child.stdout.end();
      child.stderr.end(status ? 'ZEROHFAKE scheduler refused' : '');
      child.emit('close', status, null);
      return;
    }
    if (/whoami\.exe$/iu.test(file))
      child.stdout.end('"ZEROHFAKE","S-1-5-21-123"');
    else if (/icacls\.exe$/iu.test(file) || replacement) {
      if (replacement && process.env.ZEROH_WORKER_TEST_ACL_FAILURE === 'yes')
        status = 5;
      if (
        process.env.ZEROH_WORKER_TEST_ACL_FAILURE === 'grant' &&
        (args.includes('/grant:r') || replacement)
      )
        status = 5;
      if (
        replacement &&
        status === 0 &&
        process.env.ZEROH_WORKER_TEST_ACL_STATE
      )
        writeFileSync(process.env.ZEROH_WORKER_TEST_ACL_STATE, 'private');
      if (status === 0) aclResult(file, args, options);
      child.stdout.end();
    } else {
      child.stdout.end('ZEROHFAKE-output');
      child.stderr.end('ZEROHFAKE-stderr');
      if (file === 'ZEROHFAKE-fail') status = 7;
      if (file === 'ZEROHFAKE-missing')
        child.emit(
          'error',
          Object.assign(new Error('missing'), { code: 'ENOENT' }),
        );
    }
    child.emit('close', status, null);
  };
  if (
    acl &&
    replacement &&
    process.env.ZEROH_WORKER_TEST_ACL_FAILURE === 'stop'
  ) {
    process.emit('ZEROHFAKE-acl-started');
    setTimeout(complete, 50);
  } else if (replacement && failure === 'stall') setTimeout(complete, 2000);
  else setImmediate(complete);
  return child;
};
syncBuiltinESMExports();

if (
  !isMainThread &&
  workerData?.nonce &&
  process.env.ZEROH_WORKER_TEST_REMOVE_MARKER === 'yes'
) {
  unlinkSync(`${process.env.ZEROH_HOME}/.acl-protected`);
  // Explicit null is a completed, unsuccessful discovery, not a retry request.
  const { uninstallOwner } =
    await import('../../packages/zeroh-disclosure-core/uninstall-marker.js');
  uninstallOwner();
}
