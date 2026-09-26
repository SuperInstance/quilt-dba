// QUILT-DBA driver script — runs the developmental loop against the sheet.
//
// The world driver is a PROGRAM CELL (driver.step, see dba/sheet.mjs); this
// script is the hand that cranks it: create engine, load sheet, call
// driver.step N times, register growth cells when the sheet grows, write
// checkpoint bundles every 1000 evaluations (git commit per checkpoint for
// the canonical run), hash state, and resume from bundles for replay.
//
// ALL agent logic lives in the sheet's cells. The script only:
//   1. instantiates the engine + sheet,
//   2. cranks driver.step,
//   3. performs the growth handshake (engine.register — outside program-cell
//      reach by engine design: boundRuntime = {get,set,call} only),
//   4. checkpoints / restores / hashes.

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { QuiltEngine } from '../engine/index.js';
import { buildSheet, growthCells, TASKS } from './sheet.mjs';
import { fnv1a64, sealChain, verifyChain, rowHash } from '../shared/receipts.mjs';

// ── canonical deep JSON (sorted keys, arrays in order) ───────────────────────
export function canonDeep(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canonDeep).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonDeep(v[k])).join(',') + '}';
}

// cells that constitute the complete agent+world state (checkpoint bundle)
export const STATE_IDS = [
  'run.meta', 'env.cfg', 'env.state', 'env.rng',
  'sensors.vision', 'sensors.proprio', 'sensors.history', 'sensors.language',
  'world.predict.w', 'world.predict.last',
  'policy.orient_override', 'policy.last',
  'ledger', 'state.stage', 'memory.episodic', 'memory.semantic',
  'teacher.feedback.last', 'curriculum.next_task.last', 'curriculum.history',
  'qrc.state', 'qrc.features', 'skills', 'conservation.state',
  'growth.pending', 'growth.flag', 'growth.log',
];

export const ARMS = {
  A: { jevGated: true, conservationEnforced: true, curiosityThrottled: true, label: 'conservation enforced (C=1.585), JEV-gated curriculum' },
  B: { jevGated: true, conservationEnforced: false, curiosityThrottled: false, label: 'conservation ablated: no refusal, no curiosity throttle' },
  D: { jevGated: false, conservationEnforced: true, curiosityThrottled: true, label: 'JEV gate off: unguided random task selection, conservation enforced' },
};

export async function createAgent({ seed, arm, maxEvals, cachePaths = [], harvestShots = 256 }) {
  const cfgArm = ARMS[arm];
  const engine = new QuiltEngine(`quilt-dba-${arm}-${seed}`, { eager: true });
  engine.loadSheet({ cells: await buildSheet({ cachePaths, harvestShots }) });
  await engine.set('run.meta', { seed, arm, evalIndex: 0, maxEvals, ...cfgArm, armLabel: cfgArm.label });
  // seed the single world rng (mulberry32 state) deterministically from the seed
  await engine.set('env.rng', { a: (seed * 2654435761 ^ 0x9e3779b9) >>> 0 });
  // place the first task's rewards
  await seedWorld(engine, seed);
  return engine;
}

async function seedWorld(engine, seed) {
  const cfg = (await engine.get('env.cfg')).data;
  const task = 0; // forage-static opener for every arm/seed (curriculum decides after)
  const a0 = (seed * 2654435761 ^ 0x9e3779b9) >>> 0;
  let ra = a0;
  const rnd = () => { ra = (ra + 0x6D2B79F5) | 0; let t = Math.imul(ra ^ (ra >>> 15), 1 | ra); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const walls = cfg.tasks[task].walls;
  const blocked = (x, y) => (x < 0 || y < 0 || x >= cfg.size || y >= cfg.size) || walls.some(w => w[0] === x && w[1] === y);
  const rewards = [];
  let guard = 0;
  while (rewards.length < cfg.tasks[task].nReward && guard++ < 800) {
    const x = Math.floor(rnd() * cfg.size), y = Math.floor(rnd() * cfg.size);
    if (blocked(x, y) || (x === 8 && y === 8)) continue;
    if (rewards.some(r => r[0] === x && r[1] === y)) continue;
    rewards.push([x, y]);
  }
  await engine.set('env.state', { task, x: 8, y: 8, rewards, drifts: 0, eaten: 0, respawns: 0, switches: 0, tenure: 0 });
}

export function hashState(engine) {
  const snap = {};
  for (const id of STATE_IDS) snap[id] = (engine.cells.get(id)?.value?.data) ?? null;
  return fnv1a64(canonDeep(snap));
}

export function bundle(engine, meta = {}) {
  const cells = {};
  for (const id of STATE_IDS) cells[id] = (engine.cells.get(id)?.value?.data) ?? null;
  return { version: 1, repo: 'quilt-dba', kind: 'developmental-checkpoint', ...meta, cells, state_hash: fnv1a64(canonDeep(cells)) };
}

export async function resume(engine, b) {
  for (const id of STATE_IDS) {
    if (b.cells[id] !== undefined && b.cells[id] !== null) await engine.set(id, b.cells[id]);
  }
  // re-register any growth cells the resumed run had already grown
  for (const g of (b.cells['growth.log'] || [])) {
    if (!engine.cells.get('sensors.language')) for (const def of growthCells()) engine.register(def);
    await engine.set('growth.flag', { languageWired: true });
  }
}

// ── GROWTH HANDSHAKE (production path, shared with smoke) ───────────────────
// The sheet asks (growth.pending), the script registers. Registration is
// outside program-cell reach by engine design (boundRuntime = {get,set,call}).
export async function growthHandshake(engine, { at, from_stage = 1, position_x1000 = null, parent = null } = {}) {
  for (const def of growthCells()) engine.register(def);
  await engine.set('growth.flag', { languageWired: true });
  await engine.set('growth.pending', { needed: false, at, from_stage, handled: true });
  const log = { at_eval: at, from_stage, to_stage: 2, cells: ['sensors.language', 'teacher.label'], parent_commit: parent, position_x1000 };
  const gl = (engine.cells.get('growth.log').value.data).slice();
  gl.push(log);
  await engine.set('growth.log', gl);
  const st = { ...(engine.cells.get('state.stage').value.data) };
  st.stage = 2; st.crossed_at = at;
  await engine.set('state.stage', st);
  return log;
}

function git(root, cmd) { return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim(); }

// ── THE DEVELOPMENTAL RUN ────────────────────────────────────────────────────
export async function runDevolution({
  seed, arm, evals, checkpointEvery = 1000,
  checkpointDir = null, gitCommits = false, repoRoot = null,
  resumeBundle = null, harvestShots = 256, cachePaths = [],
  growthReceipt = null, // async (info) => row | null — called when the sheet grows
}) {
  const t0 = Date.now();
  const engine = await createAgent({ seed, arm, maxEvals: evals, cachePaths, harvestShots });
  let startEval = 0;
  if (resumeBundle) { await resume(engine, resumeBundle); startEval = resumeBundle.cells['run.meta'].evalIndex; }

  const telemetry = {
    seed, arm, evals, startEval,
    crossed: false, crossed_at: null, stage_final: 1,
    refusals: { total: 0, warmup: 0, post_switch: 0, steady: 0, other: 0, ablated_would_refuse: 0 },
    surprises: { max: 0, nan: false }, wall_clip: false, pos_overflow: false,
    rewards: 0, switches: 0, drifts: 0, orient_fires: 0,
    checkpoints: [], growth_at: null, growth_parent_commit: null,
  };

  for (let i = startEval; i < evals; i++) {
    const r = (await engine.call('driver.step', { i })).data;
    if (!r || r.eta_x1000 === undefined) throw new Error(`driver.step returned no receipt at eval ${i}`);
    // ── growth handshake: the sheet asks, the script registers ──
    const gp = (engine.cells.get('growth.pending').value.data);
    if (gp.needed && !telemetry.crossed) {
      telemetry.crossed = true; telemetry.crossed_at = gp.at;
      let parent = null;
      if (gitCommits && repoRoot) { try { parent = git(repoRoot, 'git rev-parse HEAD'); } catch { parent = null; } }
      telemetry.growth_parent_commit = parent;
      const log = await growthHandshake(engine, { at: gp.at, from_stage: gp.from_stage, position_x1000: gp.position_x1000, parent });
      telemetry.growth_at = gp.at;
      if (growthReceipt) await growthReceipt({ ...log, seed, arm });
    }
    // ── telemetry ──
    const cs = engine.cells.get('conservation.state').value.data;
    if (cs.refusals_total !== telemetry.refusals.total) {
      const last = cs.refusal_log[cs.refusal_log.length - 1];
      telemetry.refusals.total = cs.refusals_total;
      if (last) {
        const k = last.kind === 'post-switch' ? 'post_switch' : ['warmup', 'steady'].includes(last.kind) ? last.kind : 'other';
        telemetry.refusals[k]++;
      }
    }
    telemetry.refusals.ablated_would_refuse = cs.by_kind.ablated_would_refuse || 0;
    if (r.eta_x1000 > telemetry.surprises.max) telemetry.surprises.max = r.eta_x1000;
    if (!Number.isFinite(r.eta_x1000) || !Number.isFinite(r.position_x1000)) telemetry.surprises.nan = true;
    if (r.position_x1000 > 10_000_000) telemetry.pos_overflow = true;
    if (r.orient) telemetry.orient_fires++;
    telemetry.rewards = r.ate ? telemetry.rewards + 1 : telemetry.rewards;
    if (r.switchEvent) telemetry.switches++;
    if (r.driftEvent) telemetry.drifts++;
    if (r.policy_reads) telemetry.last_policy_reads = r.policy_reads;
    // ── checkpoint ──
    if ((i + 1) % checkpointEvery === 0 || i === evals - 1) {
      const n = i + 1;
      const meta = { run: `${arm}_s${seed}`, eval_index: n, of: evals, state_hash_at_ckpt: hashState(engine) };
      const b = bundle(engine, meta);
      if (checkpointDir) {
        const dir = join(checkpointDir, `${arm}_s${seed}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `ckpt_${String(n).padStart(6, '0')}.json`), JSON.stringify(b));
        if (gitCommits && repoRoot) {
          try {
            git(repoRoot, `git add checkpoints/${arm}_s${seed}/ckpt_${String(n).padStart(6, '0')}.json`);
            git(repoRoot, `git commit -q -m "ckpt ${arm}/s${seed} eval ${n}/${evals}: stage ${r.stage} pos ${(r.position_x1000 / 1000).toFixed(3)} eta ${r.eta_x1000} refusals ${telemetry.refusals.total} hash ${meta.state_hash_at_ckpt.slice(0, 12)}" --allow-empty -- 'checkpoints/${arm}_s${seed}/ckpt_${String(n).padStart(6, '0')}.json'`);
            telemetry.checkpoints.push({ eval: n, committed: true, hash: meta.state_hash_at_ckpt });
          } catch (e) {
            telemetry.checkpoints.push({ eval: n, committed: false, why: String(e.message).slice(0, 80) });
          }
        } else {
          telemetry.checkpoints.push({ eval: n, committed: false, file: true });
        }
      } else {
        telemetry.checkpoints.push({ eval: n, committed: false, in_memory: true, hash: meta.state_hash_at_ckpt });
      }
    }
  }
  telemetry.stage_final = engine.cells.get('state.stage').value.data.stage;
  telemetry.final_hash = hashState(engine);
  telemetry.ms = Date.now() - t0;
  telemetry.eval_index_final = engine.cells.get('run.meta').value.data.evalIndex;
  return { engine, telemetry, bundle: bundle(engine, { run: `${arm}_s${seed}`, eval_index: evals, of: evals, state_hash_at_ckpt: telemetry.final_hash }) };
}

export function loadBundle(path) { return JSON.parse(readFileSync(path, 'utf8')); }
export { TASKS };
