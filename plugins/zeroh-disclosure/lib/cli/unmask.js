// SPDX-License-Identifier: AGPL-3.0-only

import { envSessionId } from '../../packages/zeroh-disclosure-core/session.js';
import {
  activeGrants,
  capSummary,
  formatGrantTimeLeft,
  isPersonalDataType,
  isSecretType,
  normaliseKind,
  PERSONAL_DATA_TYPES,
  readGrantStore,
  revokeGrants,
  writeCap,
} from '../../packages/zeroh-disclosure-core/unmask.js';
import { authorized, print } from './shared.js';

export async function cmdUnmask(args, cwd) {
  const action = args._[1];
  if (action === 'caps') {
    if (args.list) {
      const loaded = capSummary();
      print(loaded, args.json, [
        ...(loaded.ignored
          ? [
              'warning: unmask.json failed signature verification; defaults are in effect',
            ]
          : []),
        ...Object.entries(loaded.caps).map(([kind, cap]) => `${kind}: ${cap}`),
      ]);
      return;
    }
    const kind = args._[2];
    const cap = args._[3];
    if (!kind || !cap) {
      throw new Error('unmask caps requires <KIND> <15m|1h|session|0>');
    }
    if (!(await authorized())) return;
    const caps = writeCap(kind, cap);
    print(
      { action: 'cap_updated', kind: kind.toUpperCase(), cap, caps },
      args.json,
      [`${kind.toUpperCase()} unmask cap: ${cap}`],
    );
    return;
  }
  if (action === 'revoke') {
    const target = args._[2] || 'all';
    const revoked = revokeGrants(cwd, target);
    print({ action: 'revoked', target, grants: revoked }, args.json, [
      revoked.length
        ? `Revoked ${revoked.length} unmask grant(s): ${revoked.map(({ id }) => id).join(', ')}`
        : 'No unmask grants to revoke.',
    ]);
    return;
  }
  if (action) {
    unmaskRequest(args, action);
    return;
  }

  const sessionId = args.session || envSessionId();
  const grants = activeGrants(cwd, { sessionId });
  const loaded = readGrantStore(cwd);
  print(
    { grants, ignored: loaded.ignored },
    args.json,
    grants.length
      ? grants.map(
          (grant) =>
            `${grant.id}  ${grant.kind}  ${formatGrantTimeLeft(grant)}  ${grant.reason}`,
        )
      : [
          ...(loaded.ignored
            ? [
                'Warning: the signed grant file was changed by hand and is ignored.',
              ]
            : []),
          'No active unmask grants.',
        ],
  );
  if (!args.json) console.log(unmaskHowToAsk());
}

// A function, not a module constant: main() runs before later constants exist.
function unmaskHowToAsk() {
  return 'To ask Claude to unmask a kind: /zeroh-disclosure:unmask EMAIL <why>. You decide in the dialog; keys are never unmasked.';
}

// `unmask <KIND> <why…>` names a request for Claude to make with the
// request_unmask tool; the grant itself is only ever made in the user's dialog.
function unmaskRequest(args, rawKind) {
  const kind = normaliseKind(rawKind);
  const reason = args._.slice(2).join(' ').trim();
  if (isSecretType(kind)) {
    print({ action: 'refused', kind }, args.json, [
      `${kind} is a secret or credential type. Keys are never unmasked.`,
    ]);
    return;
  }
  if (!isPersonalDataType(kind)) {
    throw new Error(
      `unknown unmask kind ${kind}. Kinds: ${PERSONAL_DATA_TYPES.join(', ')}`,
    );
  }
  if (!reason) {
    print({ action: 'needs_reason', kind }, args.json, [
      `Say why Claude should see ${kind} values: /zeroh-disclosure:unmask ${kind} <why>`,
    ]);
    return;
  }
  print({ action: 'request', kind, reason }, args.json, [
    `Unmask request: kind ${kind}, reason "${reason}". Claude asks with request_unmask; you decide in Claude Code's dialog.`,
  ]);
}

// `statusline` prints ZeroH's status line (lib/statusline.js; Claude Code
// runs it, see lib/statusline-settings.js). `statusline on|off` turns
// Claude Code's statusLine entry on or off (lib/statusline-settings.js), for
// the user only.
