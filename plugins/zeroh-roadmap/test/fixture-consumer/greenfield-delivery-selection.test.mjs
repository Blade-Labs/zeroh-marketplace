import test from 'node:test'
import assert from 'node:assert/strict'
import { validateDeliverySelection, DELIVERY_PATHS } from './greenfield-native-evidence.mjs'

test('local prototype defers delivery without creating or replacing existing infrastructure', () => {
  const before = { [DELIVERY_PATHS[0]]: { sha256: 'existing', mode: 420 } }
  const input = { arm: {}, proposal: {}, before, after: structuredClone(before), commands: [] }
  assert.deepEqual(validateDeliverySelection(input), { deferred: true })
  for (const path of DELIVERY_PATHS) {
    assert.throws(() => validateDeliverySelection({ ...input, after: { ...before, [path]: { sha256: 'changed' } } }), /deferred delivery must preserve/)
  }
  assert.throws(() => validateDeliverySelection({ ...input, arm: { deliveryValidation: {} } }), /cannot claim validation/)
})

test('selected delivery cannot lose its proposal or receipt to take the deferred path', () => {
  const input = { arm: {}, proposal: {}, before: {}, after: {}, commands: [] }
  for (const selected of [{ arm: { delivery: {} } }, { proposal: { delivery: {} } }]) {
    assert.throws(() => validateDeliverySelection({ ...input, ...selected }))
  }
})
