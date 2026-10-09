# Parser measurements, fourth round, 2026-10-05

Linux; Node 22.23.2 and 26.1.0, bash and zsh. Each leg ran alone, with no other
agent test/lint/build/benchmark process running. Twenty cold parser processes
and twenty cold hook processes per variant. Hook variants run ABAB:
A = no adapter, B = adapter, repeated twenty times. Percentiles use nearest rank.
All durations below are milliseconds. Load averages describe the host, which
also had unrelated work; they are not CPU utilization percentages.

| Node    | Shell |  Parser p50 / p95 | Hook adapter p50 / p95 | No-adapter p50 / p95 | Hook delta p50 / p95 | Parser gate | Hook gate |
| ------- | ----- | ----------------: | ---------------------: | -------------------: | -------------------: | ----------- | --------- |
| 22.23.2 | bash  | 156.919 / 206.524 |      674.737 / 814.397 |    558.499 / 634.956 |    116.238 / 179.441 | pass        | fail      |
| 22.23.2 | zsh   | 142.263 / 173.666 |      710.797 / 890.084 |    626.201 / 747.075 |     84.596 / 143.009 | pass        | pass      |
| 26.1.0  | bash  | 394.671 / 444.455 |      800.266 / 902.372 |    658.710 / 776.109 |    141.556 / 126.262 | fail        | pass      |
| 26.1.0  | zsh   | 357.561 / 397.952 |      770.056 / 878.843 |    606.496 / 668.870 |    163.560 / 209.973 | fail        | fail      |

| Node    | Shell | Start load 1 / 5 / 15 min | After parser/CST load 1 / 5 / 15 min | End load 1 / 5 / 15 min |
| ------- | ----- | ------------------------- | ------------------------------------ | ----------------------- |
| 22.23.2 | bash  | 13.43 / 17.14 / 17.76     | 13.96 / 17.19 / 17.77                | 13.96 / 16.93 / 17.67   |
| 22.23.2 | zsh   | 13.96 / 16.93 / 17.67     | 14.04 / 16.90 / 17.66                | 14.12 / 16.65 / 17.55   |
| 26.1.0  | bash  | 14.12 / 16.65 / 17.55     | 14.39 / 16.63 / 17.53                | 12.59 / 16.06 / 17.32   |
| 26.1.0  | zsh   | 12.59 / 16.06 / 17.32     | 12.41 / 15.91 / 17.26                | 7.60 / 14.40 / 16.71    |

All measures (each n = 20):

| Node    | Shell | Measure          |  p50 ms |  p95 ms |
| ------- | ----- | ---------------- | ------: | ------: |
| 22.23.2 | bash  | runtimeLoad      |  37.506 |  76.007 |
| 22.23.2 | bash  | perCommand       |   0.483 |   0.985 |
| 22.23.2 | bash  | sixtyCommandPass |  28.987 |  59.114 |
| 22.23.2 | bash  | parser           | 156.919 | 206.524 |
| 22.23.2 | bash  | wholeHook        | 674.737 | 814.397 |
| 22.23.2 | bash  | noAdapterHook    | 558.499 | 634.956 |
| 22.23.2 | zsh   | runtimeLoad      |  41.980 |  59.812 |
| 22.23.2 | zsh   | perCommand       |   0.412 |   0.814 |
| 22.23.2 | zsh   | sixtyCommandPass |  24.690 |  48.816 |
| 22.23.2 | zsh   | parser           | 142.263 | 173.666 |
| 22.23.2 | zsh   | wholeHook        | 710.797 | 890.084 |
| 22.23.2 | zsh   | noAdapterHook    | 626.201 | 747.075 |
| 26.1.0  | bash  | runtimeLoad      |  38.609 |  63.687 |
| 26.1.0  | bash  | perCommand       |   0.667 |   1.245 |
| 26.1.0  | bash  | sixtyCommandPass |  39.998 |  74.715 |
| 26.1.0  | bash  | parser           | 394.671 | 444.455 |
| 26.1.0  | bash  | wholeHook        | 800.266 | 902.372 |
| 26.1.0  | bash  | noAdapterHook    | 658.710 | 776.109 |
| 26.1.0  | zsh   | runtimeLoad      |  41.958 |  62.970 |
| 26.1.0  | zsh   | perCommand       |   0.528 |   0.869 |
| 26.1.0  | zsh   | sixtyCommandPass |  31.688 |  52.117 |
| 26.1.0  | zsh   | parser           | 357.561 | 397.952 |
| 26.1.0  | zsh   | wholeHook        | 770.056 | 878.843 |
| 26.1.0  | zsh   | noAdapterHook    | 606.496 | 668.870 |

The 60-command default/Liftoff CST identity check passed in all four runs.
Parser gate follows the owner ruling: p50 < 300 ms; whole-hook p95 <= same-runner
no-adapter p95 + 150 ms and < 1,000 ms. All four hook p95 values are below
1,000 ms. Only Node 22 zsh passes both eligibility gates; other legs have no
verified fallback in these measurements. The parser statistic remains pending
owner confirmation (memo p95, ruling p50); thresholds are unchanged. Timing
eligibility binds phase 44 in 1.1.1 and does not block 1.1.0 test assets.

The supplied existing Node 26.1.0 binary was prepended to PATH. No dependency
installation or upstream fetch was performed. These are local measurements,
not complete CI shell/oracle evidence. macOS, Windows and PowerShell remain
CI-only. Other older parser JSON files are historical; use the four node22/node26
files accompanying this table for this round.
