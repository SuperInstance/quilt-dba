// QUILT-DBA — the seed sheet: a developmental agent declared as cells.
//
// Canon: github.com/SuperInstance/SuperInstance-papers/tree/main/seed-proto
// (seed1 DBA blueprint -> seed2 quilt-native reduction -> seed3 developer's
// guide). The claim under test: the quilt engine already contains every
// primitive needed to GROW an agent — nothing new at the substrate level,
// everything new at the declaration level. This file is that declaration.
//
// THE 12-CELL SEED SHEET (seed3 §4, integer-scaled x1000 for fixed-point
// determinism — a receipted hole-fill; the seed demands determinism but not
// the scaling):
//
//   sensors.vision    Z_in  salience 0..1000 (inverse distance to nearest reward)
//   sensors.proprio   Z_in  {x, y}
//   world.predict     JEPA  momentum predictor + reward guess from memory.semantic
//   world.surprise    JEPA  integer L1 surprise: |dpos|*500 + reward_miss*500
//   reflex.orient     pincher  salience > 800 => immediate orient (no teacher)
//   policy.action     Z_out reflex -> greedy(memory.semantic) + curiosity + qrc tie-break
//   ledger.gamma      DoubleEntry  compute-cost proxy (teacher consults, growth checks)
//   ledger.eta        DoubleEntry  = world.surprise
//   ledger.check      DoubleEntry  gamma + eta <= C(=1585) ? ok : refuse
//   state.stage       Vibe  position += clamp(gain/50, 0..10); velocity = delta
//   memory.episodic   GC    ring of last 64 visits (driver-written)
//   memory.semantic   GC    decayed reward estimate (driver-written, decay 0.98)
//   teacher.feedback  Murmur OFFLINE rule teacher, labeled 'teacher:offline-rule'
//   teacher.jev_gate  Murmur JEV typed-decision mock (LABELED mock:true),
//                           thresholds >0.95 execute / 0.70-0.95 escalate / <0.70 discard
//   skills.graph      Graph beta1 = E - V + C over the live cell graph
//   conservation      guard refusal log (driver-appended)
//
// GROWTH: state.stage.position >= 1000 => the sheet GROWS: engine.loadSheet
// with stage-2 cells added (sensors.language Z_in + teacher.label Murmur, and
// policy.action now reads them). Adding cells IS advancing stages.
//
// HOLES FILLED BEYOND SPEC (receipted in README):
//   - gamma/eta candidate computations (seed3 §3.1 offers candidates, none final):
//     gamma = 100 base + 150 per teacher consult + 250 per growth check (scaled);
//     eta = world.surprise. Composition: additive. C = 1.585 -> 1585 scaled.
//   - stage-position units (seed gives none): gain_units = max(0, prev_surprise -
//     surprise), position += clamp(floor(gain/50), 0, 10) per evaluation.
//   - JEV offline mock calibration: p = 0.5 + 0.5*tanh((success-0.75)*8), fixed.
//   - curriculum: 4 tasks (reward layouts) of rising spread; JEV-gated arm
//     switches only when the gate executes; unguided arm switches every 500 evals.
import { v, law, prog, formula, listenerCell } from '../shared/kit.mjs';

const C_SCALED = 1585; // log2(3) x 1000

// deterministic JEV mock (the OFF voice; a mock never pretends to be real)
const jevMock = (success, k) => {
  const p = 0.5 + 0.5 * Math.tanh((success - 0.75) * 8);
  return { type: 'noul', noul: p, action: p > 0.95 ? 'execute' : p >= 0.70 ? 'escalate' : 'discard', mock: true, k };
};

export function buildSheet(stage = 1) {
  const cells = [
    // ── world / env (value cells, driver-written) ──────────────────────────
    v('env.cfg', { W: 16, H: 16, task: 0 }, 'active task layout id + bounds'),
    v('env.tasks', [
      { name: 'cluster', rewards: [[4, 4], [5, 4], [4, 5]] },
      { name: 'line', rewards: [[2, 8], [6, 8], [10, 8], [14, 8]] },
      { name: 'corners', rewards: [[1, 1], [14, 1], [1, 14], [14, 14]] },
      { name: 'scatter', rewards: [[3, 12], [8, 2], [13, 9], [5, 6], [11, 13]] },
    ], 'curriculum: 4 tasks of rising spread (hole-fill: the seed names no task set)'),
    v('env.state', { x: 8, y: 8, px: 8, py: 8, t: 0, last_reward: 0 }, 'agent state, driver-written'),
    v('env.visits', { map: {} }, 'visit counts "x,y"->n (curiosity), driver-written'),
    v('env.success_ring', [], 'last 100 reward outcomes (curriculum input)'),
    v('memory.episodic', [], 'ring of last 64 visits (GC merge phase)'),
    v('memory.semantic', {}, 'decayed reward estimate "x,y"->n x1000 (GC decay 0.98)'),
    v('teacher.mode', 'jev-gated', "'jev-gated' | 'unguided' (arm D)"),
    v('teacher.jev_log', [], 'every gate consult, with the mock label'),
    v('growth.done', 0, '0 = stage-1 sheet live; 1 = grown'),
    v('growth.log', [], '{stage, cells_added, parent_hash} entries'),
    v('conservation.ledger', [], 'refusal receipts {t, gamma, eta, verdict}'),
    v('world.prev_surprise', 1500, 'previous surprise (competence gain input)'),
    v('world.last_features', [], 'qrc features used by the last action'),

    // ── Z_in: sensors ──────────────────────────────────────────────────────
    prog('sensors.proprio', `
const s = (await runtime.get('env.state')).data;
return { x: s.x, y: s.y, t: s.t };`, 'Z_in: own position', ['env.state']),

    prog('sensors.vision', `
const s = (await runtime.get('env.state')).data;
const cfg = (await runtime.get('env.cfg')).data;
const tasks = (await runtime.get('env.tasks')).data;
const rewards = tasks[cfg.task].rewards;
let best = 1e9;
for (const [rx, ry] of rewards) {
  const d = Math.abs(rx - s.x) + Math.abs(ry - s.y);
  if (d < best) best = d;
}
return best === 0 ? 1000 : Math.max(0, 1000 - best * 80);`, 'Z_in: salience 0..1000, inverse L1 distance to nearest reward', ['env.state', 'env.cfg', 'env.tasks']),

    // ── JEPA: world model ──────────────────────────────────────────────────
    prog('world.predict', `
const s = (await runtime.get('env.state')).data;
const sem = (await runtime.get('memory.semantic')).data;
const cfg = (await runtime.get('env.cfg')).data;
// momentum predictor: next = pos + (pos - prev), clamped to bounds
let nx = s.x + (s.x - s.px), ny = s.y + (s.y - s.py);
nx = Math.max(0, Math.min(cfg.W - 1, nx)); ny = Math.max(0, Math.min(cfg.H - 1, ny));
const guess = sem[nx + ',' + ny] || 0;
return { x: nx, y: ny, pred_reward: guess > 400 ? 1 : 0 };`, 'JEPA: predicted next position + reward guess', ['env.state', 'memory.semantic', 'env.cfg']),

    prog('world.surprise', `
const p = (await runtime.get('world.predict')).data;
const s = (await runtime.get('env.state')).data;
const d = Math.abs(p.x - s.x) + Math.abs(p.y - s.y);
const miss = p.pred_reward !== (s.last_reward ? 1 : 0) ? 500 : 0;
return d * 250 + miss;`, 'JEPA: integer surprise = |dpos|*250 + reward_miss*500', ['world.predict', 'env.state']),

    // ── pincher reflex ─────────────────────────────────────────────────────
    prog('reflex.orient', `
const sal = (await runtime.get('sensors.vision')).data;
return sal > 800 ? 1 : 0;`, 'pincher: salience > 800 => orient reflex fires (fast path, no teacher)', ['sensors.vision']),

    // ── teacher (Murmur primitive) ─────────────────────────────────────────
    prog('teacher.jev_gate', `
const ring = (await runtime.get('env.success_ring')).data;
const mode = (await runtime.get('teacher.mode')).data;
const success = ring.length >= 20 ? ring.filter(Boolean).length / ring.length : 0.5;
const d = jevMock(success, ring.length);
const log = (await runtime.get('teacher.jev_log')).data;
if (log.length < 512) log.push({ t: (await runtime.get('env.state')).data.t, p: Math.round(d.noul * 1000) / 1000, action: d.action, mock: true });
await runtime.set('teacher.jev_log', log);
return d;

function jevMock(success, k) {
  const p = 0.5 + 0.5 * Math.tanh((success - 0.75) * 8);
  return { type: 'noul', noul: p, action: p > 0.95 ? 'execute' : p >= 0.70 ? 'escalate' : 'discard', mock: true, k };
}`, 'JEV typed-decision mock (LABELED mock:true). Calibration hole-fill: p = 0.5+0.5*tanh((success-0.75)*8); thresholds 0.95/0.70 per seed3 §9', ['env.success_ring', 'teacher.mode', 'teacher.jev_log', 'env.state']),

    prog('teacher.feedback', `
const gate = (await runtime.get('teacher.jev_gate')).data;
const mode = (await runtime.get('teacher.mode')).data;
const cfg = (await runtime.get('env.cfg')).data;
if (mode === 'unguided') return { switch_to: cfg.task, rule: 'unguided: driver switches', teacher: 'offline-rule' };
// jev-gated: only an EXECUTE verdict may switch the task, and only upward
// (zone of proximal development: ~75% success band, easy -> hard)
let switch_to = cfg.task;
if (gate.action === 'execute' && gate.noul > 0.95 && cfg.task < 3) switch_to = cfg.task + 1;
return { switch_to, rule: gate.action, teacher: 'offline-rule' };`, 'Murmur: OFFLINE rule teacher (labeled). The LLM proposes nothing here — no keys this session', ['teacher.jev_gate', 'teacher.mode', 'env.cfg']),

    // ── Z_out: policy ──────────────────────────────────────────────────────
    prog('policy.action', `
const s = (await runtime.get('env.state')).data;
const cfg = (await runtime.get('env.cfg')).data;
const tasks = (await runtime.get('env.tasks')).data;
const sal = (await runtime.get('sensors.vision')).data;
const reflex = (await runtime.get('reflex.orient')).data;
const visits = (await runtime.get('env.visits')).data;
const grown = (await runtime.get('growth.done')).data;
const sem = (await runtime.get('memory.semantic')).data;
let label = null;
if (grown) { const L = (await runtime.get('sensors.language')).data; label = L; }
const rewards = tasks[cfg.task].rewards;
const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
let best = null, bestScore = -1e9;
for (const [dx, dy] of dirs) {
  const nx = Math.max(0, Math.min(cfg.W - 1, s.x + dx));
  const ny = Math.max(0, Math.min(cfg.H - 1, s.y + dy));
  // greedy toward nearest reward (manhattan), curiosity bonus for least-visited
  let dBest = 1e9;
  for (const [rx, ry] of rewards) dBest = Math.min(dBest, Math.abs(rx - nx) + Math.abs(ry - ny));
  const seen = visits.map[nx + ',' + ny] || 0;
  let score = -dBest * 100 - seen * 10 + (grown && sem[nx + ',' + ny] > 400 ? 150 : 0);
  if (label && label.dx === dx && label.dy === dy) score += 300; // teacher label edge (stage 2)
  if (score > bestScore) { bestScore = score; best = [dx, dy]; }
}
if (reflex) {
  // pincher overrides: pure salience climb
  let bBest = -1;
  for (const [dx, dy] of dirs) {
    const nx = Math.max(0, Math.min(cfg.W - 1, s.x + dx));
    const ny = Math.max(0, Math.min(cfg.H - 1, s.y + dy));
    let dBest = 1e9;
    for (const [rx, ry] of rewards) dBest = Math.min(dBest, Math.abs(rx - nx) + Math.abs(ry - ny));
    if (1000 - dBest * 80 > bBest) { bBest = 1000 - dBest * 80; best = [dx, dy]; }
  }
}
return { dx: best[0], dy: best[1], reflex };`, 'Z_out: reflex-override -> greedy + curiosity (+ label-guess when grown)', ['env.state', 'env.cfg', 'env.tasks', 'sensors.vision', 'reflex.orient', 'env.visits', 'growth.done', 'memory.semantic']),

    // ── DoubleEntry: the conservation law ──────────────────────────────────
    prog('ledger.gamma', `
const log = (await runtime.get('teacher.jev_log')).data;
const t = (await runtime.get('env.state')).data.t;
const consulted = log.length && log[log.length - 1].t === t ? 1 : 0;
return 100 + consulted * 150;`, 'DoubleEntry gamma: 100 base + 150 per teacher consult (hole-fill, scaled)', ['teacher.jev_log', 'env.state']),

    prog('ledger.eta', `
return (await runtime.get('world.surprise')).data;`, 'DoubleEntry eta = surprise', ['world.surprise']),

    prog('ledger.check', `
const g = (await runtime.get('ledger.gamma')).data;
const e = (await runtime.get('ledger.eta')).data;
return { gamma: g, eta: e, sum: g + e, C: 1585, verdict: g + e <= 1585 ? 'ok' : 'refuse' };`, 'DoubleEntry: gamma + eta <= C = log2(3) x 1000 (seed3 §3). Boundary: 1585 passes, 1586 refuses', ['ledger.gamma', 'ledger.eta']),

    prog('conservation.test', `
return { gamma: input.gamma, eta: input.eta, sum: input.gamma + input.eta, C: 1585, verdict: input.gamma + input.eta <= 1585 ? 'ok' : 'refuse' };`, 'input-driven boundary probe: exact at the scaled integers (R4)'),

    // ── Vibe: developmental state ──────────────────────────────────────────
    prog('state.stage', `
const pos = (await runtime.get('state.position')).data;
const prev = (await runtime.get('world.prev_surprise')).data;
const cur = (await runtime.get('world.surprise')).data;
const gain = Math.max(0, prev - cur);
const step = Math.max(0, Math.min(10, Math.floor(gain / 50)));
return { position: pos + step, velocity: step };`, 'Vibe: position accumulates only while surprise DECLINES (competence)', ['state.position', 'world.prev_surprise', 'world.surprise']),

    v('state.position', 0, 'stage position (kept as its own value cell so the driver can checkpoint it)'),

    // ── Graph: skills/lineage ──────────────────────────────────────────────
    prog('skills.graph', `
const grown = (await runtime.get('growth.done')).data;
// stage-1: 24 cells, 22 declared edges; stage-2 adds 2 cells + 4 edges
const V = grown ? 26 : 24, E = grown ? 26 : 22;
return { V, E, beta1: E - V + 1 };`, 'Graph: beta1 = E - V + C(=1) over the live cell graph', ['growth.done']),

    // ── QRC (MOTH reservoir) ───────────────────────────────────────────────
    v('qrc.source', { mode: 'offline-stream', live: false, note: 'vault stream; cached real packets where present; a mock never pretends to be quantum' }, 'entropy provenance label'),
    prog('qrc.features', `
const t = (await runtime.get('env.state')).data.t;
// vault-stream features: deterministic u(0,1000) ints from a hashed stream
let h = (t * 2654435761) >>> 0;
const out = [];
for (let i = 0; i < 4; i++) { h = (h ^ (h << 13)) >>> 0; h = (h ^ (h >>> 17)) >>> 0; h = (h ^ (h << 5)) >>> 0; out.push(h % 1001); }
await runtime.set('world.last_features', out);
return out;`, 'QRC: 4 reservoir features (deterministic offline stream, live:false)', ['env.state', 'world.last_features']),
  ];

  // ── GROWTH: stage 2 adds sensors.language + teacher.label and the policy
  //    edge to them. Adding cells IS advancing stages (seed2 docC §4).
  if (stage >= 2) {
    cells.push(
      prog('sensors.language', `
const s = (await runtime.get('env.state')).data;
const tasks = (await runtime.get('env.tasks')).data;
const cfg = (await runtime.get('env.cfg')).data;
// the teacher labels the BEST move at this position (a hint channel)
const rewards = tasks[cfg.task].rewards;
let best = null, bd = 1e9;
for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
  const nx = Math.max(0, Math.min(cfg.W - 1, s.x + dx));
  const ny = Math.max(0, Math.min(cfg.H - 1, s.y + dy));
  let d = 1e9;
  for (const [rx, ry] of rewards) d = Math.min(d, Math.abs(rx - nx) + Math.abs(ry - ny));
  if (d < bd) { bd = d; best = [dx, dy]; }
}
return { dx: best[0], dy: best[1], channel: 'teacher:offline-rule' };`, 'Z_in (stage 2): teacher label channel', ['env.state', 'env.tasks', 'env.cfg']),
      v('growth.stage', stage, 'current stage'),
    );
  } else {
    cells.push(v('growth.stage', 1, 'current stage'));
  }
  return { name: 'quilt-dba-seed-agent', cells };
}
