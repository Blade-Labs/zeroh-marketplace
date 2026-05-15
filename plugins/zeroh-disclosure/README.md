# ZeroH Disclosure · proof primitive + Claude Code adapter

ZeroH Disclosure is a disclosure-proof primitive. The unit of value is the
signed, verifiable, optionally anchored receipt proving which policy, boundary,
protection engine, and transformed view were applied before release.

The Claude Code plugin is the first adapter. The same proof primitive is also
available from the CLI, and future adapters such as browser extensions, MCP
servers, and IDE plugins should produce the same receipt contract.

---

## Quick install (recommended)

```bash
claude plugin marketplace add Blade-Labs/zeroh-marketplace
claude plugin install zeroh-disclosure@zeroh-marketplace
```

Verify:

```bash
claude plugin list | grep zeroh-disclosure
```

The plugin runs end-to-end with zero configuration using the local `regex-local`
reference engine. The Blade sample policy can also use Presidio as a
third-party protection engine through a local Docker sidecar.

## Proof primitive

Core contracts live in:

| Contract | Purpose |
| --- | --- |
| `docs/receipt-schema-v2.md` | Receipt fields, hash rules, signature rules, verifier expectations |
| `docs/protection-engine.md` | Engine interface for regex-local, Presidio, and future masking/DLP engines |
| `docs/blade-policy.md` | Blade sample policy behavior and fallback semantics |

Current surfaces:

| Surface | Role |
| --- | --- |
| Claude Code hooks | First interactive AI-boundary adapter |
| `zeroh-disclosure` CLI | Hook-independent proof creation and verification |
| Presidio sidecar | Third-party protection engine proof point |

### Optional: live Hedera HCS anchoring

By default the receipt pipeline records the anchor *intent* but doesn't
submit it on-chain. To turn anchoring on:

1. **Install the Hedera SDK once**, in the cached plugin install:

   ```bash
   cd ~/.claude/plugins/cache/zeroh-marketplace/zeroh-disclosure/*/
   npm install
   ```

   Re-run after `claude plugin update` — snapshot refreshes drop the cached
   `node_modules/`.

2. **Get a free Hedera testnet account** at <https://portal.hedera.com/>.
   The faucet hands out 100 ℏ — enough for hundreds of anchors.

3. **Mint an HCS topic** (one-time):

   ```bash
   HEDERA_OPERATOR_ID=0.0.xxxxxx HEDERA_OPERATOR_KEY=302e02... \
     node ~/.claude/plugins/cache/zeroh-marketplace/zeroh-disclosure/*/scripts/create-topic.mjs
   ```

   Note the topic id it prints.

4. **Configure per-project.** Drop a `.zeroh.env` file next to the code you
   launch Claude Code from:

   ```
   ZEROH_ANCHOR=1
   HEDERA_NETWORK=testnet
   HEDERA_OPERATOR_ID=0.0.xxxxxx
   HEDERA_OPERATOR_KEY=302e02...
   HEDERA_TOPIC_ID=0.0.yyyyyy
   ```

   This file beats the plugin's bundled defaults; real shell env vars beat
   both. See `.env.example` for the full list of boundary metadata
   variables.

---

## Try it

Activate the sample Blade policy with the structured command:

```
/zeroh-disclosure:apply-policy blade
```

Natural-language activation like `apply Blade policy` is recognized as a
convenience, but structured activation is canonical.

Start any Claude Code session and type something with sensitive data:

```
My card is 4532 0151 1283 0366 and my email is alice@example.com.
Draft a refund email.
```

You'll see a block before the raw prompt crosses the Claude boundary:

```
🛡  ZeroH Disclosure: policy applied before the Claude boundary.

Policy: blade-ai-disclosure-v1
Engine: regex-local
Receipt: zrh_...

Detected 2 item(s): CARD_NUMBER, EMAIL

Re-submit using this masked version (copy/paste):

────────────────────────────────────────
My card is [CARD_NUMBER-7a3f9e] and my email is [EMAIL-2b8d4c].
Draft a refund email.
────────────────────────────────────────
```

Copy the policy-permitted line, paste, hit Enter. The model drafts the email
using the tokens — never seeing the raw values. The receipt already exists
before this re-submit crosses the AI boundary. At the end of the turn, Stop
rolls receipts into a ProofPack:

```
📜 Turn 1: receipt zrh_… (anchored 0.0.…@… seq=1)
📦 ProofPack written: .zeroh/sessions/<sid>/turn-1.proofpack.json
```

Inspect what happened with the slash commands:

| Command | What it shows |
| --- | --- |
| `/zeroh-disclosure:mask-show` | Types + positions of redacted items (no raw values) |
| `/zeroh-disclosure:mask-receipt` | Signed SD-JWT receipt JSON |
| `/zeroh-disclosure:mask-anchor` | Hedera tx_id + HashScan URL |
| `/zeroh-disclosure:mask-proofpack` | Regulator-ready evidence export path |
| `/zeroh-disclosure:mask-config` | Policy + protection engine + anchor status |
| `/zeroh-disclosure:apply-policy blade` | Activate a named disclosure policy |
| `/zeroh-disclosure:disclosure-receipt` | Alias for the receipt view |
| `/zeroh-disclosure:disclosure-proofpack` | Alias for the ProofPack view |
| `/zeroh-disclosure:disclosure-anchor` | Alias for the anchor view |
| `/zeroh-disclosure:disclosure-config` | Policy + engine + anchor status |

(Or use the `mask-review` skill to scan a draft before pasting:
*"Use the mask-review skill on this: …"*.)

---

## Configuration

All settings live in a `.env`-style file. Precedence, highest first:

1. **Real environment variables** in your shell.
2. **`<project>/.zeroh.env`** in the cwd where you launch Claude Code
   (per-project override).
3. **`<plugin>/.env`** inside this folder (default).

| Variable | Purpose | Default |
| --- | --- | --- |
| `ZEROH_POLICY` | Active policy alias/id (`qcb`, `blade`) | `qcb` |
| `ZEROH_PROTECTION_ENGINE` | Override protection engine (`regex-local`, `presidio-http`) | policy default |
| `ZEROH_POLICY_MODE` | `fallback_with_receipt` or `fail_closed` | `fallback_with_receipt` |
| `PRESIDIO_ANALYZER_URL` | Presidio analyzer endpoint | `http://localhost:5002/analyze` |
| `PRESIDIO_ANONYMIZER_URL` | Presidio anonymizer endpoint | `http://localhost:5001/anonymize` |
| `ZEROH_ANCHOR` | `1` to submit anchors to Hedera | `0` |
| `HEDERA_NETWORK` | `testnet` or `mainnet` | `testnet` |
| `HEDERA_OPERATOR_ID` | Hedera account paying for submissions | — |
| `HEDERA_OPERATOR_KEY` | Operator private key (DER or hex) | — |
| `HEDERA_TOPIC_ID` | HCS topic to submit to (use `scripts/create-topic.mjs`) | — |
| `ZEROH_HCS_GRPC_DEADLINE_MS` | Per-HCS gRPC request deadline | `10000` |
| `ZEROH_HCS_TIMEOUT_MS` | Total HCS request timeout; must exceed gRPC deadline | `30000` |
| `ZEROH_HCS_MAX_ATTEMPTS` | Hedera SDK attempts before fallback | `4` |
| `ZEROH_DESTINATION` | Boundary field for the receipt | `anthropic_claude_api` |
| `ZEROH_MODEL` | Boundary model identifier | `claude-code` |
| `ZEROH_RETENTION` | Boundary retention class — affects which policy rule fires | `unknown` |
| `ZEROH_DESTINATION_JURISDICTION` | Boundary jurisdiction (ISO) | `US` |

Without Hedera credentials the plugin still runs end-to-end — it just skips
the live submit and stores the anchor *intent* in the receipt.

### Presidio sidecar

Start the third-party protection engine proof point with:

```bash
docker compose -f docker-compose.presidio.yml up
```

Then run:

```bash
node bin/zeroh-disclosure.mjs doctor --policy blade
node bin/zeroh-disclosure.mjs apply --policy blade --engine presidio-http --text "email alice@example.com"
```

If Presidio is unavailable, fallback behavior is controlled by the active
policy and recorded in `protection_engine_resolution` on the receipt.

### Repeatable Blade proof demo

```bash
docker compose -f docker-compose.presidio.yml up -d
node bin/zeroh-disclosure.mjs doctor --policy blade
node bin/zeroh-disclosure.mjs demo blade-proof --engine presidio-http
node bin/zeroh-disclosure.mjs verify --receipt .zeroh/sessions/<session>/turn-1.json
node bin/zeroh-disclosure.mjs verify --proofpack .zeroh/sessions/<session>/turn-1.proofpack.json
node bin/zeroh-disclosure.mjs poll-anchor --receipt .zeroh/sessions/<session>/turn-1.json
```

The demo prints the policy applied, engine used, fallback/degradation status,
raw-content flags, sanitized text, receipt hash, ProofPack hash, anchor status,
and verification result. If Presidio is unavailable the demo fails closed unless
you pass `--allow-fallback`, which records fallback to `regex-local` in the
receipt.

### CLI

```bash
node bin/zeroh-disclosure.mjs apply --policy blade --text "contact alice@example.com"
node bin/zeroh-disclosure.mjs verify --receipt .zeroh/sessions/cli-default/turn-1.json
node bin/zeroh-disclosure.mjs proofpack --session cli-default
node bin/zeroh-disclosure.mjs verify --proofpack .zeroh/sessions/cli-default/turn-1.proofpack.json
node bin/zeroh-disclosure.mjs poll-anchor --receipt .zeroh/sessions/cli-default/turn-1.json
node bin/zeroh-disclosure.mjs doctor
```

CLI sessions are peers to Claude sessions under `.zeroh/sessions/<id>`.

---

## Why a block-and-paste UX

Claude Code's `UserPromptSubmit` hook can block a prompt with a reason or add
context, but **it cannot rewrite the prompt** before the model sees it
(verified against the official hook spec). The honest pre-hook behavior is
therefore: detect → block → show the masked alternative → user pastes back.
One extra paste per sensitive prompt is the cost of *guaranteeing* the raw
values never reach the model.

For surfaces that allow transparent rewriting (browser extension hooking
`fetch`, for example), see `../research/zeroh-disclosure-integration-feasibility-v0.1.pdf`.

---

## Updating, uninstalling

```bash
claude plugin update zeroh-disclosure@zeroh-marketplace
claude plugin disable zeroh-disclosure@zeroh-marketplace
claude plugin uninstall zeroh-disclosure@zeroh-marketplace
claude plugin marketplace remove zeroh-marketplace
```

Hooks only load at Claude Code session start; restart any running sessions
after install / update / disable.

---

## What's inside

```
zeroh-disclosure/
├── .claude-plugin/plugin.json        ← Claude Code plugin manifest
├── .env.example                      ← copy to <project>/.zeroh.env
├── hooks/
│   ├── hooks.json                    ← UserPromptSubmit + Stop
│   ├── user-prompt-submit.js         ← pre-boundary policy proof + block/allow
│   └── stop.js                       ← finalize ledgers + ProofPack rollup/backfill
├── bin/zeroh-disclosure.mjs          ← apply / verify / proofpack / poll-anchor / doctor / demo
├── commands/                         ← apply-policy + disclosure-* commands (mask-* aliases retained)
├── skills/mask-review/               ← user-invokable "scan this draft for leaks"
├── lib/
│   ├── disclosure.js                 ← reusable proof primitive
│   ├── protection-engines/           ← regex-local + presidio-http adapters
│   ├── policy-registry.js            ← qcb + blade policy resolution
│   ├── crypto.js, sdjwt.js           ← P-256 signing, SD-JWT-style receipts
│   ├── receipt.js, proofpack.js      ← receipt v2 + rollup
│   ├── hedera-anchor.js, anchor-verify.js ← live HCS/EVM evidence + mirror verification
│   └── wallet/mock-wallet.js         ← session-persistent P-256 signer
└── scripts/create-topic.mjs          ← one-shot HCS topic mint
```

---

## What it's based on

Three pieces sit next to each other in this workspace; here's the map:

|  | `zeroh-disclosure-mvp` | `zeroh-disclosure-wallet-mvp` | `zeroh-disclosure` *(this)* |
|---|---|---|---|
| **Shape** | Provider-agnostic SDK + CLI + HTTP server | Non-custodial client library + Vue integration | Claude Code plugin |
| **Boundary** | Wraps `openaiCompatible` / `anthropicMessages` calls server-side | Generates receipts client-side; signs with a wallet adapter | Hooks into Claude Code's `UserPromptSubmit` / `Stop` events |
| **Detector + masker** | Built in | Built in | **Lifted from wallet-mvp**; token format swapped to FNV-1a deterministic |
| **Receipt** | `provenance.js` tokens + append-only `ledger.js` + MD ProofPack | SD-JWT-style receipts; Hedera **anchor intent** (no submit) | SD-JWT (lifted); **live Hedera HCS submission** added |
| **Signing wallet** | Server-managed / none | `genericWalletAdapter` — Blade signer or mock P-256 | Mock P-256, persisted per session to disk |
| **Storage** | Filesystem ledger | LocalStorage / memory vault | Per-turn JSON files under `.zeroh/sessions/<sid>/` |
| **CLI** | `bin/zeroh-disclosure.js` (demo/inspect/server/proofpack/verify) | `demo.js`, `dev-server.js` | `bin/zeroh-disclosure.mjs` apply/verify/proofpack/doctor |
| **Unique value** | Provider wrappers, ledger verification | Wallet abstraction, regulator/CISO/user presentations | Receipt/verifier primitive with Claude as first adapter |

**Architectural relationship**

- `zeroh-disclosure/lib/` is a **copy of `zeroh-disclosure-wallet-mvp/src/core/`** (`detector.js`, `mask.js`, `crypto.js`, `boundary.js`, `policy.js`, `policies/qcb-ai-disclosure.v1.js`, `sdjwt.js`, `receipt.js`, `proofpack.js`, `anchor.js`, `vault.js`), with one substantive change: `mask.js` now uses FNV-1a deterministic tokens (from the Ali Chat research) instead of counter-based `[TYPE_N]` tokens.
- The plugin **adds** `hedera-anchor.js` (live HCS submit via `@hashgraph/sdk`) and `session.js` (per-turn ledger on disk) — capabilities the wallet-mvp had as *intent* but never executed.
- `zeroh-disclosure-mvp` is a **separate, server-side lineage** that pre-dates the wallet refactor. Different architecture (HTTP server, provider wrappers, append-only ledger), different signing model.

In one sentence: **the invariant product is the receipt/verifier; Claude Code, CLI, browser extension, MCP, and IDE surfaces are adapters.** The convergence path sketched in `../research/repo-comparison.md` keeps the proof core canonical, folds disclosure-mvp's good ideas (ledger + verify tooling) into it, and ships thin surface adapters like this plugin as distribution products.

---

## Troubleshooting

**Hook doesn't fire.** Make sure you restarted Claude Code after install —
hooks load at session start. Run `claude plugin list` and confirm `zeroh-disclosure`
is `enabled`. For a deeper look, `claude --debug` shows hook events.

**Edits to the source don't seem to take effect.** `claude plugin install`
snapshots the plugin into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`.
Editing the source folder afterwards has no effect on the running install.
After making changes, bump `version` in `.claude-plugin/plugin.json` and
run:

```bash
claude plugin marketplace update zeroh-marketplace
claude plugin update zeroh-disclosure@zeroh-marketplace
# fully quit and restart Claude Code
```

(Or `claude plugin uninstall …` + `… install …` for a clean refresh.)

**Prompt is sent without a block.** Check which policy and protection engine
are active with `/zeroh-disclosure:disclosure-config`. Clean prompts are allowed
but still receive receipts; sensitive prompts depend on what the configured
engine detects.

**Anchor fails with `INSUFFICIENT_PAYER_BALANCE`.** Your operator account
balance is too low. Refill at <https://portal.hedera.com/faucet>.

**Docker unavailable.** Start Docker Desktop and confirm the Linux engine is
running, then start Presidio with `docker compose -f docker-compose.presidio.yml up -d`.

**Presidio unavailable.** Run `node bin/zeroh-disclosure.mjs doctor --policy blade`.
Check `PRESIDIO_ANALYZER_URL`, `PRESIDIO_ANONYMIZER_URL`, and whether the
sidecar containers are healthy.

**HCS fails with `UNKNOWN` or max attempts.** The HCS path uses gRPC. Keep
`ZEROH_HCS_TIMEOUT_MS` greater than `ZEROH_HCS_GRPC_DEADLINE_MS`; defaults are
`30000` and `10000`. The receipt records the HCS failure `stage`,
`duration_ms`, and timeout config.

**Anchor is submitted but not found.** Mirror node indexing can lag. Re-run
`poll-anchor`; HCS/EVM evidence remains in the receipt and can be checked later.

**EVM fallback was used.** HCS failed and Hashio/EVM credentials were present.
Inspect `anchor.hcs_attempt` for the HCS stage/error. The EVM calldata still
verifies against the receipt hash.

**`@hashgraph/sdk` not installed.** Run `npm install` inside this folder.

**Receipts not showing up.** Pre-boundary receipts are written in the turn JSON
as soon as the prompt hook runs. Stop finalizes ledgers and writes ProofPacks.
Use `/zeroh-disclosure:disclosure-receipt` or the CLI `verify` command to
inspect the latest proof.

---

## What this plugin does NOT do

- **Transparent rewriting** — the hook can only block, not rewrite. Use a
  browser extension for that surface (see the feasibility doc).
- **Universal coverage** — this is one of several adapters. See
  `../research/zeroh-disclosure-integration-feasibility-v0.1.pdf` for the full
  landscape.
- **Mainnet by default** — Hedera defaults to `testnet`. Flip
  `HEDERA_NETWORK=mainnet` only when you mean it.
