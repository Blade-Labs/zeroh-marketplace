// ESM shim around @bladelabs/blade-sdk.js.
//
// Why this exists: the package's published ESM build (lib/esm/index.js)
// uses extension-less imports (`./BladeSDK` instead of `./BladeSDK.js`),
// which Node.js strict ESM resolution rejects with ERR_MODULE_NOT_FOUND.
// The CJS build is intact, so we load it via createRequire and re-export.
//
// TODO(blade-sdk-fix): file an upstream fix to ship a Node-strict-ESM-
// compatible build, then drop this shim and import directly from
// `@bladelabs/blade-sdk.js`.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// createRequire uses CJS resolution; Node picks the `require` condition in
// the package's `exports` map, which routes to ./lib/cjs/index.js (the
// intact CJS build) instead of the broken ./lib/esm/index.js.
const bladeCjs = require('@bladelabs/blade-sdk.js');

export const BladeSDK = bladeCjs.BladeSDK;
export const ParametersBuilder = bladeCjs.ParametersBuilder;

// Re-export everything else the CJS build provides, so this shim is a
// drop-in replacement for the (broken) package root.
export default bladeCjs;
