// SPDX-License-Identifier: AGPL-3.0-only

// Node 26 on Windows can crash when a process spawns while a worker is alive.
// Hooks that need a subprocess host create it before either worker. Workers
// wait on messages; the host creates children without worker threads. Unix and CLI
// main threads retain the original Node APIs.
import {
  execFileSync as nodeExecFileSync,
  spawnSync as nodeSpawnSync,
  spawn as nodeSpawn,
} from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isMainThread,
  MessageChannel,
  parentPort,
  receiveMessageOnPort,
} from 'node:worker_threads';

function subprocessError(error) {
  if (!error) return undefined;
  return Object.fromEntries(
    ['message', 'code', 'errno', 'syscall', 'path', 'spawnargs'].map((key) => [
      key,
      error[key],
    ]),
  );
}

function request(file, args, options, operation = 'subprocess') {
  // The host itself has a neutral cwd; requested commands retain worker semantics.
  options = { ...options, cwd: options.cwd || process.cwd() };
  let streaming = false;
  const { port1, port2 } = new MessageChannel();
  const done = new Int32Array(new SharedArrayBuffer(4));
  try {
    parentPort.postMessage(
      { type: 'subprocess', operation, file, args, options, done, port: port2 },
      [port2],
    );
    // The loader's watchdog can terminate this wait just like any other
    // synchronous hook work. Only the worker waits; the loader stays live.
    const waited = Atomics.wait(
      done,
      0,
      0,
      options.timeout ? options.timeout + 1000 : undefined,
    );
    if (waited === 'timed-out')
      return {
        status: null,
        signal: null,
        error: Object.assign(new Error('subprocess response timed out'), {
          code: 'ETIMEDOUT',
        }),
      };
    const result = receiveMessageOnPort(port1)?.message;
    if (!result) throw new Error('subprocess response missing');
    for (const key of ['stdout', 'stderr']) {
      if (result[key] instanceof Uint8Array)
        result[key] = Buffer.from(result[key]);
    }
    result.output = [null, result.stdout, result.stderr];
    if (result.error)
      result.error = Object.assign(
        new Error(result.error.message),
        result.error,
      );
    if (operation === 'spawn' && result.pid) {
      result.port = port1;
      streaming = true;
    }
    return result;
  } finally {
    if (!streaming) port1.close();
  }
}

export function spawnSync(file, args, options = {}) {
  if (process.platform !== 'win32' || isMainThread)
    return nodeSpawnSync(file, args, options);
  return request(file, args, options);
}

export function execFileSync(file, args, options = {}) {
  if (process.platform !== 'win32' || isMainThread)
    return nodeExecFileSync(file, args, options);
  const result = request(file, args, options);
  if (result.error || result.status !== 0) {
    throw Object.assign(
      result.error || new Error(`Command failed: ${file}`),
      result,
    );
  }
  return result.stdout;
}

// Run a child asynchronously on the loader thread with the result shape the
// existing synchronous callers consume. onChild gives the loader ownership.
export function runSubprocess(file, args, options, onChild = () => {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = nodeSpawn(file, args, { ...options, timeout: undefined });
      onChild(child);
    } catch (error) {
      resolve({ status: null, signal: null, error: subprocessError(error) });
      return;
    }
    let error;
    const buffers = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    const maxBuffer = options.maxBuffer ?? 1024 * 1024;
    const kill = (code) => {
      error ||= Object.assign(new Error(`subprocess ${code}`), { code });
      child.kill(options.killSignal || 'SIGTERM');
    };
    const timer = options.timeout
      ? setTimeout(() => kill('ETIMEDOUT'), options.timeout)
      : null;
    for (const key of ['stdout', 'stderr']) {
      child[key]?.on('data', (chunk) => {
        sizes[key] += chunk.length;
        if (sizes[key] > maxBuffer) kill('ENOBUFS');
        else buffers[key].push(chunk);
      });
    }
    child.once('error', (failure) => {
      error ||= failure;
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(options.input);
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      const output = (key) => {
        if (!child[key]) return null;
        const bytes = Buffer.concat(buffers[key]);
        return options.encoding && options.encoding !== 'buffer'
          ? bytes.toString(options.encoding)
          : bytes;
      };
      resolve({
        pid: child.pid,
        status,
        signal,
        error: subprocessError(error),
        stdout: output('stdout'),
        stderr: output('stderr'),
      });
    });
  });
}

// Windows hook workers retain their isolation. Their child creation runs in
// a separate process, started before ANY hook or bookkeeping worker exists.
// That process never creates a worker thread.
let subprocessHost = null;
let hostFailure = null;
let hostId = 0;
const hostRequests = new Map();
function unavailableResult(error = hostFailure) {
  return {
    status: null,
    signal: null,
    error: subprocessError(
      error ||
        Object.assign(new Error('Windows subprocess service is unavailable'), {
          code: 'ENOSYS',
        }),
    ),
  };
}
export async function startWindowsSubprocessHost(onUnavailable = () => {}) {
  if (!isMainThread)
    throw new Error('subprocess host must start on the main thread');
  if (subprocessHost) return;
  let host;
  const markDead = (error) => {
    if (hostFailure) return;
    hostFailure =
      error ||
      Object.assign(new Error('subprocess host exited'), { code: 'EPIPE' });
    subprocessHost = null;
    if (host?.connected) host.disconnect();
    onUnavailable(hostFailure);
    for (const respond of [...hostRequests.values()])
      respond({ result: unavailableResult() });
    hostRequests.clear();
  };
  hostFailure = null;
  try {
    host = nodeSpawn(
      process.execPath,
      [
        ...process.execArgv,
        fileURLToPath(new URL('./subprocess-host.js', import.meta.url)),
      ],
      {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true,
        cwd: process.env.SystemRoot || process.env.SYSTEMROOT || os.homedir(),
        serialization: 'advanced',
      },
    );
    subprocessHost = host;
    host.on('message', (message) => hostRequests.get(message.id)?.(message));
    // Permanent: send() on a closed IPC channel emits error after startup too.
    host.on('error', markDead);
    host.on('exit', () => markDead());
    host.on('disconnect', () => markDead());
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            Object.assign(new Error('subprocess host startup timed out'), {
              code: 'ETIMEDOUT',
            }),
          ),
        500,
      );
      const ready = () => {
        clearTimeout(timer);
        resolve();
      };
      const failed = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      host.once('spawn', ready);
      host.once('error', failed);
      host.once('exit', () =>
        failed(new Error('subprocess host exited during startup')),
      );
      host.once('disconnect', () =>
        failed(new Error('subprocess host disconnected during startup')),
      );
    });
    if (hostFailure) throw hostFailure;
  } catch (error) {
    markDead(error);
    throw error;
  }
}
export function stopWindowsSubprocessHost() {
  if (subprocessHost?.connected) subprocessHost.disconnect();
}
function sendToHost(message) {
  const host = subprocessHost;
  if (!host?.connected) return false;
  try {
    host.send(message, (error) => {
      if (error) host.emit('error', error);
    });
    return true;
  } catch (error) {
    host.emit('error', error);
    return false;
  }
}
function hostRequest(message, respond) {
  const id = ++hostId;
  let streaming = false;
  hostRequests.set(id, (response) => {
    if (streaming && response.result?.error) {
      respond({
        streaming: true,
        event: 'error',
        error: response.result.error,
      });
      respond({ streaming: true, event: 'close', code: null, signal: null });
      hostRequests.delete(id);
      return;
    }
    streaming ||= response.streaming;
    respond(response);
    if (!response.streaming || response.event === 'close')
      hostRequests.delete(id);
  });
  if (!sendToHost({ ...message, id })) {
    hostRequests.get(id)?.({ result: unavailableResult() });
  }
  return id;
}

// Async callers (clipboard, proxy startup and detached removal) use the same
// prestarted host. Only stdin and ignore/file stdout are needed by hooks.
export function spawn(file, args, options = {}) {
  if (process.platform !== 'win32' || isMainThread)
    return nodeSpawn(file, args, options);
  const result = request(file, args, options, 'spawn');
  const child = new EventEmitter();
  child.pid = result.pid;
  child.stdin = new PassThrough();
  child.unref = () => result.port?.unref();
  child.kill = () => {
    result.port?.postMessage({ kill: true });
    return true;
  };
  if (result.error) {
    setImmediate(() => child.emit('error', result.error));
    return child;
  }
  child.stdin.on('data', (input) => result.port.postMessage({ input }));
  child.stdin.on('end', () => result.port.postMessage({ end: true }));
  result.port.on('message', (message) => {
    if (message.event === 'error')
      child.emit(
        'error',
        Object.assign(new Error(message.error.message), message.error),
      );
    else child.emit(message.event, message.code, message.signal);
    if (message.event === 'close') result.port.close();
  });
  return child;
}

// Workers use only the prestarted host for optional command execution.
export function serveWorkerSubprocesses(
  worker,
  { onUnavailable = () => {} } = {},
) {
  const active = new Set();
  const requestIds = new Set();
  let stopped = false;
  worker.on('exit', () => {
    stopped = true;
    for (const port of active) port.close();
    active.clear();
    for (const id of requestIds) hostRequests.delete(id);
    requestIds.clear();
  });
  worker.on('message', (message) => {
    if (message?.type !== 'subprocess' || stopped) return;
    const { file, args, options, port, done, operation } = message;
    if (!subprocessHost) {
      const result = unavailableResult();
      onUnavailable(result.error);
      port.postMessage(result);
      Atomics.store(done, 0, 1);
      Atomics.notify(done, 0);
      port.close();
      return;
    }
    active.add(port);
    let id;
    id = hostRequest({ file, args, options, operation }, (response) => {
      if (stopped) return;
      if (!subprocessHost || hostFailure) onUnavailable(hostFailure);
      port.postMessage(response.result || response);
      if (response.result) {
        Atomics.store(done, 0, 1);
        Atomics.notify(done, 0);
      }
      if (!response.streaming || response.event === 'close') {
        active.delete(port);
        requestIds.delete(id);
        port.close();
      }
    });
    port.on('message', (input) => sendToHost({ id, control: input }));
    if (hostRequests.has(id)) requestIds.add(id);
  });
}
