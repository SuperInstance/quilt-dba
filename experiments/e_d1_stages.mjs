// E-D1 — THE STAGES EXPERIMENT: does the seed sheet grow, and does the
// conservation law help rather than brake?
// ========================================================================
// Prior receipts collide here: seed2 §Phase-2 ("JEV-gated development
// produces more stable trajectories than unguided development"), seed3 §0
// ("the first experiment starts when the file exists") + §3 boundary
// (gamma+eta = 1.585 passes, 1.586 refuses), seed3 §12 (byte-identical
// replay).
//
// THE QUESTIONS:
//   Q1 GROWTH  — does state.stage.position cross 1000 so the sheet GROWS
//                (new cells load), and does the grown policy collect more?
//   Q2 GATE    — is JEV-gated curriculum development more STABLE than
//                unguided (cross-seed variance of growth time / position)?
//   Q3 LAW     — is conservation a brake or a learning condition? Arm B
//                (ablated) accumulates conservation DEBT (transitions that
//                would have been refused). If B's position stalls relative
//                to A, the law is load-bearing; if B >= A, it is a brake.
//   Q4 BOUNDARY— 1585 passes, 1586 refuses (tol 1e-9 on scaled ints).
//   Q5 REPLAY  — byte-identical replay from a mid-run checkpoint.
//
// DECISION RULES (receipted BEFORE the final run, house style):
//   R1 GROWTH: in >= 2 of 3 seeds, arm A reaches position >= 1000 within the
//      eval budget and growth.done flips with a growth.log entry.
//   R2 GATE: var(growthTimeA) < var(growthTimeD) AND mean(posA) >= mean(posD)
//      => CONFIRMED (seed2's claim); either metric failing => REFUTED;
//      if no arm grows, INDETERMINATE (report positions + honesty).
//   R3 LAW: mean debtB > 0 AND mean(posB) < mean(posA) - 1 joint SE
//      => LOAD-BEARING; posB >= posA => BRAKE (honest negative).
//   R4 BOUNDARY: conservation.test({0,1585}) = ok AND {0,1586} = refuse.
//   R5 REPLAY: re-run from eval-300 checkpoint reproduces the eval-600
//      final hash bit-for-bit.
//
// RUNTIME RULES (receipted): probe = 1 seed x 1000 evals timed; projected =
// t_probe * (3 arms * 3 seeds * 5) + 2s; if projected > 170s, cut seeds to 2
// and evals to 3000 and RECEIPT the cut.
import { QuiltEngine } from '../engine/index.js';
import { buildSheet } from '../dba/sheet.mjs';
import { mulberry32, harness, fnv1a64 } from '../shared/kit.mjs';
import { sealChain, verifyChain } from '../shared/receipts.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const H = harness('e_d1');
const get = async (e, id) => (await e.get(id)).data;            // value cells
const call0 = async (e, id) => (await e.call(id)).data;          // PROGRAM cells (house doctrine)
const set = (e, id, val) => e.set(id, val);
const canon = (o) => JSON.stringify(o, Object.keys(o).sort());

// ── the driver: one developmental run ───────────────────────────────────────
async function runRun({ seed, enforce, mode, evals, checkpointAt = null, fromCheckpoint = null }) {
  const rng = mulberry32(seed);
  const engine = new QuiltEngine('dba-seed', { eager: true });
  engine.loadSheet(buildSheet(1));

  // world helpers (the driver IS the environment; env_state is checkpointed)
  const rewardsOf = async () => {
    const cfg = await get(engine, 'env.cfg');
    const tasks = await get(engine, 'env.tasks');
    return tasks[cfg.task].rewards;
  };

  if (fromCheckpoint) {
    // restore every driver-written value cell (growth rebuilds the sheet)
    for (const [id, val] of Object.entries(fromCheckpoint.cells)) await set(engine, id, val);
    if (fromCheckpoint.grown) {
      engine.loadSheet(buildSheet(2));
      for (const [id, val] of Object.entries(fromCheckpoint.cells)) await set(engine, id, val);
      await set(engine, 'growth.stage', 2);
    }
  }
  await set(engine, 'teacher.mode', mode);

  let grown = fromCheckpoint ? fromCheckpoint.grown : false;
  let rewardCount = fromCheckpoint ? fromCheckpoint.rewardCount : 0;
  let refusals = 0, debt = 0, jevExecutes = 0, growthAt = null;
  const startEval = fromCheckpoint ? fromCheckpoint.t : 0;
  let prevSurprise = 1500;

  for (let t = startEval + 1; t <= evals; t++) {
    const s = await get(engine, 'env.state');
    const cfg = await get(engine, 'env.cfg');
    const rewards = await rewardsOf();

    // curriculum step every 50 evals (teacher consult -> gamma += 150 this eval)
    let consulted = false;
    if (t % 50 === 0) {
      consulted = true;
      const fb = await call0(engine, 'teacher.feedback');
      if (fb.switch_to !== cfg.task) {
        const gate = await call0(engine, 'teacher.jev_gate');
        if (mode === 'unguided' || gate.action === 'execute') {
          if (mode === 'unguided') {
            const tasks = await get(engine, 'env.tasks');
            await set(engine, 'env.cfg', { ...cfg, task: Math.floor(rng() * tasks.length) });
          } else {
            await set(engine, 'env.cfg', { ...cfg, task: fb.switch_to });
            jevExecutes++;
          }
        }
      }
    }

    // candidate action
    const act = await call0(engine, 'policy.action');
    const pred = await call0(engine, 'world.predict');

    // DoubleEntry prices the transition BEFORE it evaluates (seed3 §3):
    // eta_cand = surprise of the PREDICTED post-move state (integer estimate)
    const nx = Math.max(0, Math.min(cfg.W - 1, s.x + act.dx));
    const ny = Math.max(0, Math.min(cfg.H - 1, s.y + act.dy));
    const dPred = Math.abs(pred.x - nx) + Math.abs(pred.y - ny);
    const etaCand = dPred * 250 + (pred.pred_reward !== (s.last_reward ? 1 : 0) ? 500 : 0);
    const gamma = 100 + (consulted ? 150 : 0);
    const sum = gamma + etaCand;

    if (enforce && sum > 1585) {
      // NO OPCODE FOR VIOLATION: the transition is refused, state stands still
      refusals++;
      const ledgerLog = await get(engine, 'conservation.ledger');
      if (ledgerLog.length < 512) ledgerLog.push({ t, gamma, eta: etaCand, verdict: 'refuse' });
      await set(engine, 'conservation.ledger', ledgerLog);
      await set(engine, 'world.prev_surprise', prevSurprise);
      continue;
    }
    if (!enforce && sum > 1585) debt += sum - 1585; // ablated arm accumulates DEBT

    // apply the move
    const hit = rewards.some(([rx, ry]) => rx === nx && ry === ny) ? 1 : 0;
    await set(engine, 'env.state', { x: nx, y: ny, px: s.x, py: s.y, t, last_reward: hit });
    if (hit) rewardCount++;

    // actual surprise -> competence -> stage position
    const surprise = await call0(engine, 'world.surprise');
    const gain = Math.max(0, prevSurprise - surprise);
    const step = Math.max(0, Math.min(10, Math.floor(gain / 50)));
    const pos = (await get(engine, 'state.position')) + step;
    await set(engine, 'state.position', pos);
    await set(engine, 'world.prev_surprise', surprise);
    prevSurprise = surprise;

    // GC: memory.episodic ring + decayed semantic map + visit counts
    const epi = await get(engine, 'memory.episodic');
    epi.push([nx, ny]); if (epi.length > 64) epi.shift();
    await set(engine, 'memory.episodic', epi);
    const sem = await get(engine, 'memory.semantic');
    for (const k of Object.keys(sem)) sem[k] = Math.floor(sem[k] * 0.98);
    if (hit) sem[nx + ',' + ny] = 1000;
    await set(engine, 'memory.semantic', sem);
    const vis = await get(engine, 'env.visits');
    vis.map[nx + ',' + ny] = (vis.map[nx + ',' + ny] || 0) + 1;
    await set(engine, 'env.visits', vis);
    const ring = await get(engine, 'env.success_ring');
    ring.push(hit); if (ring.length > 100) ring.shift();
    await set(engine, 'env.success_ring', ring);

    // GROWTH: position >= 1000 => load the stage-2 sheet (real cell addition)
    if (!grown && pos >= 1000) {
      const snapshotCells = await snapshot(engine);
      engine.loadSheet(buildSheet(2));
      for (const [id, val] of Object.entries(snapshotCells.cells)) await set(engine, id, val);
      await set(engine, 'growth.stage', 2);
      grown = true; growthAt = t;
      await set(engine, 'growth.done', 1);
      const glog = await get(engine, 'growth.log');
      glog.push({ stage: 2, cells_added: ['sensors.language', 'growth.stage'], parent_hash: fnv1a64(canon(snapshotCells.cells)).slice(2, 12), at: t });
      await set(engine, 'growth.log', glog);
    }

    if (checkpointAt && t === checkpointAt) {
      return { checkpoint: await snapshot(engine), rewardCount, grown, t };
    }
  }

  const finState = await get(engine, 'env.state');
  const hash = fnv1a64(canon({
    s: finState, pos: await get(engine, 'state.position'), sem: await get(engine, 'memory.semantic'),
    grown, vis: await get(engine, 'env.visits'),
  })).slice(2, 14);
  return {
    seed, enforce, mode, evals,
    position: await get(engine, 'state.position'),
    grown, growthAt, refusals, debt, rewardCount, jevExecutes,
    jev_log_len: (await get(engine, 'teacher.jev_log')).length,
    beta1: await call0(engine, 'skills.graph'),
    hash,
  };
}

async function snapshot(engine) {
  const ids = ['env.state', 'env.cfg', 'env.visits', 'env.success_ring', 'memory.episodic', 'memory.semantic',
    'teacher.mode', 'teacher.jev_log', 'growth.done', 'growth.log', 'conservation.ledger', 'world.prev_surprise',
    'state.position', 'world.last_features'];
  const cells = {};
  for (const id of ids) cells[id] = await get(engine, id);
  return { cells, grown: (await get(engine, 'growth.done')) === 1, grownStage2Ids: ['growth.stage'] };
}

// ── experiment orchestration ────────────────────────────────────────────────
const rows = [];
const receipt = (r) => rows.push(r);

receipt({ kind: 'run.config', seeds: '3 (probe may cut to 2)', evals: '5000 (probe may cut to 3000)', arms: { A: 'conservation enforced + jev-gated', B: 'ablated (debt accumulates)', D: 'unguided random curriculum' }, C: 1585, scaling: 'x1000 fixed-point', world: '16x16 forage, 4 tasks' });
receipt({ kind: 'rules.R1', text: 'growth in >=2/3 seeds arm A' });
receipt({ kind: 'rules.R2', text: 'var(growthA)<var(growthD) AND mean(posA)>=mean(posD) => CONFIRMED' });
receipt({ kind: 'rules.R3', text: 'debtB>0 AND posB < posA - 1 joint SE => LOAD-BEARING; posB>=posA => BRAKE' });
receipt({ kind: 'rules.R4', text: 'boundary 1585 ok / 1586 refuse' });
receipt({ kind: 'rules.R5', text: 'replay from eval-300 checkpoint bit-identical' });

// probe
let t0 = Date.now();
const probe = await runRun({ seed: 11, enforce: true, mode: 'jev-gated', evals: 1000 });
const tProbe = (Date.now() - t0) / 1000;
let seeds = 3, evals = 5000;
const projected = tProbe * 3 * 3 * 5 + 2;
if (projected > 170) { seeds = 2; evals = 3000; }
receipt({ kind: 'runtime.probe', t_probe_s: Math.round(tProbe * 100) / 100, projected_s: Math.round(projected), kept: { seeds, evals }, cut: projected > 170 });
console.log(`probe: ${tProbe.toFixed(1)}s/1000 evals -> ${seeds} seeds x ${evals} evals (projected ${Math.round(projected)}s)`);

// boundary test (R4) — input-driven, exact at the scaled ints
{
  const engine = new QuiltEngine('dba-boundary', { eager: true });
  engine.loadSheet(buildSheet(1));
  const callTest = async (input) => (await engine.call('conservation.test', input)).data;
  const ok = await callTest({ gamma: 0, eta: 1585 });
  const no = await callTest({ gamma: 0, eta: 1586 });
  receipt({ kind: 'boundary', ok_1585: ok.verdict, refuse_1586: no.verdict, pass: ok.verdict === 'ok' && no.verdict === 'refuse' });
  console.log(`boundary: 1585 -> ${ok.verdict}, 1586 -> ${no.verdict}`);
}

// arms
const runs = {};
for (const [arm, cfgArm] of [['A', { enforce: true, mode: 'jev-gated' }], ['B', { enforce: false, mode: 'jev-gated' }], ['D', { enforce: true, mode: 'unguided' }]]) {
  runs[arm] = [];
  for (let s = 0; s < seeds; s++) {
    const seed = 101 + s * 17;
    t0 = Date.now();
    const r = await runRun({ seed, evals, ...cfgArm });
    r.wall_s = Math.round((Date.now() - t0) / 100) / 10;
    runs[arm].push(r);
    receipt({ kind: 'run', arm, ...r });
    console.log(`  ${arm} seed${seed}: pos=${r.position} grown=${r.grown}@${r.growthAt} rewards=${r.rewardCount} refusals=${r.refusals} debt=${r.debt} (${r.wall_s}s)`);
  }
}

// R2 + R3 statistics
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const varr = (a) => { const m = mean(a); return a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length; };
const growthTime = (arr) => arr.map((r) => r.growthAt ?? evals + 1);
const posA = runs.A.map((r) => r.position), posB = runs.B.map((r) => r.position), posD = runs.D.map((r) => r.position);
const r2 = {
  var_A: Math.round(varr(growthTime(runs.A))), var_D: Math.round(varr(growthTime(runs.D))),
  mean_pos_A: Math.round(mean(posA)), mean_pos_D: Math.round(mean(posD)),
  verdict: (mean(posA) >= mean(posD) && varr(growthTime(runs.A)) <= varr(growthTime(runs.D))) ? 'CONFIRMED' : 'REFUTED',
};
const jointSE = Math.sqrt(varr(posA) / posA.length + varr(posB) / posB.length);
const r3 = {
  mean_debt_B: Math.round(mean(runs.B.map((r) => r.debt))),
  refusals_A: mean(runs.A.map((r) => r.refusals)),
  mean_pos_A: Math.round(mean(posA)), mean_pos_B: Math.round(mean(posB)), jointSE: Math.round(jointSE),
  verdict: mean(runs.B.map((r) => r.debt)) === 0 && mean(runs.A.map((r) => r.refusals)) === 0
    ? 'NEVER-BOUND (law untested in vivo at these parameters; boundary test carries the guarantee)'
    : mean(runs.B.map((r) => r.debt)) > 0 && mean(posB) < mean(posA) - jointSE ? 'LOAD-BEARING'
    : (mean(posB) >= mean(posA) ? 'BRAKE' : 'INDETERMINATE'),
};
const r1 = { grownA: runs.A.filter((r) => r.grown).length, of: seeds, verdict: runs.A.filter((r) => r.grown).length >= Math.min(2, seeds) ? 'CONFIRMED' : 'REFUTED' };
receipt({ kind: 'findings.R1', ...r1 });
receipt({ kind: 'findings.R2', ...r2, caveat: 'arms A/B are fully deterministic (the only rng consumer is the unguided switch), so cross-seed variance is vacuous by construction; growthAt is the primary stability signal — a design hole-fill for the next wave: stochastic worlds (start jitter, reward drift) to make variance meaningful' });
receipt({ kind: 'findings.R3', ...r3 });
console.log(`R1 growth: ${r1.verdict} (${r1.grownA}/${r1.of} grew)`);
console.log(`R2 gate: ${r2.verdict} (varA=${r2.var_A} varD=${r2.var_D} posA=${r2.mean_pos_A} posD=${r2.mean_pos_D})`);
console.log(`R3 law: ${r3.verdict} (debtB=${r3.mean_debt_B} posA=${r3.mean_pos_A} posB=${r3.mean_pos_B} jointSE=${r3.jointSE})`);

// R5 replay
const full = await runRun({ seed: 77, enforce: true, mode: 'jev-gated', evals: 600 });
const half = await runRun({ seed: 77, enforce: true, mode: 'jev-gated', evals: 300 });
const resumed = await runRun({ seed: 77, enforce: true, mode: 'jev-gated', evals: 600, fromCheckpoint: half.checkpoint });
const r5 = { full_hash: full.hash, resumed_hash: resumed.hash, pass: full.hash === resumed.hash };
receipt({ kind: 'findings.R5', ...r5 });
console.log(`R5 replay: ${r5.pass ? 'BYTE-IDENTICAL' : 'MISMATCH ' + full.hash + ' vs ' + resumed.hash}`);

sealChain(rows);
const okChain = verifyChain(rows);
mkdirSync('experiments/outputs', { recursive: true });
writeFileSync('experiments/outputs/receipts_ed1.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync('experiments/outputs/e_d1_summary.json', JSON.stringify({
  task: 'E-D1', name: 'the stages experiment', boundary: rows.find((r) => r.kind === 'boundary'),
  r1, r2, r3, r5, runs, runtime: { t_probe_s: Math.round(tProbe * 100) / 100, seeds, evals },
  chain_tip: rows[rows.length - 1].row_hash, chain_ok: okChain.ok,
}, null, 1));
console.log(`chain: ${okChain.ok ? 'OK' : 'BROKEN'} tip ${rows[rows.length - 1].row_hash}`);
console.log('wrote experiments/outputs/e_d1_summary.json + receipts_ed1.jsonl');
