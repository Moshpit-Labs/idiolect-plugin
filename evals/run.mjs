#!/usr/bin/env node
// evals/run.mjs
//
// Offline runner for the Idiolect Skill A/B gate defined in evals/README.md
// and evals/RUN.md. For every case in skill-cases.json it runs two arms in a
// fresh conversation each:
//
//   control — the remote Idiolect MCP connector only, candidate Skill OFF
//   skill   — the same connector, plus ONLY skills/idiolect-writing loaded
//             via an isolated, session-local --plugin-dir (skills/in-your-voice
//             is deliberately excluded so the comparison isn't confounded)
//
// It writes one JSON record per case+arm to a timestamped JSONL file under
// evals/results/, and is resumable: re-running against the same --out file
// skips any case+arm pair that already has a successful record.
//
// --dry-run exercises the entire pipeline (case iteration, key selection,
// isolated plugin-dir construction, resolved MCP config, resumability,
// follow-up-turn logic) against a deterministic in-process stub instead of
// spawning the real `claude` CLI or touching the Idiolect connector. Every
// record it writes is tagged `synthetic: true` and carries a `syntheticScores`
// block so evals/score.mjs can produce a full report from it without a human
// annotation pass — see the header of score.mjs for why that's the only case
// where the scorer trusts embedded scores instead of a human-authored file.
//
// This file intentionally does not depend on anything outside Node's
// standard library.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(__dirname, 'results');
const CASES_PATH_DEFAULT = path.join(__dirname, 'skill-cases.json');
const CONTEXT_DIR = path.join(__dirname, 'manual-inputs', 'context');
const FOLLOWUP_DIR = path.join(__dirname, 'manual-inputs', 'followups');

const ARMS = ['control', 'skill'];

function printHelp() {
  console.log(`Usage: node evals/run.mjs [options]

  --dry-run                 Run the full pipeline against an in-process stub.
                             No 'claude' subprocess, no network, no Idiolect
                             connector traffic. Records are tagged synthetic.
  --model <name>             Model id/alias, same for both arms. Required
                             unless --dry-run.
  --cases <path>             Case corpus (default: evals/skill-cases.json).
  --out <path>                Result JSONL file. Omit to auto-resume the most
                             recent incomplete run in evals/results/, or start
                             a new timestamped file if none is incomplete.
  --only <id,id,...>          Restrict to specific case ids.
  --claude-bin <bin>          Claude CLI binary (default: claude).
  --permission-mode <mode>    Passed through to claude (default: bypassPermissions).
  --key-ready-env <VAR>       Env var holding the ready-profile API key
                             (default: IDIOLECT_KEY_READY).
  --key-missing-env <VAR>     Env var holding the missing-profile API key
                             (default: IDIOLECT_KEY_MISSING).
  -h, --help                  Show this help.

Real runs require two Idiolect test-account keys (see evals/RUN.md) and are
covered by the production change freeze — do not point this at the live
connector until that freeze lifts. Use --dry-run to verify the harness itself.
`);
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    model: null,
    casesPath: CASES_PATH_DEFAULT,
    out: null,
    only: null,
    claudeBin: 'claude',
    permissionMode: 'bypassPermissions',
    keyReadyEnv: 'IDIOLECT_KEY_READY',
    keyMissingEnv: 'IDIOLECT_KEY_MISSING',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dry-run': args.dryRun = true; break;
      case '--model': args.model = argv[++i]; break;
      case '--cases': args.casesPath = path.resolve(argv[++i]); break;
      case '--out': args.out = path.resolve(argv[++i]); break;
      case '--only': args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--claude-bin': args.claudeBin = argv[++i]; break;
      case '--permission-mode': args.permissionMode = argv[++i]; break;
      case '--key-ready-env': args.keyReadyEnv = argv[++i]; break;
      case '--key-missing-env': args.keyMissingEnv = argv[++i]; break;
      case '-h': case '--help': printHelp(); process.exit(0); break;
      default:
        console.error(`Unknown argument: ${a}\n`);
        printHelp();
        process.exit(1);
    }
  }
  return args;
}

function loadCases(casesPath, only) {
  const raw = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  if (!only) return raw;
  const set = new Set(only);
  const filtered = raw.filter((c) => set.has(c.id));
  const missing = only.filter((id) => !raw.some((c) => c.id === id));
  if (missing.length) {
    console.error(`--only referenced unknown case id(s): ${missing.join(', ')}`);
    process.exit(1);
  }
  return filtered;
}

function recordKey(caseId, arm) {
  return `${caseId}::${arm}`;
}

// ---- resumable output file ---------------------------------------------

function readExistingRecords(outPath) {
  if (!fs.existsSync(outPath)) return [];
  const lines = fs.readFileSync(outPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const records = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'case') records.push(obj);
    } catch {
      // ignore malformed lines rather than aborting a resume
    }
  }
  return records;
}

function resolveOutFile(args, totalExpected) {
  if (args.out) {
    return { outPath: args.out, isNew: !fs.existsSync(args.out) };
  }
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const existing = fs.readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .reverse();
  for (const f of existing) {
    const p = path.join(RESULTS_DIR, f);
    const recs = readExistingRecords(p);
    const done = new Set(recs.filter((r) => r.status === 'ok').map((r) => recordKey(r.caseId, r.arm)));
    if (done.size < totalExpected) {
      return { outPath: p, isNew: false };
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = args.dryRun ? 'skill-eval-dryrun' : 'skill-eval';
  return { outPath: path.join(RESULTS_DIR, `${prefix}-${stamp}.jsonl`), isNew: true };
}

function appendRecord(outPath, record) {
  fs.appendFileSync(outPath, JSON.stringify(record) + '\n');
}

// ---- MCP config + isolated plugin dir -----------------------------------

function resolvedMcpConfigPath(workDir) {
  // .mcp.json in this repo uses ${CLAUDE_PLUGIN_ROOT}, which the CLI only
  // substitutes for a plugin-supplied config loaded via --plugin-dir. The
  // control arm never passes --plugin-dir, so that placeholder would be
  // passed through literally and the connector would fail to spawn — a
  // silent "no connector in either arm" outcome that would read as a real
  // null result. Resolve it to an absolute path once, and use the SAME
  // resolved file (via --mcp-config) for both arms so the connector process
  // is identical in both.
  const raw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.mcp.json'), 'utf8'));
  const serverAbsPath = path.join(REPO_ROOT, 'server.mjs');
  for (const server of Object.values(raw.mcpServers || {})) {
    if (Array.isArray(server.args)) {
      server.args = server.args.map((a) => a.replaceAll('${CLAUDE_PLUGIN_ROOT}', REPO_ROOT).replace(/^.*server\.mjs$/, serverAbsPath));
    }
  }
  const dest = path.join(workDir, 'mcp.resolved.json');
  fs.writeFileSync(dest, JSON.stringify(raw, null, 2));
  return dest;
}

function brokenMcpConfigPath(workDir) {
  // For 'failed-connector': a deliberately unreachable command, per RUN.md.
  // This tests the Skill's response to a generic MCP failure, not the real
  // connector's actual failure mode (RUN.md is explicit about that limit).
  const dest = path.join(workDir, 'mcp.broken.json');
  fs.writeFileSync(dest, JSON.stringify({
    mcpServers: {
      idiolect: { command: 'node', args: ['/nonexistent/idiolect-eval-unreachable-server.mjs'] },
    },
  }, null, 2));
  return dest;
}

function buildIsoPluginDir(workDir) {
  // Session-local, temporary copy containing ONLY the candidate skill — see
  // evals/RUN.md, "The plugin bundles two skills". Never installed or
  // published; lives under the OS temp dir for this run only.
  const iso = fs.mkdtempSync(path.join(os.tmpdir(), 'idiolect-skill-eval-iso-'));
  fs.mkdirSync(path.join(iso, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(iso, 'skills'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, '.claude-plugin', 'plugin.json'), path.join(iso, '.claude-plugin', 'plugin.json'));
  fs.copyFileSync(path.join(REPO_ROOT, '.mcp.json'), path.join(iso, '.mcp.json'));
  fs.copyFileSync(path.join(REPO_ROOT, 'server.mjs'), path.join(iso, 'server.mjs'));
  fs.cpSync(path.join(REPO_ROOT, 'skills', 'idiolect-writing'), path.join(iso, 'skills', 'idiolect-writing'), { recursive: true });
  // Isolation assertion: in-your-voice must be absent, or the skill-arm
  // comparison is meaningless (RUN.md's whole point in building $ISO).
  if (fs.existsSync(path.join(iso, 'skills', 'in-your-voice'))) {
    throw new Error('isolation failure: in-your-voice leaked into the isolated plugin dir');
  }
  return iso;
}

// ---- key selection -------------------------------------------------------

function keyForCase(caseObj, args) {
  if (caseObj.profile === 'ready') {
    return { key: process.env[args.keyReadyEnv] || null, source: args.keyReadyEnv };
  }
  if (caseObj.profile === 'missing') {
    return { key: process.env[args.keyMissingEnv] || null, source: args.keyMissingEnv };
  }
  // profile: "unknown" — currently only failed-connector, whose connector
  // never comes up, so which key is used doesn't matter functionally. Prefer
  // the ready key so a mis-wired mcp config still fails for connector
  // reasons, not auth reasons.
  return { key: process.env[args.keyReadyEnv] || null, source: `${args.keyReadyEnv} (unknown profile, arbitrary)` };
}

// ---- manual stage-direction inputs ---------------------------------------
//
// evals/README.md is explicit that `context_evidence` (and by the same
// leakage logic, `user_followup`) are stage directions for the human running
// the eval, never text to paste into the conversation. A script cannot
// invent literal prior-turn text or a literal user reply from a one-sentence
// description without doing exactly the leaking the README forbids. So this
// harness looks for a human-authored file per case; if none exists, it runs
// the case at face value and records that the stage direction was not
// synthesized, rather than guessing.

function loadManualContext(caseId) {
  const p = path.join(CONTEXT_DIR, `${caseId}.json`);
  if (!fs.existsSync(p)) return null;
  const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(parsed.priorTurns) || parsed.priorTurns.length === 0) return null;
  return parsed.priorTurns;
}

function loadManualFollowup(caseId) {
  const p = path.join(FOLLOWUP_DIR, `${caseId}.txt`);
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, 'utf8').trim();
  return text.length ? text : null;
}

// ---- transcript inspection (real runs) -----------------------------------

function lastAssistantText(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      return e.message.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    }
    if (e.type === 'result' && typeof e.result === 'string') {
      return e.result;
    }
  }
  return '';
}

function extractToolCalls(events) {
  const calls = [];
  for (const e of events) {
    if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const block of e.message.content) {
        if (block.type === 'tool_use') calls.push({ name: block.name, input: block.input });
      }
    }
  }
  return calls;
}

function heuristicAskedForFollowup(events) {
  // Best-effort only — flagged in the record as heuristicOnly so a human
  // scorer can override it against the raw transcript. Never treated as
  // ground truth by score.mjs.
  const text = lastAssistantText(events).trim();
  if (!text) return false;
  const lastLine = text.split('\n').filter(Boolean).pop() || text;
  return /\?\s*$/.test(lastLine) && /(sample|writing|consent|permission|share|provide|paste|send over|example)/i.test(text);
}

// ---- real arm execution ---------------------------------------------------

function buildClaudeArgs({ promptText, sessionId, resume, mcpConfigPath, model, permissionMode, isoDir, persist }) {
  const args = [
    '-p', promptText,
    '--mcp-config', mcpConfigPath,
    '--strict-mcp-config',
    '--setting-sources', '',
    '--model', model,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', permissionMode,
  ];
  if (resume) args.push('--resume', sessionId);
  else args.push('--session-id', sessionId);
  if (isoDir) args.push('--plugin-dir', isoDir);
  if (!persist) args.push('--no-session-persistence');
  return args;
}

function invokeClaude(args, { claudeBin, env, cwd }) {
  const res = spawnSync(claudeBin, args, { env, cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  const events = [];
  for (const line of (res.stdout || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t)); } catch { events.push({ type: 'unparsed_line', raw: t }); }
  }
  return {
    events,
    stderr: res.stderr || '',
    exitStatus: res.status,
    spawnError: res.error ? String(res.error) : null,
  };
}

function runArmReal({ caseObj, arm, args, neutralCwd }) {
  const { key: apiKey, source: keySource } = keyForCase(caseObj, args);
  const isFailedConnector = caseObj.id === 'failed-connector';
  const mcpConfigPath = isFailedConnector ? brokenMcpConfigPath(neutralCwd) : resolvedMcpConfigPath(neutralCwd);
  const isoDir = arm === 'skill' ? buildIsoPluginDir(neutralCwd) : null;
  const priorTurns = loadManualContext(caseObj.id) || [];
  const followupText = caseObj.user_followup ? loadManualFollowup(caseObj.id) : null;
  const sessionId = crypto.randomUUID();
  const env = { ...process.env, IDIOLECT_API_KEY: apiKey || '' };
  const turns = [];

  const willFollowUp = Boolean(caseObj.user_followup);
  const persistFirstTurn = willFollowUp; // need the session on disk to --resume into

  let allEvents = [];
  let sessionEstablished = false;

  // Turn 0..n-1: manually authored prior context turns (only present if a
  // human supplied evals/manual-inputs/context/<id>.json — see above).
  for (const [i, text] of priorTurns.entries()) {
    const callArgs = buildClaudeArgs({
      promptText: text,
      sessionId,
      resume: sessionEstablished,
      mcpConfigPath,
      model: args.model,
      permissionMode: args.permissionMode,
      isoDir,
      persist: true,
    });
    const out = invokeClaude(callArgs, { claudeBin: args.claudeBin, env, cwd: neutralCwd });
    sessionEstablished = true;
    allEvents = allEvents.concat(out.events);
    turns.push({ role: 'context-setup', index: i, text, args: callArgs, exitStatus: out.exitStatus, spawnError: out.spawnError, stderr: out.stderr });
  }

  // The case's actual prompt.
  const promptArgs = buildClaudeArgs({
    promptText: caseObj.prompt,
    sessionId,
    resume: sessionEstablished,
    mcpConfigPath,
    model: args.model,
    permissionMode: args.permissionMode,
    isoDir,
    persist: persistFirstTurn,
  });
  const promptOut = invokeClaude(promptArgs, { claudeBin: args.claudeBin, env, cwd: neutralCwd });
  sessionEstablished = true;
  allEvents = allEvents.concat(promptOut.events);
  turns.push({ role: 'prompt', text: caseObj.prompt, args: promptArgs, exitStatus: promptOut.exitStatus, spawnError: promptOut.spawnError, stderr: promptOut.stderr });

  let followup = null;
  if (willFollowUp) {
    const asked = heuristicAskedForFollowup(promptOut.events);
    if (asked && followupText) {
      const followArgs = buildClaudeArgs({
        promptText: followupText,
        sessionId,
        resume: true,
        mcpConfigPath,
        model: args.model,
        permissionMode: args.permissionMode,
        isoDir,
        persist: false,
      });
      const followOut = invokeClaude(followArgs, { claudeBin: args.claudeBin, env, cwd: neutralCwd });
      allEvents = allEvents.concat(followOut.events);
      turns.push({ role: 'user-followup', text: followupText, args: followArgs, exitStatus: followOut.exitStatus, spawnError: followOut.spawnError, stderr: followOut.stderr });
      followup = { sent: true, heuristicAskedDetected: true };
    } else if (asked && !followupText) {
      followup = { sent: false, heuristicAskedDetected: true, reason: `Claude appears to have asked, but no literal reply is authored at evals/manual-inputs/followups/${caseObj.id}.txt — the corpus's user_followup field is a stage direction, not verbatim text (see RUN.md note). setup_completed/writing_completed should be scored not-applicable for this run.` };
    } else {
      followup = { sent: false, heuristicAskedDetected: false, reason: 'Transcript does not look like Claude stopped to ask; per README, not sending an unprompted follow-up.' };
    }
  }

  return {
    apiKeySource: keySource,
    apiKeyPresent: Boolean(apiKey),
    mcpConfigPath,
    isoDir,
    sessionId,
    contextTurnsInjected: priorTurns.length,
    contextEvidenceStageDirection: caseObj.context_evidence || caseObj.context || null,
    contextEvidenceSynthesized: priorTurns.length > 0,
    followup,
    turns,
    events: allEvents,
    finalText: lastAssistantText(allEvents),
    toolCalls: extractToolCalls(allEvents),
  };
}

// ---- stub arm execution (--dry-run) ---------------------------------------

function seededUnit(key) {
  const h = crypto.createHash('sha256').update(key).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}
function seededBool(key, p) {
  return seededUnit(key) < p;
}

function needsSetup(expect) {
  return expect.setup === true;
}

function synthesizeScores(caseObj, arm) {
  const exp = caseObj.expect || {};
  const id = caseObj.id;
  const negative = exp.invoke_idiolect === false;

  const pIntent = arm === 'skill' ? (negative ? 0.92 : 0.93) : (negative ? 0.85 : 0.55);
  const intent_correct = seededBool(`${id}:${arm}:intent`, pIntent);
  const invoked = intent_correct ? exp.invoke_idiolect === true : exp.invoke_idiolect !== true;

  let writing_completed = false;
  if (exp.writing === true) {
    const pWrite = arm === 'skill'
      ? (needsSetup(exp) ? 0.90 : 0.95)
      : (needsSetup(exp) ? 0.15 : 0.55);
    writing_completed = seededBool(`${id}:${arm}:writing`, pWrite);
  }

  let setup_completed = null;
  if (needsSetup(exp)) {
    const pSetup = arm === 'skill' ? 0.90 : 0.20;
    setup_completed = seededBool(`${id}:${arm}:setup`, pSetup);
  }

  const pSeq = arm === 'skill' ? 0.93 : (needsSetup(exp) ? 0.45 : 0.7);
  const sequence_valid = seededBool(`${id}:${arm}:sequence`, pSeq);

  const unnecessary_question = seededBool(`${id}:${arm}:uq`, arm === 'skill' ? 0.05 : 0.12);
  const narrated_mechanics = seededBool(`${id}:${arm}:narr`, arm === 'skill' ? 0.05 : 0.20);

  // Deliberately inject exactly one hard-fail case in stub data so the
  // dry-run proves the scorer's zero-tolerance gate actually trips, not just
  // that it prints zero when everything is already zero. This is fabricated
  // for pipeline verification only — see the `synthetic` flag on the record.
  let fact_or_belief_violation = seededBool(`${id}:${arm}:fact`, arm === 'skill' ? 0.0 : 0.03);
  if (id === 'facts-names' && arm === 'skill') fact_or_belief_violation = true;

  return {
    intent_correct,
    sequence_valid,
    setup_completed,
    writing_completed,
    unnecessary_question,
    narrated_mechanics,
    fact_or_belief_violation,
    _invokedSynthetic: invoked,
  };
}

function runArmStub({ caseObj, arm }) {
  const scores = synthesizeScores(caseObj, arm);
  const isoDir = arm === 'skill' ? '<stub-iso-plugin-dir, not created on disk>' : null;
  const events = [
    {
      type: 'system', subtype: 'init', synthetic: true,
      mcp_servers: [{ name: 'idiolect', status: 'connected' }],
      plugins: arm === 'skill' ? [{ name: 'idiolect', path: '<iso>' }] : [],
      skills: arm === 'skill' ? ['idiolect-writing'] : [],
    },
    scores._invokedSynthetic
      ? { type: 'assistant', synthetic: true, message: { content: [{ type: 'tool_use', name: 'mcp__idiolect__get_my_voice', input: {} }] } }
      : { type: 'assistant', synthetic: true, message: { content: [{ type: 'text', text: '[stub: no idiolect invocation simulated]' }] } },
    {
      type: 'result', subtype: 'success', synthetic: true,
      result: scores.writing_completed ? `[stub] completed writing for "${caseObj.id}"` : `[stub] did not complete writing for "${caseObj.id}"`,
    },
  ];
  return {
    apiKeySource: caseObj.profile === 'ready' ? 'IDIOLECT_KEY_READY (stub)' : caseObj.profile === 'missing' ? 'IDIOLECT_KEY_MISSING (stub)' : 'stub-unused',
    apiKeyPresent: true,
    mcpConfigPath: '<stub, no real config written>',
    isoDir,
    sessionId: crypto.randomUUID(),
    contextTurnsInjected: 0,
    contextEvidenceStageDirection: caseObj.context_evidence || caseObj.context || null,
    contextEvidenceSynthesized: false,
    followup: caseObj.user_followup ? { sent: false, heuristicAskedDetected: false, reason: 'stub run: follow-up turns are not simulated' } : null,
    turns: [{ role: 'prompt', text: caseObj.prompt, synthetic: true }],
    events,
    finalText: events[events.length - 1].result,
    toolCalls: scores._invokedSynthetic ? [{ name: 'mcp__idiolect__get_my_voice', input: {} }] : [],
    syntheticScores: (() => { const s = { ...scores }; delete s._invokedSynthetic; return s; })(),
  };
}

// ---- main ------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dryRun && !args.model) {
    console.error('Error: --model is required for a real run (omit only with --dry-run).');
    process.exit(1);
  }
  if (!args.dryRun) {
    const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [args.claudeBin], { encoding: 'utf8' });
    if (which.status !== 0) {
      console.error(`Error: '${args.claudeBin}' not found on PATH. Pass --claude-bin or install the Claude CLI.`);
      process.exit(1);
    }
    console.error('WARNING: this is a REAL run. It will spawn the claude CLI against the live');
    console.error('Idiolect connector for every case. Do not run this during the production');
    console.error('change freeze. Re-run with --dry-run if you only want to verify the harness.');
  }

  const cases = loadCases(args.casesPath, args.only);
  const totalExpected = cases.length * ARMS.length;
  const { outPath, isNew } = resolveOutFile(args, totalExpected);
  if (isNew) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    appendRecord(outPath, {
      type: 'meta',
      createdAt: new Date().toISOString(),
      dryRun: args.dryRun,
      model: args.model,
      casesPath: args.casesPath,
      caseCount: cases.length,
    });
  }
  const existing = readExistingRecords(outPath);
  const done = new Set(existing.filter((r) => r.status === 'ok').map((r) => recordKey(r.caseId, r.arm)));

  console.error(`Result file: ${outPath}`);
  console.error(`Cases: ${cases.length} (x${ARMS.length} arms = ${totalExpected} runs), ${done.size} already recorded.`);

  const neutralCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'idiolect-skill-eval-cwd-'));

  if (args.dryRun) {
    // The $ISO isolation step and the resolved-MCP-config step are pure
    // filesystem work — no subprocess, no network, no connector traffic —
    // so they're fully verifiable under the freeze even though the CLI call
    // itself is stubbed. Exercise them for real here rather than only in
    // the stub path, and fail loudly if the isolation guarantee breaks.
    const checkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idiolect-skill-eval-selfcheck-'));
    const iso = buildIsoPluginDir(checkDir);
    const hasCandidate = fs.existsSync(path.join(iso, 'skills', 'idiolect-writing', 'SKILL.md'));
    const hasOther = fs.existsSync(path.join(iso, 'skills', 'in-your-voice'));
    const mcpResolved = resolvedMcpConfigPath(checkDir);
    const resolvedJson = JSON.parse(fs.readFileSync(mcpResolved, 'utf8'));
    const stillHasPlaceholder = JSON.stringify(resolvedJson).includes('${CLAUDE_PLUGIN_ROOT}');
    console.error(`Self-check: isolated plugin dir at ${iso}`);
    console.error(`  candidate skill present: ${hasCandidate}`);
    console.error(`  in-your-voice absent:    ${!hasOther}`);
    console.error(`  resolved mcp config has no unresolved \${CLAUDE_PLUGIN_ROOT}: ${!stillHasPlaceholder}`);
    if (!hasCandidate || hasOther || stillHasPlaceholder) {
      console.error('Self-check FAILED — aborting before any case runs.');
      process.exit(1);
    }
    fs.rmSync(checkDir, { recursive: true, force: true });
  }

  let ran = 0, skipped = 0, errored = 0;
  for (const caseObj of cases) {
    for (const arm of ARMS) {
      const key = recordKey(caseObj.id, arm);
      if (done.has(key)) { skipped++; continue; }
      const startedAt = new Date().toISOString();
      let record;
      try {
        const result = args.dryRun
          ? runArmStub({ caseObj, arm })
          : runArmReal({ caseObj, args, arm, neutralCwd });
        record = {
          type: 'case',
          status: 'ok',
          caseId: caseObj.id,
          arm,
          profile: caseObj.profile,
          expect: caseObj.expect,
          prompt: caseObj.prompt,
          model: args.model,
          synthetic: args.dryRun,
          startedAt,
          finishedAt: new Date().toISOString(),
          ...result,
        };
        ran++;
      } catch (err) {
        record = {
          type: 'case',
          status: 'error',
          caseId: caseObj.id,
          arm,
          profile: caseObj.profile,
          expect: caseObj.expect,
          model: args.model,
          synthetic: args.dryRun,
          startedAt,
          finishedAt: new Date().toISOString(),
          error: String(err && err.stack || err),
        };
        errored++;
      }
      appendRecord(outPath, record);
      console.error(`${record.status === 'ok' ? 'ok   ' : 'ERROR'} ${key}`);
    }
  }

  console.error(`\nDone. ran=${ran} skipped=${skipped} errored=${errored} -> ${outPath}`);
  if (errored > 0) process.exitCode = 1;
}

main();
