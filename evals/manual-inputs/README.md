# Manual inputs for a real run

`run.mjs` and `score.mjs` automate the mechanical parts of the eval (arm
plumbing, key selection, isolation, resumability, raw capture). Three things
in `evals/README.md` and `evals/RUN.md` are explicitly human judgment calls
and are never fabricated by the scripts. Each has its own directory here,
created on demand — none of these exist until a human authors them.

## `context/<case-id>.json` — literal prior turns

Some cases carry a `context_evidence` (or `context`) field in
`skill-cases.json`. Per `evals/README.md`'s leakage note, that field is a
**stage direction for the human running the eval**, never text to paste into
the conversation — pasting it verbatim tells the model under test exactly
what the case is checking for.

If a case needs actual prior conversation turns (as opposed to connector-side
account state — see below), author the real turns here:

```json
{ "priorTurns": ["<first message a human/tool would actually have sent>", "..."] }
```

`run.mjs` sends these as real earlier turns in the same session before the
case's own prompt. If this file is absent, the case runs with just its
prompt, and the record notes `contextEvidenceSynthesized: false` plus the
original stage-direction text (for the human reviewing results, never sent to
the model).

Several `context_evidence` values describe **connector-side account state**
("the connector reports more evidence required", "first setup attempt
returns build_in_progress") rather than conversation turns. Those can't be
injected by this script at all — they require the `IDIOLECT_KEY_MISSING`
test account to actually be in that state before the case runs. See the
per-case account note in `evals/RUN.md`.

## `followups/<case-id>.txt` — literal second-turn reply

Same leakage problem, one level down: `user_followup` in the corpus is also a
description ("User supplies two short writing samples and explicitly
consents..."), not verbatim reply text. `run.mjs` only sends a second turn
when its transcript heuristic thinks Claude stopped to ask (flagged
`heuristicAskedDetected` in the record — verify it against the raw transcript,
it is not ground truth) AND a literal reply exists here. Author the actual
reply text a human would type, e.g. for `no-profile-needs-evidence`:

```
Here are two short samples: ...
Yes, you can use these to set up my writing model.
```

## `scores/<name>.jsonl` — human-judged per-case-per-arm scores

`score.mjs --init-scores <path>` scaffolds this from a raw results file: one
line per recorded case+arm, the 7 fields from `evals/README.md`'s "Score per
case" section set to `null`. Fill them in by hand against the raw transcript
in the results file, using the `expect`-key mapping table in
`evals/README.md`. Then run:

```
node evals/score.mjs evals/results/<raw-file>.jsonl --scores evals/manual-inputs/scores/<name>.jsonl
```

This step is skipped only for `--dry-run` output, where `run.mjs` embeds a
`syntheticScores` block directly (fabricated for pipeline verification, never
a judgment) and `score.mjs` reads that instead — every such report is banner-
and prefix-labeled SYNTHETIC.
