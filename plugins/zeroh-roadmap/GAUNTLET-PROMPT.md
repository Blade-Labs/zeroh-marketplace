> Historical investigation record. This describes an earlier implementation, not the current execution contract. See [README.md](README.md) and [MULTI-DRIVER.md](MULTI-DRIVER.md).

# Skill Upgrade Gauntlet

Audit every Claude Code skill currently installed and autonomously upgrade the ones I select through a Skill Upgrade Gauntlet.

First, find and inspect every installed skill across every available scope. Preserve an immutable copy of every original skill and its resources.

Before beginning any upgrades, create a live local HTML dashboard showing the complete skill inventory, what each skill does, where it came from, whether it can be edited, and any dependencies or overlaps you discover. Open the dashboard on my computer and give me its link in Claude Code.

The dashboard is view-only. I should select which skills to upgrade and start the run by replying to you in Claude Code, not through the dashboard. Present the skills clearly, ask for my selection, and wait.

Once I respond, begin immediately and work autonomously until every selected skill is resolved. Do not ask me to direct the experiments, approve revisions, interpret results, or decide what to try next. Pause only for a genuine external blocker or an action that could affect live systems or data.

For each selected skill, begin by determining what the skill is actually meant to accomplish before changing anything.

Have fresh, independent agents inspect the complete original skill and its relevant resources, examples, and available evidence of real use. From that, create and verify a frozen, implementation-neutral outcome contract: a faithful specification of what the user cares about, what a successful result looks like, which qualities matter most, what constraints must be respected, what must never happen, and when the skill should or should not be useful.

Distinguish ends from means. Do not carry an old procedure, prompting technique, tool sequence, or implementation choice into the outcome contract merely because it appears in the original skill. Preserve a method only when the method itself is genuinely part of the user's requirement. Remove distinctive wording, examples, and procedural clues that could reveal which skill version produced an output.

Have a separate independent agent compare the proposed outcome contract against the original skill and identify anything important that was omitted, distorted, or incorrectly treated as a preference. Resolve those issues and freeze the contract before editing begins. Display the resulting contract in the dashboard.

Next, build the benchmark for that skill.

Give an independent benchmark designer the frozen outcome contract and a neutral description of the skill's intended capabilities and boundaries—but not the original skill's implementation instructions. Have it create a diverse suite of realistic tasks that collectively test the full outcome contract, including ordinary use, difficult situations, edge cases, relevant variations, and whether the skill activates appropriately.

For each task, create an evaluation packet containing everything an informed judge needs to evaluate the result correctly: the user request and inputs, the relevant parts of the outcome contract, any objective facts or invariants that must be satisfied, the relative importance of different qualities when necessary, and any failures that should disqualify an answer. Where no single ideal answer exists, specify what success means rather than inventing a rigid gold answer.

Split the benchmark into an iteration set and a sealed held-out set. Skill builders may learn from failures on the iteration set but must never see the held-out tasks, evaluation packets, expected results, or judge verdicts before the final evaluation.

Before editing begins, have another fresh agent audit the benchmark for coverage, realism, solvability, leakage, redundancy, leading criteria, and accidental bias toward the original skill. Fix any weaknesses, freeze the benchmark and acceptance standard, and show its coverage in the dashboard without exposing the sealed tasks.

Treat every selected skill as its own independent experiment. Evaluate at least these conditions on equivalent tasks:

- Opus 4.8 with the original skill
- Opus 5 with no skill
- Opus 5 with the original skill
- Opus 5 with the proposed upgraded skill

Every sample must be produced by a fresh, independent agent run that receives only the information needed to execute its assigned task and condition. Runs must not share conversations, reasoning, conclusions, artifacts, or memories with one another. No contestant may see another contestant's output.

Every judgment must also be performed by a fresh, independent agent run that is separate from the contestants, skill builders, benchmark designers, outcome-contract extractors, lead agent, and other judges.

Give each judge only:

- The task the contestant was asked to complete
- The task's implementation-neutral evaluation packet
- The anonymized outputs, behavior, or artifacts being compared, in randomized order

The judge must not see either skill file, know which model or skill produced an output, know what changes are being tested, see builder reasoning or previous verdicts, or know which result the lead agent hopes will win.

This allows judges to understand what the user values without exposing the instructions that produced the results.

Use real models, not simulated model personas. Verify the exact model used for every run and display it in the dashboard. Use the strongest appropriate independent judge models actually available. Never silently substitute models, route two conditions through the same underlying model, or claim that an unavailable model was tested.

Each judge must choose the better result, state its confidence, explain concretely why it is better for this user under the outcome contract, and identify any requirement either result violated or handled especially well. Evaluate the real deliverables, behavior, tool use, and artifacts—not summaries written by the lead agent.

Upgrade each skill for Opus 5. The only standing principle is this: a skill should primarily contain what the model could not reasonably know on its own. Beyond that, give the skill builders room to investigate, experiment, and try whatever they believe will produce the strongest general result. Let the evaluations decide what works.

When a candidate loses, use the blind feedback to understand why, try a better approach, and run the comparison again. Keep builders blind to held-out tests. Replace tests once iteration has contaminated them. Do not leak benchmark answers into a skill, tune to individual examples, cherry-pick generations, relax the standard, or optimize for a particular judge's quirks.

Green must represent a decisive, repeatable improvement rather than a narrow win, lucky sample, greater verbosity, or generic stylistic preference. The final result must clearly outperform the original stack, improve on the original skill when both use Opus 5, add real value beyond Opus 5 working without the skill, satisfy the outcome contract, survive fresh unseen testing, and introduce no important regressions.

If Opus 5 repeatedly performs best without a skill, do not manufacture a revised skill merely to turn the dashboard green. Treat retirement or disabling as a valid successful upgrade, label it transparently as "Green — retire," and preserve the evidence explaining why.

Keep the HTML dashboard updated throughout the run. For each skill, show its outcome contract, benchmark coverage, current state, exact models, completed trials, blind results, judge explanations, regressions, iteration history, current changes, held-out performance, and why it is red, yellow, or green. Make the underlying evidence inspectable without exposing sealed tests before they are used.

Persist all progress, results, candidate versions, and dashboard state so the run can resume safely after a context reset, process failure, rate limit, or interrupted Claude Code session.

Continue the Gauntlet Loop until every selected skill is honestly green or has been conclusively shown to be better retired. Then install the winning versions, preserve a reversible copy of every original, run one final clean evaluation using fresh agent runs and the sealed held-out set, update the dashboard with the final results, and notify me in Claude Code that the entire upgrade is complete.
