// dba/kernels.mjs — the developmental cell semantics as PURE deterministic
// integer-scaled functions. This is the substance of the 12-cell SEED SHEET
// (seed3 §4); dba/sheet.mjs declares the same cells into the vendored Quilt
// engine, and the engine program cells call THESE kernels (no drift: the
// sheet is the contract, the kernels are the substance, the core loop is the
// selected substrate — receipted in README "substrate selection").
//
// Fixed-point doctrine (seed3 §4.1 "Determinism: no floating-point
// nondeterminism in the JEPA or DoubleEntry cells. Use fixed-point where
// possible"):
//   - all ledger quantities are SCALED INTEGERS (unit = 1/1000 bit).
//     C = 1.585 bits -> C_SCALED = 1585. Boundary tol 1e-9 scaled units.
//   - surprise = squared prediction error over the 9-bit vision window,
//     scaled x1000 and rounded: eta_scaled = round(ETA_SCALE * mse).
//   - vibe position/velocity are floats but accumulate through a fixed
//     op order (deterministic IEEE754); everything checkpointed.

export const GRID = 16;
export const SCALE = 1000;
export const C_SCALED = 1585;          // gamma + eta <= C, C = log2(3) = 1.585 bits
export const C_TOL = 1e-9;             // boundary tolerance, scaled units (receipted)
export const ETA_SCALE = 2000;         // eta = 2 * mse  (W=2 scale — receipted hole-fill)
export const GAMMA_MOVE = 600;         // gamma = energy commitment: 1 energy = 0.6 milli-bit-kl?
export const GAMMA_CURIO = 50;         // curiosity-dominated choice surcharge
export const GAMMA_ORIENT = 60;        // reflex head-turn (no world transition)
export const VISION_N = 9;             // 3x3 window
export const ENERGY0 = 50, ENERGY_MAX = 100, MOVE_COST = 1, FOOD_ENERGY = 10;
export const FOOD_PER_ZONE = 10, N_ZONES = 4, RESPAWN_DELAY = 20;
export const EWMA_ALPHA = 0.002;       // vibe velocity = EWMA of learning progress
export const CURIO_W = 0.4;            // curiosity bonus weight (score units)
export const LABEL_W = 1.5;            // stage>=2 label-channel bias (growth edge live)
export const NOVELTY_W = 0.5;          // innate novelty preference (seed3 §4.1)
export const WZONE_W = 0.2;            // weak pull toward the current zone center
export const WAYPOINT_W = 1.0;         // teacher waypoint gradient (A/B only)
export const AVERSION_PENALTY = 8, AVERSION_TTL = 40;
export const RING_CAP = 64;            // memory.episodic merge ring capacity
export const DECAY_EVERY = 16, DECAY_FACTOR = 0.98, PRUNE_BELOW = 0.5; // memory.semantic decay
export const TEACHER_EVERY = 250, ZONE_DEPLETE = 2;   // teacher:offline-rule
export const SURPRISE_PIN = 900;       // divergence: eta_scaled >= 900 sustained ...
export const SUSTAIN_LIMIT = 1000;     // ... for >= 1000 evals => diverged
export const STARVE_LIMIT = 1000;      // or energy<=0 sustained >= 1000 evals
export const STAGE1_THRESHOLD = 1.0;   // vibe.position > 1.0 => sheet grows

export const ACTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W
export const ZONE_CENTERS = [[4, 4], [12, 4], [4, 12], [12, 12]];
export const ZONE_NAMES = ['nw', 'ne', 'sw', 'se'];

// ---------------------------------------------------------------------------
// rng: mulberry32 — single uint32 state, fully checkpointable.
// ---------------------------------------------------------------------------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const idx = (x, y) => y * GRID + x;
export const xy = (i) => [i % GRID, Math.floor(i / GRID)];
export const manhattan = (x1, y1, x2, y2) => Math.abs(x1 - x2) + Math.abs(y1 - y2);
export const zoneOf = (x, y) => (x >> 3) + 2 * (y >> 3);
export const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

// stateless keyed flicker bit (replay-safe: no hidden rng state)
export function flickerBit(fnv1a64, worldSeed, evalN, i) {
  return Number(BigInt(fnv1a64(`flick:${worldSeed}:${evalN}:${i}`)) & 1n);
}

// ---------------------------------------------------------------------------
// world generation — deterministic from worldSeed
// ---------------------------------------------------------------------------
export function genWorld(worldSeed) {
  const rng = mulberry32(worldSeed);
  const hazards = [];
  while (hazards.length < 4) {
    const bx = 2 + Math.floor(rng() * 12), by = 2 + Math.floor(rng() * 12);
    const cells = [idx(bx, by), idx(bx + 1, by), idx(bx, by + 1), idx(bx + 1, by + 1)];
    if (cells.some(c => hazards.includes(c))) continue;
    if (cells.includes(idx(8, 8))) continue; // never on the start cell
    hazards.push(...cells);
  }
  const food = new Array(N_ZONES * FOOD_PER_ZONE).fill(-1);
  const taken = new Set(hazards); taken.add(idx(8, 8));
  for (let z = 0; z < N_ZONES; z++) {
    const zx = (z % 2) * 8, zy = (z >> 1) * 8;
    for (let k = 0; k < FOOD_PER_ZONE; k++) {
      let cx, cy, tries = 0;
      do { cx = zx + Math.floor(rng() * 8); cy = zy + Math.floor(rng() * 8); tries++; }
      while (taken.has(idx(cx, cy)) && tries < 200);
      const c = idx(cx, cy);
      taken.add(c); food[z * FOOD_PER_ZONE + k] = c;
    }
  }
  return { hazards: hazards.slice().sort((a, b) => a - b), food };
}

export function nearHazard(hazards, x, y) {
  for (const h of hazards) {
    const [hx, hy] = xy(h);
    if (Math.abs(hx - x) <= 1 && Math.abs(hy - y) <= 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// sensors.vision / sensors.proprio (Z_in)
// salience (receipted hole-fill: seed3 gives no salience units):
//   food orthogonally adjacent -> 0.9, diagonally adjacent -> 0.85,
//   else count(window)/9. Reflex fires at salience > 0.8 <=> food within 1 step.
// ---------------------------------------------------------------------------
export function observe(state, fnv1a64) {
  const { env, hazards, worldSeed } = state;
  const [x, y] = [env.x, env.y];
  const win = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = x + dx, cy = y + dy;
    let bit = 0;
    if (cx >= 0 && cx < GRID && cy >= 0 && cy < GRID && state.foodSet.has(idx(cx, cy))) bit = 1;
    win.push(bit);
  }
  const flicked = nearHazard(hazards, x, y);
  if (flicked) for (let i = 0; i < VISION_N; i++) win[i] ^= flickerBit(fnv1a64, worldSeed, state.eval, i);
  let salience = 0;
  for (let i = 0; i < VISION_N; i++) {
    if (!win[i]) continue;
    const dx = (i % 3) - 1, dy = Math.floor(i / 3) - 1;
    const s = (dx === 0 && dy === 0) ? 1 : (dx === 0 || dy === 0) ? 0.9 : 0.85;
    if (s > salience) salience = s;
  }
  if (salience === 0) salience = win.reduce((a, b) => a + b, 0) / VISION_N;
  const foodCount = win.reduce((a, b) => a + b, 0);
  return {
    win, salience: Math.round(salience * SCALE) / SCALE, flicked, foodCount,
    proprio: { x, y, energy: env.energy },
  };
}

// ---------------------------------------------------------------------------
// world.predict (JEPA) — predict-then-learn, NO lookahead: predictions come
// from the table as it stands BEFORE this transition is written.
//   key = "x,y,a"; win[key] = last observed window for that transition;
//   err[key] = EWMA of mse seen at that key (drives eta_pred / pre-gate).
// Default prediction for an unvisited key = persistence (current window).
// ---------------------------------------------------------------------------
export const jepaKey = (x, y, a) => `${x},${y},${a}`;
export function jepaPredict(state, x, y, a, curWin) {
  const k = jepaKey(x, y, a);
  const win = state.jepaWin[k] !== undefined ? state.jepaWin[k] : curWin;
  const err = state.jepaErr[k] !== undefined ? state.jepaErr[k] : 0;
  return { key: k, predWin: win, etaPredScaled: Math.round(ETA_SCALE * err) };
}
export function mseOf(winA, winB) {
  let wrong = 0;
  for (let i = 0; i < VISION_N; i++) if (winA[i] !== winB[i]) wrong++;
  return wrong / VISION_N;
}

// ---------------------------------------------------------------------------
// conservation (DoubleEntry, enforced) — gamma + eta <= C, scaled ints.
//   gamma: energy commitment of the transition (GAMMA_MOVE per move,
//   +GAMMA_CURIO if the curiosity term dominated the policy choice,
//   GAMMA_ORIENT for the reflex head-turn which commits no world transition).
//   eta: ETA_SCALE * mse of the executed transition's prediction.
// Violation => the DRIVER refuses the transition, receipts it, keeps prior
// state. Tolerance 1e-9 scaled units (integers are exact; the tol is the
// receipted boundary semantics).
// ---------------------------------------------------------------------------
export function conservationOK(gammaScaled, etaScaled) {
  return gammaScaled + etaScaled <= C_SCALED + C_TOL;
}
export function boundaryCase(gammaScaled, etaScaled) {
  // returns 'pass' | 'refuse' — the receipted boundary test primitive
  return conservationOK(gammaScaled, etaScaled) ? 'pass' : 'refuse';
}

// ---------------------------------------------------------------------------
// policy.action (Z_out) — greedy-toward-reward + curiosity bonus.
// Inputs are the cell values only (sensors, world.predict, teacher.feedback,
// ledger feasibility, memory) — the no-lookahead probe audits this surface.
// ---------------------------------------------------------------------------
export function policyScore(state, obs, cand, curX, curY) {
  const [dx, dy] = ACTIONS[cand.a];
  const tx = curX + dx, ty = curY + dy;
  if (tx < 0 || tx >= GRID || ty < 0 || ty >= GRID) return { score: -Infinity, parts: null, tx, ty };
  const [zx, zy] = ZONE_CENTERS[state.teacher.zone];
  const dzc = manhattan(curX, curY, zx, zy) - manhattan(tx, ty, zx, zy);
  let dzw = 0;
  if (state.teacher.waypoint) {
    dzw = manhattan(curX, curY, state.teacher.waypoint[0], state.teacher.waypoint[1]) -
          manhattan(tx, ty, state.teacher.waypoint[0], state.teacher.waypoint[1]);
  }
  const foodSeen = obs.win[(dy + 1) * 3 + (dx + 1)] === 1;
  const av = state.aversion[idx(tx, ty)];
  const novel = 1 - Math.min(1, (state.memory.semantic[idx(tx, ty)] || 0) / 10);
  const curiosity = CURIO_W * cand.etaPredScaled / SCALE;
  const labelW = state.stage >= 2 ? LABEL_W : 1.0; // growth wires teacher.label in
  const parts = {
    reward: foodSeen ? 10 : 0,
    zone: labelW * (WZONE_W * dzc + (state.teacher.waypoint ? WAYPOINT_W * dzw : 0)),
    curiosity,
    aversion: av !== undefined && state.eval < av ? -AVERSION_PENALTY : 0,
    novelty: NOVELTY_W * novel,
  };
  const score = parts.reward + parts.zone + parts.curiosity + parts.aversion + parts.novelty;
  return { score, parts, tx, ty };
}
export function curiosityDominated(parts) {
  if (!parts) return false;
  let maxK = 'reward', maxV = -Infinity;
  for (const k of ['reward', 'zone', 'curiosity', 'novelty']) {
    if (parts[k] > maxV) { maxV = parts[k]; maxK = k; }
  }
  return maxK === 'curiosity';
}

// ---------------------------------------------------------------------------
// reflex.orient (pincher listener) — salience > 0.8 => immediate orient,
// NO teacher consulted. Returns the orient move (direction of the most
// salient adjacent food) or null.
// ---------------------------------------------------------------------------
export function reflexOrient(obs) {
  if (!(obs.salience > 0.8)) return null;
  let best = null, bestS = 0;
  for (let i = 0; i < VISION_N; i++) {
    if (!obs.win[i] || i === 4) continue;
    const dx = (i % 3) - 1, dy = Math.floor(i / 3) - 1;
    const s = (dx === 0 || dy === 0) ? 0.9 : 0.85;
    if (s > bestS) { bestS = s; best = [dx, dy]; }
  }
  if (!best) return null;
  for (let a = 0; a < 4; a++) if (ACTIONS[a][0] === best[0] && ACTIONS[a][1] === best[1]) return { a, gamma: GAMMA_ORIENT };
  return null;
}

// ---------------------------------------------------------------------------
// teacher.feedback (Murmur) — OFFLINE deterministic curriculum rule, labeled
// 'teacher:offline-rule'. NO LLM this session.
//   propose: argmax_z foodCount_z / (1 + manhattan(agent, center_z))
// ---------------------------------------------------------------------------
export const zoneOfPellet = (i) => Math.floor(i / FOOD_PER_ZONE);
export function teacherPropose(state) {
  const [x, y] = [state.env.x, state.env.y];
  let best = 0, bestScore = -1;
  for (let z = 0; z < N_ZONES; z++) {
    const [cx, cy] = ZONE_CENTERS[z];
    const fz = state.food.reduce((n, c, i) => zoneOfPellet(i) === z && c >= 0 ? n + 1 : n, 0);
    const s = fz / (1 + manhattan(x, y, cx, cy));
    if (s > bestScore) { bestScore = s; best = z; }
  }
  return best;
}
export function zoneFoodCount(state, z) {
  let n = 0;
  for (let i = 0; i < state.food.length; i++) if (zoneOfPellet(i) === z && state.food[i] >= 0) n++;
  return n;
}
export function teacherWaypoint(state) {
  const [x, y] = [state.env.x, state.env.y];
  let best = null, bestD = Infinity;
  for (let pass = 0; pass < 2 && best === null; pass++) {
    for (let i = 0; i < state.food.length; i++) {
      const c = state.food[i];
      if (c < 0) continue;
      if (pass === 0 && zoneOfPellet(i) !== state.teacher.zone) continue;
      const [cx, cy] = xy(c);
      const dd = manhattan(x, y, cx, cy);
      if (dd < bestD) { bestD = dd; best = [cx, cy]; }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// jev.decide — deterministic typed-decision MOCK, LABELED mock (no LLM, no
// live judge this session). Thresholds (receipted):
//   score > 0.95 -> execute | 0.70..0.95 -> escalate | < 0.70 -> discard
// ---------------------------------------------------------------------------
export const JEV_LABEL = 'jev:mock-v1';
export function jevDecide(desc) {
  const score = clamp(0.5 * desc.densityNorm + 0.3 * (1 - desc.distNorm) + 0.2 * desc.energyNorm, 0, 1);
  const verdict = score > 0.95 ? 'execute' : score >= 0.70 ? 'escalate' : 'discard';
  return { score: Math.round(score * SCALE) / SCALE, verdict, mock: true, label: JEV_LABEL, type: desc.type };
}
export function jevEscalateRule(desc) { return desc.densityNorm >= 0.4; } // offline adjudication

// ---------------------------------------------------------------------------
// memory.episodic (GC merge ring) / memory.semantic (GC decay)
// ---------------------------------------------------------------------------
export function ringAppend(ring, entry) {
  const last = ring[ring.length - 1];
  if (last && last.x === entry.x && last.y === entry.y && last.r === entry.r && last.kind === entry.kind) {
    last.n = (last.n || 1) + 1;         // merge phase: dedupe consecutive
  } else {
    ring.push(entry);
    if (ring.length > RING_CAP) ring.shift();
  }
}
export function semanticDecay(semantic) {
  for (const k of Object.keys(semantic)) {
    semantic[k] = semantic[k] * DECAY_FACTOR;
    if (semantic[k] < PRUNE_BELOW) delete semantic[k];
  }
}

// ---------------------------------------------------------------------------
// skills (Graph) — beta1 = E - V + C over the sheet (C = components).
// ---------------------------------------------------------------------------
export function betti1(vertices, edges, components) { return edges - vertices + components; }

// ---------------------------------------------------------------------------
// state.stage (Vibe) — velocity = EWMA of learning progress; position grows.
// learning progress lp = clamp((s_prev - s_now)/1000, 0, 1); refused/hold
// evals contribute lp = 0 (no learning happened).
// ---------------------------------------------------------------------------
export function vibeUpdate(state, etaScaled, learned) {
  const lp = learned ? clamp((state.sPrev - etaScaled) / SCALE, 0, 1) : 0;
  state.vibe.velocity = (1 - EWMA_ALPHA) * state.vibe.velocity + EWMA_ALPHA * lp;
  state.vibe.position += state.gain * state.vibe.velocity;
  state.sPrev = learned ? etaScaled : state.sPrev;
  return lp;
}
