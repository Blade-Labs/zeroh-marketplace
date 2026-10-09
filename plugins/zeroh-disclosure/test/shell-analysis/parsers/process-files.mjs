// SPDX-License-Identifier: AGPL-3.0-only

// SPDX-License-Identifier: MIT
import { spawn, spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const diagnosticCommands = new AsyncLocalStorage();
const pendingCleanup = new Map();

// Defender and asynchronously closing job handles can outlive process close.
// Preserve effect results and retry leftovers at the end of collection.
export function cleanupDirectory(root, { remove = rmSync } = {}) {
  try {
    remove(root, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    });
    pendingCleanup.delete(root);
    return null;
  } catch (error) {
    const diagnostic = {
      program: 'fixture-cleanup',
      status: null,
      error: error.code,
      stderr: safeDiagnosticText(
        `cleanup deferred: ${error.code || error.name}; directory=${root}`,
      ),
    };
    pendingCleanup.set(root, diagnostic);
    diagnosticCommands.getStore()?.push(diagnostic);
    process.stderr.write(diagnostic.stderr + '\n');
    return diagnostic;
  }
}

export function retryFixtureCleanup({ roots, ...options } = {}) {
  return [...pendingCleanup.keys()]
    .filter((root) => !roots || roots.includes(root))
    .map((root) => cleanupDirectory(root, options))
    .filter(Boolean);
}

export function safeDiagnosticText(value) {
  return String(value ?? '')
    .replace(/\x1b\[[0-9;]*m/gu, '')
    .replace(
      /(authorization|password|secret|token)\s*[:=]\s*[^\s,;]+/giu,
      '$1=[redacted]',
    )
    .replace(/Bearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/giu, '$1[redacted]@')
    .replace(/[A-Za-z0-9_+/=-]{24,}/gu, '[redacted]')
    .split(/\r?\n/u)
    .slice(0, 5)
    .map((line) => line.slice(0, 300))
    .join('\n');
}

function recordCommand(executable, result) {
  const commands = diagnosticCommands.getStore();
  if (!commands || (!result.stderr && !result.error && result.status === 0))
    return result;
  commands.push({
    program: path.basename(executable),
    status: result.status ?? null,
    signal: result.signal ?? null,
    elapsedMs: result.elapsedMs,
    error: result.error?.code,
    stderr: safeDiagnosticText(result.stderr || result.error?.code),
  });
  return result;
}

export async function captureCommandDiagnostics(run) {
  const commands = [];
  return diagnosticCommands.run(commands, async () => {
    try {
      return { result: await run(), commands };
    } catch (error) {
      return { error, commands };
    }
  });
}

// Use real stdin/stdout descriptors. Some restricted hosts cannot poll Node's
// socket-backed subprocess pipes; a zero exit alone then loses the hook answer.
// Files also keep command/value bytes out of parent-process diagnostics.
function transport(executable, options) {
  const temporary = options.env?.TMPDIR;
  if (!temporary) throw new Error('Isolated subprocess TMPDIR is required');
  const root = mkdtempSync(path.join(temporary, 'zeroh-process-'));
  const files = ['input', 'output', 'error'].map((name) =>
    path.join(root, name),
  );
  writeFileSync(files[0], options.input ?? '');
  const descriptors = files.map((file, index) =>
    openSync(file, index ? 'w' : 'r'),
  );
  const { input, encoding, ...rest } = options;
  return {
    options: {
      ...rest,
      env: {
        ...rest.env,
        // Leave time for bridge diagnostics and descendant cleanup before Node
        // kills the bridge. Corpus calls have a much larger caller budget.
        ...(/(?:^|[\\/])fixture-powershell\.exe$/iu.test(executable)
          ? {
              ZEROH_ORACLE_CHILD_TIMEOUT_MS: String(
                options.timeout > 0
                  ? Math.max(
                      100,
                      options.timeout - Math.min(10000, options.timeout / 2),
                    )
                  : 120000,
              ),
            }
          : {}),
      },
      stdio: descriptors,
    },
    result: (result) => ({
      ...result,
      stdout: readFileSync(files[1], encoding ?? 'utf8'),
      stderr: readFileSync(files[2], encoding ?? 'utf8'),
    }),
    cleanup() {
      for (const descriptor of descriptors) closeSync(descriptor);
      cleanupDirectory(root);
    },
  };
}

export function spawnFileSync(executable, args, options) {
  const files = transport(executable, options);
  const started = performance.now();
  try {
    const result = spawnSync(executable, args, files.options);
    return recordCommand(
      executable,
      files.result({
        ...result,
        elapsedMs: Math.round(performance.now() - started),
      }),
    );
  } finally {
    files.cleanup();
  }
}

export async function spawnFile(executable, args, options) {
  const files = transport(executable, options);
  const started = performance.now();
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, args, files.options);
      let failure;
      child.once('error', (error) => {
        failure = error;
      });
      child.once('close', (status, signal) => {
        const result = recordCommand(
          executable,
          files.result({
            status,
            signal,
            error: failure,
            elapsedMs: Math.round(performance.now() - started),
          }),
        );
        if (failure) reject(failure);
        else resolve(result);
      });
    });
  } finally {
    files.cleanup();
  }
}
