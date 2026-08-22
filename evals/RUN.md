# Reproducing the Skill-off vs Skill-on offline gate

Status as of 2026-08-22: **not run**. See "Why this is blocked here" below. This
file is the exact command sequence for whoever has what this audit environment
lacked.

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

## Per-case run

For each of the 26 cases in `skill-cases.json`, run twice (control, then
skill), in a fresh conversation both times (`-p` with no `--continue`/`-c`),
same model both times:

```bash
# Control arm: connector only, no skill
IDIOLECT_API_KEY="$KEY_FOR_THIS_CASE_PROFILE" \
claude -p "$PROMPT_TEXT" \
  --mcp-config .mcp.json \
  --strict-mcp-config \
  --model <same-model-both-arms> \
  --output-format json > "results/<case-id>.control.json"

# Skill arm: connector + isolated candidate skill only
IDIOLECT_API_KEY="$KEY_FOR_THIS_CASE_PROFILE" \
claude -p "$PROMPT_TEXT" \
  --mcp-config .mcp.json \
  --strict-mcp-config \
  --plugin-dir "$ISO" \
  --model <same-model-both-arms> \
  --output-format json > "results/<case-id>.skill.json"
```

`$KEY_FOR_THIS_CASE_PROFILE` is `IDIOLECT_KEY_READY` for `profile: ready`
cases, `IDIOLECT_KEY_MISSING` for `profile: missing` cases.

For cases with `context_evidence` describing prior turns (not `missing`-profile
setup state), construct those turns as actual earlier messages in the
conversation — never paste the `context_evidence` sentence itself (see
`evals/README.md`, leakage note).

For cases with `user_followup`: only send it as a second `-p` turn (via
`--continue`) if the transcript shows Claude actually stopped to ask; otherwise
leave the case single-turn and mark `setup_completed`/`writing_completed`
not-applicable per the README.

Score each result file by hand against `skill-cases.json`'s `expect` block,
using the key-mapping table in `evals/README.md`. Keep every raw
`--output-format json` transcript beside its score — do not summarize before
scoring.

## Cases this repo cannot exercise even with the above

- `failed-connector`: requires the Idiolect connector to actually be
  unavailable. Simulate with a `--mcp-config` pointing at a deliberately
  unreachable command/URL for that one case only; do not claim this tests the
  real connector's failure mode, only the Skill's response to a generic MCP
  failure.
- All 7 `profile: missing` cases require the clean second account above; there
  is no way to reset a `ready` account back to missing without deleting real
  profile data, so do not attempt that against `IDIOLECT_KEY_READY`.

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
