// SPDX-License-Identifier: AGPL-3.0-only

export { readOptions } from './curl-wget.js';
export {
  GIT_WRITE_SUBCOMMANDS,
  commandAssignments,
  ghCommand,
  gitCommand,
} from './git-gh.js';
export { opensslCommand } from './cloud-clis.js';
export {
  RUNNER_OPTIONS,
  localProgramReach,
  optionWrites,
  optionWritesInto,
  uncHost,
} from './archive-and-fs.js';
export {
  AWK_PROGRAMS,
  INTERPRETER_OPTIONS,
  awkProgram,
  execCommand,
  interpreterCode,
  interpreterSpec,
  readAwkProgram,
  readCode,
  readSedScript,
  sedProgram,
} from './shells.js';
