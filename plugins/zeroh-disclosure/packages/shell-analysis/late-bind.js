// SPDX-License-Identifier: AGPL-3.0-only

export {
  LOAD_FAILURE_LINE,
  RUN_FILE_MAX_AGE_MS,
  TURN_END_GRACE_MS,
  gitBashPath,
  valuesFilePath,
} from './late-bind/detect.js';
export {
  rewriteBashCommand,
  rewritePowerShellCommand,
} from './late-bind/rewrite.js';
export {
  claudeCodeBraceQuoteRefusal,
  cleanupSessionRunFiles,
  cleanupStaleRunFiles,
  deleteValuesFile,
  prepareBashLateBinding,
  preparePowerShellLateBinding,
} from './late-bind/decide.js';
