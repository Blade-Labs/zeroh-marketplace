#!/usr/bin/env bash
# Mechanizes the compaction-preservation contract the consumer CLAUDE.md states as prose. Prose a
# compaction can simply decline to honour is not a contract; this puts the same three items in
# front of the summarizer at the one moment they are about to be dropped.
#
# `printf` is a bash BUILTIN, deliberately preferred over `echo`/`cat` for the time-stamp.sh
# reason: it forks nothing and it still produces the block when PATH is stripped and no external
# command can be found. Fail-soft to the end — a hook that BLOCKED compaction in order to preserve
# context would destroy the session it was written to protect, so every path exits 0.
printf '%s\n' \
  'PRESERVE across this compaction:' \
  '  1. the modified-files list' \
  '  2. the active phase/task id + its next unfinished step' \
  '  3. which gate slots the current gate still owes' \
  'And BEFORE compacting, flush any durable lesson to the committed sidecar:' \
  '  roadmap eval lesson "<text>" --writer <your model id> [--phase N]' \
  2>/dev/null || true
exit 0
