// SPDX-License-Identifier: AGPL-3.0-only

// Public product identity used by runtime messages, lifecycle commands and
// documentation checks. Keep these values together so a marketplace rename
// cannot leave one removal or repair path pointing at an older identity.
export const PRODUCT_NAME = 'ZeroH Disclosure';
export const PUBLIC_MARKETPLACE_NAME = 'zeroh';
export const PUBLIC_MARKETPLACE_REPO = 'Blade-Labs/zeroh-marketplace';
export const PUBLIC_PLUGIN_ID = `zeroh-disclosure@${PUBLIC_MARKETPLACE_NAME}`;

// Compatibility for profiles that registered the public repository under
// its pre-1.0 name ends after the 1.1 release line. Remove
// staleMarketplaceName and its notice when 1.2.0 is prepared.
export const STALE_MARKETPLACE_COMPATIBILITY_REMOVE_IN = '1.2.0';
