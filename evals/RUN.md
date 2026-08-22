# Reproducing the Skill-off vs Skill-on offline gate

Status as of 2026-08-22: **not run**. See "Why this is blocked here" below. The
harness (`evals/run.mjs` + `evals/score.mjs`) is now built and verified
end-to-end via `--dry-run` against a stub — everything in this doc that does
not require the live connector or a second test account has been checked
against `claude --help` and actually exercised. This file documents that
implementation and what a human still has to supply to point it at real
accounts.

## What you need

- A `claude` CLI (v2.1.170+ confirmed to support the flags below) authenticated
  to a Claude account with model access.
- Two **separate Idiolect test accounts** and their `IDIOLECT_API_KEY` values:
  - `IDIOLECT_KEY_READY` — has a usable Voice Profile already (`get_my_voice`
    returns `state: "ready"`).
  - `IDIOLECT_KEY_MISSING` — a clean account with no Voice Profile
    (`get_my_voice` returns not-ready), used only for the 7 `profile: missing`
    cases (`no-profile-context-evidence`, `no-profile-needs-evidence`,
    `no-profile-rewrite-evidence`, `setup-shortfall`, `setup-retry`,
    `setup-silent-mechanics`, `user-declines-setup`).
- Network access to `https://idiolect.lol` (the connector's MCP endpoint).
- Do not sign up new accounts as part of running this — this doc assumes they
  already exist; creating test accounts is outside this audit's remit.

## The plugin bundles two skills — isolate the candidate first

`skills/` currently holds both the shipped `in-your-voice` skill and the
candidate `idiolect-writing` skill, and `.claude-plugin/plugin.json` does not
select one — Claude Code auto-loads every directory under `skills/`. Pointing
`--plugin-dir` at this repo as-is would load **both** skills in the "Skill-on"
arm, which confounds the comparison (you would not know which skill fired).

Build an isolated, session-local copy that contains only the candidate before
running the Skill-on arm:

```bash
ISO=$(mktemp -d)
mkdir -p "$ISO/.claude-plugin" "$ISO/skills"
cp .claude-plugin/plugin.json "$ISO/.claude-plugin/plugin.json"
cp .mcp.json "$ISO/.mcp.json"
cp server.mjs "$ISO/server.mjs"
cp -r skills/idiolect-writing "$ISO/skills/idiolect-writing"
# deliberately omit skills/in-your-voice
```

Use `$ISO` as the `--plugin-dir` target for the Skill-on arm. This directory
is temporary and session-local — nothing is installed, published, or added to
any marketplace, and nothing under version control changes.

## Per-case run — implemented by `evals/run.mjs`

This section originally specified a command sequence by hand. It has since
been implemented as `evals/run.mjs` (`node evals/run.mjs --model <model>`),
which is now the source of truth for the exact invocation; run it with
`--dry-run` to see the pipeline exercised against a stub. What follows
documents that implementation and four corrections found while building it
against `claude --help` (v2.1.170):

1. **`.mcp.json` uses `${CLAUDE_PLUGIN_ROOT}`.** That placeholder is only
   substituted when the config is loaded through `--plugin-dir`. Passed
   directly via `--mcp-config` (the control arm, which never uses
   `--plugin-dir`), it comes through literally and the connector fails to
   spawn — silently turning the control arm into "no connector" rather than
   "connector, no skill," which would invalidate every lift number. The
   runner resolves it to an absolute path once and uses that same resolved
   file for both arms via `--mcp-config`.
2. **Isolation needs `--setting-sources ""` too, not just `--plugin-dir` +
   `--strict-mcp-config`.** Those two flags isolate the *explicit* MCP config
   and the *explicit* plugin dir, but an operator's own ambient
   `~/.claude` config (user-level plugins, project `.mcp.json` via cwd) still
   loads unless setting sources are also emptied — confirmed empirically:
   without it, unrelated user-level plugins showed up in the session's
   `plugins` list. The runner passes `--setting-sources ""` and runs from a
   neutral temp `cwd`, never the repo root.
3. **`--output-format json` returns only the final result, not the tool-call
   trace** that `intent_correct` and `sequence_valid` need. Use
   `--output-format stream-json --verbose` (confirmed: `stream-json` in
   `--print` mode requires `--verbose` or the CLI refuses to start) and keep
   the full JSONL event stream as the raw record.
4. **`--continue` is the wrong resume mechanism for a scripted, multi-case
   harness.** It resumes "the most recent conversation in the current
   directory" — ambiguous once many cases run in the same process/cwd. Use
   `--session-id <uuid>` on the first turn and `--resume <uuid>` on the
   follow-up turn instead; each case gets an unambiguous, addressable
   session regardless of run order.

One thing this section got right that's worth restating: `user_followup` has
the same leakage problem `context_evidence` does — it's a *description*
("User supplies two short writing samples...") in the source corpus, not
literal reply text. Pasting the field verbatim as the human's turn would leak
the expected setup path exactly like pasting `context_evidence` would. The
runner never does this; see `evals/manual-inputs/README.md` for where the
literal reply text has to come from.

`$KEY_FOR_THIS_CASE_PROFILE` is `IDIOLECT_KEY_READY` for `profile: ready`
cases, `IDIOLECT_KEY_MISSING` for `profile: missing` cases — `run.mjs` selects
this automatically per case.

Score each raw result with `evals/score.mjs` against `skill-cases.json`'s
`expect` block, using the key-mapping table in `evals/README.md`. Keep every
raw transcript beside its score — do not summarize before scoring.

## Cases this repo cannot exercise even with the above

- `failed-connector`: requires the Idiolect connector to actually be
  unavailable. `run.mjs` handles this case by pointing `--mcp-config` at a
  deliberately unreachable command for that one case only; do not claim this
  tests the real connector's failure mode, only the Skill's response to a
  generic MCP failure.
- All 7 `profile: missing` cases require the clean second account above; there
  is no way to reset a `ready` account back to missing without deleting real
  profile data, so do not attempt that against `IDIOLECT_KEY_READY`.
- **The 6 setup-possible missing-profile cases each need a *different*
  connector-side evidence state on that one account**:
  `no-profile-context-evidence` (two pre-approved messages already stored),
  `no-profile-needs-evidence` (nothing stored, no consent),
  `no-profile-rewrite-evidence` (draft available, consent not yet given),
  `setup-shortfall` (some evidence, connector still wants more),
  `setup-retry` (enough evidence, but the *first* setup attempt must return
  `build_in_progress` — a fault-injection need, not just a data state), and
  `setup-silent-mechanics` (evidence already approved and stored). A single
  clean account cannot hold four different states at once, and the first case
  that successfully completes setup stops the account from being `missing`
  for the next one run against it. Whoever runs this for real needs either a
  way to reset/re-seed `IDIOLECT_KEY_MISSING`'s evidence state between cases,
  or one throwaway account per case — `setup-retry` in particular may not be
  reachable at all without a way to force `build_in_progress` on demand.

## This run is not a dry run. Plan for it.

Every case drives the **live** remote connector against real accounts. A full
run creates real Voice Profiles and real writing output, and the backend records
it the same way it records any other user activity. 26 cases x 2 arms is 52
synthetic user journeys. Two consequences:

1. **Coordinate with whoever owns the product analytics before running.** These
   journeys are indistinguishable from real usage after the fact unless someone
   plans for them. Either run while nothing is being measured, or record both
   test accounts' user ids up front and hand them over for exclusion.
2. **A change freeze forbids this run entirely.** If the current rule is "no
   writes to production", there is no compliant way to execute the eval against
   the live connector, whatever tooling is available. That is the binding
   blocker, not the tooling gaps below. Schedule the run for after the freeze.

## Why this is blocked here

This audit's environment has: no `IDIOLECT_KEY_MISSING` (no second, clean
Idiolect test account — the one connector visible in this session already
returned `state: "ready"`), no way to force a connector outage for
`failed-connector`, and (per this task's own hard rules) no authorization to
install or publish the candidate Skill anywhere, session-scoped or otherwise,
beyond what is documented above for someone who does have those two things.

Also confirmed directly: `claude plugin eval` is **not** a subcommand of this
CLI at v2.1.170 — `claude plugin eval --help` silently prints the parent
`claude plugin` help rather than erroring. It appears to be early-access gated.
Do not build the harness around it without checking availability first.
That is 8 of 26 cases structurally unrunnable regardless of tooling, so no
partial run was attempted — a partial run scored as if it were the full gate
would misrepresent the gate's own missing-profile and failure-path criteria.
No results in this file or elsewhere in this repo are simulated; the gate
status is PENDING until someone with both test accounts runs the above.
