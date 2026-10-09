// SPDX-License-Identifier: AGPL-3.0-only

import { spawn } from '../../packages/zeroh-disclosure-core/child-process.js';
import { rmSync } from 'node:fs';

import {
  failRemoval,
  finishRemoval,
  stopRemovalHeartbeat,
} from '../../packages/zeroh-disclosure-core/user-authority.js';

export const removalState = {
  lock: null,
  localCleanupDone: false,
  failure: null,
  remainingSteps: [],
};

export async function finishUninstall(command) {
  stopRemovalHeartbeat();
  if (removalState.lock && !removalState.localCleanupDone) {
    failRemoval();
  }
  if (command === 'uninstall' && (removalState.lock || removalState.failure)) {
    console.log(
      removalState.localCleanupDone
        ? 'ZeroH Disclosure: local cleanup finished.'
        : `ZeroH Disclosure: local cleanup failed${removalState.failure ? ` (${removalState.failure})` : ' before completion'}.`,
    );
    if (removalState.remainingSteps.length) {
      console.log(`Remaining steps: ${removalState.remainingSteps.join('; ')}`);
    }
  }
  if (removalState.lock) {
    finishRemoval(removalState.lock, {
      cleanupDirectory: removalState.localCleanupDone,
    });
  }
  if (
    removalState.localCleanupDone &&
    !removalState.failure &&
    removalState.remainingSteps.length === 0 &&
    process.env.ZEROH_REMOVAL_LOG_DIR
  ) {
    const logDir = process.env.ZEROH_REMOVAL_LOG_DIR;
    if (process.platform === 'win32') {
      const cleaner = spawn(
        process.execPath,
        [
          '-e',
          `const fs=require('node:fs'); const dir=process.argv[1]; const pid=Number(process.argv[2]); let attempts=0; const retry=()=>{if(++attempts>8)return; try{process.kill(pid,0);setTimeout(retry,Math.min(100*attempts,800))}catch{try{fs.rmSync(dir,{recursive:true,force:true})}catch{setTimeout(retry,Math.min(100*attempts,800))}}};retry();`,
          logDir,
          String(process.pid),
        ],
        { detached: true, stdio: 'ignore', windowsHide: true },
      );
      cleaner.unref();
    } else {
      rmSync(logDir, { recursive: true, force: true });
    }
  }
}
