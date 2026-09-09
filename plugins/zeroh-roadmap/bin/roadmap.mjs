#!/usr/bin/env node
// Small file utilities. The native session owns execution and review.
const help = `Usage: roadmap status [root] [--json]
       roadmap claim [root] [--count N]
       roadmap claim [root] --work ID --owner SESSION [--release]
       roadmap init [--root path]
       roadmap phase validate <phase-or-arc-path|--all> [--json]
Removed workflow/config/gate commands are not compatibility aliases. Read README.md for migration.`
const [command, ...args] = process.argv.slice(2)
if (!command || ['--help', '-h', 'help'].includes(command) || args.includes('--help')) console.log(help)
else if (!['status', 'claim', 'init', 'phase'].includes(command)) {
  console.error(`roadmap ${command} was retired. Native skills run agents, checks and Git; use status or phase validate for typed records. Existing automation must be adapted before upgrading.\n${help}`)
  process.exitCode = 2
} else {
  try { process.exitCode = await (await import(`../cli/commands/${command}.mjs`)).default(args) }
  catch (error) { console.error(`roadmap: ${error.message}`); process.exitCode = 1 }
}
