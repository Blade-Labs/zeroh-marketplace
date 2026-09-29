# Product principles

These rules decide how ZeroH Disclosure behaves when it is unsure. Every change to the plugin
follows them, and every release is checked against them.

1. **ZeroH adds protection where there was none; it never takes away what Claude Code can do.**
2. **Mask what we can, pass what we can't.**
3. **Only two things are stopped by default:**
   - a secret heading to a host we know isn't allowed (the stop names the one-line command that
     allows it);
   - the model changing ZeroH's own protection: its settings, its keys and vault, its hooks, or
     the local proxy.
4. **Blocking uncertain cases is opt-in:** `/zeroh-disclosure:settings uncertain block`.
5. **We always show whether you're protected, and say when something wasn't.** When ZeroH can't check an operation, you see
   one plain line, for example:

   ```text
   ZeroH Disclosure: this command was not protected (couldn't parse it).
   ```

   The first time in a session, the line also says how to block these instead. It is shown at most
   once per reason per turn, and never contains a value.

   The [status line](how-to.md#show-zeroh-in-the-status-line) shows it all the time: 🟢
   protected, 🟡 files only, or 🔴 not protecting, with the operations not protected this turn.

6. **Every pass-through is recorded with a reason.** The receipt and `/zeroh-disclosure:report`
   count them by reason (dynamic destination, script or interpreter, unknown launcher, couldn't
   parse, timed out, unknown format, proxy not running, too large, check failed, and a call that
   ran with the token because the value couldn't be put back). Detection improves over time, especially
   in Premium, and these counts show which gaps matter most.
7. **Never ask the user to change how they work.**
8. **Never mask what we can't restore.** A token only helps if ZeroH can put the real value back
   for the user's commands, edits and screen. If it can't, for example because the vault can't be
   opened, the value passes unmasked, with a line saying it was not protected:

   ```text
   ZeroH Disclosure: this tool output was not protected (ZeroH couldn't open its vault) · /zeroh-disclosure:doctor
   ```

   The same holds when the vault opens but can't be saved (another writer holds its lock, a disk
   error): values already on disk stay masked, and every new one passes unmasked, with the line
   `… was not protected (ZeroH couldn't save its vault) · /zeroh-disclosure:doctor`. The local
   proxy can't show a line itself, so the turn's Stop shows it. A dead token would break the
   user's work.

   **A deliberate exception to rule 4:** with `uncertain block` the hooks withhold or stop, but
   the local proxy still passes new values unmasked when the vault can't be saved, and the Stop
   line says so. The proxy never refuses a request for this failure: Claude Code retries a refused
   request and then ends the session, which would take away what it can do (rule 1). The receipt
   and the signed turn summary count those values as sent, not masked.

## What this means in practice

| Situation                                                                                                  | Default (`uncertain pass`)                                              | `uncertain block`                                           |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| A secret heading to a host that isn't allowed                                                              | stopped, with the allow command                                         | stopped                                                     |
| The model changing ZeroH's settings, keys or hooks                                                         | stopped                                                                 | stopped                                                     |
| A secret heading somewhere ZeroH can't work out                                                            | runs; "not protected" line; recorded                                    | stopped, with the reason                                    |
| A command ZeroH can't parse                                                                                | runs; "not protected" line; recorded                                    | stopped, with the reason                                    |
| A secret typed while the local proxy isn't running                                                         | sent; "not protected" line; recorded                                    | prompt stopped                                              |
| Reading an SSH key, kubeconfig or credentials file                                                         | read; what the detector finds is masked; recorded                       | refused                                                     |
| A hook that runs out of time                                                                               | passes unchecked; "not protected" line; recorded                        | stopped or withheld                                         |
| A project `.zeroh.env` that can't be read                                                                  | defaults apply; "not protected" line; recorded                          | stopped                                                     |
| Tool output over 1 MB                                                                                      | passed unscanned; "not protected" line; recorded                        | withheld                                                    |
| Tool output whose check fails                                                                              | passed as is; "not protected" line; recorded                            | withheld                                                    |
| ZeroH's vault can't be opened (tool output, file reads, prompts through the proxy)                         | passed unmasked, never with dead tokens; "not protected" line; recorded | withheld or stopped                                         |
| ZeroH's vault opens but can't be saved (every mask path)                                                   | values on disk stay masked, new ones pass; "not protected" line         | withheld or stopped; through the proxy, as in pass (rule 8) |
| A raw secret in a WebFetch URL                                                                             | the destination rules, as for a command                                 | stopped                                                     |
| A token ZeroH can't put back: vault closed, value expired, a `Monitor` command, a command it can't prepare | runs with the token; "ran with the token, not your key" line; recorded  | stopped                                                     |

## For contributors

A change that adds a denial or a stop is accepted only if it is one of the two kinds in rule 3,
or applies only in `uncertain block` mode. The deny-inventory test (`test/deny-inventory.test.mjs`)
fails on a new denial reason until it is added there with a justification. A change that masks
must mask with the project's vault and save it through `lib/restorable.js` (`maskRestorably` or
`saveRestorably`), so every token it emits can be put back (rule 8). `test/rc2-last-stops.test.mjs`
checks that no mask path emits a token when the vault can't be opened, and
`test/vault-unsaveable.test.mjs` that none emits one it couldn't save.
