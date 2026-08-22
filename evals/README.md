# Idiolect Skill offline gate

This is a product-behavior eval, not a publication test.

## Arms

Run every case in `skill-cases.json` twice in a fresh Claude conversation with the same Idiolect remote connector available:

- **Control:** connector enabled, candidate Skill disabled.
- **Skill:** connector enabled, `skills/idiolect-writing/SKILL.md` enabled.

Use the same Claude model and connector build for both arms. Do not reuse conversation state across cases.

For `profile: ready`, use a test account with a usable personal writing model. For `profile: missing`, use a clean test account and provide only the `context_evidence` named by the case. Do not add helpful hints that are absent from the case.

`context_evidence` and `context` describe conversation state to construct before the model sees the case's `prompt` (e.g. inject the described messages as earlier turns, or provision the test account's evidence store to match) — they are stage directions for the person running the eval, never text to paste into the conversation itself. Showing that sentence to the model under test leaks the expected setup path and invalidates the case.

For cases that carry a `user_followup`, script it as the human's reply if and only if Claude actually stops to ask for it; do not volunteer it, and do not fabricate a reply for a case that has no `user_followup` field — record that case's `setup_completed`/`writing_completed` as not-applicable rather than guessing what the user would have said.

## Score per case

Record binary fields from the observable conversation/tool trace:

- `intent_correct` — invoked Idiolect exactly when the case expects it.
- `sequence_valid` — profile check before personal writing; if setup is needed, setup/verify precedes writing.
- `setup_completed` — only for cases where setup is both needed and possible.
- `writing_completed` — the user's original writing task ended with usable requested prose.
- `unnecessary_question` — Claude asked for information/evidence it already had or did not need.
- `narrated_mechanics` — Claude exposed tool/profile/score choreography without a reason.
- `fact_or_belief_violation` — changed a pinned fact or invented a user belief/experience.

Keep the raw trace beside the score. Judge observable behavior, not prose prettiness.

### Mapping from case `expect` keys to the score fields above

The corpus uses a different vocabulary than the score fields; there is no 1:1 name match, so map by hand:

| `expect` key(s) | score field |
| --- | --- |
| `invoke_idiolect` | `intent_correct` |
| `setup`, `resume_original_task` | `sequence_valid`, `setup_completed` |
| `writing` | `writing_completed` |
| `ask_user: false`, `minimal_questions` | inverse of `unnecessary_question` |
| `no_tool_narration`, `no_score_narration` | inverse of `narrated_mechanics` |
| `preserve_facts`, `do_not_invent_belief` | inverse of `fact_or_belief_violation` |
| `only_for_prose`, `minimal_edit`, `smallest_blocker`, `preserve_original_task`, `no_internal_jargon` | not covered by any of the 7 fields — judge by hand and record separately; do not force these into one of the 7 |

`ask_user` (true or false) appears on only 7 of the 26 cases. Everywhere else, "no unnecessary question" is implicit from the absence of setup friction, not stated as ground truth. Gate criterion 6 (below) is therefore **directional, not a clean pass/fail** — report it as such rather than a binary verdict.

## Gate to Plugin work

Proceed to Plugin packaging only if all are true:

1. **Original-task completion improves by at least 20 percentage points** across positive personal-writing cases.
2. Among missing-profile cases where setup is possible, **setup-to-writing completion improves by at least 30 percentage points**. Only 6 cases currently qualify (setup possible and profile missing), so each case is worth ~17 points — this criterion has very low resolution at this corpus size; do not read a 1-2 case swing as a confident pass.
3. Ready-profile writing completion does not regress.
4. Intent precision is at least 90%: no habitual Idiolect calls for code, explicitly non-personal voice, or generic examples.
5. **Zero fact/belief violations.** One is a hard fail.
6. The Skill does not increase unnecessary questions or mechanics narration overall.

If the gate fails, fix the Skill or connector choreography before packaging anything. Installation/distribution work cannot rescue bad orchestration.

## Why this gate

E2 showed that creating an initiation event is cheap; converting that initiation into actual writing is the scarce behavior. This eval therefore rewards completed writing journeys and penalizes extra ceremony. Voice-profile implementation details are intentionally absent so the same cases survive a V2 profile rollout.
