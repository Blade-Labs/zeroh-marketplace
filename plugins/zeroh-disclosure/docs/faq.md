# ZeroH Disclosure FAQ

## When does ZeroH update?

Claude Code controls automatic marketplace refresh. ZeroH enables auto-update once unless you
have already chosen either setting; this does not guarantee an immediate release download.
Run `claude plugin marketplace update zeroh` to refresh the published catalog, then
`claude plugin update zeroh-disclosure@zeroh` to update the installed plugin. Restart Claude
Code afterwards so its hooks load the new code. Doctor reports a newer public marketplace
version, or says it could not check when offline; the request carries no user information.

The owner's 29 September 2026 observation of delayed 1.0.0 delivery did not record a Claude
Code version. The cached-folder behavior was separately observed with Claude Code 2.1.283;
see [troubleshooting](troubleshooting.md#zeroh-has-not-picked-up-a-newer-release). The automatic
refresh interval still needs a versioned live observation.

## Are miss reports sent to Blade Labs?

Reports stay on this computer. Sending miss reports to Blade Labs is planned for later. Release 1.1 has no intake service.
