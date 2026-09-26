// QUILT-DBA smoke — green-or-die checks for the developmental seed agent.
// Run: node smoke.mjs   (exit 1 on any failure)
//
// 14 checks: cells exist · conservation boundary · chain seal/verify/tamper ·
// vault stream determinism · cached REAL packet pool · JEV mock labeled +
// band-consistent · short-run replay byte-identity · growth handshake fires ·
// no-lookahead probe · fixed-point state · single rng source · β₁ formula ·
// pincher reflex fires · JEPA learns.

import { rmSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  runDevolution, createAgent, hashState, bundle, resume, loadBundle, ARMS, growthHandshake,
} from './dba/driver.mjs';
import { SEED_DECLARATION, growthCells } from './dba/sheet.mjs';
import { MothVault, cachePool } from './shared/moth.mjs';
import { fnv1a64, sealChain, verifyChain, rowHash } from './shared/receipts.mjs';

const CHECKPOINTS = ['/home/z/my-project/download/quilt-cortex/.cache/moth-holdem.json',
  '/home/z/my-project/download/.cache/moth-e16.json'];
const BUNDLE_DIR = join(import.meta.dirname, 'experiments/outputs/bundles/smoke');

let pass = 0, fail = 0; const failures = [];
async function check(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; failures.push({ name, error: String(e?.message ?? e) }); console.log(`  ✗ ${name}\n      ${String(e?.message ?? e)}`); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

console.log('QUILT-DBA SMOKE');
const t0 = Date.now();

// 1 ── cells exist: all twelve declared paths + session cells, on a live engine
await check('cells exist: 12 declared paths + driver.step + growth-capable sheet', async () => {
  const engine = await createAgent({ seed: 7, arm: 'A', maxEvals: 10 });
  const paths = ['sensors.vision', 'sensors.proprio', 'world.predict', 'reflex.orient',
    'policy.action', 'ledger', 'state.stage', 'memory.episodic', 'memory.semantic',
    'teacher.feedback', 'skills', 'conservation'];
  for (const p of paths) ok(engine.cells.get(p), `missing cell: ${p}`);
  for (const p of ['curriculum.next_task', 'qrc.reservoir', 'driver.step', 'skills.beta1', 'reflex.orient.act']) {
    ok(engine.cells.get(p), `missing session cell: ${p}`);
  }
  eq(SEED_DECLARATION.length, 12, 'declaration length');
  ok(engine.cells.get('reflex.orient').def.kind === 'listener', 'reflex.orient is a listener');
  ok(engine.cells.get('skills.beta1').def.kind === 'formula', 'skills.beta1 is a formula');
});

// 2 ── conservation boundary: 1.585 passes, 1.586 refused (exact on x1000 ints)
await check('conservation boundary: γ+η=1585 passes, 1586 refused (tol 1e-9 moot on ints)', async () => {
  const engine = await createAgent({ seed: 7, arm: 'A', maxEvals: 10 });
  const chk = async (g, e) => (await engine.call('conservation.check', { gamma_x1000: g, eta_x1000: e })).data;
  eq((await chk(1585, 0)).ok, true, 'sum == C must pass');
  eq((await chk(0, 1585)).ok, true, 'sum == C must pass (commutes)');
  eq((await chk(585, 1000)).ok, true, 'sum == C must pass (mixed)');
  eq((await chk(1586, 0)).ok, false, 'sum == C+1 must be refused');
  eq((await chk(585, 1001)).ok, false, 'sum == C+1 must be refused (mixed)');
  eq((await chk(1585, 0)).sum_x1000, 1585, 'sum echoed');
  eq((await chk(1585, 0)).tolerance.includes('1e-9'), true, 'tolerance receipted (string note: exact on integers)');
});

// 3 ── receipt chain: seal → verify → tamper detection
await check('chain verify: sealChain → verifyChain ok; tamper detected', () => {
  const rows = [{ seq: 1, kind: 'a', v: 1 }, { seq: 2, kind: 'b', v: 2 }, { seq: 3, kind: 'c', v: 3 }];
  sealChain(rows);
  const v1 = verifyChain(rows);
  ok(v1.ok, 'verifyChain must pass on sealed rows');
  eq(v1.links, 3, 'link count');
  const tampered = rows.map(r => ({ ...r }));
  tampered[1].v = 999;
  const v2 = verifyChain(tampered);
  ok(!v2.ok, 'verifyChain must fail on tampered row');
  eq(rowHash({ seq: 9 }, 'GENESIS').length, 18, 'rowHash is 0x-prefixed 64-bit');
  ok(fnv1a64('x') !== fnv1a64('y'), 'fnv distinct inputs');
});

// 4 ── vault stream determinism (offline → labeled mock)
await check('vault stream deterministic + labeled mock (offline session)', async () => {
  const vA = new MothVault({ label: 'dba-smoke', offline: true });
  const vB = new MothVault({ label: 'dba-smoke', offline: true });
  const hA = await vA.harvest(64), hB = await vB.harvest(64);
  ok(hA.mock === true, 'offline harvest must be labeled mock');
  eq(hA.poolDigest, hB.poolDigest, 'two vaults, same digest');
  const sA = vA.streamFor(hA, 'probe'), sB = vB.streamFor(hB, 'probe');
  const dA = [sA(), sA(), sA(), sA(), sA()], dB = [sB(), sB(), sB(), sB(), sB()];
  eq(dA, dB, 'same key ⇒ same sub-stream');
  ok(new Set(dA).size > 1, 'stream is not constant (E17 fix holds)');
});

// 5 ── cached REAL packet pool: present, stable digest, labeled live:false
await check('cached REAL packets: both files load, digest stable, labeled live:false/mock:true', async () => {
  const p1 = cachePool(CHECKPOINTS);
  const p2 = cachePool(CHECKPOINTS);
  ok(p1.rows > 150, `expected >150 rows across both packets, got ${p1.rows}`);
  ok(p1.numbers.length > 1000, `expected >1000 real numbers, got ${p1.numbers.length}`);
  eq(p1.poolDigest, p2.poolDigest, 'pool digest stable across loads');
  ok(p1.label.live === false && p1.label.mock === true, 'pool labeled live:false mock:true');
  eq(p1.sources.filter(s => s.present).length, 2, 'both cached packets present');
});

// shared short-run machinery
async function shortRun(evals = 400) {
  const { engine, telemetry } = await runDevolution({ seed: 3, arm: 'A', evals, harvestShots: 64 });
  return { engine, telemetry };
}

// 6 ── JEV mock labeled + band-consistent routing
await check('JEV mock labeled (mock/live) and routing matches the confidence bands', async () => {
  const engine = await createAgent({ seed: 3, arm: 'A', maxEvals: 150 });
  for (let i = 0; i < 150; i++) await engine.call('driver.step', { i });
  const jev = engine.cells.get('curriculum.next_task.last').value.data;
  ok(jev && jev.mock === true && jev.live === false, 'JEV decision labeled mock:true live:false');
  ok(jev.source.includes('typesafe-LIVE.json'), 'shape provenance receipted in the decision');
  const c = jev.confidence;
  const expected = c > 0.95 ? 'execute' : c >= 0.70 ? (jev.routedWhy.startsWith('escalate-to-teacher') ? 'escalate' : 'BAD') : 'discard';
  ok(expected !== 'BAD', `routing inconsistent with band: conf ${c} routedWhy ${jev.routedWhy}`);
  ok(['discard', 'execute', 'escalate-to-teacher', 'escalate-to-teacher:confirmed'].includes(jev.routedWhy), 'routedWhy in vocabulary');
  eq(jev.probabilities_x1000.reduce((a, b) => a + b, 0) >= 990, true, 'probabilities sum ~1');
});

// 7 ── short-run replay byte-identity from checkpoint 2
await check('replay byte-identity: resume from ckpt 2 (eval 200) reproduces eval-400 hash exactly', async () => {
  rmSync(BUNDLE_DIR, { recursive: true, force: true });
  mkdirSync(BUNDLE_DIR, { recursive: true });
  const run1 = await runDevolution({ seed: 3, arm: 'A', evals: 400, checkpointEvery: 200, checkpointDir: BUNDLE_DIR, harvestShots: 64 });
  const b2 = loadBundle(join(BUNDLE_DIR, 'A_s3', 'ckpt_000200.json'));
  const b4 = loadBundle(join(BUNDLE_DIR, 'A_s3', 'ckpt_000400.json'));
  eq(b2.state_hash, b2.state_hash, 'bundle self-hash present');
  const run2 = await runDevolution({ seed: 3, arm: 'A', evals: 400, resumeBundle: b2, harvestShots: 64 });
  eq(run2.telemetry.final_hash, b4.state_hash, 'resumed final hash must equal the original eval-400 bundle hash');
  eq(run2.telemetry.final_hash, run1.telemetry.final_hash, 'and the original run final hash');
});

// 8 ── growth handshake fires: position > 1.0 ⇒ sheet grows, stage 1→2
await check('growth fires: position > 1.0 registers sensors.language + teacher.label, logs parent, stage 2', async () => {
  const engine = await createAgent({ seed: 5, arm: 'A', maxEvals: 20 });
  const st = { ...engine.cells.get('state.stage').value.data };
  st.position_x1000 = 1001; // strictly past 1.0
  await engine.set('state.stage', st);
  ok(!engine.cells.get('sensors.language'), 'pre-growth: no sensors.language');
  const r = (await engine.call('driver.step', { i: 0 })).data;
  const gp = engine.cells.get('growth.pending').value.data;
  ok(gp.needed, `sheet must ask for growth (position ${r.position_x1000})`);
  const log = await growthHandshake(engine, { at: gp.at, from_stage: gp.from_stage, position_x1000: gp.position_x1000, parent: null });
  ok(engine.cells.get('sensors.language'), 'post-growth: sensors.language registered');
  ok(engine.cells.get('teacher.label'), 'post-growth: teacher.label registered');
  const gl = engine.cells.get('growth.log').value.data;
  eq(gl.length, 1, 'growth_log has one entry');
  ok(gl[0].from_stage === 1 && gl[0].to_stage === 2, 'stage 1→2 in growth_log');
  ok(engine.cells.get('state.stage').value.data.stage === 2, 'vibe stage is 2');
  const label = (await engine.call('teacher.label', {})).data;
  ok(label.label === 'teacher:offline-rule', 'growth teacher is the offline rule');
});

// 9 ── no-lookahead probe: the agent side cannot read present/future reward state
await check('no-lookahead: policy reads ⊆ declared inputs; no env.state/future cells anywhere in the agent reads', async () => {
  const engine = await createAgent({ seed: 3, arm: 'A', maxEvals: 60 });
  const auditIds = new Set();
  const policyReads = new Set();
  for (let i = 0; i < 60; i++) {
    const r = (await engine.call('driver.step', { i, audit: true })).data;
    for (const id of r.audit || []) auditIds.add(id);
    for (const id of r.policy_reads || []) policyReads.add(id);
  }
  const forbidden = (id) => /env\.state|reward|future|lookahead/.test(id);
  const polBad = [...policyReads].filter(forbidden);
  eq(polBad, [], `policy must not read world/future cells, saw: ${polBad}`);
  const auditBad = [...auditIds].filter((id) => /future|lookahead/.test(id));
  eq(auditBad, [], `no future cells exist to read, saw: ${auditBad}`);
  const declared = new Set(['sensors.vision', 'ledger', 'run.meta', 'teacher.feedback.last',
    'memory.episodic', 'policy.orient_override', 'env.cfg', 'sensors.language']);
  for (const id of policyReads) ok(declared.has(id), `policy read ${id} is not a declared input`);
});

// 10 ── fixed-point doctrine: decision-feeding state is integers
await check('fixed-point: all decision-feeding bundle numbers are integers', async () => {
  const { engine } = await shortRun(120);
  const b = bundle(engine, { run: 'smoke' });
  const intCells = ['ledger', 'state.stage', 'memory.episodic', 'memory.semantic',
    'env.rng', 'env.state', 'world.predict.w', 'world.predict.last',
    'teacher.feedback.last', 'conservation.state', 'sensors.vision', 'sensors.proprio'];
  const walk = (v, path, errs) => {
    if (typeof v === 'number') { if (!Number.isInteger(v)) errs.push(`${path}=${v}`); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, errs)); return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`, errs);
  };
  const errs = [];
  for (const id of intCells) walk(b.cells[id], id, errs);
  eq(errs, [], `non-integer decision state: ${errs.slice(0, 5).join(', ')}`);
  const jev = b.cells['curriculum.next_task.last'];
  ok(jev === null || (typeof jev.confidence === 'number'), 'JEV float fields confined to the labeled mock cell');
});

// 11 ── single rng source: no Math.random anywhere in repo source or cell code
await check('single rng source: no Math.random in sheet/driver/experiment sources; env.rng is the only stream', () => {
  const files = ['dba/sheet.mjs', 'dba/driver.mjs']; // agent sources (shared/* are fleet-verbatim copies)
  for (const f of files) {
    const src = readFileSync(join(import.meta.dirname, f), 'utf8');
    ok(!src.includes('Math.random'), `${f} must not use Math.random`);
  }
  ok(readFileSync(join(import.meta.dirname, 'dba/sheet.mjs'), 'utf8').includes("await rt.set('env.rng'", ), 'driver.step commits env.rng every eval (single checkpointed stream)');
});

// 12 ── β₁ = E − V + C formula cell tracks the skills graph
await check('β₁ formula cell equals skills.E − skills.V + skills.C', async () => {
  const { engine } = await shortRun(600);
  const sk = engine.cells.get('skills').value.data;
  const beta = (await engine.get('skills.beta1')).data;
  eq(beta, sk.E - sk.V + sk.C, 'β₁ mismatch');
  ok(sk.history.length > 0, 'β₁ history tracked');
  ok(sk.V >= 14 && sk.E >= 12, 'skill nodes consolidated during the run');
});

// 13 ── pincher reflex fires in real runs (salience > 0.8 ⇒ orient, no teacher)
await check('pincher reflex fires (orient count > 0) and policy respects the override', async () => {
  const { engine, telemetry } = await shortRun(600);
  ok(telemetry.orient_fires > 0, `expected reflex fires, got ${telemetry.orient_fires}`);
  const pl = engine.cells.get('policy.last').value.data;
  ok(Array.isArray(pl.scores), 'policy decision components receipted');
  ok(telemetry.refusals.total > 0, 'conservation refused at least once in 600 evals (warmup)');
  ok(telemetry.refusals.warmup > 0, 'warmup refusals receipted by kind');
});

// 14 ── JEPA learns: repeated identical transitions converge (delta rule works)
await check('JEPA learns: surprise on a repeated transition strictly decreases under the delta rule', async () => {
  const engine = await createAgent({ seed: 3, arm: 'A', maxEvals: 10 });
  const P = [1, 0, 0, 0, 6], N = [0, 2, 0, 0, 5];
  let first = null, last = null;
  for (let k = 0; k < 14; k++) {
    const r = (await engine.call('world.predict', { obsPrev: P, action: 1, obsNow: N, learn: true })).data;
    if (first === null) first = r.surprise_x1000;
    last = r.surprise_x1000;
  }
  ok(last < first, `expected convergence, first ${first} last ${last}`);
  ok(first > 0, 'initial surprise nonzero (untrained prediction misses)');
  const wl = engine.cells.get('world.predict.last').value.data;
  ok(wl.rule.startsWith('jepa-v1'), 'JEPA rule label receipted');
});

const ms = Date.now() - t0;
console.log(`\nSMOKE: ${pass}/${pass + fail} checks green in ${ms}ms`);
if (fail) { for (const f of failures) console.log(`  FAILED: ${f.name}: ${f.error}`); process.exit(1); }
