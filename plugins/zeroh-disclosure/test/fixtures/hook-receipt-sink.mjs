// SPDX-License-Identifier: AGPL-3.0-only

// Execute the production hook inside an injected transport scope.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  localFileReceiptSink,
  withReceiptSink,
} from '../../packages/zeroh-disclosure-core/receipt-sink.js';
const sink = {
  write(item) {
    appendFileSync(
      process.env.ZEROH_TEST_SINK_LOG,
      `${JSON.stringify({ name: path.basename(item.path), kind: item.kind, hasLocalPrivate: item.bytes.includes('local_private') })}\n`,
      { mode: 0o600 },
    );
    return localFileReceiptSink.write(item);
  },
};
await withReceiptSink(
  sink,
  () => import(pathToFileURL(path.resolve(process.argv[2]))),
);
