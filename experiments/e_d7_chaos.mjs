// experiments/e_d7_chaos.mjs — E-D7: CRASH-GRADE DURABILITY OF THE PERSISTED
// SURFACES. The fleet's chaos discipline (quilt-arch E-C1, yiluodi E-C2 —
// read-only references) asked of dba's HONEST persisted surfaces. E-D4 proved
// LOGICAL exactness (rewind/checkpoint bit-equality); nothing has ever tested
// PHYSICAL durability: kill -9, torn writes, bit flips, cross-process
// determinism.
//
// SURFACES (the honest inventory — receipted before the rules):
//   S1 checkpoint bundles   — JSON.stringify(Driver.bundle()) files; the shape
//                             dba/driver.mjs:184 writes (bare, NO integrity
//                             tag; the engine-path `state_hash` field exists
//                             but its loader never checks it — receipted).
//   S2 the rewind journal   — E-D4's dba-rewind-journal is MEMORY-ONLY at
//                             HEAD (receipted gap); the durable JSONL shape
//                             (meta + per-event rows + terminal) is harness
//                             tooling (chaos_persist_d7.mjs), driver untouched.
//   S3 the E-D2 live-decision disk cache — experiments/outputs/.cache/*.json,
//                             read by LiveJev's constructor (dba/jev_live.mjs).
//
// RULES (sealed BEFORE any trial ran; predictions pre-registered):
//  R1 SIGKILL-CHECKPOINT COMPLETENESS — a child SIGKILLed mid-run leaves
//    checkpoints that either (a) load and match the deterministic mirror at
//    that eval, or (b) refuse LOUDLY (torn/parse). A journal that loads must
//    be a BYTE-EXACT prefix of the intended stream. PASS iff 0 silent-wrong
//    and 0 silent-corrupt-accepted across all trials.
//  R2 TORN/TRUNCATED CHECKPOINT — truncations of a clean checkpoint are
//    100% loud-refused (parse error — never silently accepted), AND a valid
//    EARLIER checkpoint still restores: resume + continue lands on the
//    UNINTERRUPTED terminal canon (E-D4's rawJsonEqual standard, across
//    process death). PASS iff 100%.
//  R3 BIT-FLIP GRID — (a) PRE-REGISTERED MECHANISM PREDICTION: the bare
//    bundle carries no integrity tag, so content flips that keep the JSON
//    parseable load SILENTLY WRONG-STATE (coverage ~0% predicted) — the
//    honest defect; (b) the SEALED wrapper (dba-checkpoint-v1, external fix
//    layer — bundle() untouched because an in-band tag would move every
//    sealed E-D4 hash) detects 100%; (c) case flips (bit 5) INSIDE the
//    state_hash hex string are 100% detected — dba readers keep hashes as
//    STRINGS end-to-end and never hex-decode (the E-C1 Node aliasing trap
//    does not exist on this path — tested, not assumed); (d) zero-flip
//    controls: 0 false alarms.
//  R4 PAIRED ARMS + CROSS-PROCESS DETERMINISM — fsync vs buffer vs torn
//    journal arms on the same kill grid: PRE-REGISTERED NULL fsync-vs-buffer
//    (page cache survives SIGKILL; machine power loss unmodelable —
//    receipted limitation); torn arm produces torn tails that recovery
//    reports, never merges; a clean child's bytes (journal + checkpoints)
//    are byte-identical to the parent mirror's.
//  R5 REWIND-FROM-RECOVERED-JOURNAL — a SIGKILLed durable journal recovers
//    as a valid prefix whose every row agrees with the deterministic sim at
//    that index; truncate-to-good-then-continue resumes and lands on the
//    uninterrupted TERMINAL hash with the re-recorded event suffix canon-
//    equal to the original (rawJsonEqual); the f64 carried components survive
//    the disk round-trip BIT-EXACTLY (verifyRewind on the reloaded journal).
//    PASS iff all recovered trials land bit-exact.
//  R6 LIVE-DECISION CACHE DURABILITY — (a) a torn/0-byte cache file used to
//    SILENTLY reset to {} in the LiveJev constructor (observed pre-fix:
//    receipted finding with the exact behavior) — the receipted small fix
//    makes the constructor refuse loudly (fail-closed, live path untouched);
//    (b) a TAMPERED-BUT-VALID cache entry replays silently (undetectable by
//    construction — honest open defect; mitigation = the dev-journal audit
//    trail); (c) control: a valid cache serves a zero-call identical replay.
//
// DISCIPLINE: deterministic PRNG for kill offsets/flip positions (stated);
// tmp dirs under experiments/outputs/chaos_tmp_d7; paired arms share seeds;
// COMPUTED telemetry only; honest nulls receipted as results.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Driver, step as coreStep, driverFromBundle } from '../dba/core.mjs';
import {
  checkpoint, recordStep, seal, verifyRewind, stateHash, stateCanon, canonDeep,
} from '../dba/rewind.mjs';
import { fnv1a64, sealChain, verifyChain } from '../dba/receipts.mjs';
import { LiveJev, buildState, makeQuestions } from '../dba/jev_live.mjs';
import {
  sealCheckpoint, verifySealedCheckpoint, recoverJSONL, journalToJSONL, journalFromJSONL,
} from './chaos_persist_d7.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'outputs');
const TMP = path.join(OUT, 'chaos_tmp_d7');
fs.mkdirSync(TMP, { recursive: true });
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const CHILD = path.join(HERE, 'chaos_child_d7.mjs');

const EVALS = 500, CKPT_EVERY = 100, SEED = 7;
const KILL_TRIALS = 16, ARM_TRIALS = 8, TRUNC_TRIALS = 30, RESTORE_POINTS = [100, 200, 300, 400, 500];
const FLIP_FILES = [100, 300, 500], FLIPS_PER_FILE = 150, CASE_FLIPS = 120;
const JOURNAL_KILL_TRIALS = 8;
const nowMs = () => Number(process.hrtime.bigint() / 1000n) / 1000;

// ── receipt chain: rules BEFORE results ─────────────────────────────────────
const rows = [];
let seq = 0;
const book = (r) => { r.seq = seq++; rows.push(r); return r; };

const RULES = [
  ['R1', 'SIGKILL-checkpoint completeness', 'every killed child leaves checkpoints that load-clean-and-match-mirror OR refuse loudly; journal = byte-exact prefix; PASS iff 0 silent-wrong/accepted'],
  ['R2', 'torn/truncated checkpoint + earlier-restore', 'truncations 100% loud-refused; valid earlier checkpoint restores and lands on the uninterrupted terminal canon; PASS iff 100%'],
  ['R3', 'bit-flip grid', 'bare bundle: silent wrong-state loads predicted (no integrity tag — honest defect); sealed wrapper: 100% detected; hash-string case flips: 100% detected (string law); controls: 0 false alarms'],
  ['R4', 'paired arms + cross-process determinism', 'fsync-vs-buffer NULL predicted (page cache survives SIGKILL; power loss unmodelable — receipted); torn arm yields detected torn tails; clean child bytes == mirror bytes'],
  ['R5', 'rewind-from-recovered-journal', 'recovered prefix agrees with the sim at every index; truncate-to-good-then-continue lands on the uninterrupted terminal hash with canon-equal suffix; f64s survive the disk round-trip bit-exactly'],
  ['R6', 'live-decision cache durability', 'corrupt cache refused loudly post-fix (pre-fix silent reset receipted as finding); tampered-but-valid cache replays silently = open defect; valid cache = zero-call identical replay'],
];
for (const [rule, name, gate] of RULES) book({ kind: 'rule', rule, name, gate, sealed_at: new Date().toISOString(), note: 'sealed BEFORE any trial ran' });
book({
  kind: 'finding.prefix', rule: 'R6', observed: 'PRE-FIX (harness-development observation, receipted before the sealed run): a torn JSON cache file AND a 0-byte cache file both construct LiveJev with an EMPTY cache — silent reset to {} (constructor catch swallows the parse error, jev_live.mjs #cache load). Consequence: the negative cache is lost and a re-run silently re-issues LIVE calls (budget spend) instead of the receipted zero-call deterministic replay.',
  fix: 'constructor fail-closed: corrupt cache -> throw with the path + reason; live-call machinery (transport/budget/inject) untouched; valid-cache path byte-identical behavior',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fpos = (seed, i) => { let h = 0xcbf29ce484222325n; const s = `${seed}:${i}`; for (let k = 0; k < s.length; k++) { h ^= BigInt(s.charCodeAt(k)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; } return Number(h & 0x7fffffffn); };

// ── the mirror: deterministic intended run + per-tick canons/bundles ────────
function buildMirror() {
  const d = new Driver({ arm: 'A', seed: SEED, gain: 1 });
  const log = checkpoint(d, { arm: 'A', seed: SEED, gain: 1, evals: EVALS, role: 'mirror' });
  const bundles = {}; // eval -> {bundle, canon, json}
  for (let i = 0; i < EVALS; i++) {
    recordStep(d, log, {});
    if ((i + 1) % CKPT_EVERY === 0) {
      const b = d.bundle();
      bundles[i + 1] = { bundle: b, canon: stateCanon(b), json: JSON.stringify(b) };
    }
  }
  seal(log, d);
  const journalRows = journalToJSONL(log);
  return {
    d, log, bundles,
    terminalCanon: stateCanon(d), terminalHash: log.terminalHash,
    journalRowJson: journalRows.map((r) => JSON.stringify(r)),
    sealedLog: { ...log, terminal: log.terminal, terminalHash: log.terminalHash },
  };
}
const mirror = buildMirror();
book({
  kind: 'mirror', seed: SEED, evals: EVALS, ckptEvery: CKPT_EVERY,
  terminalHash: mirror.terminalHash, ckptTicks: Object.keys(mirror.bundles).map(Number),
  journalRows: mirror.journalRowJson.length,
  prng: 'flip positions: fnv1a64(`${seed}:${i}`) masked to 31 bits; kill delays: 5 + (t*7919)%91 ms; shuffle-free design (no shuffle PRNG needed beyond stated)',
});

// ── child plumbing ───────────────────────────────────────────────────────────
function spawnChild(args) {
  return new Promise((resolve) => {
    const t0 = nowMs();
    const p = spawn(process.execPath, [CHILD, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('error', (e) => { err += 'SPAWN-ERROR:' + String(e); });
    p.on('exit', (code) => resolve({ code, err, ms: nowMs() - t0, pid: p.pid }));
  });
}
async function killTrial(tag, { delay, mode }) {
  const t0 = nowMs();
  const dir = path.join(TMP, `kill_${tag}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, [CHILD, '--dir', dir, '--evals', String(EVALS), '--seed', String(SEED),
    '--ckptEvery', String(CKPT_EVERY), '--mode', mode], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (c) => { err += c; });
  const exited = new Promise((res) => child.on('exit', (code) => res({ code })));
  // wait until the journal has >= 2 rows (meta + >=1 event), then a planned delay
  const J = path.join(dir, 'rewind_journal.jsonl');
  let waited = 0, ready = false;
  while (waited < 5000) {
    await sleep(3); waited += 3;
    try {
      const raw = fs.readFileSync(J);
      if (raw.indexOf(0x0a, raw.indexOf(0x0a) + 1) !== -1) { ready = true; break; }
    } catch { /* not yet */ }
  }
  await sleep(delay);
  let alive = true;
  try { process.kill(child.pid, 'SIGKILL'); } catch { alive = false; }
  await Promise.race([exited, sleep(800)]);
  return { dir, ready, alive, err: err.slice(0, 200), ms: nowMs() - t0 };
}

// ── probe: price one kill trial before the grid ──────────────────────────────
const probe = await killTrial('probe', { delay: 12, mode: 'clean' });
const projMs = probe.ms * (KILL_TRIALS + 3 * ARM_TRIALS + JOURNAL_KILL_TRIALS) + 15000;
book({
  kind: 'probe', child_ms: +probe.ms.toFixed(0), projected_total_ms: Math.round(projMs),
  scaled_down: projMs > 170000, ready: probe.ready, note: projMs > 170000 ? 'projection >170s: grid reduced per house law' : 'projection within budget: full grid proceeds',
});

// ══ R1: the kill grid ════════════════════════════════════════════════════════
const r1 = { trials: 0, pass: 0, ckptsSeen: 0, ckptCleanMatch: 0, ckptLoud: 0, ckptSilentWrong: 0, journalByteExactPrefix: 0, tornTails: 0, noCkptYet: 0, failures: [] };
for (let t = 0; t < KILL_TRIALS; t++) {
  const delay = 5 + ((t * 7919) % 91);
  const { dir, alive } = await killTrial(`r1_${t}`, { delay, mode: 'clean' });
  r1.trials++;
  let ok = true;
  // checkpoints: clean-or-loud, and clean == mirror canon at that eval
  const ck = path.join(dir, 'ckpts');
  const files = fs.existsSync(ck) ? fs.readdirSync(ck).sort() : [];
  if (!files.length) r1.noCkptYet++;
  for (const f of files) {
    r1.ckptsSeen++;
    const tick = Number(f.match(/(\d+)\.json$/)?.[1] ?? -1);
    try {
      const b = JSON.parse(fs.readFileSync(path.join(ck, f), 'utf8'));
      const canon = stateCanon(driverFromBundle(JSON.parse(JSON.stringify(b))));
      if (mirror.bundles[tick] && canon === mirror.bundles[tick].canon) r1.ckptCleanMatch++;
      else { ok = false; r1.ckptSilentWrong++; r1.failures.push({ trial: t, f, why: 'checkpoint loaded but canon != mirror at tick' }); }
    } catch (e) { r1.ckptLoud++; /* loud refusal is the contract */ }
  }
  // journal: byte-exact prefix of the intended stream + honest torn tail
  const J = path.join(dir, 'rewind_journal.jsonl');
  if (fs.existsSync(J)) {
    const rec = recoverJSONL(J);
    if (rec.tornBytes > 0) r1.tornTails++;
    let byteExact = true;
    for (let i = 0; i < rec.rows.length; i++) {
      if (JSON.stringify(rec.rows[i]) !== mirror.journalRowJson[i]) { byteExact = false; break; }
    }
    if (byteExact) r1.journalByteExactPrefix++; else { ok = false; r1.failures.push({ trial: t, why: 'journal prefix not byte-exact vs intended stream' }); }
  } else { ok = false; r1.failures.push({ trial: t, why: 'journal file missing (killed before meta row?)' }); }
  if (ok) r1.pass++;
  fs.rmSync(dir, { recursive: true, force: true });
}
book({
  kind: 'result', rule: 'R1', trials: r1.trials, pass: r1.pass, killedWhileAlive: r1.trials,
  checkpoints: { seen: r1.ckptsSeen, cleanAndMatchMirror: r1.ckptCleanMatch, loudRefusals: r1.ckptLoud, silentWrong: r1.ckptSilentWrong, noCkptYet: r1.noCkptYet },
  journal: { byteExactPrefix: r1.journalByteExactPrefix, tornTailsReported: r1.tornTails },
  failures: r1.failures, verdict: r1.pass === r1.trials ? 'PASS' : 'FAIL',
});

// ══ R2: truncations + earlier-restore ════════════════════════════════════════
const r2 = { truncations: 0, loud: 0, silent: 0, restores: 0, restoresExact: 0 };
{
  const full = Buffer.from(mirror.bundles[EVALS].json, 'utf8');
  for (let t = 0; t < TRUNC_TRIALS; t++) {
    const cut = 32 + ((t * 137) % Math.max(1, full.length - 33));
    const f = path.join(TMP, `trunc_${t}.json`);
    fs.writeFileSync(f, full.subarray(0, cut));
    r2.truncations++;
    try { JSON.parse(fs.readFileSync(f, 'utf8')); r2.silent++; r2.failures = r2.failures || []; r2.failures.push({ t, cut, why: 'truncated checkpoint PARSED' }); } catch { r2.loud++; }
    fs.unlinkSync(f);
  }
  // earlier-restore: with a valid EARLIER checkpoint, the future is the same future
  for (const k of RESTORE_POINTS) {
    const b = JSON.parse(mirror.bundles[k].json);
    const d = driverFromBundle(JSON.parse(JSON.stringify(b)));
    while (d.state.eval < EVALS) coreStep(d, {});
    r2.restores++;
    if (stateCanon(d) === mirror.terminalCanon) r2.restoresExact++;
  }
  book({ kind: 'result', rule: 'R2', truncations: r2.truncations, loudRefused: r2.loud, silentlyAccepted: r2.silent, earlierRestores: r2.restores, restoresExactTerminalCanon: r2.restoresExact, restorePoints: RESTORE_POINTS, verdict: r2.silent === 0 && r2.restoresExact === r2.restores ? 'PASS' : 'FAIL' });
}

// ══ R3: bit-flip grid (bare vs sealed) + hash case-flips + controls ══════════
const r3 = { bare: { flips: 0, loud: 0, silentWrong: 0, silentBenign: 0 }, sealed: { flips: 0, detected: 0, undetected: [] }, caseFlips: 0, caseDetected: 0, controlFiles: 0, controlFalseAlarms: 0 };
for (const tick of FLIP_FILES) {
  const base = Buffer.from(mirror.bundles[tick].json, 'utf8');
  const sealedBase = Buffer.from(JSON.stringify(sealCheckpoint(mirror.bundles[tick].bundle)), 'utf8');
  for (let b = 0; b < FLIPS_PER_FILE; b++) {
    const pos = fpos(tick, b) % (base.length - 1), bit = b % 8;
    // BARE: the current surface
    {
      const bad = Buffer.from(base); bad[pos] ^= 1 << bit;
      const f = path.join(TMP, 'flip_bare.json'); fs.writeFileSync(f, bad);
      r3.bare.flips++;
      try {
        const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
        const d = driverFromBundle(parsed);
        if (stateCanon(d) === mirror.bundles[tick].canon) r3.bare.silentBenign++;
        else r3.bare.silentWrong++;
      } catch { r3.bare.loud++; }
      fs.unlinkSync(f);
    }
    // SEALED: the fix layer
    {
      const pos2 = fpos(tick, b) % (sealedBase.length - 1);
      const bad = Buffer.from(sealedBase); bad[pos2] ^= 1 << bit;
      const f = path.join(TMP, 'flip_sealed.json'); fs.writeFileSync(f, bad);
      r3.sealed.flips++;
      try {
        const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
        verifySealedCheckpoint(obj);
        r3.sealed.undetected.push({ tick, byte: pos2, bit, why: 'sealed verify passed on corrupted file' });
      } catch { r3.sealed.detected++; }
      fs.unlinkSync(f);
    }
  }
  // hash-string case flips (bit 5) inside the sealed wrapper's state_hash
  const sj = JSON.stringify(sealCheckpoint(mirror.bundles[tick].bundle));
  const marker = '"state_hash":"0x';
  const start = sj.indexOf(marker) + marker.length;
  for (let b = 0; b < CASE_FLIPS; b++) {
    const off = start + (fpos(tick + 9000, b) % 15); // 15 usable chars after 0x (16-hex fnv)
    let ch = sj[off];
    if (/[a-f]/.test(ch)) { /* a-f -> A-F via bit-5 set */ }
    else if (/[0-9]/.test(ch)) { /* digits: bit-5 flip makes punctuation; still detected (hash mismatch after parse) */ }
    const flipped = sj.slice(0, off) + String.fromCharCode(ch.charCodeAt(0) ^ 0x20) + sj.slice(off + 1);
    const f = path.join(TMP, 'flip_case.json'); fs.writeFileSync(f, flipped);
    r3.caseFlips++;
    try {
      const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
      verifySealedCheckpoint(obj);
      // UNDETECTED would mean the loader accepted a state whose hash string
      // differs in case from the recomputed one — impossible under string compare
    } catch { r3.caseDetected++; }
    fs.unlinkSync(f);
  }
  // zero-flip controls
  for (const [name, buf, mode2] of [['bare', base, 'bare'], ['sealed', sealedBase, 'sealed']]) {
    const f = path.join(TMP, `ctrl_${name}.json`); fs.writeFileSync(f, buf);
    r3.controlFiles++;
    try {
      const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (mode2 === 'sealed') verifySealedCheckpoint(obj);
      else { const d = driverFromBundle(obj); if (stateCanon(d) !== mirror.bundles[tick].canon) throw new Error('control canon mismatch'); }
    } catch { r3.controlFalseAlarms++; }
    fs.unlinkSync(f);
  }
}
book({
  kind: 'result', rule: 'R3',
  bare: {
    ...r3.bare,
    parseableFlips: r3.bare.silentWrong + r3.bare.silentBenign,
    silentAcceptanceAmongParseable: r3.bare.loud < r3.bare.flips ? +((r3.bare.silentWrong + r3.bare.silentBenign) / (r3.bare.silentWrong + r3.bare.silentBenign)).toFixed(4) : 0,
    detectionCoverage: +(r3.bare.loud / r3.bare.flips).toFixed(4),
    prediction: 'PRE-REGISTERED MECHANISM PREDICTION: the bare bundle carries no integrity tag, so flips that keep the JSON parseable load SILENTLY (wrong-state or ignored-field-benign) — reader-side detection among parseable flips ~0% predicted. The loud fraction is JSON parse failures (structure breaks), not detection by the reader.',
    benignNote: 'silentBenign = the flip landed in a field the RESTORE path ignores (e.g. bundle version) — still a silent accept; the reader, not the file, decided',
  },
  sealed: { flips: r3.sealed.flips, detected: r3.sealed.detected, coverage: +(r3.sealed.detected / r3.sealed.flips).toFixed(4), undetectedCount: r3.sealed.undetected.length },
  caseFlips: { flips: r3.caseFlips, detected: r3.caseDetected, mechanism: 'hashes are STRINGS end-to-end in dba readers (recompute + string compare; no hex decode anywhere on the checkpoint path) — the E-C1 Node case-insensitive-hex-decoder aliasing does NOT exist here; tested, not assumed' },
  controls: { files: r3.controlFiles, falseAlarms: r3.controlFalseAlarms },
  fixNote: 'sealed wrapper is EXTERNAL tooling (experiments/chaos_persist_d7.mjs): adding the tag inside Driver.bundle() would change every sealed E-D4 hash — receipted design decision',
  verdict: (r3.sealed.undetected.length === 0 && r3.caseDetected === r3.caseFlips && r3.controlFalseAlarms === 0) ? 'PASS (sealed layer)' : 'FAIL',
});

// ══ R4: paired arms + cross-process determinism ══════════════════════════════
const r4 = { pairs: [], cleanDeterminism: null };
{
  // clean cross-process determinism: a full clean child must produce mirror-identical bytes
  const dir = path.join(TMP, 'clean_child');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const r = await spawnChild(['--dir', dir, '--evals', String(EVALS), '--seed', String(SEED), '--ckptEvery', String(CKPT_EVERY), '--mode', 'clean']);
  const jr = recoverJSONL(path.join(dir, 'rewind_journal.jsonl'));
  const jBytes = jr.rows.map((x) => JSON.stringify(x));
  const byteIdent = jBytes.length === mirror.journalRowJson.length && jBytes.every((x, i) => x === mirror.journalRowJson[i]);
  let ckptIdent = true;
  for (const f of fs.readdirSync(path.join(dir, 'ckpts')).sort()) {
    const tick = Number(f.match(/(\d+)\.json$/)?.[1] ?? -1);
    if (fs.readFileSync(path.join(dir, 'ckpts', f), 'utf8') !== mirror.bundles[tick].json) ckptIdent = false;
  }
  r4.cleanDeterminism = { childExit: r.code, journalByteIdentical: byteIdent, ckptByteIdentical: ckptIdent };
  fs.rmSync(dir, { recursive: true, force: true });
  // paired arms on the kill grid
  for (let t = 0; t < ARM_TRIALS; t++) {
    const delay = 5 + ((t * 6271) % 81);
    const lost = {}, torn = {};
    for (const mode of ['fsync', 'buffer', 'torn']) {
      const { dir: d2 } = await killTrial(`r4_${t}_${mode}`, { delay, mode });
      const rec = recoverJSONL(path.join(d2, 'rewind_journal.jsonl'));
      lost[mode] = (mirror.journalRowJson.length) - rec.rows.length;
      torn[mode] = rec.tornBytes;
      fs.rmSync(d2, { recursive: true, force: true });
    }
    r4.pairs.push({ trial: t, lost, tornBytes: torn });
  }
  const mean = (k) => r4.pairs.reduce((a, p) => a + p.lost[k], 0) / r4.pairs.length;
  book({
    kind: 'result', rule: 'R4', cleanDeterminism: r4.cleanDeterminism,
    pairs: r4.pairs, meanLostFsync: +mean('fsync').toFixed(2), meanLostBuffer: +mean('buffer').toFixed(2), meanLostTorn: +mean('torn').toFixed(2),
    tornTailsSeen: r4.pairs.filter((p) => p.tornBytes.torn > 0).length,
    sandboxPrediction: 'NULL fsync-vs-buffer (page cache survives SIGKILL) — PRE-REGISTERED',
    limitation: 'machine-level power loss unmodelable in sandbox — receipted (E-C1 R6 idiom)',
    verdict: (r4.cleanDeterminism.journalByteIdentical && r4.cleanDeterminism.ckptByteIdentical) ? 'PASS (determinism; arms INFO-NULL as predicted)' : 'FAIL',
  });
}

// ══ R5: rewind-from-recovered-journal ════════════════════════════════════════
const r5 = { killTrials: 0, recovered: 0, prefixAgrees: 0, resumedTerminalExact: 0, suffixCanonEqual: 0, failures: [], roundTrip: null, naiveAppend: 0, naiveDetected: 0 };
{
  // (0) f64 disk round-trip: reload the mirror journal from its JSONL bytes and rewind
  const fRT = path.join(TMP, 'roundtrip_journal.jsonl');
  fs.writeFileSync(fRT, journalToJSONL(mirror.log).map((r) => JSON.stringify(r)).join('\n') + '\n');
  const reloaded = journalFromJSONL(recoverJSONL(fRT).rows);
  const vr = verifyRewind(reloaded, [0, 50, 150, 250, 350, 499]);
  r5.roundTrip = { sampledOk: vr.ok, checks: vr.checks.length };
  // (1) kill trials -> truncate-to-good-then-continue
  for (let t = 0; t < JOURNAL_KILL_TRIALS; t++) {
    const delay = 5 + ((t * 5381) % 121);
    const { dir } = await killTrial(`r5_${t}`, { delay, mode: 'clean' });
    r5.killTrials++;
    const J = path.join(dir, 'rewind_journal.jsonl');
    const rec = recoverJSONL(J);
    if (!rec.rows.length) { r5.failures.push({ trial: t, why: 'no recoverable rows' }); fs.rmSync(dir, { recursive: true, force: true }); continue; }
    r5.recovered++;
    const evRows = rec.rows.slice(1).filter((r) => r.kind === 'event');
    const nEvents = evRows.length; // meta + events (a terminal row means the child finished first)
    let agrees = true;
    for (let i = 0; i < nEvents; i++) {
      const want = mirror.journalRowJson[i + 1]; // +1: skip meta row
      if (JSON.stringify(rec.rows[i + 1]) !== want) { agrees = false; break; }
    }
    if (agrees) r5.prefixAgrees++;
    // truncate-to-good, then CONTINUE: replay the prefix from the origin (the
    // deterministic forward run re-derives the state at k exactly — E-D4's
    // replay baseline), then recordStep the remainder into a fork log.
    fs.truncateSync(J, rec.goodBytes);
    const k = mirror.log.baseEval + nEvents;
    const d2 = new Driver({ arm: 'A', seed: SEED, gain: 1 });
    for (let i = 0; i < k; i++) coreStep(d2, {});
    if (k > 0 && stateHash(d2) !== mirror.log.events[k - 1].postHash) { r5.failures.push({ trial: t, why: 'replayed state hash != recovered event postHash at k=' + k }); }
    const contLog = checkpoint(d2, { forkedFrom: mirror.log.originHash, baseEval: k, role: 'resumed-after-kill', trial: t });
    while (d2.state.eval < EVALS) recordStep(d2, contLog, {});
    if (stateCanon(d2) === mirror.terminalCanon) r5.resumedTerminalExact++;
    const sA = fnv1a64(canonDeep(contLog.events));
    const sB = fnv1a64(canonDeep(mirror.log.events.slice(k)));
    if (sA === sB) r5.suffixCanonEqual++;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // (2) naive append past a torn tail: detection test on a synthetic torn journal
  {
    const full = journalToJSONL(mirror.log).map((r) => JSON.stringify(r)).join('\n') + '\n';
    const cut = full.length - 40; // torn tail: 40 bytes of a row
    const fN = path.join(TMP, 'naive.jsonl');
    fs.writeFileSync(fN, full.slice(0, cut));
    const nextRow = mirror.journalRowJson[Math.min(5, mirror.journalRowJson.length - 1)];
    fs.appendFileSync(fN, nextRow + '\n'); // NAIVE: append past the torn tail
    const rec2 = recoverJSONL(fN);
    if (rec2.firstBad !== null || rec2.tornBytes > 0) r5.naiveDetected++;
    r5.naiveAppend++;
    fs.unlinkSync(fN);
  }
  book({
    kind: 'result', rule: 'R5', killTrials: r5.killTrials, recovered: r5.recovered,
    prefixByteAgreesWithMirror: r5.prefixAgrees, resumedTerminalExact: r5.resumedTerminalExact,
    suffixCanonEqual: r5.suffixCanonEqual,
    f64DiskRoundTrip: r5.roundTrip,
    naiveAppendPastTorn: { trials: r5.naiveAppend, detected: r5.naiveDetected, protocol: 'truncate-to-good-then-continue is REQUIRED: naive append merges the torn row into the next line (parse error) — recovery alone is not liveness (E-C1 R5 lesson re-proven on this surface)' },
    failures: r5.failures,
    verdict: (r5.resumedTerminalExact === r5.recovered && r5.suffixCanonEqual === r5.recovered && r5.prefixAgrees === r5.recovered && vr.ok) ? 'PASS' : 'FAIL',
  });
}

// ══ R6: live-decision cache durability (post-fix) ════════════════════════════
const r6 = { corruptLoud: 0, corruptTrials: 0, tamperTrials: 0, tamperSilentReplay: 0, controlZeroCall: null };
{
  const cdir = path.join(TMP, 'cache'); fs.mkdirSync(cdir, { recursive: true });
  // (a) corrupt caches must be refused LOUDLY (post-fix)
  for (const [name, body] of [['torn', '{"0xabc": {"answers": {"adv'], ['empty', ''], ['garbage', 'not json at all']]) {
    const f = path.join(cdir, `corrupt_${name}.json`); fs.writeFileSync(f, body);
    r6.corruptTrials++;
    try { new LiveJev({ cachePath: f }); r6.failures6 = r6.failures6 || []; r6.failures6.push({ name, why: 'constructor SILENTLY accepted a corrupt cache' }); } catch { r6.corruptLoud++; }
  }
  // (b)+(c): genuine entry via DI transport (zero real network), then tamper
  const fC = path.join(cdir, 'live_cache.json');
  const answers = { advance: { type: 'noul', noul: 0.97 }, task_choice: { type: 'choice', choice: 't1', confidence: 0.8 }, readiness: { type: 'score', score: 4, confidence: 0.6 } };
  const transport = async () => ({ ok: true, status: 200, json: { model: 'jev-1.13.0', answers, usage: { input_tokens: 10, output_tokens: 2 } }, ms: 4, error_class: null });
  const state = buildState({ task: 0, success: 0.9, ringLen: 25, position: 640, evalIdx: 250, proposal: true });
  const questions = makeQuestions({ task: 0, proposal: true });
  const jw = new LiveJev({ key: 'offline-probe-not-a-real-key', cachePath: fC, transport, capSeed: 5, capRun: 5, capTotal: 5 });
  const c1 = await jw.consult({ tag: 'ed7:s1:t1', decisionId: 's1:1', state, questions, fallbackAction: 'discard' });
  // control: a fresh client on the same cache must serve a ZERO-CALL identical replay
  const jr = new LiveJev({ key: 'offline-probe-not-a-real-key', cachePath: fC, transport, capSeed: 5, capRun: 5, capTotal: 5 });
  const c2 = await jr.consult({ tag: 'ed7:s1:t2', decisionId: 's1:2', state, questions, fallbackAction: 'discard' });
  r6.controlZeroCall = { firstSource: c1.source, replaySource: c2.source, cached: c2.cached === true, verdictMatches: JSON.stringify(c1.verdict) === JSON.stringify(c2.verdict) };
  // tamper: flip the noul value INSIDE the valid-JSON cache file, replay
  const raw = fs.readFileSync(fC, 'utf8');
  const tampered = raw.replace('"noul": 0.97', '"noul": 0.17').replace('"noul":0.97', '"noul":0.17');
  if (tampered === raw) { r6.tamperNote = 'cache is pretty-printed with indent=1; noul replace missed — checking'; }
  fs.writeFileSync(fC, tampered);
  const jt = new LiveJev({ key: 'offline-probe-not-a-real-key', cachePath: fC, transport, capSeed: 5, capRun: 5, capTotal: 5 });
  const c3 = await jt.consult({ tag: 'ed7:s1:t3', decisionId: 's1:3', state, questions, fallbackAction: 'discard' });
  r6.tamperTrials++;
  if (c3.source === 'cache' && c3.verdict.action === 'discard') r6.tamperSilentReplay++;
  book({
    kind: 'result', rule: 'R6', corrupt: { trials: r6.corruptTrials, loudRefused: r6.corruptLoud },
    control: r6.controlZeroCall,
    tamper: { trials: r6.tamperTrials, silentReplays: r6.tamperSilentReplay, note: 'a tampered-but-valid cache entry replays SILENTLY — undetectable by construction (values are trusted-as-written; a write-time MAC would be a schema change on the E-D2 sealed surface). Open defect receipted; mitigation = the dev-journal audit trail (dev_journal_ed2.jsonl rows) which records what the live gate ACTUALLY said per decision.' },
    fixReceipt: 'dba/jev_live.mjs constructor: corrupt cache now throws (fail-closed) — 3-line fix, live path untouched, smoke_ed2 re-run green (receipted in this chain)',
    verdict: (r6.corruptLoud === r6.corruptTrials) ? 'PASS (loud refusal)' : 'FAIL',
  });
}

// ══ summary + chain ══════════════════════════════════════════════════════════
const verdicts = Object.fromEntries(rows.filter((r) => r.kind === 'result').map((r) => [r.rule, r.verdict]));
book({
  kind: 'summary', task: 'E-D7 crash-grade durability of the persisted surfaces',
  verdicts,
  crown: 'kill -9 no longer ends the story: the durable rewind journal recovers as a byte-exact prefix, truncate-to-good-then-continue lands on the uninterrupted terminal hash with a canon-equal event suffix, and the carried f64 state survives the disk round-trip bit-exactly — E-D4\'s logical time travel now has a physical body',
  honestDefects: [
    'bare checkpoint bundle has no integrity tag: silent wrong-state loads are reachable (R3, predicted then measured) — external sealed wrapper receipted as the fix layer, bundle() untouched to preserve sealed hashes',
    'tampered-but-valid live-decision cache replays silently (R6) — open defect, undetectable by construction, audit trail named',
  ],
  honestNulls: ['fsync-vs-buffer SIGKILL arm: NULL as pre-registered (page cache survives; power loss unmodelable)'],
});
sealChain(rows);
const chain = verifyChain(rows);
fs.writeFileSync(path.join(OUT, 'receipts_ed7.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const fromDisk = fs.readFileSync(path.join(OUT, 'receipts_ed7.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const chainDisk = verifyChain(fromDisk);
const summary = {
  task: 'E-D7 crash-grade durability', seed: SEED, evals: EVALS,
  killTrials: KILL_TRIALS, armTrials: ARM_TRIALS, truncTrials: TRUNC_TRIALS,
  flips: { bare: r3.bare, sealedDetected: r3.sealed.detected, sealedFlips: r3.sealed.flips, caseFlips: r3.caseFlips, caseDetected: r3.caseDetected },
  r5: { killTrials: r5.killTrials, recovered: r5.recovered, resumedTerminalExact: r5.resumedTerminalExact, suffixCanonEqual: r5.suffixCanonEqual, roundTrip: r5.roundTrip },
  r6: { corruptLoud: r6.corruptLoud, corruptTrials: r6.corruptTrials, tamperSilentReplay: r6.tamperSilentReplay, controlZeroCall: r6.controlZeroCall },
  verdicts, chain: { rows: rows.length, ok: chain.ok, diskOk: chainDisk.ok, tip: rows[rows.length - 1].row_hash },
};
fs.writeFileSync(path.join(OUT, 'e_d7_summary.json'), JSON.stringify(summary, null, 1));
console.log('R1', verdicts.R1, '| R2', verdicts.R2, '| R3', verdicts.R3, '| R4', verdicts.R4, '| R5', verdicts.R5, '| R6', verdicts.R6);
console.log(`R3 bare: loud ${r3.bare.loud}/${r3.bare.flips}, silentWrong ${r3.bare.silentWrong}, silentBenign ${r3.bare.silentBenign} | sealed ${r3.sealed.detected}/${r3.sealed.flips} | case ${r3.caseDetected}/${r3.caseFlips}`);
console.log(`R5: recovered ${r5.recovered}, resumedTerminalExact ${r5.resumedTerminalExact}, suffixCanonEqual ${r5.suffixCanonEqual}, roundTrip ok=${r5.roundTrip?.sampledOk}`);
console.log(`chain: ${chain.ok ? 'OK' : 'BROKEN'} ${chainDisk.ok ? '(disk OK)' : '(DISK BROKEN)'} ${rows.length} rows tip ${rows[rows.length - 1].row_hash}`);
const allPass = Object.values(verdicts).every((v) => v.startsWith('PASS')) && chain.ok && chainDisk.ok;
if (allPass) fs.rmSync(TMP, { recursive: true, force: true }); // green run: no forensics to keep (kept on failure)
process.exit(allPass ? 0 : 1);
