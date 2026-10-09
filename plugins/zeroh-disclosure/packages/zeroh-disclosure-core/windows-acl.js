// SPDX-License-Identifier: AGPL-3.0-only

// icacls /save records: UTF-16LE, relative name, CRLF, SDDL, CRLF.
// Preserve the installed tool's BOM convention (historical versions differ).
// /restore replaces the directory's own DACL; inheritance propagates to children.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { execFileSync } from './child-process.js';

function systemTool(name, env) {
  return path.win32.join(
    env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows',
    'System32',
    name,
  );
}

// Microsoft SDDL SID Strings: only concrete user identities qualify. Group,
// logon-token, creator and domain-relative aliases cannot identify this user.
const USER_ALIASES = {
  SY: 'S-1-5-18',
  LS: 'S-1-5-19',
  NS: 'S-1-5-20',
  AN: 'S-1-5-7',
};
function principalSid(principal, sid, localAccount) {
  if (USER_ALIASES[principal]) return USER_ALIASES[principal];
  if (
    localAccount &&
    /^S-1-5-21-\d+-\d+-\d+-(?:500|501)$/u.test(sid) &&
    ((principal === 'LA' && sid.endsWith('-500')) ||
      (principal === 'LG' && sid.endsWith('-501')))
  )
    return sid;
  return principal;
}
export function verifiedWindowsDacl(record, name, sid, localAccount = false) {
  const lines = record.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  if (lines[0] !== name || lines.slice(2).some((line) => line.trim()))
    return false;
  // icacls may emit AI (auto-inherited) and the dummy SACL NO_ACCESS_CONTROL.
  const sddl = lines[1]?.replace(/S:NO_ACCESS_CONTROL$/u, '');
  const header = /^D:((?:P|AI|AR)*)(?=\()/u.exec(sddl || '');
  if (!header || !header[1].includes('P')) return false;
  const aces = [...sddl.slice(header[0].length).matchAll(/\(([^()]*)\)/gu)];
  if (
    aces.length !== 2 ||
    aces.map((ace) => ace[0]).join('') !== sddl.slice(header[0].length)
  )
    return false;
  const principals = [];
  for (const ace of aces) {
    const [type, flags, rights, object, inherited, principal, ...extra] =
      ace[1].split(';');
    if (
      type !== 'A' ||
      !['OICI', 'CIOI'].includes(flags) ||
      !['FA', '0x1f01ff'].includes(rights) ||
      object ||
      inherited ||
      extra.length
    )
      return false;
    principals.push(principalSid(principal, sid, localAccount));
  }
  return principals.sort().join(',') === [sid, 'S-1-5-18'].sort().join(',');
}

function* transaction(target, env) {
  const cwd = path.win32.dirname(systemTool('icacls.exe', env));
  const csv = String(
    yield [
      systemTool('whoami.exe', env),
      ['/user', '/fo', 'csv', '/nh'],
      { encoding: 'utf8', windowsHide: true, env, cwd },
    ],
  );
  const sid = /"(S-1-(?:\d+-)+\d+)"/u.exec(csv)?.[1];
  if (!sid) return false;
  const account = /^"([^"\r\n]+)"/u.exec(csv)?.[1];
  const authority = account?.split('\\');
  let localAccount =
    authority?.length === 2 &&
    authority[0].toLowerCase() === os.hostname().toLowerCase();
  const computer = env.COMPUTERNAME;
  if (
    !localAccount &&
    authority?.length === 2 &&
    /^S-1-5-21-\d+-\d+-\d+-(?:500|501)$/u.test(sid) &&
    typeof computer === 'string' &&
    /^[a-z0-9_-]{1,15}$/iu.test(computer) &&
    authority[0].toLowerCase() === computer.toLowerCase()
  ) {
    // Verify the NetBIOS name with the OS, rather than trusting environment
    // text or a possibly different DNS hostname to authorize LA/LG.
    try {
      const machine = String(
        yield [
          systemTool('WindowsPowerShell/v1.0/powershell.exe', env),
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '[Environment]::MachineName',
          ],
          { encoding: 'utf8', windowsHide: true, env, cwd },
        ],
      ).trim();
      localAccount = machine.toLowerCase() === computer.toLowerCase();
    } catch {
      // A failed name query cannot prove LA/LG, but numeric SID restore is safe.
      localAccount = false;
    }
  }
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zeroh-acl-'));
  const saved = path.join(directory, 'read.acl');
  const restore = path.join(directory, 'restore.acl');
  const name = path.basename(target);
  try {
    const save = [
      systemTool('icacls.exe', env),
      [target, '/save', saved, '/Q'],
      { stdio: 'ignore', windowsHide: true, env, cwd },
    ];
    yield save;
    if (
      verifiedWindowsDacl(
        readFileSync(saved, 'utf16le'),
        name,
        sid,
        localAccount,
      )
    )
      return 'root';
    const prefix = readFileSync(saved, 'utf16le').startsWith('\uFEFF')
      ? '\uFEFF'
      : '';
    writeFileSync(
      restore,
      `${prefix}${name}\r\nD:P(A;OICI;FA;;;${sid})(A;OICI;FA;;;SY)\r\n`,
      'utf16le',
    );
    yield [
      systemTool('icacls.exe', env),
      [path.dirname(target), '/restore', restore, '/Q'],
      { stdio: 'ignore', windowsHide: true, env, cwd },
    ];
    yield save;
    return verifiedWindowsDacl(
      readFileSync(saved, 'utf16le'),
      name,
      sid,
      localAccount,
    )
      ? 'tree'
      : false;
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 2,
      retryDelay: 25,
    });
  }
}
// One bounded synchronous attempt, only before hook workers exist. On timeout
// Node kills the child; partially propagated ACLs are an accepted known gap.
export function protectWindowsPath(
  target,
  {
    env = process.env,
    platform = process.platform,
    execute = execFileSync,
    timeout = 1800,
    onVerified = () => {},
  } = {},
) {
  if (platform !== 'win32' || !isMainThread) return false;
  const end = performance.now() + timeout;
  const work = transaction(target, env);
  try {
    let step = work.next();
    while (!step.done) {
      const left = Math.floor(end - performance.now());
      if (left <= 0) throw new Error('ACL budget expired');
      const [file, args, options] = step.value;
      try {
        step = work.next(
          execute(file, args, { ...options, timeout: Math.min(500, left) }),
        );
      } catch (error) {
        step = work.throw(error);
      }
    }
    if (step.value) onVerified({ fullApply: step.value === 'tree' });
    return Boolean(step.value);
  } catch (error) {
    try {
      work.throw(error);
    } catch {
      /* Best effort. */
    }
    return false;
  } finally {
    work.return();
  }
}
