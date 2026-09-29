// SPDX-License-Identifier: AGPL-3.0-only

// Where a shell command sends data (rc.2 item 4, Astra R2), read with the
// shared tokenizer (lib/shell-scan.js): the destination operands of every
// network command, found by the program's basename after launchers are
// unwrapped (`/usr/bin/curl`, `env -i curl`, `timeout 5 curl`, `curl.exe`,
// `Invoke-RestMethod`), over the whole command with no lookback limit. A
// network command's operand is a destination whatever it looks like: no
// member-access or file-extension exclusion applies to it.
//
// What cannot be proven is reported as uncertain, with the reason the
// receipt records (lib/unchecked.js):
//   dynamic-destination    a host only known when the command runs ($HOST,
//                          $(…), `xargs curl`, a token inside a host name,
//                          curl -K, wget -i, ssh -o ProxyCommand=…);
//   script-or-interpreter  a script, interpreter or other program that
//                          could send a value anywhere (node x.js, python -c,
//                          a pipe into bash);
//   unknown-launcher       a network command started through a program
//                          ZeroH does not know (proxychains curl …), or a
//                          program name that is itself computed ($CURL);
//   unparseable            a command line the tokenizer cannot read.
// The caller decides: in `pass` mode (the default) an uncertain case runs as
// in rc.1 and is recorded; in `block` mode it is denied. A destination that
// is positively identified and not allowed is denied in both modes.
import { analyzeShell, programName } from './shell-scan.js';
import {
  ghCommand,
  gitCommand,
  localProgramReach,
  opensslCommand,
  readOptions,
  sedProgram,
} from './shell-programs.js';
import { TOKEN_PATTERN } from './token-pattern.js';

const TOKEN_SPLIT_RE = new RegExp(`(${TOKEN_PATTERN})`, 'u');
const TOKEN_ANY_RE = new RegExp(TOKEN_PATTERN, 'u');

// Programs that look names up. A value restored anywhere in their
// arguments (a query name, a search domain such as `dig +domain=` or
// `nslookup -domain=`, a server) goes to the name servers, which are never
// on an allow list: each such argument is a destination, as the name it
// makes where that can be read, else as written. An IP address looked up as
// itself is its own destination (see lib/secrets.js).
const DNS_PROGRAMS = new Set([
  'dig',
  'nslookup',
  'host',
  'drill',
  'delv',
  'kdig',
  'getent',
  'resolvectl',
  'dscacheutil',
  'nmap',
  'resolve-dnsname',
]);

function dnsDisclosures(entry, result) {
  const args = entry.args ?? [];
  if (
    entry.program === 'getent' &&
    !/^a?hosts/u.test(String(args[0]?.value ?? ''))
  )
    return;
  for (const word of args) {
    const value = String(word.value);
    if (!TOKEN_ANY_RE.test(value)) continue;
    const name = value
      .replace(/^[+-]{1,2}[A-Za-z][A-Za-z0-9-]*[=:]/u, '')
      .replace(/^@/u, '')
      .replace(/\.$/u, '');
    result.network = true;
    result.destinations.push(
      tokenName(name) ??
        name
          .split(TOKEN_SPLIT_RE)
          .map((piece, i) => (i % 2 ? piece : piece.toLowerCase()))
          .join(''),
    );
  }
}

// Options that take a value, per network command. Anything else starting
// with `-` is a flag. A long option may also carry its value after `=`.
const CURL_VALUE_OPTIONS = new Set(
  (
    '-A -b -c -C -d -D -e -E -F -H -K -m -o -P -Q -r -T -u -U -w -x -X -y -Y -z ' +
    '--abstract-unix-socket --alt-svc --aws-sigv4 --cacert --capath --cert --cert-type ' +
    '--ciphers --config --connect-timeout --connect-to --continue-at --cookie --cookie-jar ' +
    '--create-file-mode --crlfile --curves --data --data-ascii --data-binary --data-raw ' +
    '--data-urlencode --delegation --dns-interface --dns-ipv4-addr --dns-ipv6-addr ' +
    '--dns-servers --doh-url --dump-header --ech --egd-file --engine --etag-compare ' +
    '--etag-save --expect100-timeout --form --form-string --ftp-account --ftp-alternative-to-user ' +
    '--ftp-method --ftp-port --ftp-ssl-ccc-mode --happy-eyeballs-timeout-ms --haproxy-clientip ' +
    '--header --help --hostpubmd5 --hostpubsha256 --hsts --interface --ip-tos --ipfs-gateway ' +
    '--json --keepalive-time --key --key-type --krb --libcurl --limit-rate --local-port ' +
    '--login-options --mail-auth --mail-from --mail-rcpt --max-filesize --max-redirs ' +
    '--max-time --netrc-file --noproxy --oauth2-bearer --output --output-dir --pass ' +
    '--pinnedpubkey --preproxy --proto --proto-default --proto-redir --proxy --proxy-cacert ' +
    '--proxy-capath --proxy-cert --proxy-cert-type --proxy-ciphers --proxy-crlfile ' +
    '--proxy-header --proxy-key --proxy-key-type --proxy-pass --proxy-pinnedpubkey ' +
    '--proxy-service-name --proxy-tls13-ciphers --proxy-tlsauthtype --proxy-tlspassword ' +
    '--proxy-tlsuser --proxy-user --proxy1.0 --pubkey --quote --random-file --range ' +
    '--rate --referer --request --request-target --resolve --retry --retry-delay ' +
    '--retry-max-time --sasl-authzid --service-name --socks4 --socks4a --socks5 ' +
    '--socks5-gssapi-service --socks5-hostname --speed-limit --speed-time --stderr ' +
    '--telnet-option --tftp-blksize --time-cond --tls-max --tls13-ciphers --tlsauthtype ' +
    '--tlspassword --tlsuser --trace --trace-ascii --trace-config --unix-socket ' +
    '--upload-file --url --url-query --user --user-agent --variable --write-out ' +
    '--ip-tos --vlan-priority --ech'
  ).split(/\s+/u),
);
const WGET_VALUE_OPTIONS = new Set(
  (
    '-a -A -B -D -e -i -I -l -o -O -P -Q -R -t -T -U -w -X ' +
    '--append-output --accept --base --domains --execute --input-file --include-directories ' +
    '--level --output-file --output-document --directory-prefix --quota --reject --tries ' +
    '--timeout --user-agent --wait --exclude-directories --bind-address --body-data --body-file ' +
    '--ca-certificate --ca-directory --certificate --certificate-type --config --connect-timeout ' +
    '--crl-file --cut-dirs --default-page --dns-timeout --header --http-password --http-user ' +
    '--load-cookies --max-redirect --method --password --post-data --post-file --private-key ' +
    '--private-key-type --proxy-password --proxy-user --read-timeout --referer --save-cookies ' +
    '--use-askpass --user --waitretry --warc-file --limit-rate --local-encoding --remote-encoding ' +
    '--restrict-file-names --secure-protocol --ftp-password --ftp-user --reject-regex --accept-regex'
  ).split(/\s+/u),
);
const SSH_VALUE_OPTIONS = new Set(
  '-B -b -c -D -E -e -F -I -i -J -L -l -m -O -o -P -p -Q -R -S -W -w'.split(
    ' ',
  ),
);
const NC_VALUE_OPTIONS = new Set(
  '-e -c -I -i -M -m -O -P -p -q -s -T -V -W -w -x -X'.split(' '),
);
const HTTPIE_VALUE_OPTIONS = new Set(
  '-a -A -o -p -s --auth --auth-type --output --print --style --session --session-read-only --verify --cert --cert-key --ssl --proxy --timeout --max-redirects --format-options --response-charset --response-mime'.split(
    ' ',
  ),
);
const POWERSHELL_SWITCHES = new Set(
  [
    'usebasicparsing',
    'usedefaultcredentials',
    'allowunencryptedauthentication',
    'skipcertificatecheck',
    'skipheadervalidation',
    'skiphttperrorcheck',
    'disablekeepalive',
    'passthru',
    'resume',
    'noproxy',
    'allowinsecureredirect',
    'preservehttpmethodonredirect',
    'preserveauthorizationonredirect',
    'proxyusedefaultcredentials',
    'informationlevel',
    'traceroute',
    'detailed',
    'quiet',
    'asjob',
    'usessl',
    'bodyashtml',
  ].map((name) => `-${name}`),
);

const HTTPIE = Object.freeze({
  style: 'httpie',
  values: HTTPIE_VALUE_OPTIONS,
  // `--proxy http:http://host:3128`: the proxy URL after the protocol.
  proxy: ['--proxy'],
});
const TRACEROUTE = Object.freeze({
  style: 'all',
  values: new Set(['-f', '-g', '-i', '-m', '-p', '-q', '-s', '-t', '-w', '-z']),
  // -g: a gateway the packets are routed through.
  dest: ['-g'],
});

// How each network program names its destination.
//   url       every operand is a URL (curl, wget)
//   httpie    the first operand that is not a method is the URL
//   first     the first operand is the host (ssh, nc, telnet)
//   all       every operand naming a host is one (ping, dig)
//   remote    operands of the form host:path are remote (scp, rsync)
//   socat     operands are socat addresses
//   ps        a PowerShell cmdlet: its host parameters and first positional
const NETWORK = Object.freeze({
  curl: {
    style: 'url',
    values: CURL_VALUE_OPTIONS,
    dest: [
      '--url',
      '-x',
      '--proxy',
      '--preproxy',
      '--socks4',
      '--socks4a',
      '--socks5',
      '--socks5-hostname',
      '--doh-url',
      '--dns-servers',
      '--ipfs-gateway',
    ],
    unseen: ['-K', '--config'],
    pairs: ['--resolve', '--connect-to'],
  },
  wget: {
    style: 'url',
    values: WGET_VALUE_OPTIONS,
    dest: ['-B', '--base'],
    // `-e http_proxy=URL` names a proxy (read); any other command is unseen.
    wgetrc: ['-e', '--execute'],
    unseen: ['-i', '--input-file', '--config'],
  },
  aria2c: {
    style: 'url',
    values: new Set([
      '-d',
      '-o',
      '-i',
      '--dir',
      '--out',
      '--input-file',
      '--all-proxy',
      '--http-proxy',
      '--https-proxy',
      '--ftp-proxy',
    ]),
    dest: ['--all-proxy', '--http-proxy', '--https-proxy', '--ftp-proxy'],
    unseen: ['-i', '--input-file'],
  },
  lynx: { style: 'url', values: new Set() },
  links: { style: 'url', values: new Set() },
  w3m: { style: 'url', values: new Set() },
  http: HTTPIE,
  https: HTTPIE,
  httpie: HTTPIE,
  xh: HTTPIE,
  xhs: HTTPIE,
  ssh: {
    style: 'first',
    values: SSH_VALUE_OPTIONS,
    dest: ['-J'],
    // -W host:port, -L/-R [bind:]port:host:hostport: the far end connects.
    forwards: ['-W', '-L', '-R'],
    sshOptions: true,
  },
  mosh: {
    style: 'first',
    values: new Set(['-p', '--ssh', '--port', '--server', '--client']),
    shellCode: ['--ssh'],
  },
  telnet: { style: 'first', values: new Set(['-b', '-e', '-l', '-n', '-X']) },
  nc: { style: 'first', values: NC_VALUE_OPTIONS, dest: ['-x'], listen: true },
  ncat: {
    style: 'first',
    values: new Set([
      ...NC_VALUE_OPTIONS,
      ...'--proxy --proxy-type --proxy-auth --proxy-dns --source --source-port --exec --sh-exec --lua-exec --wait --idle-timeout --output --hex-dump --allow --allowfile --deny --denyfile --max-conns --ssl-cert --ssl-key --ssl-trustfile --ssl-ciphers --ssl-servername --ssl-alpn'.split(
        ' ',
      ),
    ]),
    dest: ['-x', '--proxy', '--ssl-servername'],
    listen: true,
  },
  netcat: {
    style: 'first',
    values: NC_VALUE_OPTIONS,
    dest: ['-x'],
    listen: true,
  },
  ftp: { style: 'first', values: new Set(['-P']) },
  sftp: {
    style: 'first',
    values: SSH_VALUE_OPTIONS,
    dest: ['-J'],
    unseen: ['-S'],
    sshOptions: true,
  },
  tftp: { style: 'first', values: new Set(['-m', '-c']) },
  ping: {
    style: 'all',
    values: new Set([
      '-c',
      '-i',
      '-I',
      '-l',
      '-m',
      '-M',
      '-p',
      '-Q',
      '-s',
      '-S',
      '-t',
      '-T',
      '-w',
      '-W',
    ]),
  },
  ping6: {
    style: 'all',
    values: new Set(['-c', '-i', '-I', '-l', '-p', '-s', '-t', '-w', '-W']),
  },
  traceroute: TRACEROUTE,
  traceroute6: TRACEROUTE,
  tracepath: { style: 'all', values: new Set(['-l', '-m', '-p']) },
  mtr: {
    style: 'all',
    values: new Set(
      '-a -B -c -f -F -G -i -I -L -m -M -P -Q -s -Z -y --address --first-ttl --filename --gracetime --interval --interface --localport --max-ttl --port --psize --report-cycles --timeout --tos'.split(
        ' ',
      ),
    ),
    unseen: ['-F', '--filename'],
  },
  // A DNS program sends every name it looks up (-q, -x and the operands) to
  // the name servers: the whole name is the destination.
  dig: {
    style: 'all',
    values: new Set(['-b', '-c', '-f', '-k', '-p', '-q', '-t', '-x', '-y']),
    dest: ['-q', '-x'],
    unseen: ['-f'],
    dns: true,
  },
  delv: {
    style: 'all',
    values: new Set(['-a', '-b', '-c', '-d', '-p', '-q', '-t', '-x']),
    dest: ['-q', '-x'],
    dns: true,
  },
  kdig: {
    style: 'all',
    values: new Set(['-b', '-c', '-k', '-p', '-q', '-t', '-x', '-y', '-E']),
    dest: ['-q', '-x'],
    dns: true,
  },
  nslookup: { style: 'all', values: new Set(), dns: true },
  host: {
    style: 'all',
    values: new Set(['-c', '-N', '-R', '-t', '-W', '-m']),
    dns: true,
  },
  drill: {
    style: 'all',
    values: new Set('-b -c -f -i -k -o -p -q -r -V -w -y'.split(' ')),
    unseen: ['-f', '-i'],
    dns: true,
  },
  whois: { style: 'all', values: new Set(['-h', '-p']), dest: ['-h'] },
  scp: {
    style: 'remote',
    values: SSH_VALUE_OPTIONS,
    dest: ['-J'],
    unseen: ['-S'],
    sshOptions: true,
  },
  rsync: {
    style: 'remote',
    values: new Set([
      '-e',
      '--rsh',
      '-f',
      '--filter',
      '--exclude',
      '--include',
      '--exclude-from',
      '--include-from',
      '--files-from',
      '-B',
      '--block-size',
      '--port',
      '--password-file',
      '--log-file',
      '-T',
      '--temp-dir',
      '--partial-dir',
      '--chmod',
      '--chown',
      '--compare-dest',
      '--copy-dest',
      '--link-dest',
      '--bwlimit',
      '--timeout',
      '--contimeout',
      '-M',
      '--remote-option',
      '--out-format',
      '--info',
      '--debug',
      '--usermap',
      '--groupmap',
      '--max-size',
      '--min-size',
      '--max-delete',
      '--modify-window',
      '--suffix',
      '--backup-dir',
      '--skip-compress',
      '--iconv',
      '--checksum-choice',
      '--compress-choice',
      '--compress-level',
      '--stop-after',
      '--stop-at',
      '--sockopts',
      '--address',
      '--outbuf',
    ]),
    shellCode: ['-e', '--rsh'],
  },
  socat: {
    style: 'socat',
    values: new Set(['-d', '-D', '-t', '-T', '-b', '-lf', '-lp', '-L', '-W']),
  },
  'invoke-webrequest': { style: 'ps', params: ['-uri', '-url', '-proxy'] },
  iwr: { style: 'ps', params: ['-uri', '-url', '-proxy'] },
  'invoke-restmethod': { style: 'ps', params: ['-uri', '-url', '-proxy'] },
  irm: { style: 'ps', params: ['-uri', '-url', '-proxy'] },
  'start-bitstransfer': { style: 'ps', params: ['-source'] },
  'test-netconnection': { style: 'ps', params: ['-computername'] },
  tnc: { style: 'ps', params: ['-computername'] },
  'test-connection': { style: 'ps', params: ['-computername', '-targetname'] },
  'resolve-dnsname': { style: 'ps', params: ['-name', '-server'] },
  'send-mailmessage': {
    style: 'ps',
    params: ['-smtpserver'],
    positional: false,
  },
});

export const NETWORK_PROGRAMS = Object.freeze(Object.keys(NETWORK));

// Programs that only work on local data: a restored value they receive stays
// on the machine unless another command in the line sends it. Their options
// that reach another machine or run a program (tar's remote archive and -I,
// rg --pre, a UNC path …) are read by localProgramReach. git, gh and openssl
// talk to the network in some subcommands: see PROGRAM_DESTINATIONS.
const LOCAL_PROGRAMS = new Set(
  (
    'echo printf cat tac head tail wc sort uniq cut tr tee grep egrep fgrep rg sed awk gawk ' +
    'jq yq base64 base32 xxd od hexdump md5sum sha1sum sha256sum sha512sum shasum cksum ' +
    'true false test [ [[ ]] : cd pwd ls stat file touch mkdir rmdir rm mv cp ln chmod ' +
    'chown date sleep read export unset set local declare typeset readonly let shift ' +
    'exit return alias unalias type which whereis command printenv env ' +
    'basename dirname realpath readlink mktemp diff cmp comm paste join fold fmt nl ' +
    'column expand unexpand rev yes seq tee less more strings gzip gunzip zcat ' +
    'bzip2 xz zstd tar zip unzip write-output write-host out-null get-content ' +
    'set-content add-content out-file select-string select-object where-object ' +
    'foreach-object convertto-json convertfrom-json get-childitem test-path new-item ' +
    'remove-item copy-item move-item set-location get-location get-item join-path ' +
    'split-path resolve-path measure-object sort-object format-table format-list ' +
    'out-string write-error write-verbose write-warning get-date start-sleep clear-host'
  ).split(/\s+/u),
);

const INTERPRETERS = new Set(
  (
    'node nodejs deno bun python python2 python3 pypy ruby perl php lua luajit java ' +
    'kotlin scala go cargo rustc dotnet npm npx pnpm pnpx yarn bunx make cmake gradle ' +
    'mvn ant rake bundle pip pip3 uv uvx poetry pipenv tox pytest jest vitest mocha ' +
    'sh bash zsh dash ksh mksh ash fish busybox pwsh powershell osascript swift ' +
    'terraform ansible ansible-playbook kubectl helm docker podman'
  ).split(/\s+/u),
);

// A destination operand's host, from a URL (`https://u@host:443/x`),
// `host:port`, `user@host`, `[v6]:port`, or a bare host. Null when the value
// names no host (a relative path, a port, `-`). { dynamic } when the host is
// only known at run time: an expansion before the host ends, a token inside
// a host that is only a token (it may stand for a URL or an address), or
// URL globbing (`{a,b}`, `[1-3]`, which curl expands). A token that is a
// label, or part of one, of a longer name (`[API_KEY-3f9a1c].evil.example`)
// is sent to the name servers that resolve it: the whole name, token as
// written, is the destination.
export function operandHost(word) {
  const value = word.value;
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.exec(value);
  let start = scheme ? scheme[0].length : value.startsWith('//') ? 2 : 0;
  let end = value.length;
  for (let i = start; i < value.length; i += 1) {
    if (value[i] === '/' || value[i] === '?' || value[i] === '#') {
      end = i;
      break;
    }
  }
  const authority = value.slice(start, end);
  if (word.dynamic && word.dynamicAt <= end) return { dynamic: true };
  if (!authority) return null;
  const at = authority.lastIndexOf('@');
  let host = at >= 0 ? authority.slice(at + 1) : authority;
  const named = tokenName(host.replace(/:\d*$/u, ''));
  if (named && !word.brace) return { host: named };
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    if (close < 0) return { dynamic: true };
    const inner = host.slice(1, close);
    // `[API_KEY-…]`: a token, not an IPv6 address.
    if (!inner.includes(':')) return { dynamic: true };
    return { host: inner.toLowerCase() };
  }
  host = host.replace(/:\d*$/u, '');
  if (!host) return null;
  if (/[[\]{}*?$`]/u.test(host) || word.brace) return { dynamic: true };
  if (!scheme && !/^[A-Za-z0-9._-]+$/u.test(host)) return null;
  return { host: host.toLowerCase() };
}

// `name` with the tokens in it as written and the rest in lower case, when
// it is a DNS name of two or more labels with a token in at least one of
// them; else null.
function tokenName(name) {
  const pieces = name.split(TOKEN_SPLIT_RE);
  if (pieces.length < 3) return null;
  const labels = pieces
    .map((piece, i) => (i % 2 ? 'x' : piece))
    .join('')
    .split('.');
  if (labels.length < 2 || !labels.every((l) => /^[A-Za-z0-9_-]+$/u.test(l)))
    return null;
  return pieces
    .map((piece, i) => (i % 2 ? piece : piece.toLowerCase()))
    .join('');
}

function sshOptionDestinations(value, result, word) {
  const option = /^([A-Za-z]+)\s*[= ]\s*(.*)$/su.exec(value);
  if (!option) return;
  const key = option[1].toLowerCase();
  if (
    key === 'proxycommand' ||
    key === 'localcommand' ||
    key === 'permitlocalcommand'
  )
    result.uncertain.push({
      reason: 'dynamic-destination',
      detail: `ssh -o ${option[1]}`,
    });
  else if (key === 'hostname' || key === 'proxyjump') {
    for (const part of option[2].split(','))
      addOperand(result, { ...word, value: part, dynamic: false });
  }
}

function addOperand(result, word, { allowSingleLabel = true } = {}) {
  const found = operandHost(word);
  if (!found) return;
  if (found.dynamic) {
    result.uncertain.push({
      reason: 'dynamic-destination',
      detail: 'host known only at run time',
    });
    return;
  }
  if (
    !allowSingleLabel &&
    !found.host.includes('.') &&
    !found.host.includes(':')
  )
    return;
  result.destinations.push(found.host);
}

// ssh -W host:port, -L / -R [bind:]port:host:hostport: the host the far end
// connects to (a `-L`/`-R` to a socket path names none).
function forwardDestination(word, result) {
  const value = String(word.value);
  if (word.dynamic) {
    result.uncertain.push({
      reason: 'dynamic-destination',
      detail: 'ssh forward',
    });
    return;
  }
  const parts = value.match(/\[[^\]]*\]|[^:]+/gu) ?? [];
  const host =
    parts.length >= 3 ? parts.at(-2) : parts.length === 2 ? parts[0] : null;
  if (host && !/^\d+$/u.test(host))
    addOperand(result, { ...word, value: host.replace(/^\[|\]$/gu, '') });
}

// wget -e COMMAND: a wgetrc command. `http_proxy=`, `https_proxy=` and
// `ftp_proxy=` name a proxy; any other could fetch from anywhere
// (`input=…`), so it stays unseen.
function wgetCommand(word, result, command) {
  const rc = /^\s*(?:https?|ftp)_proxy\s*=\s*(.+)$/iu.exec(String(word.value));
  if (rc && !word.dynamic) addOperand(result, { ...word, value: rc[1].trim() });
  else
    result.uncertain.push({
      reason: 'dynamic-destination',
      detail: `${command.program} -e`,
    });
}

// The destinations of one network command.
function networkCommand(command, spec, result) {
  const args = command.args;
  const values = spec.values ?? new Set();
  const operands = [];
  if (spec.style === 'ps') {
    let expectValue = null;
    let positionalDone = spec.positional === false;
    for (const word of args) {
      const lower = word.value.toLowerCase();
      if (expectValue) {
        if (spec.params.includes(expectValue)) addOperand(result, word);
        expectValue = null;
        continue;
      }
      if (!word.dynamic && /^-[A-Za-z]/u.test(word.value)) {
        const [name] = lower.split(':');
        if (POWERSHELL_SWITCHES.has(name)) continue;
        if (lower.includes(':')) {
          if (spec.params.includes(name))
            addOperand(result, {
              ...word,
              value: word.value.slice(name.length + 1),
            });
          continue;
        }
        expectValue = name;
        continue;
      }
      if (!positionalDone) {
        addOperand(result, word);
        positionalDone = true;
      }
    }
    return;
  }
  // Options read once, the same way for every check below (Astra rc.2 F5):
  // `-K cfg`, `-Kcfg`, `-sKcfg` and `--config=cfg` are the same option.
  const read = readOptions(args, { values });
  for (const option of read.options) {
    const { name } = option;
    if (spec.unseen?.includes(name)) {
      result.uncertain.push({
        reason: 'dynamic-destination',
        detail: `${command.program} ${name}`,
      });
    }
    if (spec.listen && name === '-l') result.listening = true;
    const optionValue = option.value;
    if (!optionValue) continue;
    if (spec.dest?.includes(name)) addOperand(result, optionValue);
    if (spec.pairs?.includes(name)) {
      // --resolve host:port:addr, --connect-to h1:p1:h2:p2: data goes to
      // the address given last.
      const parts = String(optionValue.value).split(':');
      const target = name === '--resolve' ? parts.slice(2).join(':') : parts[2];
      if (optionValue.dynamic)
        result.uncertain.push({
          reason: 'dynamic-destination',
          detail: name,
        });
      else if (target)
        addOperand(result, {
          ...optionValue,
          value: target.replace(/^\[|\]$/gu, ''),
        });
    }
    if (spec.sshOptions && name === '-o')
      sshOptionDestinations(optionValue.value, result, optionValue);
    if (spec.forwards?.includes(name)) forwardDestination(optionValue, result);
    if (spec.proxy?.includes(name))
      addOperand(result, {
        ...optionValue,
        value: String(optionValue.value).replace(/^[A-Za-z]+:(?!\/\/)/u, ''),
      });
    if (spec.wgetrc?.includes(name)) wgetCommand(optionValue, result, command);
    if (spec.shellCode?.includes(name)) {
      // rsync -e 'ssh -J jump', mosh --ssh='ssh -p 2222': a command line.
      const inner = shellDestinations(String(optionValue.value));
      result.destinations.push(...inner.destinations);
      result.uncertain.push(...inner.uncertain);
      if (optionValue.dynamic)
        result.uncertain.push({
          reason: 'dynamic-destination',
          detail: `${command.program} ${name}`,
        });
    }
  }
  for (const word of read.operands) {
    if (spec.dns && String(word.value).startsWith('+')) continue;
    operands.push(word);
  }
  switch (spec.style) {
    case 'url':
      for (const word of operands) addOperand(result, word);
      break;
    case 'httpie': {
      const methods =
        /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)$/u;
      const url = operands.find((word) => !methods.test(word.value));
      if (url) {
        // `:3000/x` is httpie's shorthand for localhost.
        if (!url.value.startsWith(':')) addOperand(result, url);
      }
      break;
    }
    case 'first':
      if (!result.listening && operands[0]) addOperand(result, operands[0]);
      break;
    case 'all':
      for (const word of operands) {
        if (spec.dns && /^@/u.test(word.value)) {
          addOperand(result, { ...word, value: word.value.slice(1) });
          continue;
        }
        if (
          spec.dns &&
          /^(?:A|AAAA|MX|TXT|NS|CNAME|SOA|PTR|SRV|CAA|ANY|IN|CH|HS)$/iu.test(
            word.value,
          )
        )
          continue;
        addOperand(result, word, { allowSingleLabel: !spec.dns });
      }
      break;
    case 'remote':
      for (const word of operands) {
        const value = word.value;
        if (/^rsync:\/\//iu.test(value)) {
          addOperand(result, word);
          continue;
        }
        // host:path, user@host:path; not /abs, ./rel, ~/x or C:\x.
        const colon = value.indexOf(':');
        const slash = value.indexOf('/');
        if (colon <= 0 || (slash >= 0 && slash < colon)) continue;
        if (/^[A-Za-z]:[\\/]/u.test(value)) continue;
        if (word.dynamic && word.dynamicAt <= colon) {
          result.uncertain.push({
            reason: 'dynamic-destination',
            detail: `${command.program} remote`,
          });
          continue;
        }
        addOperand(result, {
          ...word,
          value: value.slice(0, colon),
          dynamic: false,
        });
      }
      break;
    case 'socat':
      for (const word of operands) {
        if (/^(?:EXEC|SYSTEM|SHELL):/iu.test(word.value)) {
          result.uncertain.push({
            reason: 'script-or-interpreter',
            detail: 'socat EXEC',
          });
          continue;
        }
        const address =
          /^(TCP[46]?|TCP[46]?-CONNECT|OPENSSL|OPENSSL-CONNECT|SSL|UDP[46]?|UDP[46]?-(?:CONNECT|SENDTO|DATAGRAM)|SCTP[46]?(?:-CONNECT)?|SOCKS4A?|SOCKS5(?:-CONNECT)?|PROXY|PROXY-CONNECT|DCCP[46]?-CONNECT)[:](.*)$/iu.exec(
            word.value,
          );
        if (!address) continue;
        if (word.dynamic) {
          result.uncertain.push({
            reason: 'dynamic-destination',
            detail: 'socat address',
          });
          continue;
        }
        // SOCKS and PROXY: the proxy, then the host it connects to.
        const fields = address[2].split(',')[0].split(':');
        const hosts = /^(?:SOCKS|PROXY)/iu.test(address[1])
          ? fields.slice(0, 2)
          : fields.slice(0, 1);
        for (const host of hosts)
          if (host) addOperand(result, { ...word, value: host });
      }
      break;
    default:
      break;
  }
}

// git (Astra rc.2 F4): local subcommands stay local; one that talks to a
// remote sends to a URL on the line or, without one, to wherever the
// repository's configuration points (dynamic-destination); an alias or an
// external `git-foo`, and a `-c` that names a program to run or a remote,
// could do anything (script-or-interpreter). `source` and `.` are scripts
// and fall through to the generic case below.
function gitDestinations(entry, result) {
  const git = gitCommand(entry);
  // `remote add` / `set-url` store where later pushes and fetches go.
  const stored =
    git.subcommand === 'remote' &&
    git.urls.length > 0 &&
    ['add', 'set-url'].includes(git.remoteSubcommand);
  if (git.kind === 'network' || stored) {
    result.network = true;
    for (const word of git.urls) {
      // `user@host:repo` (scp syntax) names the host before the colon.
      const scp = /^[\w.-]+@([\w.-]+):(?!\/\/)/u.exec(String(word.value));
      addOperand(
        result,
        scp && !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(word.value)
          ? { ...word, value: scp[1] }
          : word,
      );
    }
    if (!git.urls.length && git.kind === 'network')
      result.uncertain.push({
        reason: 'dynamic-destination',
        detail: `git ${git.subcommand}`,
      });
  }
  // A `-c` that names a program (core.sshCommand, an alias …) runs it
  // whatever the destination (Astra rc.2 V5).
  if (git.kind === 'unknown' || git.commandConfig || entry.stdinArgs)
    result.uncertain.push({
      reason: 'script-or-interpreter',
      detail: git.kind === 'unknown' ? `git ${git.subcommand}` : 'git -c',
    });
}

// gh: the GitHub host named on the line, else the one gh is configured
// with (dynamic-destination). Local subcommands stay local; an alias or an
// extension could do anything.
function ghDestinations(entry, result) {
  const gh = ghCommand(entry);
  if (gh.kind === 'local' && !entry.stdinArgs) return;
  if (gh.kind === 'unknown' || (gh.kind === 'local' && entry.stdinArgs)) {
    result.uncertain.push({
      reason: 'script-or-interpreter',
      detail: `gh ${gh.subcommand}`,
    });
    return;
  }
  result.network = true;
  for (const host of gh.hosts) addOperand(result, { value: host });
  if (gh.dynamicHost || !gh.hosts.length)
    result.uncertain.push({
      reason: 'dynamic-destination',
      detail: `gh ${gh.subcommand}`,
    });
}

// openssl: s_client, s_time and ocsp go where -connect, -host, -proxy or
// -url say (none: localhost:4433, loopback); s_server answers whoever
// connects.
function opensslDestinations(entry, result) {
  const openssl = opensslCommand(entry);
  if (openssl.kind === 'local' && !openssl.fetches) return;
  result.network = true;
  if (
    openssl.kind === 'listen' ||
    openssl.kind === 'unknown' ||
    openssl.fetches ||
    (openssl.kind === 'connect' &&
      !openssl.targets.length &&
      openssl.subcommand === 'cmp')
  )
    result.uncertain.push({
      reason: 'dynamic-destination',
      detail: `openssl ${openssl.subcommand}`,
    });
  for (const word of openssl.targets) addOperand(result, word);
}

// A program ZeroH counts as local, with what its options can still reach.
function localDestinations(entry, result, shell) {
  const reach = localProgramReach(entry);
  if (reach.runs)
    result.uncertain.push({
      reason: 'script-or-interpreter',
      detail: reach.runs,
    });
  if (reach.remote) {
    result.network = true;
    result.uncertain.push({
      reason: 'dynamic-destination',
      detail: reach.remote,
    });
  }
  for (const { host } of reach.unc) {
    result.network = true;
    // PowerShell opens `\\host\share` over SMB; to Bash on Linux and macOS
    // it is a file name, so there it is only uncertain.
    if (shell === 'powershell') addOperand(result, { value: host });
    else
      result.uncertain.push({
        reason: 'dynamic-destination',
        detail: 'UNC path',
      });
  }
}

const PROGRAM_DESTINATIONS = Object.freeze({
  git: gitDestinations,
  gh: ghDestinations,
  openssl: opensslDestinations,
});

function isPathLike(value) {
  return /[\\/]/u.test(value);
}

// { ok, reason, network, destinations: [host], uncertain: [{ reason, detail }] }
// for a Bash or PowerShell command line. Hosts are lower case; loopback and
// allow rules are the caller's business.
export function shellDestinations(command, { shell = 'bash' } = {}) {
  const result = {
    ok: true,
    reason: null,
    network: false,
    destinations: [],
    uncertain: [],
  };
  const analysis = analyzeShell(command, shell);
  if (!analysis.ok) {
    result.ok = false;
    result.reason = analysis.reason;
    result.uncertain.push({ reason: 'unparseable', detail: analysis.reason });
  }
  for (const entry of analysis.commands) {
    if (entry.dynamicProgram) {
      result.uncertain.push({
        reason: 'unknown-launcher',
        detail: 'computed program name',
      });
      continue;
    }
    if (entry.dynamicCode) {
      result.uncertain.push({
        reason: 'script-or-interpreter',
        detail: 'code only known at run time',
      });
    }
    if (entry.foreignCode) {
      result.uncertain.push({
        reason: 'script-or-interpreter',
        detail: `${entry.program} inline code`,
      });
    }
    const program = entry.program;
    if (!program || entry.lookupOnly) continue;
    // `bash -c '…'`, `eval …`, `iex …`: the code it runs is listed and read.
    if (entry.inlineParsed && !entry.dynamicCode && !entry.foreignCode)
      continue;
    const spec = Object.hasOwn(NETWORK, program) ? NETWORK[program] : null;
    if (DNS_PROGRAMS.has(program)) {
      dnsDisclosures(entry, result);
      if (spec && (entry.args ?? []).some((w) => TOKEN_ANY_RE.test(w.value))) {
        // The tokens are read above; the rest as for any network program.
        const before = result.uncertain.length;
        networkCommand({ ...entry, program }, spec, result);
        result.uncertain.splice(
          before,
          Infinity,
          ...result.uncertain
            .slice(before)
            .filter((u) => u.detail !== 'host known only at run time'),
        );
        result.network = true;
        continue;
      }
    }
    if (spec) {
      result.network = true;
      if (entry.stdinArgs) {
        result.uncertain.push({
          reason: 'dynamic-destination',
          detail: `xargs ${program}`,
        });
      }
      networkCommand({ ...entry, program }, spec, result);
      continue;
    }
    if (Object.hasOwn(PROGRAM_DESTINATIONS, program)) {
      PROGRAM_DESTINATIONS[program](entry, result, shell);
      continue;
    }
    // sed's `e` command runs another command (awk is inline code, above).
    if (program === 'sed' && sedProgram(entry).program.executes.length) {
      result.uncertain.push({
        reason: 'script-or-interpreter',
        detail: 'sed e',
      });
      continue;
    }
    if (LOCAL_PROGRAMS.has(program) && !entry.stdinArgs) {
      localDestinations(entry, result, shell);
      continue;
    }
    // A network program among the arguments of a program ZeroH does not
    // know: `proxychains curl …`, `tsocks nc …`.
    const launched = entry.args.find(
      (word) =>
        !word.dynamic && Object.hasOwn(NETWORK, programName(word.value)),
    );
    if (launched && !LOCAL_PROGRAMS.has(program)) {
      result.network = true;
      result.uncertain.push({
        reason: 'unknown-launcher',
        detail: `${program} ${programName(launched.value)}`,
      });
      continue;
    }
    if (
      INTERPRETERS.has(program) ||
      isPathLike(entry.programWord?.value ?? '')
    ) {
      result.uncertain.push({
        reason: 'script-or-interpreter',
        detail: program,
      });
      continue;
    }
    if (!LOCAL_PROGRAMS.has(program)) {
      result.uncertain.push({
        reason: 'script-or-interpreter',
        detail: program,
      });
    }
  }
  result.destinations = [...new Set(result.destinations)];
  return result;
}
