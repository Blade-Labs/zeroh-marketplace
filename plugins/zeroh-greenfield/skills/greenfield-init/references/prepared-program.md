# Save a program once

Native edits, file copies and simple commands are the default. Optionally use
the installed plugin's `scripts/prepared-program.mjs` for an exceptional approved
bulk executable program. The helper is not a required initialization step.

1. Write the program once in an isolated working directory outside the consumer.
   Choose `bash`, `python` or `node` (ES module; use cwd-relative paths).
   Keep writers self-contained with standard-library/built-in imports. Execution
   uses a private temporary file, so relative imports and Node package resolution
   do not use the consumer root; cwd-relative filesystem paths do. Run project
   tooling through separate approved commands from the consumer root rather than
   importing application modules into a writer.
   For embedded languages, prepare separate programs so each gets its own syntax
   check. Do not hide unvalidated Python/JS inside a shell heredoc.
2. Write a request JSON with `cwd` (absolute consumer root), `script` (absolute
   saved source), `kind`, and `paths` (unique repository-relative target files,
   including files expected to be absent). Run:
   `node <plugin>/scripts/prepared-program.mjs prepare <request.json> <scratch-dir>`.
   The helper checks syntax/tool availability, captures actual target bytes and
   mode, and returns a content-addressed artifact path outside the consumer.
   Preparation does not mutate the consumer. Review its source and target list.
3. Include the returned artifact and its short execution command in the concrete
   proposal. After host/user approval, execute:
   `node <plugin>/scripts/prepared-program.mjs run <returned-artifact> --approved`.
   The flag acknowledges existing approval; it cannot grant authority. Retain
   the host's normal filesystem, network and approval controls.
4. The helper checks the artifact digest, syntax and unchanged targets before
   execution, then executes a private temporary copy of the checked bytes with
   closed stdin and removes that copy afterward. Bash stops on failed commands
   and pipelines. The saved artifact remains available for inspection. Capture
   its real exit code. Never retype the program, predict hashes or append an
   exit-printing suffix. A changed target or program requires preparing and
   reviewing the changed operation before execution.

The declared targets are preconditions, not a filesystem sandbox. Review the
program's complete effects. This helper has no rollback, journal, retries or
crash recovery. A failed program may have partially applied; inspect actual
state before proposing a repair. Syntax checks cannot prove semantics: run
appropriate non-mutating validation on prepared inputs before expensive work,
and verify the real output afterward. Do not guess post-generator hashes;
inspect generated state before preparing a dependent program. If that changes
approved behavior, obtain approval for the delta.
