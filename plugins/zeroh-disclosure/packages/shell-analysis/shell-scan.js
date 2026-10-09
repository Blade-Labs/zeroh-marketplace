// SPDX-License-Identifier: AGPL-3.0-only

export { commentStarts, readHeredocWord } from './tokenizer/shared.js';
export { parseBash } from './tokenizer/bash.js';
export { LAUNCHER_NAMES, programName, unwrapCommand } from './tokenizer/cmd.js';
export { parsePowerShell, stopParsingRanges } from './tokenizer/powershell.js';
export { analyzeBash, analyzeShell, shellReadings } from './scan.js';
