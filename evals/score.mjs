#!/usr/bin/env node
// evals/score.mjs
//
// Reads a raw results file written by evals/run.mjs and emits the six gate
// criteria from evals/README.md ("Gate to Plugin work"). This file does not
// invent a second scoring vocabulary — the seven per-case-per-arm fields it
// consumes (intent_correct, sequence_valid, setup_completed, writing_completed,
// unnecessary_question, narrated_mechanics, fact_or_belief_violation) are
// exactly the ones defined in evals/README.md's "Score per case" section, and
// README's expect-key mapping table is what a human uses to produce them.
//
// Judging those seven fields from a transcript is a human/LLM-judge task,
// not something this script invents — README describes it as something a
// person records "from the observable conversation/tool trace." So in a REAL
// run, this scorer requires a human-authored scores file (JSONL, one line per
// case+arm) alongside the raw transcript file; use --init-scores to scaffold
// one from a raw file's actual recorded case+arm pairs.
//
// The one exception is a --dry-run raw file from run.mjs: those records embed
// a `syntheticScores` block (fabricated for pipeline verification, not
// judgment), and this scorer will read that directly rather than demanding a
// human-scores file — but every printed number and verdict in that mode is
// prefixed and banner-labeled as synthetic, never presented as a real result.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH_DEFAULT = path.join(__dirname, 'skill-cases.json');

const SCORE_FIELDS = [
  'intent_correct',
  'sequence_valid',
  'setup_completed',
  'writing_completed',
  'unnecessary_question',
  'narrated_mechanics',
  'fact_or_belief_violation',
];

function printHelp() {
  console.log(`Usage: node evals/score.mjs <raw-results.jsonl> [options]

  --scores <path>       Human-authored per-case-per-arm score JSONL (required
                         for a real/non-synthetic raw file; see --init-scores).
  --init-scores <path>  Write a scaffold scores file for the given raw file's
                         recorded case+arm pairs (all 7 fields null) and exit.
  --cases <path>        Case corpus for cohort membership (default:
                         evals/skill-cases.json).
  -h, --help            Show this help.
`);
}

function parseArgs(argv) {
  const args = { raw: null, scores: null, initScores: null, casesPath: CASES_PATH_DEFAULT };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--scores': args.scores = path.resolve(argv[++i]); break;
      case '--init-scores': args.initScores = path.resolve(argv[++i]); break;
      case '--cases': args.casesPath = path.resolve(argv[++i]); break;
      case '-h': case '--help': printHelp(); process.exit(0); break;
      default:
        if (a.startsWith('--')) { console.error(`Unknown argument: ${a}`); process.exit(1); }
        positional.push(a);
    }
  }
  args.raw = positional[0] ? path.resolve(positional[0]) : null;
  return args;
}

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

function key(caseId, arm) { return `${caseId}::${arm}`; }

// ---- init-scores scaffold ---------------------------------------------

function writeInitScores(rawRecords, outPath) {
  const okCases = rawRecords.filter((r) => r.type === 'case' && r.status === 'ok');
  const lines = okCases.map((r) => JSON.stringify({
    caseId: r.caseId,
    arm: r.arm,
    // Reference only, ignored by the scorer — for the human filling this in.
    _expectReference: r.expect,
    intent_correct: null,
    sequence_valid: null,
    setup_completed: r.expect && r.expect.setup === true ? null : 'not_applicable',
    writing_completed: null,
    unnecessary_question: null,
    narrated_mechanics: null,
    fact_or_belief_violation: null,
    notes: '',
  }));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''));
  console.error(`Wrote ${lines.length} scaffold rows to ${outPath}. Fill in the 7 fields by hand against the raw transcript, per evals/README.md's mapping table.`);
}

// ---- score assembly ------------------------------------------------------

function buildScoreMap(rawRecords, scoresPath) {
  const isSynthetic = rawRecords.some((r) => r.synthetic === true);
  const map = new Map();
  const missing = [];

  if (isSynthetic) {
    for (const r of rawRecords) {
      if (r.type !== 'case' || r.status !== 'ok') continue;
      if (!r.syntheticScores) { missing.push(key(r.caseId, r.arm)); continue; }
      map.set(key(r.caseId, r.arm), r.syntheticScores);
    }
    return { map, isSynthetic, missing };
  }

  if (!scoresPath) {
    console.error('This raw file is not synthetic — a human-authored --scores file is required.');
    console.error('Generate a scaffold with: node evals/score.mjs <raw> --init-scores <path>');
    process.exit(1);
  }
  const scoreRecords = readJsonl(scoresPath);
  const scoreByKey = new Map(scoreRecords.map((s) => [key(s.caseId, s.arm), s]));
  for (const r of rawRecords) {
    if (r.type !== 'case' || r.status !== 'ok') continue;
    const k = key(r.caseId, r.arm);
    const s = scoreByKey.get(k);
    if (!s) { missing.push(k); continue; }
    const incomplete = SCORE_FIELDS.some((f) => s[f] === null || s[f] === undefined);
    if (incomplete) { missing.push(`${k} (unfilled fields)`); continue; }
    map.set(k, s);
  }
  return { map, isSynthetic, missing };
}

// ---- cohorts & rates -------------------------------------------------------

function rate(caseIds, arm, scoreMap, field) {
  let n = 0, d = 0;
  for (const id of caseIds) {
    const s = scoreMap.get(key(id, arm));
    if (!s) continue;
    const v = s[field];
    if (v === null || v === undefined || v === 'not_applicable') continue;
    d++;
    if (v === true) n++;
  }
  return { n, d, pct: d === 0 ? null : (100 * n) / d };
}

function anyTrue(caseIds, arm, scoreMap, field) {
  const hits = [];
  for (const id of caseIds) {
    const s = scoreMap.get(key(id, arm));
    if (s && s[field] === true) hits.push(id);
  }
  return hits;
}

function fmtPct(p) { return p === null ? 'n/a' : `${p.toFixed(1)}%`; }

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.raw) { printHelp(); process.exit(1); }
  const rawRecords = readJsonl(args.raw);
  if (args.initScores) { writeInitScores(rawRecords, args.initScores); return; }

  const cases = JSON.parse(fs.readFileSync(args.casesPath, 'utf8'));
  const byId = new Map(cases.map((c) => [c.id, c]));

  const { map: scoreMap, isSynthetic, missing } = buildScoreMap(rawRecords, args.scores);

  const tag = isSynthetic ? 'SYNTHETIC' : 'REAL';
  if (isSynthetic) {
    console.log('='.repeat(72));
    console.log('SYNTHETIC / STUB DATA — fabricated by run.mjs --dry-run for pipeline');
    console.log('verification only. NOT a real eval result. Do not act on these numbers.');
    console.log('='.repeat(72));
  }

  if (missing.length) {
    console.log(`\n[${tag}] Warning: ${missing.length} recorded case+arm pair(s) have no complete score and are excluded:`);
    for (const m of missing) console.log(`  - ${m}`);
  }

  // Cohorts, derived from `expect` (per README's mapping table), not invented.
  const allIds = cases.map((c) => c.id);
  const cohort1 = cases.filter((c) => c.expect.invoke_idiolect === true && c.expect.writing === true).map((c) => c.id);
  const cohort2 = cases.filter((c) => c.profile === 'missing' && c.expect.setup === true).map((c) => c.id);
  const cohort3 = cases.filter((c) => c.profile === 'ready' && c.expect.writing === true).map((c) => c.id);
  const negativeCohort = cases.filter((c) => c.expect.invoke_idiolect === false).map((c) => c.id);

  if (cohort2.length !== 6) {
    console.log(`\n[${tag}] NOTE: expected 6 missing-profile/setup-possible cases (README's stated n), found ${cohort2.length}. The corpus changed — re-check criterion 2's resolution claim.`);
  }

  console.log(`\n[${tag}] Gate to Plugin work (evals/README.md)`);
  console.log('-'.repeat(72));

  // Criterion 1
  const c1Control = rate(cohort1, 'control', scoreMap, 'writing_completed');
  const c1Skill = rate(cohort1, 'skill', scoreMap, 'writing_completed');
  const c1Lift = (c1Skill.pct ?? 0) - (c1Control.pct ?? 0);
  const c1Pass = c1Control.pct !== null && c1Skill.pct !== null && c1Lift >= 20;
  console.log(`1. Original-task completion lift, positive personal-writing cases (n=${cohort1.length})`);
  console.log(`   formula: skill writing_completed% - control writing_completed%, gate >= 20pp`);
  console.log(`   control=${fmtPct(c1Control.pct)} (${c1Control.n}/${c1Control.d})  skill=${fmtPct(c1Skill.pct)} (${c1Skill.n}/${c1Skill.d})  lift=${c1Lift.toFixed(1)}pp  -> ${c1Pass ? 'PASS' : 'FAIL'}`);

  // Criterion 2 (directional, low resolution)
  const c2Control = rate(cohort2, 'control', scoreMap, 'writing_completed');
  const c2Skill = rate(cohort2, 'skill', scoreMap, 'writing_completed');
  const c2Lift = (c2Skill.pct ?? 0) - (c2Control.pct ?? 0);
  const c2Pass = c2Control.pct !== null && c2Skill.pct !== null && c2Lift >= 30;
  console.log(`\n2. [DIRECTIONAL — n=${cohort2.length}, ~${(100 / Math.max(cohort2.length, 1)).toFixed(0)}pp per case; do not read a 1-2 case swing as a confident pass]`);
  console.log(`   Missing-profile setup-to-writing completion lift, gate >= 30pp`);
  console.log(`   control=${fmtPct(c2Control.pct)} (${c2Control.n}/${c2Control.d})  skill=${fmtPct(c2Skill.pct)} (${c2Skill.n}/${c2Skill.d})  lift=${c2Lift.toFixed(1)}pp  -> ${c2Pass ? 'PASS (directional)' : 'FAIL (directional)'}`);

  // Criterion 3
  const c3Control = rate(cohort3, 'control', scoreMap, 'writing_completed');
  const c3Skill = rate(cohort3, 'skill', scoreMap, 'writing_completed');
  const c3Delta = (c3Skill.pct ?? 0) - (c3Control.pct ?? 0);
  const c3Pass = c3Control.pct !== null && c3Skill.pct !== null && c3Skill.pct >= c3Control.pct;
  console.log(`\n3. Ready-profile writing completion non-regression (n=${cohort3.length})`);
  console.log(`   formula: skill writing_completed% >= control writing_completed%`);
  console.log(`   control=${fmtPct(c3Control.pct)} (${c3Control.n}/${c3Control.d})  skill=${fmtPct(c3Skill.pct)} (${c3Skill.n}/${c3Skill.d})  delta=${c3Delta.toFixed(1)}pp  -> ${c3Pass ? 'PASS' : 'FAIL'}`);

  // Criterion 4
  const c4Skill = rate(negativeCohort, 'skill', scoreMap, 'intent_correct');
  const c4Control = rate(negativeCohort, 'control', scoreMap, 'intent_correct');
  const c4Pass = c4Skill.pct !== null && c4Skill.pct >= 90;
  console.log(`\n4. Intent precision on the negative cohort (n=${negativeCohort.length}: code-only, explicit-other-voice, generic-writing-not-personal, third-party-persona, impersonal-system-notice)`);
  console.log(`   formula: skill-arm intent_correct% over cases where expect.invoke_idiolect === false, gate >= 90%`);
  console.log(`   skill=${fmtPct(c4Skill.pct)} (${c4Skill.n}/${c4Skill.d})  [control for context: ${fmtPct(c4Control.pct)}]  -> ${c4Pass ? 'PASS' : 'FAIL'}`);

  // Criterion 5
  const c5SkillViolations = anyTrue(allIds, 'skill', scoreMap, 'fact_or_belief_violation');
  const c5ControlViolations = anyTrue(allIds, 'control', scoreMap, 'fact_or_belief_violation');
  const c5Pass = c5SkillViolations.length === 0;
  console.log(`\n5. Fact/belief violations, skill arm — one is a hard fail`);
  console.log(`   skill violations: ${c5SkillViolations.length ? c5SkillViolations.join(', ') : 'none'}  [control for context: ${c5ControlViolations.length ? c5ControlViolations.join(', ') : 'none'}]  -> ${c5Pass ? 'PASS' : 'FAIL'}`);

  // Criterion 6 (directional, low resolution)
  const c6UqControl = rate(allIds, 'control', scoreMap, 'unnecessary_question');
  const c6UqSkill = rate(allIds, 'skill', scoreMap, 'unnecessary_question');
  const c6NarrControl = rate(allIds, 'control', scoreMap, 'narrated_mechanics');
  const c6NarrSkill = rate(allIds, 'skill', scoreMap, 'narrated_mechanics');
  const c6Pass = (c6UqSkill.pct ?? 0) <= (c6UqControl.pct ?? 0) && (c6NarrSkill.pct ?? 0) <= (c6NarrControl.pct ?? 0);
  console.log(`\n6. [DIRECTIONAL — ask_user ground truth exists on only 7/26 cases; narration ground truth (no_tool_narration/no_score_narration) on only 7/26; treat as a signal, not a verdict]`);
  console.log(`   Unnecessary questions: control=${fmtPct(c6UqControl.pct)} skill=${fmtPct(c6UqSkill.pct)}`);
  console.log(`   Narrated mechanics:    control=${fmtPct(c6NarrControl.pct)} skill=${fmtPct(c6NarrSkill.pct)}`);
  console.log(`   -> ${c6Pass ? 'does not increase (directional)' : 'INCREASED (directional)'}`);

  // Fields explicitly outside the 7 (README: "not covered by any of the 7
  // fields — judge by hand and record separately; do not force these in").
  console.log(`\n[${tag}] Not gated, hand-judge separately per README: only_for_prose, minimal_edit, smallest_blocker, preserve_original_task, no_internal_jargon.`);
  console.log('This scorer does not compute them — they are not in the 7-field vocabulary.');

  const overall = c1Pass && c2Pass && c3Pass && c4Pass && c5Pass;
  console.log('\n' + '='.repeat(72));
  console.log(`[${tag}] OVERALL: ${overall ? 'PASS' : 'FAIL'} (criteria 1,3,4,5 hard; criterion 2 directional; criterion 6 reported, not gating per README)`);
  if (isSynthetic) console.log('This verdict is SYNTHETIC — it verifies the scorer\'s logic runs end to end, nothing about the real Skill.');
  console.log('='.repeat(72));
}

main();
