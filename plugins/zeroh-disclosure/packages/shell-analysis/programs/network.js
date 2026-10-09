// SPDX-License-Identifier: AGPL-3.0-only

import { readOptions } from './options.js';

const OPENSSL_OPTIONS = {
  singleDash: true,
  values:
    '-connect -host -port -proxy -proxy_user -proxy_pass -url -servername -bind -accept ' +
    '-CAfile -CApath -CAstore -cert -key -pass -in -out -sess_in -sess_out -starttls ' +
    '-xmpphost -name -verify -verify_hostname -keylogfile -msgfile -time -www -WWW ' +
    '-cipher -ciphersuites -groups -curves -sigalgs -alpn -nextprotoneg -psk -psk_identity ' +
    '-issuer -serial -reqout -respout -reqin -respin -signer -signkey -VAfile -timeout ' +
    '-server -path -ref -secret -cmd -subject -newkey -certout -chainout -trusted -srvcert ' +
    '-recipient -expect_sender -tls_host -tls_cert -tls_key -tls_trusted -config -section ' +
    '-keyform -certform -inform -outform -passin -passout -days -set_serial -extfile -extensions',
};
// Subcommands that talk to a server by design; the ones that only listen;
// and the ones that work on local data only (openssl help lists them). Any
// other subcommand, and any subcommand given a server option, is read for
// its server options, and one ZeroH doesn't know is not taken as local
// (Astra rc.2 V7).
const OPENSSL_CONNECT = new Set(['s_client', 's_time', 'ocsp', 'cmp']);
const OPENSSL_LISTEN = new Set(['s_server']);
const OPENSSL_LOCAL = new Set(
  (
    'asn1parse ca ciphers cms crl crl2pkcs7 dgst dhparam dsa dsaparam ec ecparam enc engine ' +
    'errstr fipsinstall gendsa genpkey genrsa help info kdf list mac nseq passwd pkcs12 ' +
    'pkcs7 pkcs8 pkey pkeyparam pkeyutl prime rand rehash req rsa rsautl sess_id smime ' +
    'speed spkac srp storeutl ts verify version x509 skeyutl configutl ' +
    'md5 sha1 sha256 sha384 sha512 base64 aes-128-cbc aes-256-cbc des3 zlib'
  ).split(/\s+/u),
);
// Options that name a server: data goes there.
const OPENSSL_SERVER_OPTIONS = [
  '-connect',
  // The name sent to the server (SNI, XMPP to=): a destination too.
  '-servername',
  '-xmpphost',
  '-host',
  '-proxy',
  '-url',
  '-server',
];
// Options that make openssl fetch from addresses it finds at run time.
const OPENSSL_FETCH_OPTIONS = ['-crl_download', '-ocsp_check_all'];

// { kind: 'local' | 'connect' | 'listen' | 'unknown', subcommand, targets:
// [word], fetches } for an openssl command: the words naming where it
// connects (`-connect host:port`, `-host`, `-proxy`, `-url`, `-server`, or a
// `host:port` operand of a connecting subcommand).
export function opensslCommand(entry) {
  const args = entry.args || [];
  const subcommand = args[0] ? String(args[0].value) : null;
  if (OPENSSL_LISTEN.has(subcommand))
    return { kind: 'listen', subcommand, targets: [], fetches: false };
  const read = readOptions(args.slice(1), OPENSSL_OPTIONS);
  const targets = read.options
    .filter(
      (option) => option.value && OPENSSL_SERVER_OPTIONS.includes(option.name),
    )
    .map((option) => option.value);
  const fetches = read.options.some((option) =>
    OPENSSL_FETCH_OPTIONS.includes(option.name),
  );
  if (OPENSSL_CONNECT.has(subcommand)) {
    // OpenSSL 3 takes `host:port` as an operand too; nothing else is a
    // host (a value of an option not listed may land here).
    for (const word of read.operands)
      if (
        /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):\d+$/u.test(String(word.value))
      )
        targets.push(word);
    return { kind: 'connect', subcommand, targets, fetches };
  }
  if (targets.length) return { kind: 'connect', subcommand, targets, fetches };
  if (subcommand === null || OPENSSL_LOCAL.has(subcommand))
    return { kind: 'local', subcommand, targets, fetches };
  return { kind: 'unknown', subcommand, targets, fetches };
}

// ---------------------------------------------------------------------------
// Local programs that can still reach another machine or run another
// program, by their own options:
//   tar   an archive named `[user@]host:path` is opened over rsh/ssh (GNU
//         tar, unless --force-local); -I, --to-command, --rsh-command,
//         --info-script and --checkpoint-action=exec run programs;
//   rg    --pre and --hostname-bin run a program;
//   sort  --compress-program runs one;
//   zip   -TT / --unzip-command runs one;
//   less, more  a `+` command can run a shell command (`+!cmd`).
// And any program given a UNC path (`\\host\share\file`) reaches that host
// over SMB.
