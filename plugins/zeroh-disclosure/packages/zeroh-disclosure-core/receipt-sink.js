// SPDX-License-Identifier: AGPL-3.0-only

// The receipt transport seam. Writers serialize once and hand over unchanged
// bytes plus the existing local path. Sinks are synchronous: hook writes must
// finish before process exit. No relay or tenant signing key lives here.
import { AsyncLocalStorage } from 'node:async_hooks';
import { writePrivateFile } from './private-fs.js';

const sinks = new AsyncLocalStorage();
export const localFileReceiptSink = Object.freeze({
  write({ path, bytes }) {
    return writePrivateFile(path, bytes);
  },
});

// Dependency injection scoped to one operation, including its async children.
export function withReceiptSink(sink, operation) {
  if (typeof sink?.write !== 'function')
    throw new TypeError('receipt sink requires write');
  return sinks.run(sink, operation);
}

export function writeReceiptBytes(path, bytes, kind = 'receipt') {
  if (
    ![
      'receipt',
      'receipt-html',
      'report-export',
      'pending-ledger',
      'keep-folder',
    ].includes(kind)
  )
    throw new TypeError('unknown receipt artifact kind');
  return (sinks.getStore() ?? localFileReceiptSink).write({
    kind,
    path,
    bytes: Buffer.from(bytes),
  });
}

// A pending turn already contains a signed prompt receipt, but also holds
// local commitment material. Only finalized, signed evidence is relayable.
function receiptKind(record) {
  const privateRecord = (value) =>
    value &&
    typeof value === 'object' &&
    (Object.hasOwn(value, 'local_private') ||
      Object.values(value).some(privateRecord));
  if (privateRecord(record)) return 'pending-ledger';
  if (Array.isArray(record?.receipts))
    return record.receipts.every((item) => receiptKind(item) === 'receipt')
      ? 'receipt'
      : 'pending-ledger';
  if (record?.receipt?.compact)
    return record.phase === 'finalized' || record.phase === undefined
      ? 'receipt'
      : 'pending-ledger';
  return record?.compact ? 'receipt' : 'pending-ledger';
}

export function writeReceiptJson(path, record, kind = receiptKind(record)) {
  return writeReceiptBytes(path, `${JSON.stringify(record, null, 2)}\n`, kind);
}
