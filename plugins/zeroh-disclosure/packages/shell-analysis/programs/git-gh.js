// SPDX-License-Identifier: AGPL-3.0-only

import { readOptions } from './options.js';

const GIT_OPTIONS = {
  values:
    '-C -c --git-dir --work-tree --namespace --super-prefix --config-env --list-cmds --attr-source',
  operandStops: true,
};
// Subcommands that talk to a remote. Where it is comes from the repository's
// configuration, or an operand.
const GIT_NETWORK = new Set(
  (
    'push fetch pull clone ls-remote remote submodule send-email request-pull ' +
    'svn p4 lfs fetch-pack send-pack http-fetch http-push imap-send ' +
    'cvsimport cvsexportcommit archimport daemon instaweb credential'
  ).split(/\s+/u),
);
// Subcommands that only work on the local repository.
const GIT_LOCAL = new Set(
  (
    'add am annotate apply archive bisect blame branch bundle cat-file check-attr ' +
    'check-ignore check-mailmap check-ref-format checkout checkout-index cherry ' +
    'cherry-pick clean commit commit-graph commit-tree config count-objects describe ' +
    'diff diff-files diff-index diff-tree fast-export fast-import for-each-ref ' +
    'format-patch fsck gc get-tar-commit-id grep hash-object help index-pack init ' +
    'interpret-trailers log ls-files ls-tree mailinfo mailsplit maintenance merge ' +
    'merge-base merge-file merge-tree mktag mktree multi-pack-index mv name-rev notes ' +
    'pack-objects pack-refs prune prune-packed range-diff read-tree rebase reflog ' +
    'repack replace rerere reset restore rev-list rev-parse revert rm shortlog show ' +
    'show-branch show-index show-ref sparse-checkout stash status stripspace switch ' +
    'symbolic-ref tag unpack-file unpack-objects update-index update-ref ' +
    'update-server-info var verify-commit verify-pack verify-tag version whatchanged ' +
    'worktree write-tree'
  ).split(/\s+/u),
);
// `remote` subcommands that stay local.
const GIT_REMOTE_LOCAL = new Set([
  'add',
  'rename',
  'remove',
  'rm',
  'set-branches',
  'set-url',
  'get-url',
  '-v',
  '--verbose',
]);
// Configuration that names a program to run or where a remote is.
const GIT_COMMAND_CONFIG_RE =
  /^(?:alias\..+|core\.(?:sshcommand|pager|editor|askpass|fsmonitor|hookspath|gitproxy)|sequence\.editor|gpg\.(?:.+\.)?program|diff\.external|credential\..+|url\..+|remote\..+|include(?:if\..+)?\.path|.+\.(?:command|cmd|helper|textconv|driver|process|clean|smudge|tool|proxy))$/iu;

// git subcommands that change or delete the files they name: the settings
// guard stops one naming a protected path (packages/shell-analysis/settings-guard.js).
export const GIT_WRITE_SUBCOMMANDS = new Set([
  'rm',
  'mv',
  'restore',
  'checkout',
  'apply',
  'clean',
]);

// { subcommand, kind: 'local' | 'network' | 'unknown', commandConfig, urls:
// [word] } for a git command: `network` talks to a remote, `unknown` is an
// alias or an external `git-foo`. `commandConfig`: a `-c` names a program
// to run or where a remote is.
export function gitCommand(entry) {
  const read = readOptions(entry.args || [], GIT_OPTIONS);
  const commandConfig = read.options.some(
    (option) =>
      (option.name === '-c' || option.name === '--config-env') &&
      GIT_COMMAND_CONFIG_RE.test(
        String(option.value?.value ?? '').replace(/=.*$/su, ''),
      ),
  );
  const [first, ...rest] = read.operands;
  const subcommand = first ? String(first.value) : null;
  let kind = 'local';
  if (first?.dynamic) kind = 'unknown';
  else if (subcommand === null) kind = 'local';
  else if (GIT_NETWORK.has(subcommand)) {
    kind = 'network';
    if (subcommand === 'remote') {
      const sub = rest.find((word) => !String(word.value).startsWith('-'));
      if (!sub || GIT_REMOTE_LOCAL.has(String(sub.value))) kind = 'local';
      // `remote add -f` / `--fetch` fetches the new remote at once.
      if (
        String(sub?.value) === 'add' &&
        readOptions(rest.slice(rest.indexOf(sub) + 1), {
          values: '-t -m --track --master',
          longs: '--fetch --track --master --tags --no-tags --mirror',
        }).options.some((o) => o.name === '-f' || o.name === '--fetch')
      )
        kind = 'network';
      if (
        String(sub?.value) === 'show' &&
        rest.some((word) => word.value === '-n')
      )
        kind = 'local';
    }
  } else if (GIT_LOCAL.has(subcommand)) {
    if (
      subcommand === 'archive' &&
      rest.some((w) => /^--remote(?:=|$)/u.test(w.value))
    )
      kind = 'network';
    if (subcommand === 'bisect' && rest.some((word) => word.value === 'run'))
      kind = 'unknown';
  } else kind = 'unknown';
  // Remote URLs named on the line (`git push https://host/x`, `git clone
  // user@host:repo`).
  const urls = rest
    .map((word) => {
      // `archive --remote=URL`, `clone --upload-pack` aside, a URL operand.
      const remote = /^--remote=(.+)$/su.exec(String(word.value));
      return remote ? { ...word, value: remote[1] } : word;
    })
    .filter((word) =>
      /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|[\w.-]+@[\w.-]+:)/u.test(
        String(word.value),
      ),
    );
  const remoteSubcommand =
    subcommand === 'remote'
      ? String(
          rest.find((word) => !String(word.value).startsWith('-'))?.value ?? '',
        )
      : null;
  return { subcommand, kind, commandConfig, urls, remoteSubcommand };
}

// ---------------------------------------------------------------------------
// Assignments a command runs under: `NAME=value cmd` and `env NAME=value
// cmd`. { NAME: word } with the word's value after the `=`.
export function commandAssignments(entry) {
  const found = {};
  const words = entry.words || [];
  const upTo = entry.programWord ? words.indexOf(entry.programWord) : -1;
  for (const word of [
    ...(entry.assignments || []),
    ...(upTo > 0 ? words.slice(0, upTo) : []),
  ]) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/su.exec(String(word.value));
    if (match) found[match[1]] = { ...word, value: match[2] };
  }
  return found;
}

// A URL's host, lower case, or null.
function urlHost(value) {
  const match =
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^/:?#]+)/u.exec(
      String(value),
    );
  return match ? match[1].replace(/^\[|\]$/gu, '').toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// gh, GitHub's CLI. Every subcommand but a few local ones talks to a GitHub
// host: the one named on the line (`--hostname`, a URL operand, `-R
// HOST/OWNER/REPO`, `GH_HOST=`), else the one in gh's configuration, which
// is not known here.

const GH_OPTIONS = {
  values:
    '-R --repo --hostname -X --method -H --header -f -F --field --raw-field -q --jq -t --template --input -p --preview --cache -b --body -B --base -T --title -l --label -a --assignee -m --milestone -w --web -e --env -o --org -u --user -s --state -L --limit -A --author -S --search -c --commit -n --name -r --ref -v --visibility',
};
const GH_LOCAL = new Set(['help', 'version', 'completion', 'config', 'alias']);
const GH_AUTH_LOCAL = new Set(['token', 'setup-git', 'switch']);
const GH_NETWORK = new Set(
  (
    'api attestation auth browse cache codespace copilot extension gist gpg-key ' +
    'issue label org pr project release repo ruleset run search secret ' +
    'ssh-key status variable workflow agent-task preview'
  ).split(/\s+/u),
);

// { kind: 'local' | 'network' | 'unknown', subcommand, hosts: [host],
// dynamicHost } for a gh command: `unknown` is an alias or an extension.
export function ghCommand(entry) {
  const read = readOptions(entry.args || [], GH_OPTIONS);
  const [first, second] = read.operands;
  const subcommand = first ? String(first.value) : null;
  let kind = 'local';
  if (first?.dynamic) kind = 'unknown';
  else if (subcommand === null || GH_LOCAL.has(subcommand)) kind = 'local';
  else if (subcommand === 'auth' && GH_AUTH_LOCAL.has(String(second?.value)))
    kind = 'local';
  else if (GH_NETWORK.has(subcommand)) kind = 'network';
  else kind = 'unknown';
  // `gh extension exec NAME`: runs a local extension, which can send what
  // it is given anywhere, whatever host gh is set to (Astra rc.2 V6).
  if (
    subcommand === 'extension' &&
    ['exec', 'x'].includes(String(second?.value))
  )
    kind = 'unknown';
  const hosts = [];
  let dynamicHost = false;
  const addHost = (word, host) => {
    if (word?.dynamic) dynamicHost = true;
    else if (host) hosts.push(host.toLowerCase());
  };
  for (const option of read.options) {
    if (!option.value) continue;
    if (option.name === '--hostname') addHost(option.value, option.value.value);
    if (option.name === '-R' || option.name === '--repo') {
      const repo = String(option.value.value);
      const parts = repo.split('/');
      addHost(
        option.value,
        urlHost(repo) ?? (parts.length === 3 ? parts[0] : null),
      );
    }
  }
  for (const word of read.operands.slice(1)) {
    const host = urlHost(word.value);
    if (host) addHost(word, host);
  }
  const assigned = commandAssignments(entry).GH_HOST;
  if (assigned) addHost(assigned, String(assigned.value));
  // github.com's API lives at api.github.com; an enterprise host serves both.
  const all = hosts.flatMap((host) =>
    host === 'github.com' ? [host, 'api.github.com'] : [host],
  );
  return { kind, subcommand, hosts: [...new Set(all)], dynamicHost };
}

// ---------------------------------------------------------------------------
// openssl: s_client, s_time and ocsp connect to a host; s_server listens and
// answers whoever connects; every other subcommand works on local data.
