// SPDX-License-Identifier: AGPL-3.0-only

import { spawnSync } from 'node:child_process';

export function hookChildDiagnostics(result) {
  return `exit code=${Object.hasOwn(result, 'status') ? result.status : result.code}; signal=${result.signal ?? null}; stderr=${String(result.stderr ?? '')}; stdout=${String(result.stdout ?? '')}`;
}

// Test-only allowance for owner rulings WIN12/WIN14. Product calls never retry.
// Deliberate synchronous busy loops stress the Windows Node 26 JIT/worker
// teardown crash more often, so explicitly marked fixtures get two retries.
// Ordinary hooks retain one. Answers, modes and deadlines never trigger retries.
function retryPolicy({
  platform = process.platform,
  nodeVersion = process.versions.node,
  deliberateBusyLoop = false,
  log = (message) => console.error(message),
} = {}) {
  const limit = deliberateBusyLoop ? 2 : 1;
  return (result, retry, label) => {
    if (
      retry < limit &&
      platform === 'win32' &&
      nodeVersion.startsWith('26.') &&
      !result.error &&
      !result.signal &&
      [0xc0000005, 0x80000003].includes(result.status) &&
      (String(result.stderr ?? '') === '' ||
        /V8_Fatal|Fatal error in .*v8|FATAL ERROR:.*\bv8\b/iu.test(
          String(result.stderr),
        ))
    ) {
      log(
        `[ZeroH test retry] Windows Node ${nodeVersion} hook ${label} exited 0x${result.status.toString(16)}; ${limit === 1 ? 'retrying once' : `retry ${retry + 1} of 2 (deliberate busy-loop fixture stresses V8 JIT/worker teardown)`} (known V8 crash). ${hookChildDiagnostics(result)}`,
      );
      return true;
    }
    return false;
  };
}

export function spawnHookSync(executable, args, options, controls = {}) {
  const spawn = controls.spawn ?? spawnSync;
  const retry = retryPolicy(controls);
  let result;
  let attempts = 0;
  do {
    result = spawn(executable, args, options);
  } while (retry(result, attempts++, args.at(-1)));
  return result;
}

// The async caller collects streams and timings for each individual child.
// Return only the final attempt, preserving its original deadline checks.
export async function runHookChild(attempt, label, controls = {}) {
  const retry = retryPolicy(controls);
  let result;
  let attempts = 0;
  do {
    result = await attempt();
  } while (retry(result, attempts++, label));
  return result;
}
