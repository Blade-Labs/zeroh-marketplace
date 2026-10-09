// SPDX-License-Identifier: AGPL-3.0-only

// SPDX-License-Identifier: MIT
// Inject only in the real run.js worker, before it imports PreToolUse.
import { isMainThread, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';

if (!isMainThread && workerData?.name === 'pre-tool-use') {
  const event = JSON.parse(workerData.input);
  const command = event.tool_input.command;
  const shell = process.env.ZEROH_TEST_PARSER_SHELL;
  let result;
  if (shell === 'pwsh' || shell === 'powershell-5.1') {
    const { parsePowerShell } = await import('./powershell-adapter.mjs');
    result = parsePowerShell(command, {
      executable: process.env.ZEROH_TEST_PARSER_EXECUTABLE,
    });
    if (result.errors.length)
      throw new Error('Benchmark command has PowerShell parse errors');
  } else {
    const { parseBash } = await import('./bash-adapter.mjs');
    result = await parseBash(command);
    if (result.hasError)
      throw new Error('Benchmark command has Bash parse errors');
  }
  writeFileSync(
    process.env.ZEROH_TEST_PARSER_MARKER,
    JSON.stringify({ parsed: true, shell, commandLength: command.length }),
  );
}
