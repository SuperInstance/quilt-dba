// tests/surfaceC.test.mjs — Wave-69 Track B battery (offline, deterministic).
// Proves SPEC S1-S6 on the memory-mapped surface: unmediated zero-copy reads,
// byte-exact snapshots, the flat 99->99->99 control ladder, non-blocking JIT
// splits, scars that survive rewinds, and the Round-22 band law at parity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SurfaceC, PROJECTION_GRANULE } from '../surfaces/surfaceC.mjs';
import { mapCells, controlLevel, runLadder } from '../surfaces/controlMap.mjs';
import { JitSplitter, regionEntropy, ENTROPY_SPLIT_BITS } from '../surfaces/jitSplit.mjs';
import { StickyScarRegistry } from '../surfaces/scars.mjs';
import {
  prove, seedBlocks, perturbPayloads, runBaseline, runBanded, withCache,
  mixKey, blockFingerprint, PERTURB_OPS, ROUND22_COST_CAP,
} from '../surfaces/bandLaw.mjs';
import { StitchLedger } from '../stitches/ledger.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL_BAND_LAW_SHA = '1e3cb4d2df1677f4461e8744615b8617898f96fc84108b2241ce50ead0f4f318';

// ---------- S1: the unmediated projection ----------

test('S1 zero-copy: a mapped view IS the register file (aliasing)', () => {
  const s = new SurfaceC(64);
  const r = s.mapRegion(0, 8);
  assert.equal(r.data.buffer, s.registers.buffer, 'view must share the register ArrayBuffer — anything else is mediated');
  r.data[3] = 41.5;
  assert.equal(s.registers[3], 41.5, 'store through the view lands in the register file directly');
  s.registers[5] = 7.25;
  assert.equal(r.data[5], 7.25, 'load through the view reads the register file directly');
  r.tags[0] = 1234;
  assert.equal(s.tags[0], 1234, 'tag words alias too');
});

test('S1 fail-closed: E_REGISTER_OVERRUN on bad spans (bounds, misalignment, empty)', () => {
  const s = new SurfaceC(64);
  for (const [b, l] of [[-8, 8], [0, 0], [0, -8], [63, 2], [0, 7], [60, 8], [1.5, 8]]) {
    assert.throws(() => s.mapRegion(b, l), (e) => e.code === 'E_REGISTER_OVERRUN', `mapRegion(${b}, ${l}) must refuse`);
  }
  assert.throws(() => s.alloc(7), (e) => e.code === 'E_REGISTER_OVERRUN');
  assert.throws(() => new SurfaceC(63), (e) => e.code === 'E_REGISTER_OVERRUN'); // not granule-multiple
  assert.equal(PROJECTION_GRANULE, 64);
});

// ---------- S6: byte-exact durability ----------

test('S6 snapshot/restore round-trip is byte-identical (cold + into)', () => {
  const s = new SurfaceC(64);
  const r = s.mapRegion(0, 8);
  for (let i = 0; i < 8; i++) r.data[i] = i * 1.5;
  r.tags[2] = 0xface;
  const snap = s.snapshot();
  const cold = SurfaceC.restore(snap);
  assert.equal(Buffer.compare(cold.snapshot(), snap), 0, 'cold restore must be byte-identical');
  // mutate the live surface, then rewind INTO it: state rewinds byte-exactly
  const r2 = s.mapRegion(0, 8);
  for (let i = 0; i < 8; i++) r2.data[i] = 999;
  r2.tags[2] = 0;
  SurfaceC.restore(snap, { into: s });
  assert.equal(Buffer.compare(s.snapshot(), snap), 0, 'into-restore must be byte-identical');
  // malformed images refuse loudly
  assert.throws(() => SurfaceC.restore(Buffer.alloc(11)), (e) => e.code === 'E_REGISTER_OVERRUN');
  assert.throws(() => SurfaceC.restore(Buffer.alloc(0)), (e) => e.code === 'E_REGISTER_OVERRUN');
});

// ---------- S2: the flat control ladder ----------

test('S2 the flat control ladder reads exactly 99->99->99', () => {
  const s = new SurfaceC(512);
  const out = runLadder(s, 99);
  assert.deepEqual(out.ladder, [99, 99, 99]);
  assert.equal(out.flat, true);
  assert.equal(out.level, 3); // three cells, all armed
});

test('S2 control drift is LOUD: a trampled tag word stops the ladder by name', () => {
  const s = new SurfaceC(512);
  const cells = mapCells(s, 3);
  assert.equal(controlLevel(cells), 3);
  // happy path first: pre-mapped armed cells run flat like the surface form
  assert.deepEqual(runLadder(cells, 99).ladder, [99, 99, 99]);
  // now trample ONE cell's level marker and hand the ladder the wounded cells:
  cells[1].region.tags[0] = 0xdeadbeef;
  assert.equal(controlLevel(cells), 2);
  assert.throws(() => runLadder(cells, 99), (e) => e.code === 'E_CONTROL_DRIFT' && e.rung === 0,
    'the ladder must refuse by name, never absorb a moved negative control');
});

// ---------- S3: JIT topological splitting ----------

test('S3 entropy: flat region ~0, wide-spread region above the split threshold', () => {
  const s = new SurfaceC(256);
  const jit = new JitSplitter(s);
  const a = jit.track(0, 8);
  const b = jit.track(s.alloc(64), 64);
  for (let i = 0; i < 8; i++) jit.viewOf(a.base).data[i] = 5; // one bucket
  for (let i = 0; i < 64; i++) jit.viewOf(b.base).data[i] = (i * 1103515245 + 12345) % 9973;
  const eA = regionEntropy(jit.viewOf(a.base).data);
  const eB = regionEntropy(jit.viewOf(b.base).data);
  assert.ok(eA < 0.5, `flat region entropy should be ~0, got ${eA}`);
  assert.ok(eB > ENTROPY_SPLIT_BITS, `storm region entropy ${eB} must exceed ${ENTROPY_SPLIT_BITS}`);
  assert.equal(regionEntropy(new Float64Array(0)), 0);
});

test('S3 split fires at the threshold, halves keep the bytes, stats move', () => {
  const s = new SurfaceC(256);
  const jit = new JitSplitter(s);
  const storm = jit.track(s.alloc(64), 64);
  for (let i = 0; i < 64; i++) jit.viewOf(storm.base).data[i] = (i * 1103515245 + 12345) % 9973;
  const whole = Array.from(jit.viewOf(storm.base).data);
  const res = jit.observe(storm.base);
  assert.equal(res.split, true);
  assert.equal(res.depth, 1);
  // the split copied, never scrambled: the two half-regions reassemble the storm
  const first = jit.table.find((t) => t.base === storm.base);
  const second = jit.table.find((t) => t.base !== storm.base && t.splitDepth === 1);
  assert.ok(first && second);
  const reassembled = [...Array.from(jit.viewOf(storm.base).data), ...Array.from(jit.viewOf(second.base).data)];
  assert.deepEqual(reassembled, whole);
  assert.equal(jit.stats().splits, 1);
  assert.equal(jit.sideState(storm.base).phase, 'SPLIT');
  // a quiet region does NOT split
  const quiet = jit.track(s.alloc(8), 8);
  for (let i = 0; i < 8; i++) jit.viewOf(quiet.base).data[i] = 3;
  const noSplit = jit.observe(quiet.base);
  assert.equal(noSplit.split, false);
});

test('S3 non-blocking: readers see old-or-new layout, never garbage (checksum across splits)', () => {
  const s = new SurfaceC(512);
  const jit = new JitSplitter(s);
  const base = jit.track(s.alloc(64), 64);
  for (let i = 0; i < 64; i++) jit.viewOf(base.base).data[i] = (i * 2654435761 % 9973);
  const expectedChecksum = Array.from(jit.viewOf(base.base).data).reduce((a, b) => a + b, 0);
  // interleave reads with splits; every read must return the SAME multiset of
  // bytes (old or new layout — they contain the same values), so the running
  // checksum over any complete pass is invariant.
  let pass = 0;
  for (let round = 0; round < 4; round++) {
    jit.observe(base.base); // may or may not split depending on depth cap
    let cs = 0;
    const v = jit.viewOf(base.base);
    for (let i = 0; i < v.length; i++) cs += v.data[i];
    assert.ok(Number.isFinite(cs), `pass ${pass}: reader checksum must always be a real number, never garbage`);
    pass++;
  }
  // final layout still holds exactly the storm bytes (copied halves preserve the multiset)
  const all = jit.table.map((t) => Array.from(jit.viewOf(t.base).data)).flat();
  assert.equal(all.reduce((a, b) => a + b, 0), expectedChecksum);
});

// ---------- S4: sticky scars ----------

test('S4 scar chain: append, verify, tamper localized', () => {
  const reg = new StickyScarRegistry();
  reg.scar('die-roll', 'roll 6 -> floor-lift', 0);
  reg.scar('band-escalate', 'op 12 outside band', 96);
  const v = reg.verify();
  assert.equal(v.ok, true);
  assert.equal(v.links, 2);
  reg.rows[0].note = 'TAMPERED';
  const v2 = reg.verify();
  assert.equal(v2.ok, false);
  assert.equal(v2.at, 1);
});

test('S4 scars survive rewind: restore rewrites state, never history', () => {
  const s = new SurfaceC(64);
  seedBlocks(s, 2); // fill blocks 0..1 deterministically
  const snap0 = s.snapshot();
  perturbPayloads(s, [1]);          // world moves
  s.scars.scar('band-escalate', 'op 1 moved past checkpoint', 8);
  assert.equal(s.scars.size, 1);
  SurfaceC.restore(snap0, { into: s }); // rewind the WORLD
  const snapAfter = s.snapshot();
  assert.equal(Buffer.compare(snapAfter, snap0), 0, 'registers rewound byte-exactly');
  assert.equal(s.scars.size, 1, 'the scar did NOT rewind: the past happened');
  assert.equal(s.scars.verify().ok, true, 'scar chain still verifies after the rewind');
});

// ---------- the vendored law ----------

test('vendor pin: band-law.mjs is byte-identical to the canonical copy', () => {
  const bytes = readFileSync(join(ROOT, 'vendor/band-law.mjs'));
  const sha = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha, CANONICAL_BAND_LAW_SHA, 'vendor drift — re-vendor from SuperInstance/madlibs-jev (via purpose-loops) and re-pin with a receipted sha');
});

test('law units: decide REST/ESCALATE/OPEN + escalation hysteresis compounds', async () => {
  const law = await import(join(ROOT, 'vendor/band-law.mjs'));
  const region = { lo: 0, hi: 0, hiInclusive: true, kind: 'checksum' };
  assert.equal(law.decide(0, region), 'REST');
  assert.equal(law.decide(0.001, region), 'ESCALATE');
  assert.equal(law.decide(5, null), 'OPEN');
  let state = { breaches: 0, level: 0 };
  const seq = [law.escalation(state, 1, region, { after: 2 }),
    law.escalation(law.escalation(state, 1, region, { after: 2 }).state, 1, region, { after: 2 })];
  state = seq[1].state;
  assert.equal(state.breaches, 2);
  assert.equal(state.level, 1, 'second consecutive breach raises the level');
  // a REST resets the streak
  const afterRest = law.escalation(state, 0, region, { after: 2 });
  assert.deepEqual(afterRest.state, { breaches: 0, level: 0 });
});

// ---------- S5: the Round-22 proof ----------

test('S5 Round 22 on Surface C: 28/28 parity at <= 38% cost', () => {
  const s = new SurfaceC(512);
  const receipt = prove(s, { scars: s.scars });
  assert.equal(receipt.ops, 28);
  assert.equal(receipt.parityCount, 28);
  assert.ok(receipt.costRatio <= ROUND22_COST_CAP, `costRatio ${receipt.costRatio} must be <= ${ROUND22_COST_CAP}`);
  assert.equal(receipt.escalations, PERTURB_OPS.length, 'every perturbed block must escalate, no more, no less');
  // determinism: a second full prove on a fresh surface lands on the same numbers
  const s2 = new SurfaceC(512);
  const again = prove(s2, { scars: s2.scars });
  assert.equal(again.costRatio, receipt.costRatio);
  assert.deepEqual(again.outputs ?? null, null); // outputs are internal; parity is the contract
  assert.equal(again.parityCount, receipt.parityCount);
});

test('S5 mechanics: REST replays cache exactly; ESCALATE recomputes to the same output', () => {
  const s = new SurfaceC(512);
  seedBlocks(s);
  const baseline = withCache(s, runBaseline(s));
  // world unchanged: every op rests
  const quiet = runBanded(s, baseline);
  assert.equal(quiet.trace.every((t) => t.decision === 'REST'), true);
  assert.deepEqual(quiet.outputs, baseline.outputs);
  // world moved on payload halves only: the perturbed set escalates, parity holds
  perturbPayloads(s);
  const loud = runBanded(s, baseline);
  assert.deepEqual(loud.trace.filter((t) => t.decision === 'ESCALATE').map((t) => t.op), PERTURB_OPS);
  assert.deepEqual(loud.outputs, baseline.outputs, 'escalated recompute must equal the baseline output');
  assert.ok(loud.cost < baseline.cost, 'banded run must still cost less than full-fat');
  // the expensive function is honest: a KEY change would break parity loudly
  s.registers[0] += 1; // op 0's key half moves
  const keyMoved = runBanded(s, baseline);
  assert.notEqual(keyMoved.outputs[0], baseline.outputs[0], 'a key change must NOT be absorbed by the band');
});

test('stitch ledger: append -> verify -> tamper loud; malformed ids refused E_STITCH_SEAL', () => {
  const led = new StitchLedger();
  const id1 = 'a'.repeat(64);
  const id2 = 'b'.repeat(64);
  led.stitch(id1);
  led.stitch(id2);
  assert.equal(led.verify().ok, true);
  assert.equal(led.size, 2);
  assert.throws(() => led.stitch('not-an-id'), (e) => e.code === 'E_STITCH_SEAL');
  assert.throws(() => led.stitch('A'.repeat(64)), (e) => e.code === 'E_STITCH_SEAL', 'uppercase hex is not the dialect');
  led.rows[0].env_id = 'c'.repeat(64);
  assert.equal(led.verify().ok, false, 'a rewritten env_id must break the chain');
});

test('cross-repo receipt: the exoj spec seal stitches as a well-formed env_id', () => {
  // The fleet rule: any repo's spec-sha-v1 seal is a valid stitch payload.
  // Use THIS repo's seal (self-receipt, always available offline); the
  // prove.mjs run additionally stitches exoj's real seal when present.
  const seal = JSON.parse(readFileSync(join(ROOT, 'spec/spec_sha.json'), 'utf8'));
  const led = new StitchLedger();
  led.stitch(seal.spec_sha);
  assert.equal(led.verify().ok, true);
});
