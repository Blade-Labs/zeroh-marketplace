// SPDX-License-Identifier: AGPL-3.0-only

import { analyzeShell, programName } from '../shell-scan.js';
import {
  ghCommand,
  gitCommand,
  localProgramReach,
  opensslCommand,
  readOptions,
  sedProgram,
} from '../shell-programs.js';
import {
  DNS_PROGRAMS,
  INTERPRETERS,
  LOCAL_PROGRAMS,
  NETWORK,
  POWERSHELL_SWITCHES,
  TOKEN_SPLIT_RE,
  TOKEN_ANY_RE,
  dnsDisclosures,
  tokenName,
} from './options.js';

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

export function sshOptionDestinations(value, result, word) {
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

export function addOperand(result, word, { allowSingleLabel = true } = {}) {
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
export function forwardDestination(word, result) {
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
export function wgetCommand(word, result, command) {
  const rc = /^\s*(?:https?|ftp)_proxy\s*=\s*(.+)$/iu.exec(String(word.value));
  if (rc && !word.dynamic) addOperand(result, { ...word, value: rc[1].trim() });
  else
    result.uncertain.push({
      reason: 'dynamic-destination',
      detail: `${command.program} -e`,
    });
}

function powerShellCommandDestinations(args, spec, result) {
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
}

// The destinations of one network command.
export function networkCommand(command, spec, result) {
  const args = command.args;
  const values = spec.values ?? new Set();
  const operands = [];
  if (spec.style === 'ps') {
    powerShellCommandDestinations(args, spec, result);
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
  networkOperandDestinations(command, spec, result, operands);
}

function networkOperandDestinations(command, spec, result, operands) {
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
export function gitDestinations(entry, result) {
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
export function ghDestinations(entry, result) {
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
export function opensslDestinations(entry, result) {
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
export function localDestinations(entry, result, shell) {
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

export const PROGRAM_DESTINATIONS = Object.freeze({
  git: gitDestinations,
  gh: ghDestinations,
  openssl: opensslDestinations,
});

export function isPathLike(value) {
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
