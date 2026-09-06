import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(resolve(PLUGIN, path), 'utf8')
const POINTER = '(remedy: using-zeroh-roadmap/references/layout.md §Missing homes)'

test('missing-home remedy has one owner and every STOP/infer site points to it exactly once', () => {
  const owner = read('skills/using-zeroh-roadmap/references/layout.md')
  assert.equal((owner.match(/^## Missing homes$/gm) ?? []).length, 1, 'owner heading must resolve exactly once')
  assert.match(owner, /\/plugin install zeroh-greenfield@zeroh-marketplace/)
  assert.match(owner, /brownfield-audit/)
  assert.match(owner, /never (?:create|author).*inline/i)

  const sites = [
    'skills/plan-arc/references/design-gate.md',
    'skills/plan-arc/SKILL.md',
    'agents/ux-designer.md',
    'agents/software-architect.md',
    'agents/test-engineer.md',
    'skills/test-strategy/SKILL.md',
  ]
  for (const site of sites) {
    const body = read(site)
    assert.equal(body.split(POINTER).length - 1, 1, `${site} must carry exactly one canonical remedy pointer`)
  }
})

test('mutating child protocols resolve the single repository-governance reference', () => {
  const ownerPath = 'skills/using-zeroh-roadmap/references/governance.md'
  assert.match(read(ownerPath), /^# Repository governance$/m)
  const sites = [
    ['skills/using-zeroh-roadmap/SKILL.md', 'references/governance.md'],
    ['skills/do-phase/SKILL.md', '../using-zeroh-roadmap/references/governance.md'],
    ['skills/do-arc/SKILL.md', '../using-zeroh-roadmap/references/governance.md'],
    ['skills/plan-phase/SKILL.md', '../using-zeroh-roadmap/references/governance.md'],
  ]
  for (const [site, pointer] of sites) {
    const body = read(site)
    assert.equal(body.split(pointer).length - 1, 1, `${site} must carry exactly one canonical governance pointer`)
    const resolved = resolve(PLUGIN, dirname(site), pointer)
    assert.equal(resolved, resolve(PLUGIN, ownerPath), `${site}'s governance pointer must resolve to the one owner`)
    assert.doesNotThrow(
      () => readFileSync(resolved, 'utf8'),
      `${site}'s governance pointer must resolve to the committed owner`,
    )
  }
})
