# ZeroH Disclosure · Claude Code plugin

Detects sensitive content in your prompts **before** they leave the device,
blocks the submission, and shows you a deterministically tokenized rewrite to
paste back. When the turn ends, a signed SD-JWT receipt is built and
(optionally) anchored to Hedera HCS — non-repudiable evidence of what was
masked.

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

The plugin runs end-to-end with zero configuration — detection, masking,
signed receipts, and ProofPack writes all work immediately.

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

Start any Claude Code session and type something with sensitive data:

```
My card is 4532 0151 1283 0366 and my email is alice@example.com.
Draft a refund email.
```

You'll see:

```
🛡  ZeroH Disclosure: your prompt contains sensitive data that should not be sent to the model.

Detected 2 item(s): CARD_NUMBER, EMAIL

Re-submit using this masked version (copy/paste):

────────────────────────────────────────
My card is [CARD_NUMBER-7a3f9e] and my email is [EMAIL-2b8d4c].
Draft a refund email.
────────────────────────────────────────
```

Copy the masked line, paste, hit Enter. The model drafts the email using the
tokens — never seeing the raw values. At the end of the turn:

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
| `/zeroh-disclosure:mask-config` | Detector categories + env status |

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
| `ZEROH_ANCHOR` | `1` to submit anchors to Hedera | `0` |
| `HEDERA_NETWORK` | `testnet` or `mainnet` | `testnet` |
| `HEDERA_OPERATOR_ID` | Hedera account paying for submissions | — |
| `HEDERA_OPERATOR_KEY` | Operator private key (DER or hex) | — |
| `HEDERA_TOPIC_ID` | HCS topic to submit to (use `scripts/create-topic.mjs`) | — |
| `ZEROH_DESTINATION` | Boundary field for the receipt | `anthropic_claude_api` |
| `ZEROH_MODEL` | Boundary model identifier | `claude-code` |
| `ZEROH_RETENTION` | Boundary retention class — affects which policy rule fires | `unknown` |
| `ZEROH_DESTINATION_JURISDICTION` | Boundary jurisdiction (ISO) | `US` |

Without Hedera credentials the plugin still runs end-to-end — it just skips
the live submit and stores the anchor *intent* in the receipt.

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
│   ├── user-prompt-submit.js         ← detect → block-and-suggest masked rewrite
│   └── stop.js                       ← finalize receipt + Hedera anchor + ProofPack
├── commands/                         ← /mask-show, /mask-receipt, /mask-anchor, /mask-proofpack, /mask-config
├── skills/mask-review/               ← user-invokable "scan this draft for leaks"
├── lib/
│   ├── detector.js                   ← regex + Luhn + IBAN/MOD-97 validators
│   ├── mask.js                       ← deterministic FNV-1a tokens
│   ├── crypto.js, sdjwt.js           ← P-256 signing, SD-JWT-style receipts
│   ├── receipt.js, proofpack.js      ← disclosure pipeline orchestration
│   ├── policy.js                     ← versioned + hashed policy (default: QCB demo)
│   ├── hedera-anchor.js              ← live HCS submission via @hashgraph/sdk
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
| **CLI** | `bin/zeroh-disclosure.js` (demo/inspect/server/proofpack/verify) | `demo.js`, `dev-server.js` | None — the plugin lives inside Claude Code |
| **Unique value** | Provider wrappers, ledger verification | Wallet abstraction, regulator/CISO/user presentations | Real pre-hook integration with an AI tool, live anchor, interactive UX |

**Architectural relationship**

- `zeroh-disclosure/lib/` is a **copy of `zeroh-disclosure-wallet-mvp/src/core/`** (`detector.js`, `mask.js`, `crypto.js`, `boundary.js`, `policy.js`, `policies/qcb-ai-disclosure.v1.js`, `sdjwt.js`, `receipt.js`, `proofpack.js`, `anchor.js`, `vault.js`), with one substantive change: `mask.js` now uses FNV-1a deterministic tokens (from the Ali Chat research) instead of counter-based `[TYPE_N]` tokens.
- The plugin **adds** `hedera-anchor.js` (live HCS submit via `@hashgraph/sdk`) and `session.js` (per-turn ledger on disk) — capabilities the wallet-mvp had as *intent* but never executed.
- `zeroh-disclosure-mvp` is a **separate, server-side lineage** that pre-dates the wallet refactor. Different architecture (HTTP server, provider wrappers, append-only ledger), different signing model.

In one sentence: **wallet-mvp is the library; mask-plugin is the first real surface adapter that consumes it; disclosure-mvp is a parallel earlier attempt that took a server-side bet.** The convergence path sketched in `../research/repo-comparison.md` keeps wallet-mvp as the canonical core, folds disclosure-mvp's good ideas (ledger + verify tooling) into it, and ships thin surface adapters like this plugin — and, later, a browser extension — as the consumer products.

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

**Prompt is sent without masking.** Check the detector matched. The detector
runs on the raw prompt text only. Whitespace and unicode normalization edge
cases can cause misses — the `mask-review` skill is useful for testing what
the detector sees on a given passage.

**Anchor fails with `INSUFFICIENT_PAYER_BALANCE`.** Your operator account
balance is too low. Refill at <https://portal.hedera.com/faucet>.

**`@hashgraph/sdk` not installed.** Run `npm install` inside this folder.

**Receipts not showing up.** They're written at the end of a turn (Stop hook).
A prompt that was blocked but never re-submitted won't have a finalized
receipt until you re-submit the masked version and let the agent finish a
turn.

---

## What this plugin does NOT do

- **Transparent rewriting** — the hook can only block, not rewrite. Use a
  browser extension for that surface (see the feasibility doc).
- **Universal coverage** — this is one of several adapters. See
  `../research/zeroh-disclosure-integration-feasibility-v0.1.pdf` for the full
  landscape.
- **Mainnet by default** — Hedera defaults to `testnet`. Flip
  `HEDERA_NETWORK=mainnet` only when you mean it.
