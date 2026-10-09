// SPDX-License-Identifier: AGPL-3.0-only

// Registration must stay usable without loading the detector (the hook loader
// can read configuration even when a detector install is broken). Detection
// sources choose a conservative scope; known and reported values match bare.
export function defaultMatchScope({ type, value, source }) {
  if (typeof value !== 'string' || value.length < 6) return 'in-context';
  if (type === 'PERSON' && !source?.startsWith('reported:'))
    return 'in-context';
  if (source?.startsWith('known:') || source?.startsWith('reported:'))
    return 'bare';
  if (
    (source === 'prompt' || source === 'detected') &&
    value.length <= 25 &&
    /^[A-Za-z][a-z]+[?!.,]?$/u.test(value) &&
    value.replace(/[?!.,]$/u, '').length <= 24
  )
    return 'in-context';
  if (source === 'detected') {
    if (['QATAR_ID', 'ACCOUNT_NUMBER'].includes(type)) return 'in-context';
    if (type === 'PHONE_NUMBER' && !value.trim().startsWith('+'))
      return 'in-context';
    if (
      /^(?:[/~]|\.\.?\/|\$|[`!(<[@&*#%=])|^[A-Za-z_$][A-Za-z_$.:-]*[!?;]*$/u.test(
        value,
      )
    )
      return 'in-context';
  }
  return 'bare';
}
