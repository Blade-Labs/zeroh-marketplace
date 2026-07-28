#!/usr/bin/env bash
# Stamps the wall clock into every prompt. A session cannot notice that a gate round ate the
# afternoon without a clock, and nothing else in the transcript carries one.
#
# `printf %()T` is a bash BUILTIN, deliberately preferred over `date`: this runs on every prompt,
# so it forks nothing, and it still produces the line when PATH is stripped and no external
# `date` can be found. Fail-soft to the end (the beacon-stamp.sh posture): a hook that blocked a
# prompt to report the time would be worse than not knowing the time.
printf '[now] %(%Y-%m-%d %H:%M %Z)T\n' -1 2>/dev/null || date '+[now] %Y-%m-%d %H:%M %Z' 2>/dev/null || true
exit 0
