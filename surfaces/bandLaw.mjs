// surfaces/bandLaw.mjs — Round 22 on Surface C (SPEC S5).
//
// The band law, vendored byte-for-byte from the canonical copy
// (vendor/band-law.mjs, pinned sha256 1e3cb4d2df1677f4461e8744615b8617898f96fc84108b2241ce50ead0f4f318
// — the SAME bytes purpose-loops pins, which itself pins madlibs-jev's):
//
//     decide(x, R) = (x in R) ? REST : ESCALATE
//
// Surface C's instantiation (the receipted wiring, not a re-invention):
//
//   x       — |observed block fingerprint − prior block fingerprint| (exact
//             integer sum over the block's registers; same bytes -> same
//             fingerprint, deterministically).
//   R       — the checksum-surface region [0, 0] (hiInclusive): on a
//             fingerprint surface the two-sided band collapses to exact
//             match. The receipt says so plainly — the band STRUCTURE on
//             this surface lives in the escalation hysteresis, Surface C's
//             own contribution to the law (Round 22): consecutive breaches
//             compound through levels 0..3 instead of re-waking from zero,
//             and level 3 latches eager mode for the rest of the run.
//   REST    — replay the op's cached output (1 unit) after the fingerprint
//             verified the block unchanged. Sound because the output is a
//             pure function of the block's KEY half: whole-block match
//             implies key match. Zero expensive ops.
//   ESCALATE— eager re-execution of the expensive key-mixing output
//             (len × ROUNDS units) + a sticky scar. Parity survives because
//             escalation recomputes from the CURRENT bytes instead of
//             guessing: in the proof workload the perturbation touches
//             PAYLOAD registers only, so escalated outputs still equal the
//             baseline — the band saved nothing it should not have, and
//             spent exactly where the world moved.
//
// Cost accounting (measured, never declared): fingerprint scan = len units;
// eager execution = keyLen × ROUNDS units; replay = 1 unit.
// Targets (SPEC §1): ROUND22_TARGET_OPS = 28 decisions, all matching
// op-for-op (28/28), at costRatio ≤ ROUND22_COST_CAP = 0.38, with the
// 99→99→99 control ladder flat throughout (S2).

import { decide, escalation } from '../vendor/band-law.mjs';

export const ROUND22_TARGET_OPS = 28;
export const ROUND22_COST_CAP = 0.38;
export const KEY_LEN = 4;            // registers per block whose values feed the output
export const BLOCK_LEN = 8;          // registers per op block (key half + payload half)
export const MIX_ROUNDS = 64;        // the expensive part: key-mixing rounds
export const ESCALATE_AFTER = 2;     // hysteresis: consecutive breaches per level step
export const EAGER_LATCH_LEVEL = 3;  // level 3 latches eager mode

// The pre-registered perturbation set: which op blocks get their PAYLOAD
// halves shifted (+17.0 to every payload register) after the baseline run.
// Deterministic, receipted, no randomness.
export const PERTURB_OPS = [4, 7, 9, 12, 15, 18, 21, 24];

// ---- the workload (deterministic ints; same seeds -> same world) ---------

export function seedBlocks(surface, ops = ROUND22_TARGET_OPS) {
  for (let i = 0; i < ops; i++) {
    const base = i * BLOCK_LEN;
    for (let j = 0; j < BLOCK_LEN; j++) {
      const keyPhase = j < KEY_LEN;
      surface.registers[base + j] = keyPhase
        ? (i * 13 + j * 7 + 1) % 1000      // key half
        : (i * 29 + j * 11 + 5) % 1000;    // payload half
    }
  }
  return ops * BLOCK_LEN;
}

export function perturbPayloads(surface, ops = PERTURB_OPS) {
  for (const i of ops) {
    const base = i * BLOCK_LEN + KEY_LEN;
    for (let j = 0; j < BLOCK_LEN - KEY_LEN; j++) surface.registers[base + j] += 17.0;
  }
  return ops.length;
}

// ---- the expensive function (output = pure function of the KEY half) -----

export function mixKey(keyView) {
  let h = 2166136261 >>> 0; // fnv1a offset basis
  for (let r = 0; r < MIX_ROUNDS; r++) {
    for (let i = 0; i < KEY_LEN; i++) {
      h = (Math.imul(h ^ ((keyView[i] | 0) & 0xffffffff), 16777619) + r + i) >>> 0;
    }
  }
  return h >>> 0;
}

export function blockFingerprint(dataView) {
  let s = 0;
  for (let i = 0; i < dataView.length; i++) s += dataView[i];
  return s; // exact float sum over int-valued registers: deterministic
}

// ---- the runs -------------------------------------------------------------

// Baseline: full-fat, every op eager. Returns {outputs, cost}.
export function runBaseline(surface, ops = ROUND22_TARGET_OPS) {
  let cost = 0;
  const outputs = [];
  for (let i = 0; i < ops; i++) {
    const region = surface.mapRegion(i * BLOCK_LEN, BLOCK_LEN);
    const key = region.data.subarray(0, KEY_LEN);
    outputs.push(mixKey(key));
    cost += KEY_LEN * MIX_ROUNDS; // the expensive execution
  }
  return { outputs, cost };
}

// Banded: observe (fingerprint) -> decide (the vendored comparator) ->
// REST replays the cached output; ESCALATE re-executes eagerly, scars,
// and compounds through the escalation hysteresis (level 3 latches eager).
// cache: per-op {wholeFp, keyFp, output} captured from the baseline pass.
export function runBanded(surface, baseline, { ops = ROUND22_TARGET_OPS, scars = null } = {}) {
  const cache = baseline.cache;
  let cost = 0;
  let state = { breaches: 0, level: 0 };
  let eagerLatch = false;
  const outputs = [];
  const trace = [];
  for (let i = 0; i < ops; i++) {
    const region = surface.mapRegion(i * BLOCK_LEN, BLOCK_LEN);
    const fp = blockFingerprint(region.data);
    const priorFp = cache[i].wholeFp;
    const x = Math.abs(fp - priorFp); // checksum surface: 0 = verified unchanged
    // the pre-registered region for a fingerprint surface: [0, 0], hi-inclusive.
    const region0 = { lo: 0, hi: 0, hiInclusive: true, kind: 'checksum' };
    let decision;
    if (eagerLatch) {
      decision = 'ESCALATE'; // the latch: level-3 hysteresis holds the surface awake
      trace.push({ op: i, decision, x, latched: true, level: state.level });
    } else {
      const esc = escalation(state, x, region0, { after: ESCALATE_AFTER });
      decision = esc.decision;
      state = esc.state;
      trace.push({ op: i, decision, x, breaches: state.breaches, level: state.level });
      // the hysteresis latch: once the compounding breaches carry the surface
      // to level 3, it STAYS awake — every later op escalates (Round 22's
      // contribution: escalation persists until a REST resets it; here none
      // comes, so the latch holds for the rest of the run).
      if (state.level >= EAGER_LATCH_LEVEL) eagerLatch = true;
    }
    if (decision === 'REST') {
      outputs.push(cache[i].output);       // the replay: 1 unit, zero expensive ops
      cost += 1;
    } else {
      const key = region.data.subarray(0, KEY_LEN);
      outputs.push(mixKey(key));           // the spend: eager re-execution
      cost += KEY_LEN * MIX_ROUNDS;
      if (scars) scars.scar('band-escalate', `op ${i} outside checksum band (x=${x})`, region.base);
    }
    cost += BLOCK_LEN;                     // the observation pass every op pays
  }
  return { outputs, cost, trace, finalLevel: state.level, latched: eagerLatch || state.level >= EAGER_LATCH_LEVEL };
}

// Attach the cache to a baseline result (whole-block fp + key fp + output).
export function withCache(surface, baseline, ops = ROUND22_TARGET_OPS) {
  baseline.cache = [];
  for (let i = 0; i < ops; i++) {
    const region = surface.mapRegion(i * BLOCK_LEN, BLOCK_LEN);
    baseline.cache.push({
      wholeFp: blockFingerprint(region.data),
      keyFp: blockFingerprint(region.data.subarray(0, KEY_LEN)),
      output: baseline.outputs[i],
    });
  }
  return baseline;
}

// ---- the proof ------------------------------------------------------------

// prove(surface, {scars}) runs the full Round-22 shape on Surface C and
// returns the receipt object. Throws (loudly) if parity or the cost cap
// fails — a band mechanism that only wins cost by changing behaviour is
// INDETERMINATE, not a pass (SPEC S5).
export function prove(surface, { scars = null, ops = ROUND22_TARGET_OPS } = {}) {
  seedBlocks(surface, ops);
  const baseline = withCache(surface, runBaseline(surface, ops), ops);

  // the world moves (payload halves of the pre-registered set, +17.0 each)
  perturbPayloads(surface);

  const banded = runBanded(surface, baseline, { ops, scars });

  let parityCount = 0;
  for (let i = 0; i < ops; i++) if (banded.outputs[i] === baseline.outputs[i]) parityCount++;
  const costRatio = banded.cost / baseline.cost;

  if (parityCount !== ops) {
    throw Object.assign(
      new Error(`band parity FAILED: ${parityCount}/${ops} — the escalated surface changed observable behaviour (S5: INDETERMINATE, not a pass)`),
      { code: 'E_BAND_PARITY', parityCount, ops },
    );
  }
  if (costRatio > ROUND22_COST_CAP) {
    throw Object.assign(
      new Error(`band cost cap BREACHED: ${costRatio.toFixed(6)} > ${ROUND22_COST_CAP} — the mechanism won nothing worth its spend`),
      { code: 'E_BAND_PARITY', costRatio },
    );
  }
  const escalations = banded.trace.filter((t) => t.decision === 'ESCALATE').length;
  if (escalations !== PERTURB_OPS.length) {
    throw Object.assign(
      new Error(`escalation accounting wrong: ${escalations} escalations for ${PERTURB_OPS.length} perturbed blocks — the band lied`),
      { code: 'E_BAND_PARITY', escalations },
    );
  }
  return {
    surface: 'C',
    ops,
    parityCount,
    parity: `${parityCount}/${ops}`,
    baselineCost: baseline.cost,
    bandedCost: banded.cost,
    costRatio: Math.round(costRatio * 1e6) / 1e6,
    costCap: ROUND22_COST_CAP,
    escalations,
    perturbedOps: PERTURB_OPS.slice(),
    escalationTrace: banded.trace,
    mixRounds: MIX_ROUNDS,
    law: 'decide(x, R) = (x in R) ? REST : ESCALATE  — vendor/band-law.mjs (pinned)',
    vendoredSha256: '1e3cb4d2df1677f4461e8744615b8617898f96fc84108b2241ce50ead0f4f318',
  };
}
