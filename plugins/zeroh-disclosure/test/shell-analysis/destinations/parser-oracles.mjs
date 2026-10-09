// SPDX-License-Identifier: AGPL-3.0-only

import {
  createBashParser,
  nodesOfType,
  parseWithBashParser,
} from '../parsers/bash-adapter.mjs';
import { parsePowerShellCommands } from '../parsers/powershell-adapter.mjs';
import { parseBash } from '../../../packages/shell-analysis/shell-scan.js';
import { generateCorpus, TOKEN, VALUE } from './corpus.mjs';
import {
  freshEnvironment,
  shellExecutable,
  shellKind,
  shellDeadline,
} from './isolation.mjs';
import { executeArgvCase, executePowerShellArgvCases } from './oracles.mjs';

function allTokens(tokens) {
  return tokens.flatMap((token) => [
    token,
    ...allTokens(token.nestedTokens || []),
  ]);
}

export async function runParserOracles({ shell, executables = {} }) {
  const kind = shellKind(shell);
  const report = { shell, cases: 0, failures: [], disagreements: [] };
  if (kind === 'cmd')
    return {
      ...report,
      supported: false,
      reason: 'cmd has no parser adapter; requires conservative notice path',
    };
  const rows = generateCorpus().filter(
    (row) =>
      row.shell === kind &&
      row.oracle === 'argv' &&
      row.program === 'curl' &&
      !row.id.endsWith('-allowed'),
  );
  if (!rows.length)
    throw new Error('parser oracle has no cases for required shell');
  if (kind === 'bash' || kind === 'zsh') {
    const parser = await createBashParser();
    try {
      // All static curl option spellings and quotes, not merely easy bare words.
      for (const row of rows.filter(
        (r) =>
          ![
            'substitution',
            'bash-zsh-array',
            'heredoc-quoted',
            'heredoc-unquoted',
          ].includes(r.category),
      )) {
        const command = row.command.replaceAll(TOKEN, VALUE);
        const parsed = parseWithBashParser(parser, command);
        if (parsed.hasError) {
          report.disagreements.push({
            id: row.id,
            reason: 'CST rejects command accepted by shell corpus',
          });
          continue;
        }
        const node = nodesOfType(parsed.root, 'command').find(
          (n) => n.children[0]?.text === 'curl',
        );
        if (!node) {
          report.failures.push(`${row.id}: CST command missing`);
          continue;
        }
        const args = [];
        let unresolved = false;
        for (const word of node.children.slice(1)) {
          const resolved = parseBash(`probe ${word.text}`);
          const words = resolved.commands[0]?.words.slice(1) || [];
          if (
            !resolved.ok ||
            words.some((w) => w.dynamic || w.glob || w.brace)
          ) {
            unresolved = true;
            break;
          }
          args.push(...words.map((w) => w.value));
        }
        const expected = row.expected.argv.map((arg) =>
          arg.replaceAll(TOKEN, VALUE),
        );
        if (!unresolved && JSON.stringify(args) !== JSON.stringify(expected))
          report.disagreements.push({
            id: row.id,
            reason:
              'CST word spans with 1.0 resolver disagree with real-shell authored argv',
          });
        report.cases++;
      }
      // Node boundaries for references are structural, independent of text regex.
      for (const [id, command, type, expected] of [
        ['literal-reference', "curl '$STRIPE_KEY:'", 'simple_expansion', 0],
        ['ansi-reference', "curl $'$STRIPE_KEY:'", 'simple_expansion', 0],
        ['escaped-reference', 'curl \\$STRIPE_KEY', 'simple_expansion', 0],
        ['full-reference', 'curl "$STRIPE_KEY:"', 'simple_expansion', 1],
        ['suffix-reference', 'curl $STRIPE_KEY_SUFFIX', 'simple_expansion', 1],
        ['brace-reference', 'curl "${STRIPE_KEY}_SUFFIX"', 'expansion', 1],
        ['comment-reference', '# $STRIPE_KEY\ncurl x', 'simple_expansion', 0],
        [
          'heredoc-literal',
          "curl <<'EOF'\n$STRIPE_KEY\nEOF",
          'simple_expansion',
          0,
        ],
        [
          'heredoc-expansion',
          'curl <<EOF\n$STRIPE_KEY\nEOF',
          'simple_expansion',
          1,
        ],
      ]) {
        const parsed = parseWithBashParser(parser, command);
        if (
          parsed.hasError ||
          nodesOfType(parsed.root, type).length !== expected
        )
          report.failures.push(`${id}: CST reference boundary differs`);
        report.cases++;
      }
    } finally {
      parser.delete();
    }
  } else {
    const selected = rows.filter((r) =>
      [
        'stop-string',
        'stop-comment',
        'reference-suffix',
        'reference-boundary',
        'here-string',
      ].includes(r.category),
    );
    const fixture = freshEnvironment('parser-oracle');
    try {
      const commands = selected.map((row) =>
        row.command.replaceAll(TOKEN, VALUE),
      );
      const batch =
        kind === 'powershell'
          ? await executePowerShellArgvCases(
              selected.map((row, index) => ({
                ...row,
                command: commands[index],
              })),
              { shell, executables, parserCommands: commands },
            )
          : null;
      const parsed = batch
        ? batch.parsed
        : parsePowerShellCommands(commands, {
            executable: shellExecutable(shell, executables),
            env: fixture.env,
            timeout: shellDeadline(shell, 8000),
          });
      if (!parsed) throw new Error('PowerShell parser batch failed');
      for (let index = 0; index < selected.length; index++) {
        const row = selected[index];
        const result = parsed.results[index];
        const tokens = allTokens(result.tokens);
        const observed =
          batch?.observations[index] ??
          (await executeArgvCase(
            { ...row, command: commands[index] },
            { shell, executables },
          ));
        const expected = row.expected.argv.map((arg) =>
          arg.replaceAll(TOKEN, VALUE),
        );
        if (
          result.errors.length ||
          observed.status !== 0 ||
          JSON.stringify(observed.calls[0]?.argv) !== JSON.stringify(expected)
        )
          report.failures.push(`${row.id}: parser/shell fixture failed`);
        const tokenFor = (text) => tokens.find((token) => token.text === text);
        if (
          row.category === 'stop-string' &&
          !tokens.some((t) => /^String/u.test(t.kind) && t.text.includes('--%'))
        )
          report.failures.push(
            `${row.id}: stop marker is not inside string token`,
          );
        if (
          row.category === 'stop-comment' &&
          !tokens.some((t) => t.kind === 'Comment' && t.text.includes('--%'))
        )
          report.failures.push(
            `${row.id}: stop marker is not inside comment token`,
          );
        if (
          row.category === 'reference-suffix' &&
          tokenFor('$STRIPE_KEY_SUFFIX')?.kind !== 'Variable'
        )
          report.failures.push(`${row.id}: suffix variable boundary lost`);
        if (
          row.category === 'reference-boundary' &&
          tokenFor('${STRIPE_KEY}')?.kind !== 'Variable'
        )
          report.failures.push(`${row.id}: braced variable boundary lost`);
        if (
          row.category === 'here-string' &&
          !tokens.some((t) => t.kind === 'HereStringLiteral')
        )
          report.failures.push(`${row.id}: here-string token missing`);
        report.cases++;
      }
      report.version = parsed.version;
    } finally {
      fixture.cleanup();
    }
  }
  return report;
}
