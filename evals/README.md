# Idiolect Skill offline gate

This is a product-behavior eval, not a publication test.

## Arms

Run every case in `skill-cases.json` twice in a fresh Claude conversation with the same Idiolect remote connector available:

- **Control:** connector enabled, candidate Skill disabled.
- **Skill:** connector enabled, `skills/idiolect-writing/SKILL.md` enabled.

Use the same Claude model and connector build for both arms. Do not reuse conversation state across cases.

For `profile: ready`, use a test account with a usable personal writing model. For `profile: missing`, use a clean test account and provide only the `context_evidence` named by the case. Do not add helpful hints that are absent from the case.

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

## Gate to Plugin work

Proceed to Plugin packaging only if all are true:

1. **Original-task completion improves by at least 20 percentage points** across positive personal-writing cases.
2. Among missing-profile cases where setup is possible, **setup-to-writing completion improves by at least 30 percentage points**.
3. Ready-profile writing completion does not regress.
4. Intent precision is at least 90%: no habitual Idiolect calls for code, explicitly non-personal voice, or generic examples.
5. **Zero fact/belief violations.** One is a hard fail.
6. The Skill does not increase unnecessary questions or mechanics narration overall.

If the gate fails, fix the Skill or connector choreography before packaging anything. Installation/distribution work cannot rescue bad orchestration.

## Why this gate

E2 showed that creating an initiation event is cheap; converting that initiation into actual writing is the scarce behavior. This eval therefore rewards completed writing journeys and penalizes extra ceremony. Voice-profile implementation details are intentionally absent so the same cases survive a V2 profile rollout.
