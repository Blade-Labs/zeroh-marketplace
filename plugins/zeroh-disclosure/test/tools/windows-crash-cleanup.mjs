// SPDX-License-Identifier: AGPL-3.0-only

// Probe-only bounded joining and cleanup evidence. Query output is restricted
// to child processes whose command line names this disposable fixture.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

export function fixtureChildProcesses(directory) {
  const needle = path.resolve(directory).toLowerCase();
  let rows = [];
  if (process.platform === 'win32') {
    const tool = path.win32.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const result = spawnSync(
      tool,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($env:ZEROH_PROBE_JOIN_PATH) } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress',
      ],
      {
        env: { ...process.env, ZEROH_PROBE_JOIN_PATH: needle },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1000,
        cwd:
          process.env.SystemRoot ||
          process.env.SYSTEMROOT ||
          path.dirname(tool),
      },
    );
    if (result.status !== 0)
      return [
        {
          kind: 'unknown',
          error: result.error?.code || `exit ${result.status}`,
        },
      ];
    try {
      const values = JSON.parse(result.stdout || '[]');
      rows = (Array.isArray(values) ? values : [values]).map((row) => ({
        pid: row.ProcessId,
        command: row.CommandLine,
        name: row.Name,
      }));
    } catch {
      return [{ kind: 'unknown', error: 'process listing unreadable' }];
    }
  } else {
    const result = spawnSync('ps', ['-axww', '-o', 'pid=,args='], {
      encoding: 'utf8',
      timeout: 1000,
    });
    if (result.status !== 0)
      return [
        {
          kind: 'unknown',
          error: result.error?.code || `exit ${result.status}`,
        },
      ];
    rows = result.stdout.split('\n').flatMap((line) => {
      const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
      return match ? [{ pid: Number(match[1]), command: match[2] }] : [];
    });
  }
  return rows
    .filter((row) => row.command.toLowerCase().includes(needle))
    .map((row) => ({
      pid: row.pid,
      kind: /icacls(?:\.exe)?/iu.test(row.command) ? 'icacls' : 'child',
    }));
}

// Across thousands of fixtures, expensive cleanup gets at most one minute.
// Once spent, still attempt each removal once and preserve failure evidence.
const cleanupBudget = { remainingMs: 60_000 };
export async function removeProbeFixture(
  directory,
  failures,
  {
    processes = fixtureChildProcesses,
    remove = rmSync,
    waitMs = 5000,
    budget = cleanupBudget,
    now = () => performance.now(),
  } = {},
) {
  const started = now();
  const left = () => Math.max(0, budget.remainingMs - (now() - started));
  const end = started + Math.min(waitMs, budget.remainingMs);
  const removeNow = () =>
    remove(directory, {
      recursive: true,
      force: true,
      maxRetries: left() >= 1500 ? 5 : 0,
      retryDelay: 100,
    });
  let alive = [];
  try {
    // Usually there is nothing holding the fixture. No CIM query on success.
    removeNow();
  } catch (error) {
    alive =
      left() >= 1000
        ? processes(directory)
        : [{ kind: 'unknown', error: 'cleanup budget exhausted' }];
    while (
      alive.some((row) => row.kind !== 'unknown') &&
      now() < end &&
      left() >= 1100
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(100, Math.max(1, end - now()))),
      );
      alive = processes(directory);
    }
    try {
      removeNow();
      return;
    } catch (retryError) {
      error = retryError;
    }
    failures.push({
      directory: path.basename(directory),
      code: error.code,
      path: error.path || directory,
      icaclsAlive: alive.some((row) => row.kind === 'icacls'),
      childAlive: alive.some((row) => row.kind !== 'unknown'),
      processes: alive,
    });
  } finally {
    budget.remainingMs = left();
  }
}
