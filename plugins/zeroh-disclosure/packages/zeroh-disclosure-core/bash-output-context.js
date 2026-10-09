// SPDX-License-Identifier: AGPL-3.0-only

import { fileDetectionOptions } from './detection-context.js';
import { detectSensitiveData } from './detector.js';
import { unionFindings } from '../../vendor/sensitive-data-detectors/src/detector.js';

// One hook's masking passes share a detector-specific memo. Key every option
// as well as the actual text after exact vault matches have changed offsets.
export function memoizeOutputFindings(
  detector = detectSensitiveData,
  { onMiss = () => {} } = {},
) {
  const memo = new Map();
  return (text, options) => {
    const key = JSON.stringify([text, options]);
    if (!memo.has(key)) {
      onMiss();
      memo.set(key, detector(text, options));
    }
    return memo.get(key);
  };
}

// Recovery is supplemental to the full unknown scan. Bound all transport
// parsing and rescans, including across stdout/output fields of one response.
// One unit per parsed/scanned UTF-8 byte plus 64 per detector invocation.
// Repeated fragments reuse findings, including empty ones. Both limits are
// shared across output fields and a vault-save fallback. Start the absolute
// clock at loader entry, before configuration, vault loading or detection.
// Admit only when now + twice the measured estimate + reserve < 10.5 s.
// Keep the 250 ms plus 250 ms/MiB masking/vault/audit reserve (500 ms at
// the 1 MiB cutoff): the review measured 40–150 ms there. Doubling estimates
// covers a 1.5x underestimate, while the earlier deadline leaves 2.5 s for
// a possible 2 s vault lock wait and scheduling before the 13 s watchdog.
// Startup consumes wall time, never a fixed recovery window.
export function outputRecoveryBudget({
  now = () => performance.now(),
  hookStart = now(),
} = {}) {
  return {
    work: 2 * 1024 * 1024,
    workUsed: 0,
    scannedBytes: 0,
    detectorCalls: 0,
    deadline: hookStart + 10500,
    outputBytes: 0,
    truncated: false,
    tailReserve: (bytes) => 250 + (250 * bytes) / (1024 * 1024),
    hookStart,
    now,
  };
}

function recoveryRemaining(budget) {
  if (
    budget.work > 0 &&
    budget.now() + budget.tailReserve(budget.outputBytes) < budget.deadline
  )
    return true;
  budget.truncated = true;
  return false;
}

function spendRecoveryWork(budget, units, estimatedMs = 0) {
  const remainingMs =
    budget.deadline - budget.now() - budget.tailReserve(budget.outputBytes);
  if (
    budget.work <= 0 ||
    remainingMs <= 0 ||
    2 * estimatedMs >= remainingMs ||
    units > budget.work
  ) {
    budget.truncated = true;
    return false;
  }
  budget.work -= units;
  budget.workUsed += units;
  return true;
}

// Recover only evidence present in the command/output. Never open a file to
// guess output boundaries, and never interpret substitutions or pipelines.
function simpleWords(command) {
  if (typeof command !== 'string') return [];
  if (/[\r\n]/u.test(command)) return [];
  const words = [];
  const token = /[ \t]*("(?:\\[^\n]|[^"\\\n])*"|'[^'\n]*'|[^\s"']+)/gy;
  let at = 0;
  const limit = command.trimEnd().length;
  while (at < limit) {
    if (at && !/[ \t]/u.test(command[at])) return [];
    const match = token.exec(command);
    if (!match) return [];
    words.push(match[1]);
    at = token.lastIndex;
  }
  const decoded = [];
  for (const word of words) {
    if (word.startsWith("'")) {
      // Single quotes preserve every character, including native paths.
      decoded.push(word.slice(1, -1));
    } else if (word.startsWith('"')) {
      const value = word.slice(1, -1);
      // Bash preserves a backslash in double quotes unless it precedes $, `,
      // ", \ or newline. Decode those escapes; refuse active substitutions.
      let literal = '';
      for (let i = 0; i < value.length; i += 1) {
        const character = value[i];
        if (character === '\\' && /[$`"\\]/u.test(value[i + 1] ?? ''))
          literal += value[++i];
        else if (character === '$' || character === '`') return [];
        else literal += character;
      }
      decoded.push(literal);
    } else {
      if (/[$`;&|<>\\*?]/u.test(word)) return [];
      decoded.push(word);
    }
  }
  return decoded;
}

function sameGrammar(files) {
  if (!files.length) return fileDetectionOptions(null);
  const first = fileDetectionOptions(files[0]);
  return files.every(
    (file) =>
      JSON.stringify(fileDetectionOptions(file)) === JSON.stringify(first),
  )
    ? first
    : fileDetectionOptions(null);
}

export function bashOutputSegments(text, command, budget) {
  const words = simpleWords(command);
  const program = words[0]?.split('/').at(-1);
  const reader = ['cat', 'head', 'tail', 'less'].includes(program);
  const diff = program === 'git' && ['diff', 'show'].includes(words[1]);
  const flags = words.filter((word) => /^-[A-Za-z]+$/u.test(word));
  const search =
    program === 'rg' ||
    (program === 'grep' &&
      flags.some((word) => word.includes('r')) &&
      flags.some((word) => word.includes('n')));
  const noFilename =
    words.includes('--no-filename') ||
    (program === 'grep' && flags.some((word) => word.includes('h')));
  let files = [];
  if (reader) {
    // Accept simple display options and head/tail line counts. Unknown
    // switches, stdin, command composition and dynamic paths fall back.
    let valid = true;
    for (let i = 1; i < words.length; i += 1) {
      const word = words[i];
      if (word === '--') {
        files.push(...words.slice(i + 1));
        break;
      }
      if (
        (program === 'head' || program === 'tail') &&
        ['-n', '-c'].includes(word)
      ) {
        if (!/^\d+$/u.test(words[++i] ?? '')) valid = false;
      } else if (word.startsWith('-')) {
        if (
          !/^(?:-[qv]|-\d+|-[nc]\d+)$/u.test(word) ||
          program === 'cat' ||
          program === 'less'
        )
          valid = false;
      } else files.push(word);
    }
    if (!valid || files.includes('-')) files = [];
  }
  const segments = [];
  const push = (value, options) => {
    if (!value) return;
    const last = segments.at(-1);
    if (last && JSON.stringify(last.options) === JSON.stringify(options))
      last.text += value;
    else segments.push({ text: value, options });
  };
  let options = reader ? sameGrammar(files) : fileDetectionOptions(null);
  let hunk = false;
  for (const line of text.match(/[^\n]*\n|[^\n]+$/gu) ?? []) {
    if (budget && !recoveryRemaining(budget)) break;
    const header = reader && /^==> (.+) <==\r?\n?$/u.exec(line);
    if (header && files.includes(header[1])) {
      push(line, fileDetectionOptions(null));
      options = fileDetectionOptions(header[1]);
      continue;
    }
    if (diff) {
      if (/^(?:diff --git |\+\+\+ )/u.test(line)) {
        options = fileDetectionOptions(null);
        hunk = false;
      }
      const file = /^diff --git a\/(.+) b\/(.+)\r?\n?$/u.exec(line);
      const plus = /^\+\+\+ b\/(.+)\r?\n?$/u.exec(line);
      if (file || plus) {
        options = fileDetectionOptions(
          (plus?.[1] ?? file[2]).replace(/\r$/u, ''),
        );
        hunk = false;
      }
      if (/^@@ /u.test(line)) hunk = true;
      if (hunk && /^[ +\-]/u.test(line) && !/^---|^\+\+\+/u.test(line)) {
        // Scan hunk content together so multiline code keeps its grammar;
        // restore each transport prefix after scrubbing below.
        push(line, options);
      } else push(line, fileDetectionOptions(null));
      continue;
    }
    if (search) {
      const numbered = noFilename && /^(\d+:)([^\n]*)(\n?)$/u.exec(line);
      if (numbered) {
        segments.push({
          text: numbered[2] + numbered[3],
          options: fileDetectionOptions(null),
          prefix: numbered[1],
        });
        continue;
      }
      const prefix = /^((.+?):\d+:)([^\n]*)(\n?)$/u.exec(line);
      if (prefix) {
        // Each search result is an independent fragment, never a continuation
        // of another file's language string or expression.
        segments.push({
          text: prefix[3] + prefix[4],
          options: fileDetectionOptions(prefix[2]),
          prefix: prefix[1],
        });
        continue;
      }
    }
    push(line, options);
  }
  return segments;
}

// Detection always starts with the original transport text. Recovered grammar
// adds findings mapped to those offsets; no reconstructed or masked fragment
// can shrink the original protection. Masking then runs once on the union.
export function bashOutputFindings(
  text,
  command,
  detectionOptions = {},
  budget = outputRecoveryBudget(),
) {
  const unknownOptions = { ...detectionOptions, ...fileDetectionOptions(null) };
  const unknownStart = budget.now();
  const unknown = detectSensitiveData(text, unknownOptions);
  const unknownEnd = budget.now();
  const inputBytes = Buffer.byteLength(text);
  budget.outputBytes = Math.max(budget.outputBytes, inputBytes);
  const msPerByte = inputBytes ? (unknownEnd - unknownStart) / inputBytes : 0;
  if (!spendRecoveryWork(budget, inputBytes)) return unknown;
  // Options outside channel/context are constant for this invocation. Keep
  // this cache local so another field/profile cannot reuse stale findings.
  const scans = new Map();
  const recover = (value, options) => {
    const key = JSON.stringify([options.channel, options.context, value]);
    if (scans.has(key)) return scans.get(key);
    const bytes = Buffer.byteLength(value);
    // A synchronous detector cannot be interrupted by this worker's clock.
    // Admit a call only when this input's measured unknown rate predicts it
    // can finish before the absolute recovery deadline.
    if (!spendRecoveryWork(budget, bytes + 64, bytes * msPerByte)) return [];
    budget.scannedBytes += bytes;
    budget.detectorCalls += 1;
    const findings = detectSensitiveData(value, options);
    scans.set(key, findings);
    return findings;
  };
  const words = simpleWords(command);
  const diff =
    words[0]?.split('/').at(-1) === 'git' &&
    ['diff', 'show'].includes(words[1]);
  const contextual = [];
  let offset = 0;
  for (const segment of bashOutputSegments(text, command, budget)) {
    if (!recoveryRemaining(budget)) break;
    const start = offset + (segment.prefix?.length ?? 0);
    for (const finding of segment.prefix
      ? recover(segment.prefix, unknownOptions)
      : []) {
      contextual.push({
        ...finding,
        start: offset + finding.start,
        end: offset + finding.end,
      });
    }
    offset = start + segment.text.length;
    if (!recoveryRemaining(budget)) break;
    if (
      start === 0 &&
      segment.text.length === text.length &&
      segment.options.context === 'mixed'
    )
      continue;
    let plain = segment.text;
    let positions;
    if (diff && segment.options.context !== 'mixed') {
      positions = [];
      const chunks = [];
      let at = start;
      for (const line of plain.match(/[^\n]*\n|[^\n]+$/gu) ?? []) {
        chunks.push(line.slice(1));
        for (let i = 1; i < line.length; i += 1) positions.push(at + i);
        at += line.length;
      }
      plain = chunks.join('');
    }
    for (const finding of recover(plain, {
      ...detectionOptions,
      ...segment.options,
    })) {
      const from = positions ? positions[finding.start] : start + finding.start;
      const to = positions
        ? positions[finding.end - 1] + 1
        : start + finding.end;
      contextual.push({ ...finding, start: from, end: to, length: to - from });
    }
  }
  return unionFindings(unknown, contextual);
}

export function scrubBashResponse(
  response,
  command,
  scan,
  budget = outputRecoveryBudget(),
) {
  const scanOutput = (text) =>
    scan(text, {
      ...fileDetectionOptions(null),
      // Re-run after exact vault matches, whose tokens can change offsets.
      detectFindings: (value, options) =>
        bashOutputFindings(value, command, options, budget),
    });
  if (typeof response === 'string') return scanOutput(response);
  if (!response || Array.isArray(response) || typeof response !== 'object')
    return scan(response, fileDetectionOptions(null));
  return Object.fromEntries(
    Object.entries(response).map(([key, value]) => [
      key,
      ['stdout', 'output'].includes(key) && typeof value === 'string'
        ? scanOutput(value)
        : scan(value, fileDetectionOptions(null)),
    ]),
  );
}

export function scrubGrepResponse(
  response,
  scan,
  budget = outputRecoveryBudget(),
) {
  const context = {
    ...fileDetectionOptions(null),
    detectFindings: (value, options) =>
      bashOutputFindings(value, 'rg -n --with-filename', options, budget),
  };
  // Content mode alone carries file:line: fragments. Counts and filename
  // lists keep the ordinary unsplit scan, as do the response's metadata.
  if (!response || response.mode !== 'content')
    return scan(response, fileDetectionOptions(null));
  return Object.fromEntries(
    Object.entries(response).map(([key, value]) => [
      key,
      scan(value, key === 'content' ? context : fileDetectionOptions(null)),
    ]),
  );
}
