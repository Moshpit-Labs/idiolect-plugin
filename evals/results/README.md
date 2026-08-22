# Results

`run.mjs` writes timestamped JSONL result files here (`skill-eval-<ts>.jsonl`
for real runs, `skill-eval-dryrun-<ts>.jsonl` for `--dry-run`). They are
generated artifacts, not source — `.gitignore` keeps `*.jsonl` in this
directory out of version control so a local run never gets committed by
accident.
