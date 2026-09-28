// SPDX-License-Identifier: AGPL-3.0-only

// The hook's thread under hooks/run.js. It gives the hook what it had as a
// process of its own: the event (globalThis.zerohHook.input, read by
// lib/hook-io.js readStdinJson), stdout and stderr (sent to the loader, which
// writes them in order), process.exit (ends this thread; the loader uses its
// code) and the state the loader's fail-closed answer depends on.
import { parentPort, workerData } from 'node:worker_threads';

const post = (message) => parentPort.postMessage(message);

// Every change to the state goes to the loader at once, so an answer after a
// timeout knows what the hook had already done.
const values = { emitted: false, cleared: false, sideEffect: null };
const state = {};
for (const key of Object.keys(values)) {
  Object.defineProperty(state, key, {
    enumerable: true,
    get: () => values[key],
    set: (value) => {
      values[key] = value;
      post({ type: 'state', state: { [key]: value } });
    },
  });
}
globalThis.zerohHook = { input: workerData.input, state, worker: true };

function forward(type) {
  return (chunk, encoding, callback) => {
    const data =
      typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk).toString(
            typeof encoding === 'string' ? encoding : 'utf8',
          );
    post({ type, data });
    const done = typeof encoding === 'function' ? encoding : callback;
    if (typeof done === 'function') done();
    return true;
  };
}
process.stdout.write = forward('stdout');
process.stderr.write = forward('stderr');

function report(error) {
  post({
    type: 'error',
    error: {
      name: error?.name || 'Error',
      code: error?.code ? String(error.code) : undefined,
    },
  });
  process.exit(1);
}
process.on('uncaughtException', report);
process.on('unhandledRejection', report);

try {
  await import(`./${workerData.name}.js`);
} catch (error) {
  report(error);
}
