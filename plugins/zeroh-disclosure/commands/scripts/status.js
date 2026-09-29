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
import { scanSessionContext } from '../../lib/context-scan.js';
import { retentionLine } from '../../lib/receipt-retention.js';
import { projectDir, proxyState } from '../../lib/hook-io.js';
import { loadKnownSecrets } from '../../lib/secrets.js';
import { proxyRuntimeStatus } from '../../lib/proxy-manager.js';
import { loadConfig, uncertainMode } from '../../lib/config.js';
import { commandSessionId } from './_helpers.js';

const root = projectDir();
// The user's settings (and a repository's shorter receipt retention).
await loadConfig({ cwd: root });
const known = loadKnownSecrets(root);
const sessionId = commandSessionId();
const proxy = await proxyState({ sessionId });
const unmask = await activeUnmaskStatus({ root, sessionId });
const contextFindings = scanSessionContext({ cwd: root, known });
const runtime = await proxyRuntimeStatus().catch(() => null);

const extra = proxyStatusLines({
  proxy,
  runtime,
  uncertain: uncertainMode(),
});

process.stdout.write(
  `${renderBanner({
    mode: 'full',
    markShown: false,
    known,
    proxy,
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
