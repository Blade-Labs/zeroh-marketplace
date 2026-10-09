// SPDX-License-Identifier: AGPL-3.0-only

// curl and wget consume the shared getopt-compatible option reader. The
// current shell-program registry has no program-specific curl/wget reader;
// destination handling owns those tables.
export * from './options.js';
