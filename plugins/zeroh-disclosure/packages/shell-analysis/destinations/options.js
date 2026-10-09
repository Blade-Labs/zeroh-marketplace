// SPDX-License-Identifier: AGPL-3.0-only

import { TOKEN_PATTERN } from '../../zeroh-disclosure-core/token-pattern.js';

export const TOKEN_SPLIT_RE = new RegExp(`(${TOKEN_PATTERN})`, 'u');
export const TOKEN_ANY_RE = new RegExp(TOKEN_PATTERN, 'u');

// `name` with the tokens in it as written and the rest in lower case, when
// it is a DNS name of two or more labels with a token in at least one of
// them; else null.
export function tokenName(name) {
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

// Programs that look names up. A value restored anywhere in their
// arguments (a query name, a search domain such as `dig +domain=` or
// `nslookup -domain=`, a server) goes to the name servers, which are never
// on an allow list: each such argument is a destination, as the name it
// makes where that can be read, else as written. An IP address looked up as
// itself is its own destination (see packages/shell-analysis/secrets.js).
export const DNS_PROGRAMS = new Set([
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

export function dnsDisclosures(entry, result) {
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
export const CURL_VALUE_OPTIONS = new Set(
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
export const WGET_VALUE_OPTIONS = new Set(
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
export const SSH_VALUE_OPTIONS = new Set(
  '-B -b -c -D -E -e -F -I -i -J -L -l -m -O -o -P -p -Q -R -S -W -w'.split(
    ' ',
  ),
);
export const NC_VALUE_OPTIONS = new Set(
  '-e -c -I -i -M -m -O -P -p -q -s -T -V -W -w -x -X'.split(' '),
);
export const HTTPIE_VALUE_OPTIONS = new Set(
  '-a -A -o -p -s --auth --auth-type --output --print --style --session --session-read-only --verify --cert --cert-key --ssl --proxy --timeout --max-redirects --format-options --response-charset --response-mime'.split(
    ' ',
  ),
);
export const POWERSHELL_SWITCHES = new Set(
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

export const HTTPIE = Object.freeze({
  style: 'httpie',
  values: HTTPIE_VALUE_OPTIONS,
  // `--proxy http:http://host:3128`: the proxy URL after the protocol.
  proxy: ['--proxy'],
});
export const TRACEROUTE = Object.freeze({
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
export const NETWORK = Object.freeze({
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
export const LOCAL_PROGRAMS = new Set(
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

export const INTERPRETERS = new Set(
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
