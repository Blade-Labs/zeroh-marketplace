// Whole documentation values only. Every word must be in this closed
// vocabulary; case, character diversity and entropy cannot grant an exemption.
const DOCUMENTATION_WORDS = new Set(
  (
    'api key keys token tokens access secret secrets pass passwd password pwd pw ' +
    'passphrase credential credentials auth bearer client id user username ' +
    'login email name host hostname port db database value string your my the here ' +
    'insert enter replace put placeholder example sample redacted xxx x ' +
    'change me changeme org account project region bucket url'
  ).split(' '),
);

export function isDocumentationPlaceholder(value) {
  // The 40-character whole-value bound includes both brackets.
  if (typeof value !== 'string' || !/^<[^<>\r\n]{1,38}>$/u.test(value))
    return false;
  const name = value.slice(1, -1).toLowerCase();
  // Preserve the explicitly documented spelling without allowing attached
  // digits on arbitrary words (for example, Password1 or Summer24).
  if (name === 'token1') return true;
  const words = name.split(/[-_. ]/u);
  if (/^[0-9]{1,2}$/u.test(words.at(-1))) words.pop();
  return (
    words.length > 0 && words.every((word) => DOCUMENTATION_WORDS.has(word))
  );
}
