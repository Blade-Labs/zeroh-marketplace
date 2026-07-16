#!/usr/bin/env bash
# DEPRECATED (ROADCODE 1655) — absorbed by `roadmap claim`; shim removed at the 1661 cutover.
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/bin/roadmap.mjs" claim "$@"
