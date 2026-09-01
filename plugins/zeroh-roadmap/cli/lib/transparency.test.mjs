import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isExplanatoryEmpty } from './transparency.mjs'

test('isExplanatoryEmpty — explanatory prefixes are empty while near-miss words remain debt', () => {
  for (const text of ['None', 'None — already shared', ' nothing: no work', 'N/A, intentionally absent']) {
    assert.equal(isExplanatoryEmpty(text), true, text)
  }
  for (const text of ['nonetheless', 'nothingburger', 'N/Able', '', null, ['None']]) {
    assert.equal(isExplanatoryEmpty(text), false, String(text))
  }
})
