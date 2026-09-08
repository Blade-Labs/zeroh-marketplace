# Running this protocol on Codex

The skills are the protocol for every harness. They name ACTIONS ("spawn the architect role",
"read the phase file"); this page translates those actions into Codex's tools and says how a
Codex session fills a role it cannot run itself. Skill bodies are never edited per harness.

## The skills reach you natively — verified, not assumed

Probed on **codex-cli 0.144.5** (2026-08-24, host `illumination`):

```
$ codex plugin marketplace add /home/patrik/zeroh-marketplace
{"marketplaceName":"zeroh-marketplace","installedRoot":"/home/patrik/zeroh-marketplace","alreadyAdded":false}

$ codex plugin add zeroh-roadmap@zeroh-marketplace          # before the index entry existed
Error: plugin `zeroh-roadmap` was not found in marketplace `zeroh-marketplace`

$ codex plugin add zeroh-roadmap@zeroh-marketplace          # after it was added
Added plugin `zeroh-roadmap` from marketplace `zeroh-marketplace`.

$ codex debug prompt-input        # what the model actually sees — 13 of these lines
- zeroh-roadmap:Do Phase: Execute a roadmap phase task-by-task with enforced sequential
  discipline… (file: …/plugins/cache/zeroh-marketplace/zeroh-roadmap/0.32.0/skills/do-phase/SKILL.md)
```

Two facts follow. **Discovery is the MARKETPLACE INDEX**: `<marketplace-root>/.agents/plugins/marketplace.json`
must list the plugin — the Claude-side `.claude-plugin/marketplace.json` is not read, and without
an entry `plugin add` refuses by name. **Surfacing is native**: every skill under `skills/` reaches
the model's prompt with its description and path, with no session-start hook and no per-session
opt-in. `.codex-plugin/plugin.json` declares that channel explicitly (`"skills": "./skills/"`) and
omits Claude hook configuration. Claude alone receives the explicit
`"hooks": "./hooks/claude-hooks.json"` pointer; the conventional cross-host `hooks/hooks.json`
name stays absent so another host cannot auto-discover Claude-shaped events. A hook *system* is
not a session-start *event*: confirm the specific event exists before building a bootstrap on it.

`codex debug prompt-input` is the re-runnable check. If a skill stops appearing there, discovery
broke — do not infer it from an installed-plugin listing, which reports installation, not surfacing.

## Action vocabulary → Codex tools

| The skills say | On Codex |
|---|---|
| read a file / search the repo | your file-read and shell tools; read relevant inputs once and refresh changed evidence |
| spawn a role / dispatch an agent | `spawn_agent` (needs `multi_agent`, below) — or the child-CLI route when the role's model is not yours |
| message a running agent, ask for a fix round | `followup_task` — it delivers, triggers a turn, and reloads an evicted child |
| wait for a spawned role | `wait_agent`, in bounded stretches of 5-10 min; it is an event subscription, so short polls buy nothing |
| run a suite / a gate slot | your shell tool, wrapped per the consumer's shared-host rules |

Subagent tools require the feature to be on in `~/.codex/config.toml`:

```toml
[features]
multi_agent = true
```

Trust your actual tool list over this table when they disagree — which tools you get depends on
the multi-agent version your model preset selects.

- **Spawning**: give children a clean context with `spawn_agent {fork_turns: "none"}`; the default
  `"all"` copies your entire transcript into the child. Role files under `~/.codex/agents/` attach
  to isolated forks via `agent_type` on **Codex 0.145+ only** — this host is 0.144.5, so treat
  `agent_type` as unavailable until you have checked your own version.
- **Model names**: never copy a model id from a skill, a table, or an old session into
  `spawn_agent` without checking it against your current spawn allowlist.
- **Lifecycle**: V2 has no `close_agent`; finished children are evicted automatically.

## Filling a role you cannot run yourself

`MULTI-DRIVER.md` §1 is the role table: each protocol spawn point has a class, a model tier chain
and a fulfillment mode. `resolveRole(roleId, 'codex')` returns which model to ask and how to reach
it — you do not choose either:

- **`native`** — the model is your own: `spawn_agent`.
- **`child-cli`** — the model belongs to another driver. Launch it as a headless child with the
  prompt on stdin, argv from the registry (`cli/lib/drivers.mjs`) — for the Claude family that is
  `claude -p [--agents <json>]`. This is how a Codex session fills the architect role on its
  chain's FIRST tier, a Claude-family model — read the chain itself off `MULTI-DRIVER.md` §1,
  never off this page.
- **`inline`** — no separate model is reachable, so you run the role yourself. Legal for
  builder-class roles, and RECORDED as inline: label it as your own work and never present it as
  an independent review.

Record every firing into the phase's `executionResult.roles`, and record a substitution when a
tier was skipped. A role binding that is not recorded did not happen as far as the scorecard is
concerned.

## Native review invocation

Use the invoking session's actual authority, never a profile inferred from repository config:
`roadmap codex review <N> --parent-authority <read-only|workspace-write|isolated-unsafe>`.
Omit `--doc` unless supplying a readable repository-relative path (`--doc <path>`); it is
not a switch. A cold checkout returns an install recipe before model launch. Within existing
install authority, prepare that exact checkout and retry the same command. Otherwise retain the
hold. The command never installs or grants broader authority implicitly.

## Environment

Detect the checkout shape with read-only git before any worktree or branch step:

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
BRANCH=$(git branch --show-current)
```

`GIT_DIR != GIT_COMMON` → you are already in a linked worktree (skip creation). Empty `BRANCH` →
detached HEAD: commit, then report the branch name and message rather than pushing.
