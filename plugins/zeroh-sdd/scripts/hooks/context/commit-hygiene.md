You have **{{uncommittedCount}}** uncommitted files (threshold: {{threshold}}).

Commit after EACH logical unit of work. One file moved = commit. One module created = commit. One bug fixed = commit.

**Why:** After compaction, you recover via `git log`. Granular commits = granular recovery. Batched commits = lost decisions = repeated work.

**Action:** `git add <specific files> && git commit -m "type(scope): what"`
