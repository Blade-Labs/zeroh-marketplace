#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// /zeroh-disclosure:status: the full banner with protection status and
// warnings.
import {
  activeUnmaskStatus,
  proxyStatusLines,
  renderBanner,
  warningLines,
} from '../../lib/banner.js';
import { scanSessionContext } from '../../packages/zeroh-disclosure-core/context-scan.js';
import { retentionLine } from '../../packages/zeroh-disclosure-core/receipt-retention.js';
import { projectDir, proxyState } from '../../lib/hook-io.js';
import { loadKnownSecrets } from '../../packages/shell-analysis/secrets.js';
import { proxyRuntimeStatus } from '../../packages/local-proxy/proxy-manager.js';
import {
  loadConfig,
  uncertainMode,
} from '../../packages/zeroh-disclosure-core/config.js';
import { commandSessionId } from './_helpers.js';
import { sessionPredatesInstall } from '../../lib/statusline.js';
import {
  storageProtectionStatus,
  STORAGE_PROTECTION_NOTICE,
} from '../../packages/zeroh-disclosure-core/private-fs.js';

const root = projectDir();
// The user's settings (and a repository's shorter receipt retention).
await loadConfig({ cwd: root });
const known = loadKnownSecrets(root);
const sessionId = commandSessionId();
const startedBeforeZeroH = sessionPredatesInstall({
  root,
  sessionId,
  env: process.env,
});
const proxy = await proxyState({ sessionId, root });
const unmask = await activeUnmaskStatus({ root, sessionId });
const contextFindings = scanSessionContext({ cwd: root, known });
const runtime = await proxyRuntimeStatus().catch(() => null);

const storage = storageProtectionStatus();
const extra = proxyStatusLines({
  proxy,
  runtime,
  uncertain: uncertainMode(),
});

if (storage) extra.push(`Storage protection: ${storage}.`);
if (storage === 'not confirmed') extra.push(STORAGE_PROTECTION_NOTICE);

process.stdout.write(
  `${renderBanner({
    mode: 'full',
    paused: false,
    markShown: false,
    known,
    proxy,
    startedBeforeZeroH,
    unmaskStatus: unmask.status,
    retention: retentionLine(),
    uncertain: uncertainMode(),
    warnings: warningLines({
      contextFindings,
      proxy,
      uncertain: uncertainMode(),
    }),
  })}\n${extra.length ? `\n${extra.join('\n')}\n` : ''}`,
);
