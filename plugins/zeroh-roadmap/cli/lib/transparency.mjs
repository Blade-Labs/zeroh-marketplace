/** True when a transparency debt field explains that it is empty. */
export function isExplanatoryEmpty(value) {
  return typeof value === 'string' && /^(none|nothing|n\/a)\b/i.test(value.trim())
}
