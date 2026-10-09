// SPDX-License-Identifier: AGPL-3.0-only

// Private loader child, created before hook workers. No worker threads here.
// Commands and arguments arrive separately over IPC, never through a shell.
import { closeSync, openSync } from 'node:fs';
import { runSubprocess, spawn } from './child-process.js';

const children = new Map();
const send = (message) => {
  if (process.connected) process.send(message);
};
async function run(message) {
  const { id, file, args, options, operation } = message;
  if (operation === 'spawn') {
    let fd;
    try {
      const settings = { ...options };
      if (settings.zerohLogFile) {
        fd = openSync(settings.zerohLogFile, 'a', 0o600);
        settings.stdio = ['ignore', fd, fd];
      }
      const child = spawn(file, args, settings);
      children.set(id, child);
      child.stdin?.on('error', () => {});
      child.__zerohDetached = options.detached;
      let started = Boolean(child.pid);
      const startedAnswer = () =>
        send({ id, streaming: true, result: { pid: child.pid, status: 0 } });
      if (started) startedAnswer();
      else
        child.once('spawn', () => {
          started = true;
          startedAnswer();
        });
      child.on('error', (error) =>
        send(
          started
            ? {
                id,
                streaming: true,
                event: 'error',
                error: { message: error.message, code: error.code },
              }
            : {
                id,
                result: { error: { message: error.message, code: error.code } },
              },
        ),
      );
      child.on('exit', (code, signal) =>
        send({ id, streaming: true, event: 'exit', code, signal }),
      );
      child.on('close', (code, signal) => {
        children.delete(id);
        send({ id, streaming: true, event: 'close', code, signal });
      });
      if (options.detached) child.unref();
    } catch (error) {
      send({
        id,
        result: { error: { message: error.message, code: error.code } },
      });
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    return;
  }
  const result = await runSubprocess(file, args, options, (child) =>
    children.set(id, child),
  );
  children.delete(id);
  send({ id, result });
}
process.on('message', (message) => {
  if (!message.control) {
    void run(message);
    return;
  }
  const child = children.get(message.id);
  if (message.control.kill) child?.kill();
  if (message.control.input) child?.stdin?.write(message.control.input);
  if (message.control.end) child?.stdin?.end();
});
process.on('disconnect', () => {
  for (const child of children.values()) {
    // Detached daemons/removal own their lifetime; ordinary children stop.
    if (child.__zerohDetached) continue;
    child.kill();
  }
  process.exit(0);
});
