// dba/core.mjs — the Driver: the developmental loop as the seed3 §5 declares
// it. One eval =
//   sensors -> predict -> conservation check (projected) -> policy ->
//   env.step -> conservation check (actual: refuse/rollback) -> memory
//   append -> vibe velocity -> (growth?)
// with checkpointing as git-commit bundles (quilt-git doctrine) and
// byte-identical replay.
//
// Arms (E-D1):
//   A — conservation enforced + JEV-gated offline-rule curriculum
//   B — ablated: conservation computed but NEVER refused (violations apply)
//   D — unguided: conservation enforced, curriculum = random task choice
//       (no teacher rule, no JEV gate)

import {
  GRID, SCALE, C_SCALED, ETA_SCALE, GAMMA_MOVE, GAMMA_CURIO, ENERGY0, ENERGY_MAX,
  MOVE_COST, FOOD_ENERGY, FOOD_PER_ZONE, N_ZONES, RESPAWN_DELAY, EWMA_ALPHA,
  AVERSION_TTL, RING_CAP, DECAY_EVERY, TEACHER_EVERY, ZONE_DEPLETE,
  STAGE1_THRESHOLD, ACTIONS, ZONE_CENTERS, ZONE_NAMES, SURPRISE_PIN,
  SUSTAIN_LIMIT, STARVE_LIMIT,
} from './kernels.mjs';
import * as K from './kernels.mjs';
import { fnv1a64 } from './receipts.mjs';

const sorted = (obj) => Object.keys(obj).sort().reduce((o, k) => (o[k] = obj[k], o), {});
function idx(x, y) { return y * GRID + x; }

// mulberry32 with EXPOSED state (checkpointable single uint32)
export function makeRng(a) {
  let state = a | 0;
  const fn = () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { fn, get state() { return state; } };
}

// base sheet dependency edges (skills graph) — mirrors dba/sheet.mjs EDGES
export const EDGES_BASE = [
  ['sensors.vision', 'world.predict'], ['sensors.proprio', 'world.predict'],
  ['memory.episodic', 'world.predict'], ['vault.qrc', 'sensors.vision'],
  ['world.predict', 'ledger'], ['policy.action', 'ledger'], ['ledger', 'conservation'],
  ['conservation', 'policy.action'], ['world.predict', 'policy.action'],
  ['teacher.feedback', 'policy.action'], ['sensors.vision', 'reflex.orient'],
  ['reflex.orient', 'policy.action'], ['ledger', 'state.stage'],
  ['state.stage', 'teacher.feedback'], ['memory.semantic', 'teacher.feedback'],
  ['ledger', 'teacher.feedback'], ['teacher.feedback', 'jev.decide'],
  ['jev.decide', 'policy.action'],
];
export const EDGES_GROWTH = [
  ['teacher.feedback', 'sensors.language'], ['sensors.language', 'teacher.label'],
  ['teacher.label', 'policy.action'],
];

export class Driver {
  constructor(opts) {
    // opts: { arm, seed, gain, vault?, worldSeed?, maxEvals }
    this.arm = opts.arm;
    this.seed = opts.seed;
    this.gain = opts.gain;
    this.maxEvals = opts.maxEvals !== undefined ? opts.maxEvals : Infinity;
    const worldSeed = opts.worldSeed !== undefined
      ? opts.worldSeed >>> 0
      : (opts.vault ? opts.vault.u32(`world:seed:${opts.seed}`) : (Math.imul(opts.seed, 0x9E3779B1) >>> 0));
    this.state = Driver.freshState({ arm: this.arm, seed: this.seed, gain: this.gain, worldSeed });
  }

  static freshState({ arm, seed, gain, worldSeed }) {
    const world = K.genWorld(worldSeed);
    const st = {
      v: 1, arm, seed, gain, worldSeed,
      eval: 0, stage: 1,
      rngState: (worldSeed ^ 0xA5A5A5A5) >>> 0,
      env: { x: 8, y: 8, energy: ENERGY0 },
      food: world.food.slice(),
      respawnQ: [],
      hazards: world.hazards,
      jepaWin: {}, jepaErr: {},
      ledger: { gamma: 0, eta: 0, sum: 0 },
      sPrev: 0,
      vibe: { position: 0, velocity: 0 },
      memory: { ring: [], semantic: {}, decayTick: 0 },
      aversion: {},
      teacher: { zone: 0, label: 'zone:0', sinceEval: 0, proposes: 0, channel: 'teacher:offline-rule' },
      jev: { last: null, counts: { execute: 0, escalate: 0, discard: 0 }, label: K.JEV_LABEL },
      growthLog: [],
      lastRefusal: null,
      metrics: {
        refusals: 0, appliedViolations: 0, orients: 0, foodEaten: 0, holds: 0,
        starveEvals: 0, sustainSurprise: 0, maxSustain: 0, nonFinite: 0, maxEta: 0,
        fired: false, firedAt: null, diverged: false, divergenceWhy: null,
        visited: [idx(8, 8)],
      },
    };
    st.foodSet = new Set(st.food.filter(c => c >= 0));
    st.visitedSet = new Set(st.metrics.visited);
    return st;
  }

  // -- checkpoint bundle: stable key order => byte-identical JSON ----------
  bundle() {
    const s = this.state;
    return {
      v: s.v, arm: s.arm, seed: s.seed, gain: s.gain, worldSeed: s.worldSeed,
      eval: s.eval, stage: s.stage, rngState: s.rngState,
      env: { x: s.env.x, y: s.env.y, energy: s.env.energy },
      food: s.food.slice(),
      respawnQ: s.respawnQ.map(r => [r[0], r[1]]),
      hazards: s.hazards.slice(),
      jepaWin: sorted(s.jepaWin), jepaErr: sorted(s.jepaErr),
      ledger: { gamma: s.ledger.gamma, eta: s.ledger.eta, sum: s.ledger.sum },
      sPrev: s.sPrev,
      vibe: { position: s.vibe.position, velocity: s.vibe.velocity },
      memory: {
        ring: s.memory.ring.map(r => ({ e: r.e, x: r.x, y: r.y, r: r.r, eta: r.eta, kind: r.kind, n: r.n || 1 })),
        semantic: sorted(s.memory.semantic), decayTick: s.memory.decayTick,
      },
      aversion: sorted(s.aversion),
      teacher: { zone: s.teacher.zone, label: s.teacher.label, sinceEval: s.teacher.sinceEval, proposes: s.teacher.proposes, channel: s.teacher.channel },
      jev: { last: s.jev.last, counts: { execute: s.jev.counts.execute, escalate: s.jev.counts.escalate, discard: s.jev.counts.discard }, label: s.jev.label },
      growthLog: s.growthLog.map(g => ({ eval: g.eval, stageFrom: g.stageFrom, stageTo: g.stageTo, cellsAdded: g.cellsAdded.slice(), edgesAdded: g.edgesAdded.map(e => e.slice()), bettiBefore: g.bettiBefore, bettiAfter: g.bettiAfter, gain: g.gain, parentCommit: g.parentCommit })),
      metrics: {
        refusals: s.metrics.refusals, appliedViolations: s.metrics.appliedViolations,
        orients: s.metrics.orients, foodEaten: s.metrics.foodEaten, holds: s.metrics.holds,
        visited: s.metrics.visited.slice(),
      },
    };
  }

  static restoreState(b) {
    const st = Driver.freshState({ arm: b.arm, seed: b.seed, gain: b.gain, worldSeed: b.worldSeed });
    st.eval = b.eval; st.stage = b.stage; st.rngState = b.rngState;
    st.env = { x: b.env.x, y: b.env.y, energy: b.env.energy };
    st.food = b.food.slice();
    st.respawnQ = b.respawnQ.map(r => [r[0], r[1]]);
    st.jepaWin = {}; for (const k of Object.keys(b.jepaWin)) st.jepaWin[k] = b.jepaWin[k];
    st.jepaErr = {}; for (const k of Object.keys(b.jepaErr)) st.jepaErr[k] = b.jepaErr[k];
    st.ledger = { gamma: b.ledger.gamma, eta: b.ledger.eta, sum: b.ledger.sum };
    st.sPrev = b.sPrev;
    st.vibe = { position: b.vibe.position, velocity: b.vibe.velocity };
    st.memory = {
      ring: b.memory.ring.map(r => ({ e: r.e, x: r.x, y: r.y, r: r.r, eta: r.eta, kind: r.kind, n: r.n })),
      semantic: {},
      decayTick: b.memory.decayTick,
    };
    for (const k of Object.keys(b.memory.semantic)) st.memory.semantic[k] = b.memory.semantic[k];
    st.aversion = {}; for (const k of Object.keys(b.aversion)) st.aversion[k] = b.aversion[k];
    st.teacher = { zone: b.teacher.zone, label: b.teacher.label, sinceEval: b.teacher.sinceEval, proposes: b.teacher.proposes, channel: b.teacher.channel };
    st.jev = { last: b.jev.last, counts: { execute: b.jev.counts.execute, escalate: b.jev.counts.escalate, discard: b.jev.counts.discard }, label: b.jev.label };
    st.growthLog = b.growthLog.map(g => ({ ...g }));
    st.metrics = {
      ...st.metrics,
      refusals: b.metrics.refusals, appliedViolations: b.metrics.appliedViolations,
      orients: b.metrics.orients, foodEaten: b.metrics.foodEaten, holds: b.metrics.holds,
      visited: b.metrics.visited.slice(),
    };
    st.foodSet = new Set(st.food.filter(c => c >= 0));
    st.visitedSet = new Set(st.metrics.visited);
    return st;
  }
}

export function driverFromBundle(b) {
  const d = Object.create(Driver.prototype);
  d.arm = b.arm; d.seed = b.seed; d.gain = b.gain; d.maxEvals = Infinity;
  d.state = Driver.restoreState(b);
  return d;
}

// ---------------------------------------------------------------------------
// one developmental eval
// ---------------------------------------------------------------------------
export function step(d, opts = {}) {
  const s = d.state;
  if (s.eval >= d.maxEvals) return null;
  const trace = opts.trace ? { obs: null, action: null, eta: null } : null;
  const armA = s.arm === 'A', armB = s.arm === 'B', armD = s.arm === 'D';

  // ---- 0. world tick: respawns. World dynamics are NOT the agent's
  //         commitment: they stand even when a transition is later refused
  //         (receipted hole-fill: refusal scope = agent state only).
  let rng = makeRng(s.rngState);
  for (let qi = 0; qi < s.respawnQ.length && s.respawnQ[qi][0] <= s.eval; qi++) {
    const [, pellet] = s.respawnQ[qi];
    const z = K.zoneOfPellet(pellet);
    const zx = (z % 2) * 8, zy = (z >> 1) * 8;
    let c = -1, tries = 0;
    do {
      const cx = zx + Math.floor(rng.fn() * 8), cy = zy + Math.floor(rng.fn() * 8);
      c = idx(cx, cy); tries++;
    } while ((s.foodSet.has(c) || s.hazards.includes(c) || c === idx(s.env.x, s.env.y)) && tries < 200);
    s.food[pellet] = c; s.foodSet.add(c);
    s.respawnQ.splice(qi, 1); qi--;
  }
  s.rngState = rng.state;

  // ---- 1. sensors fire (Z_in) --------------------------------------------
  const obs = K.observe(s, fnv1a64);
  if (trace) trace.obs = { salience: obs.salience, flicked: obs.flicked };

  // ---- 2. reflex.orient (pincher listener; salience > 0.8, no teacher) ----
  const orient = K.reflexOrient(obs);

  // ---- 3. world.predict (JEPA, predict-then-learn) ------------------------
  const cands = [];
  for (let a = 0; a < 4; a++) {
    const [dx, dy] = ACTIONS[a];
    const nx = s.env.x + dx, ny = s.env.y + dy;
    if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) { cands.push({ a, oob: true }); continue; }
    const p = K.jepaPredict(s, s.env.x, s.env.y, a, obs.win);
    cands.push({ a, oob: false, tx: nx, ty: ny, ...p });
  }

  // ---- 4. conservation projected check (pre-gate) -------------------------
  for (const c of cands) if (!c.oob) c.feasible = K.conservationOK(GAMMA_MOVE, c.etaPredScaled);

  // teacher waypoint (DERIVED per-eval from food+agent+zone — not checkpointed
  // state; replay recomputes it identically): A/B teacher-guided, D unguided.
  s.teacher.waypoint = armD ? null : K.teacherWaypoint(s);

  // ---- 5. policy.action (greedy + curiosity; reflex overrides; no teacher
  //         consult inside the reflex) --------------------------------------
  let action = null, gammaScaled = 0, viaReflex = false;
  if (orient) {
    const oc = cands.find(c => c.a === orient.a && !c.oob && c.feasible);
    if (oc) { action = oc; gammaScaled = GAMMA_MOVE; viaReflex = true; s.metrics.orients++; }
  }
  if (!action) {
    if (s.env.energy <= 0) {
      s.metrics.starveEvals++; s.metrics.holds++;
      if (s.metrics.starveEvals >= STARVE_LIMIT && !s.metrics.diverged) {
        s.metrics.diverged = true; s.metrics.divergenceWhy = 'starvation>=1000';
      }
    } else {
      let best = null;
      for (const c of cands) {
        if (c.oob || !c.feasible) continue;
        const { score, parts } = K.policyScore(s, obs, c, s.env.x, s.env.y);
        c.score = score; c.parts = parts;
        if (score > -Infinity && (best === null || score > best.score)) best = c;
      }
      if (best) {
        action = best;
        gammaScaled = GAMMA_MOVE + (K.curiosityDominated(best.parts) ? GAMMA_CURIO : 0);
      } else s.metrics.holds++;
    }
  }
  if (trace) trace.action = action ? action.a : -1;

  // ---- 6. env.step + 7. conservation actual check --------------------------
  let learned = false, etaScaled = 0;
  if (!action) {
    // hold: no world commitment (gamma = 0), no conservation check, no learn.
  } else {
    const snap = {
      x: s.env.x, y: s.env.y, energy: s.env.energy,
      food: s.food.slice(), foodSet: new Set(s.foodSet),
      respawnQ: s.respawnQ.map(r => [r[0], r[1]]), foodEaten: s.metrics.foodEaten,
    };
    s.env.x = action.tx; s.env.y = action.ty;
    s.env.energy = Math.max(0, s.env.energy - MOVE_COST);
    const cell = idx(s.env.x, s.env.y);
    const pellet = s.food.indexOf(cell);
    if (pellet >= 0) {
      s.food[pellet] = -1; s.foodSet.delete(cell);
      s.env.energy = Math.min(ENERGY_MAX, s.env.energy + FOOD_ENERGY);
      s.metrics.foodEaten++;
      s.respawnQ.push([s.eval + RESPAWN_DELAY, pellet]);
    }
    const obs2 = K.observe(s, fnv1a64);
    const mse = K.mseOf(action.predWin, obs2.win);
    etaScaled = Math.round(ETA_SCALE * mse);
    s.ledger.gamma = gammaScaled; s.ledger.eta = etaScaled; s.ledger.sum = gammaScaled + etaScaled;
    s.metrics.maxEta = Math.max(s.metrics.maxEta, etaScaled);
    if (trace) trace.eta = etaScaled;

    if (!K.conservationOK(gammaScaled, etaScaled)) {
      if (armB) {
        s.metrics.appliedViolations++;  // ablated arm: the violation APPLIES
        learned = true;
        s.jepaWin[action.key] = obs2.win;
        s.jepaErr[action.key] = s.jepaErr[action.key] === undefined ? mse : 0.7 * s.jepaErr[action.key] + 0.3 * mse;
        K.ringAppend(s.memory.ring, { e: s.eval, x: s.env.x, y: s.env.y, r: s.metrics.foodEaten, eta: etaScaled, kind: 'violation' });
      } else {
        // REFUSE: rollback the agent state, receipt it, keep prior state,
        // mark aversion (episodic), learn nothing from the refused step.
        s.env.x = snap.x; s.env.y = snap.y; s.env.energy = snap.energy;
        s.food = snap.food; s.foodSet = snap.foodSet; s.respawnQ = snap.respawnQ;
        s.metrics.foodEaten = snap.foodEaten;
        s.metrics.refusals++;
        s.lastRefusal = { eval: s.eval, action: action.a, gamma: gammaScaled, eta: etaScaled, sum: gammaScaled + etaScaled };
        s.aversion[idx(action.tx, action.ty)] = s.eval + AVERSION_TTL;
        K.ringAppend(s.memory.ring, { e: s.eval, x: action.tx, y: action.ty, r: 0, eta: etaScaled, kind: 'refusal' });
        etaScaled = 0; learned = false;
      }
    } else {
      learned = true;
      s.jepaWin[action.key] = obs2.win;
      s.jepaErr[action.key] = s.jepaErr[action.key] === undefined ? mse : 0.7 * s.jepaErr[action.key] + 0.3 * mse;
      K.ringAppend(s.memory.ring, { e: s.eval, x: s.env.x, y: s.env.y, r: s.metrics.foodEaten, eta: etaScaled, kind: viaReflex ? 'reflex' : 'policy' });
    }
  }

  // ---- 8. memory append + GC -----------------------------------------------
  if (learned) {
    const cell = idx(s.env.x, s.env.y);
    if (!s.visitedSet.has(cell)) { s.visitedSet.add(cell); s.metrics.visited.push(cell); }
  }
  s.memory.semantic[idx(s.env.x, s.env.y)] = (s.memory.semantic[idx(s.env.x, s.env.y)] || 0) + 1;
  s.memory.decayTick++;
  if (s.memory.decayTick % DECAY_EVERY === 0) K.semanticDecay(s.memory.semantic);
  for (const k of Object.keys(s.aversion)) if (s.eval >= s.aversion[k]) delete s.aversion[k];

  // ---- 9. teacher.feedback (murmur, offline rule) + JEV gate ----------------
  const depleted = K.zoneFoodCount(s, s.teacher.zone) <= ZONE_DEPLETE;
  if (s.eval - s.teacher.sinceEval >= TEACHER_EVERY || depleted) {
    s.teacher.proposes++;
    if (armD) {
      const r = makeRng(s.rngState);
      s.teacher.zone = Math.floor(r.fn() * N_ZONES) % N_ZONES;
      s.rngState = r.state;
      s.teacher.label = `zone:${s.teacher.zone}`; s.teacher.sinceEval = s.eval;
    } else {
      const to = K.teacherPropose(s);
      if (to !== s.teacher.zone) {
        const [cx, cy] = ZONE_CENTERS[to];
        const densityNorm = Math.min(1, K.zoneFoodCount(s, to) / FOOD_PER_ZONE);
        const distNorm = Math.min(1, K.manhattan(s.env.x, s.env.y, cx, cy) / 22);
        const energyNorm = s.env.energy / ENERGY_MAX;
        const desc = { type: 'curriculum.switch', from: s.teacher.zone, to, densityNorm, distNorm, energyNorm };
        const verdict = K.jevDecide(desc);
        s.jev.last = verdict; s.jev.counts[verdict.verdict]++;
        let execute = false;
        if (verdict.verdict === 'execute') execute = true;
        else if (verdict.verdict === 'escalate') execute = K.jevEscalateRule(desc); // offline adjudication
        if (execute) { s.teacher.zone = to; s.teacher.label = `zone:${to}`; s.teacher.sinceEval = s.eval; }
        else s.teacher.sinceEval = s.eval; // discarded: settle to avoid re-propose storm (receipted)
      } else s.teacher.sinceEval = s.eval;
    }
  }

  // ---- 10. vibe: learning progress -> velocity -> position ------------------
  const lp = K.vibeUpdate(s, etaScaled, learned);

  // ---- 11. divergence watch (B focus; checked for all arms) -----------------
  if (!Number.isFinite(s.vibe.position) || !Number.isFinite(s.vibe.velocity) || !Number.isFinite(s.env.energy)) {
    s.metrics.nonFinite++; if (!s.metrics.diverged) { s.metrics.diverged = true; s.metrics.divergenceWhy = 'non-finite'; }
  }
  if (learned && etaScaled >= SURPRISE_PIN) s.metrics.sustainSurprise++; else s.metrics.sustainSurprise = 0;
  s.metrics.maxSustain = Math.max(s.metrics.maxSustain, s.metrics.sustainSurprise);
  if (s.metrics.sustainSurprise >= SUSTAIN_LIMIT && !s.metrics.diverged) {
    s.metrics.diverged = true; s.metrics.divergenceWhy = 'surprise>=900 sustained>=1000';
  }

  // ---- 12. growth: position > 1.0 => sheet grows, stage 1 -> 2 --------------
  if (s.stage === 1 && s.vibe.position > STAGE1_THRESHOLD) {
    s.stage = 2;
    s.growthLog.push({
      eval: s.eval, stageFrom: 1, stageTo: 2,
      cellsAdded: ['sensors.language', 'teacher.label'],
      edgesAdded: EDGES_GROWTH.map(e => e.slice()),
      bettiBefore: K.betti1(14, EDGES_BASE.length, 1),
      bettiAfter: K.betti1(16, EDGES_BASE.length + EDGES_GROWTH.length, 1),
      gain: s.gain, parentCommit: opts.parentCommit || 'none',
    });
    s.metrics.fired = true; s.metrics.firedAt = s.eval;
  }

  s.eval++;
  return { obs, action: action ? action.a : -1, viaReflex, etaScaled, lp, learned };
}

// ---------------------------------------------------------------------------
// run loop with checkpointing; returns per-run summary
// ---------------------------------------------------------------------------
export function run(d, { checkpointEvery = 0, onCheckpoint = null, stopOnFired = false, untilEval = null, trace = null } = {}) {
  const limit = untilEval !== null ? Math.min(untilEval, d.maxEvals) : d.maxEvals;
  while (d.state.eval < limit) {
    const r = step(d, trace ? { trace } : {});
    if (trace) trace.evals.push({ e: d.state.eval - 1, a: r.action });
    if (checkpointEvery && d.state.eval % checkpointEvery === 0) {
      if (onCheckpoint) onCheckpoint(d, d.state.eval);
    }
    if (stopOnFired && d.state.metrics.fired) break;
  }
  return summarize(d);
}

export function summarize(d) {
  const s = d.state;
  return {
    arm: s.arm, seed: s.seed, evals: s.eval, stage: s.stage,
    fired: s.metrics.fired, evalsToStage1: s.metrics.firedAt,
    refusals: s.metrics.refusals, appliedViolations: s.metrics.appliedViolations,
    orients: s.metrics.orients, foodEaten: s.metrics.foodEaten, holds: s.metrics.holds,
    starveEvals: s.metrics.starveEvals, maxSustainedSurprise: s.metrics.maxSustain,
    diverged: s.metrics.diverged, divergenceWhy: s.metrics.divergenceWhy,
    maxEta: s.metrics.maxEta,
    position: s.vibe.position, velocity: s.vibe.velocity,
    coverage: s.metrics.visited.length,
    jevCounts: { ...s.jev.counts }, teacherProposes: s.teacher.proposes,
    betti1: K.betti1(s.stage === 1 ? 14 : 16, EDGES_BASE.length + (s.stage === 1 ? 0 : EDGES_GROWTH.length), 1),
    growthLog: s.growthLog.map(g => ({ ...g })),
    lastRefusal: s.lastRefusal,
  };
}
