// dba/rewind.mjs — EXACT TIME TRAVEL for the developmental driver (E-D4).
//
// Ports the PATTERN of quilt-raw/raw/journal.mjs (commit e759163) to the dba
// core substrate (dba/core.mjs Driver + dba/kernels.mjs integer kernels — the
// receipted selected loop: "the sheet is the contract, the kernels are the
// substance, the core loop is the selected substrate"). The pattern, not the
// code:
//
//   A forward eval writes ONLY the state changes produced by core.mjs `step`.
//   Each eval boundary is recorded as ONE event that carries
//     (a) the decision bits of the eval (action, refused, ate, respawn moves,
//         rng call count, teacher/jev verdicts, growth), and
//     (b) the exact PRE-value of every state component whose forward update is
//         NOT a pure function of its post-state.
//   rewind = ONE deterministic fold of per-event inverses over the canonical
//   state. No search, no fitting, no re-run from seed.
//
// ── INVERTIBILITY LEDGER (every canonical state component, receipted) ────────
//
//  component (bundle field)          forward update             exact inverse
//  ────────────────────────────────  ─────────────────────────  ─────────────────────────────────
//  eval                              +1                         -1                            COMPUTED
//  rngState (uint32)                 k × (+0x6D2B79F5 mod 2³²)  post − k·0x6D2B79F5 mod 2³²   COMPUTED
//      ↑ mulberry32 with EXPOSED state. Math.random is uninvertible because its
//      state is HIDDEN; here the advance is a pure integer add mod 2³², so the
//      exact inverse is modular arithmetic (k recovered by the builder through
//      the modular inverse of the odd constant — no counter bookkeeping). This
//      is the receipted answer to "anything derived from Math.random".
//  env.x / env.y                     +ACTIONS[a] when applied   −ACTIONS[a]                   COMPUTED
//      (refused/hold evals write nothing net — the refusal rollback already put
//      the pre-move state back; the undo sees post == pre and does nothing)
//  env.energy                        min(100, e−1+10·ate)       carried preEnergy             CARRIED (int)
//      (max(0,·) is a no-op on applied moves — energy>0 is the precondition to
//      act — but min(100,·) is a lossy clamp → carried)
//  food / foodSet                    respawn: p→c; eat: p→−1    reverse ops; Set rebuilt      COMPUTED
//      (foodSet ≡ {food[i] ≥ 0} is an invariant of every forward path incl.
//      refusals, so the undo rebuilds it from the array — exact)
//  respawnQ                          due prefix spliced +1 push un-push + prepend prefix     COMPUTED
//  ledger.{gamma,eta,sum}            overwritten per applied    carried pre ints;             CARRIED (int)
//                                    eval                       sum = γ+η recomputed
//  jepaWin[key]                      overwritten w/ obs2.win    carried prevWin / delete      CARRIED (9 ints)
//      (the NEW window is recomputable from the post state; the OVERWRITTEN
//      previous one is not → carried only when the key already existed)
//  jepaErr[key]                      EWMA fl(0.7·e+0.3·mse)     carried prevErr / delete      CARRIED (f64)
//      ← NON-INVERTIBLE COMPONENT #1: the EWMA is a lossy f64 contraction
//      (fl(0.7e+0.3m) is not injective in e). The exact inverse of a lossy
//      contraction is the contracted pre-image itself; the event carries it
//      (8 bytes, bit-exact through ECMA-262 shortest-round-trip JSON) instead
//      of guessing. Honest scope note, per the E-D4 brief.
//  sPrev                             overwritten when learned   carried pre int               CARRIED (int)
//  vibe.{position,velocity}          EWMA (α=0.002) + gain      carried pre pair              CARRIED (2×f64)
//      ← NON-INVERTIBLE COMPONENT #2: same lossy-contraction reason.
//  memory.semantic[cell]             v → fl(v+1) on a f64       carried prev value / delete   CARRIED (f64)
//      ← NON-INVERTIBLE COMPONENT #3: fl(fl(v)+1)−1 ≠ v in general.
//  memory.semantic (decay, 1/16)     ×0.98 + prune < 0.5        carried pre-decay map         CARRIED (map)
//      ← same component, decay side: ×0.98 is lossy and the prune DELETES — the
//      exact inverse of a destructive contraction is its pre-image, carried
//      every DECAY_EVERY evals.
//  memory.decayTick                  +1                         -1                            COMPUTED
//  memory.ring (episodic)            push | merge | shift       pop | n−1 | unshift(evictee)  COMPUTED (+CARRIED evictee)
//      (shift drops the head permanently → the evicted entry is carried;
//      push/merge undos are pure. The evictee re-enters the state as a CLONE:
//      the journal is never aliased into the state, so a deeper merge-undo —
//      which writes .n on the tail — can never mutate the log. The fold is
//      therefore IDEMPOTENT: repeated rewinds are byte-identical. Dev-caught
//      before the sealed run: unshifting the carried evictee by reference let
//      a merge-undo corrupt n on shift-carried entries across rewind calls.)
//  aversion                          add on refusal; expire     delete add; re-add expired    COMPUTED
//                                    when eval ≥ value          with value = t (deletion is
//                                                               checked every eval, so the
//                                                               expiry IS t — asserted)
//  teacher.{zone,label,sinceEval,    propose each 250/deplete,  carried pre ints; label       COMPUTED+CARRIED
//           proposes}                verdict-executed switch    `zone:z` recomputed
//  jev.{last,counts}                 verdict written            carried pre last; counts−1    CARRIED (obj)+COMPUTED
//  stage / growthLog                 1→2 + log push (once)      1 + pop                       COMPUTED
//  metrics.{refusals, appliedViolations, orients, foodEaten, holds, visited}     COMPUTED (−exact delta)
//
//  NON-canonical state (NOT in bundle(), NOT hashed, NOT restored — each is
//  re-derived before use on every eval or feeds recording only):
//    teacher.waypoint (recomputed at the top of every step), lastRefusal,
//    metrics.{starveEvals, sustainSurprise, maxSustain, maxEta, nonFinite,
//    diverged, divergenceWhy, fired, firedAt}.
//  Trajectory-NEUTRAL by construction: no step() branch READS them (they are
//  write-only bookkeeping). R2 verifies this empirically: a rewound-and-
//  continued run must land on the uninterrupted final hash.
//
//  Float policy (R5 audit scope): this layer COMPUTES ONLY WITH INTEGERS
//  (uint32 modular arithmetic in BigInt) and CARRIES opaque values (the three
//  documented f64 contractions pass through bit-exactly via ECMA-262
//  shortest-round-trip JSON — the quilt-raw fmt() discipline). Zero float
//  literals, zero float arithmetic, zero Math.random in this file.

import {
  Driver, driverFromBundle, step as coreStep,
} from './core.mjs';
import { DECAY_EVERY, GRID, ACTIONS, RESPAWN_DELAY, idx } from './kernels.mjs';
import { fnv1a64 } from './receipts.mjs';

// ── canonical deep JSON (sorted keys, arrays in order) — same canon as
//    dba/driver.mjs (copied, not imported: driver.mjs has a pre-existing
//    broken import of session-sheet exports; see E-D4 survey receipt) ────────
export function canonDeep(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canonDeep).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonDeep(v[k])).join(',') + '}';
}

export function stateHash(x) {
  const b = x instanceof Driver ? x.bundle() : x;
  return fnv1a64(canonDeep(b));
}
export function stateCanon(x) {
  const b = x instanceof Driver ? x.bundle() : x;
  return canonDeep(b);
}

// ── mulberry32 advance inverted: 0x6D2B79F5 is odd ⇒ invertible mod 2³² ─────
const RNG_C = 0x6D2B79F5n, M32 = 0xffffffffn, MOD = M32 + 1n;
function modInv32(a /* bigint, odd, gcd(a, 2³²)=1 */) {
  // extended Euclid over Z/2³² — exact, no search. Invariant: old_s·a ≡ old_r,
  // s·a ≡ r (mod 2³²); terminates with old_r = 1 ⇒ old_s is the inverse.
  let [old_r, r] = [a, MOD], [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return ((old_s % MOD) + MOD) % MOD;
}
const RNG_C_INV = modInv32(RNG_C);
// self-test used by the smoke: k advances then inverse recovers k exactly
export function rngAdvanceInverseTest() {
  for (let i = 0; i < 512; i++) {
    const st = (i * 2654435761) >>> 0, k = i % 9;
    const post = (st + Number((BigInt(k) * RNG_C) & M32)) >>> 0;
    if (Number((BigInt((post - st) >>> 0) * RNG_C_INV) & M32) !== k) return false;
    if ((post - Number((BigInt(k) * RNG_C) & M32)) >>> 0 !== st) return false;
  }
  return true;
}
const rngCalls = (pre, post) => Number((BigInt((post - pre) >>> 0) * RNG_C_INV) & M32);
// core.mjs stores the mulberry32 state SIGNED (|0, makeRng) after every eval,
// so the restored value must be the signed representation of the same bits
const rngRewind = (post, k) => ((post - Number((BigInt(k) * RNG_C) & M32)) >>> 0) | 0;

// ── checkpoint(state) -> event log ───────────────────────────────────────────
export function checkpoint(driver, meta = {}) {
  const b = driver.bundle();
  return {
    kind: 'dba-rewind-journal', v: 1, repo: 'quilt-dba', substrate: 'dba/core.mjs Driver',
    ...meta,
    baseEval: driver.state.eval, origin: b, originHash: stateHash(b),
    events: [], sampledCanon: {}, terminal: null, terminalHash: null,
  };
}

// record one eval boundary: run the unmodified core step, then build the event
export function recordStep(driver, log, opts = {}) {
  const s = driver.state;
  const t = s.eval;
  if (t !== log.baseEval + log.events.length) throw new Error(`journal gap: eval ${t} vs base ${log.baseEval}+${log.events.length}`);

  // ── pre-capture: only what the inverse needs and cannot recompute later ──
  const preJevLastRef = s.jev.last;
  const pre = {
    t,
    rngState: s.rngState,
    x: s.env.x, y: s.env.y, energy: s.env.energy,
    food: s.food.slice(),
    respawnQ: s.respawnQ.map(r => [r[0], r[1]]),
    teacherZone: s.teacher.zone, teacherSince: s.teacher.sinceEval, teacherProposes: s.teacher.proposes,
    jevCounts: { ...s.jev.counts },
    jevLastClone: preJevLastRef ? JSON.parse(JSON.stringify(preJevLastRef)) : null,
    ledgerGamma: s.ledger.gamma, ledgerEta: s.ledger.eta,
    sPrev: s.sPrev,
    vibeP: s.vibe.position, vibeV: s.vibe.velocity,
    ringLen: s.memory.ring.length,
    // ring captures are NORMALIZED (n always a number, absent -> 1): the live
    // entry may carry n as absent / undefined / explicit-1 depending on whether
    // it was born from a push, a merge-undo, or a bundle restore — the canonical
    // bundle renders n||1 identically, and normalizing here keeps the EVENT
    // representation stable across rewind+resume (R2 suffix equality).
    ringHead: s.memory.ring.length ? JSON.parse(JSON.stringify({ ...s.memory.ring[0], n: s.memory.ring[0].n || 1 })) : null,
    ringTail: s.memory.ring.length ? JSON.parse(JSON.stringify({ ...s.memory.ring[s.memory.ring.length - 1], n: s.memory.ring[s.memory.ring.length - 1].n || 1 })) : null,
    aversion: { ...s.aversion },
    decayTick: s.memory.decayTick,
    mRefusals: s.metrics.refusals, mViol: s.metrics.appliedViolations,
    mOrients: s.metrics.orients, mFood: s.metrics.foodEaten, mHolds: s.metrics.holds,
    stage: s.stage,
  };
  // near-cells: the semantic/visited/jepa writes of eval t land on the current
  // cell or one of its 4 move targets — capture their pre-values
  const semNear = {}, visNear = {}, jepaNear = {};
  const near = [[0, 0], ...ACTIONS];
  for (const [dx, dy] of near) {
    const nx = pre.x + dx, ny = pre.y + dy;
    if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) continue;
    const c = idx(nx, ny);
    semNear[c] = s.memory.semantic[c] === undefined ? null : s.memory.semantic[c];
    visNear[c] = s.visitedSet.has(c);
  }
  for (let a = 0; a < 4; a++) {
    const k = `${pre.x},${pre.y},${a}`;
    jepaNear[a] = {
      hadWin: s.jepaWin[k] !== undefined, win: s.jepaWin[k] ? s.jepaWin[k].slice() : null,
      hadErr: s.jepaErr[k] !== undefined, err: s.jepaErr[k] === undefined ? null : s.jepaErr[k],
    };
  }
  const willDecay = (pre.decayTick + 1) % DECAY_EVERY === 0;
  const semPreMap = willDecay ? { ...s.memory.semantic } : null;

  // ── the forward eval (unmodified core.mjs step) ───────────────────────────
  const r = coreStep(driver, opts);
  if (!r) throw new Error(`recordStep: no receipt at eval ${t} (maxEvals reached?)`);

  // ── classify the outcome from telemetry (return value + net diffs) ────────
  const refu = s.metrics.refusals > pre.mRefusals;
  const viol = s.metrics.appliedViolations > pre.mViol;
  const applied = r.action >= 0 && !refu;       // refused evals move nothing (net)
  const hold = r.action === -1;
  const postCell = idx(s.env.x, s.env.y);       // == pre cell unless applied
  if (semNear[postCell] === undefined) throw new Error(`post cell ${postCell} not in captured neighbourhood at eval ${t}`);

  // respawns processed this eval = the due prefix of the pre queue
  const rsp = [];
  {
    let i = 0;
    while (i < pre.respawnQ.length && pre.respawnQ[i][0] <= t) {
      const [d, p] = pre.respawnQ[i];
      rsp.push({ d, p, f: pre.food[p] });
      i++;
    }
    for (let j = 0; j < pre.respawnQ.length - i; j++) {
      const want = pre.respawnQ[i + j], got = s.respawnQ[j];
      if (want[0] !== got[0] || want[1] !== got[1]) throw new Error(`respawnQ not a due-prefix at eval ${t}`);
    }
  }

  // eat detection via the respawnQ push (deadline t+RESPAWN_DELAY is unique to
  // eval t). Handles BOTH eat shapes: moving onto a pre-existing pellet AND
  // the same-eval respawn-then-eat (the eaten cell is the respawn destination,
  // invisible in pre.food).
  const qExpect = pre.respawnQ.length - rsp.length;
  let ate = -1;
  if (s.respawnQ.length === qExpect + 1) {
    const tail = s.respawnQ[s.respawnQ.length - 1];
    if (tail[0] !== t + RESPAWN_DELAY) throw new Error(`respawnQ push deadline ${tail[0]} != t+${RESPAWN_DELAY} at eval ${t}`);
    if (!applied) throw new Error(`respawnQ push on a non-applied eval ${t}`);
    ate = tail[1];
  } else if (s.respawnQ.length !== qExpect) {
    throw new Error(`respawnQ length ${s.respawnQ.length} != expected ${qExpect} (+0/+1) at eval ${t}`);
  }
  if ((ate >= 0) !== (s.metrics.foodEaten === pre.mFood + 1)) {
    throw new Error(`eat/foodEaten mismatch at eval ${t}: ate ${ate}, foodEaten ${pre.mFood}->${s.metrics.foodEaten}`);
  }

  // jepa key (PRE position + action — computed at candidate time in core.step)
  const key = r.learned ? `${pre.x},${pre.y},${r.action}` : null;
  const jn = r.learned ? jepaNear[r.action] : null;

  // ring op detection (push | merge | shift | null)
  let ring = null, ringEvictee = null, ringTailN = null;
  const plen = pre.ringLen, qlen = s.memory.ring.length;
  if (qlen === plen + 1) ring = 'push';
  else if (qlen === plen) {
    const a0 = pre.ringTail, b0 = qlen ? s.memory.ring[qlen - 1] : null;
    if (b0 && a0 && a0.x === b0.x && a0.y === b0.y && a0.r === b0.r && a0.kind === b0.kind) {
      if ((b0.n || 1) !== (a0.n || 1)) { ring = 'merge'; ringTailN = a0.n === undefined ? null : a0.n; }
      // else: no ring write this eval (hold) — null
    } else if (plen > 0 && b0) { ring = 'shift'; ringEvictee = pre.ringHead; }
  } else throw new Error(`ring length jump ${plen}→${qlen} at eval ${t}`);

  // aversion: added on refusal; OVERWRITTEN on re-refusal of a marked cell
  // (value t+40 replaces the old expiry); expired keys deleted when eval
  // reaches expiry. All three cases carry their exact inverse.
  const avAdded = [], avChanged = [], avExpired = [];
  for (const k of Object.keys(s.aversion)) if (pre.aversion[k] === undefined) avAdded.push(Number(k));
  if (avAdded.length > 1) throw new Error(`>1 aversion add at eval ${t}`);
  for (const k of Object.keys(pre.aversion)) {
    if (s.aversion[k] === undefined) {
      if (pre.aversion[k] !== t) throw new Error(`aversion expiry ${pre.aversion[k]} deleted at eval ${t}: expiry model broken`);
      avExpired.push(Number(k));
    } else if (s.aversion[k] !== pre.aversion[k]) {
      avChanged.push({ c: Number(k), v: pre.aversion[k] });
    }
  }

  // teacher / jev
  const proposed = s.teacher.proposes > pre.teacherProposes;
  const executed = s.teacher.zone !== pre.teacherZone;   // zone actually switched
  const armD = s.arm === 'D';
  const cntDelta = (s.jev.counts.execute - pre.jevCounts.execute)
    + (s.jev.counts.escalate - pre.jevCounts.escalate)
    + (s.jev.counts.discard - pre.jevCounts.discard);
  const verdictWritten = proposed && !armD && cntDelta === 1;   // gate writes verdicts
  if (proposed && !armD && cntDelta > 1) throw new Error(`multiple jev verdicts at eval ${t}?`);
  const jv = verdictWritten ? s.jev.last.verdict : null;
  const tch = proposed ? (executed ? (armD ? 3 : 1) : 2) : 0;

  const ev = {
    t,
    a: r.action, refl: r.viaReflex ? 1 : 0, viol: viol ? 1 : 0,
    appr: applied ? 1 : 0, refu: refu ? 1 : 0, hold: hold ? 1 : 0,
    ate, rsp, k: rngCalls(pre.rngState, s.rngState),
    key,
    newCell: r.learned && visNear[postCell] === false ? 1 : 0,
    oWin: jn && jn.hadWin ? 1 : 0, oWinV: jn && jn.hadWin ? jn.win : null,
    oErr: jn && jn.hadErr ? 1 : 0, oErrV: jn && jn.hadErr ? jn.err : null,
    lSem: semNear[postCell],
    dec: willDecay ? semPreMap : null,
    ring, ringEvictee, ringTailN,
    avAdd: avAdded.length ? avAdded[0] : -1,
    avChg: avChanged,
    avExp: avExpired,
    tch, tFrom: pre.teacherZone, tSince: pre.teacherSince, jv,
    jvLast: verdictWritten ? pre.jevLastClone : null,
    gE: applied ? pre.energy : null,
    gL: pre.ledgerGamma, gM: pre.ledgerEta,
    gSPrev: pre.sPrev, gVp: pre.vibeP, gVv: pre.vibeV,
    gro: (pre.stage === 1 && s.stage === 2) ? 1 : 0,
  };
  ev.postHash = stateHash(driver);
  log.events.push(ev);
  return r;
}

// ── THE INVERSE: one per-event undo (applied to a state sitting at ev.t+1) ───
// rngOverride: for the journal's FIRST event, the pre-state is the origin
// bundle itself, whose stored rngState representation we must reproduce
// verbatim (freshState seeds it >>> 0-unsigned; every later eval stores it
// |0-signed) — the bits are identical, the JSON number is not.
export function undoEvent(s, ev, { rngOverride = null } = {}) {
  const postCell = idx(s.env.x, s.env.y);      // read BEFORE un-moving

  // 12. growth (reverse of the one-way 1→2 transition)
  if (ev.gro) { s.stage = 1; s.growthLog.pop(); }

  // 10. vibe + sPrev (carried f64 pair / int — components #1..3 class)
  s.vibe.position = ev.gVp; s.vibe.velocity = ev.gVv; s.sPrev = ev.gSPrev;

  // 9. teacher + jev
  if (ev.tch) {
    s.teacher.proposes--;
    s.teacher.sinceEval = ev.tSince;
    if (ev.tch === 1 || ev.tch === 3) { s.teacher.zone = ev.tFrom; s.teacher.label = `zone:${ev.tFrom}`; }
  }
  if (ev.jv) { s.jev.counts[ev.jv]--; s.jev.last = ev.jvLast; }

  // 8. semantic: un-decay (restore carried pre map), then un-+1 the cell
  if (ev.dec) {
    for (const k of Object.keys(s.memory.semantic)) delete s.memory.semantic[k];
    Object.assign(s.memory.semantic, ev.dec);
  }
  if (ev.lSem === null) delete s.memory.semantic[postCell];
  else s.memory.semantic[postCell] = ev.lSem;
  s.memory.decayTick--;

  // 8b. aversion: un-add the refusal mark, restore re-refusal overwrites,
  //     re-add expired (expiry == t, asserted in the builder)
  if (ev.avAdd >= 0) delete s.aversion[ev.avAdd];
  for (const { c, v } of ev.avChg) s.aversion[c] = v;
  for (const c of ev.avExp) s.aversion[c] = ev.t;

  // 7. conservation counters
  if (ev.refu) s.metrics.refusals--;
  if (ev.viol) s.metrics.appliedViolations--;

  // 6. env/food — reverse of forward order: un-push respawn, un-eat, un-move,
  //    un-respawn-prefix; foodSet rebuilt from the invariant
  if (ev.ate >= 0) {
    const last = s.respawnQ[s.respawnQ.length - 1];
    if (!last || last[0] !== ev.t + RESPAWN_DELAY || last[1] !== ev.ate) {
      throw new Error(`respawnQ push mismatch at eval ${ev.t}`);
    }
    s.respawnQ.pop();
    s.food[ev.ate] = postCell;
    s.metrics.foodEaten--;
  }
  if (ev.appr) {
    s.env.x -= ACTIONS[ev.a][0];
    s.env.y -= ACTIONS[ev.a][1];
    s.env.energy = ev.gE;
  }
  // orients++ precedes the conservation check in core.step, so it fires even
  // when the reflex move is then refused — undo it whenever the reflex ran
  if (ev.refl) s.metrics.orients--;
  for (let i = ev.rsp.length - 1; i >= 0; i--) {
    const { d, p, f } = ev.rsp[i];
    s.food[p] = f;
    s.respawnQ.unshift([d, p]);
  }
  s.foodSet = new Set(s.food.filter(c => c >= 0));

  // 5. jepa tables (carried pre-values / deletion)
  if (ev.key) {
    if (ev.oWin) s.jepaWin[ev.key] = ev.oWinV; else delete s.jepaWin[ev.key];
    if (ev.oErr) s.jepaErr[ev.key] = ev.oErrV; else delete s.jepaErr[ev.key];
  }

  // 4. ledger (carried ints; sum recomputed — exact integer addition)
  s.ledger.gamma = ev.gL;
  s.ledger.eta = ev.gM;
  s.ledger.sum = ev.gL + ev.gM;

  // 3. episodic ring
  if (ev.ring === 'push') s.memory.ring.pop();
  else if (ev.ring === 'merge') s.memory.ring[s.memory.ring.length - 1].n = ev.ringTailN === null ? undefined : ev.ringTailN;
  else if (ev.ring === 'shift') {
    s.memory.ring.pop();
    // CLONE on re-entry: the evictee object belongs to the event log; unshifting
    // it by reference would let a deeper merge-undo (which writes .n on the
    // tail) mutate the JOURNAL itself — rewind must be idempotent (dev-caught:
    // repeat-rewind corrupted n on shift-carried entries).
    s.memory.ring.unshift({ ...ev.ringEvictee });
  }

  // 2. holds + visited (the visited tail IS the added cell)
  if (ev.hold) s.metrics.holds--;
  if (ev.newCell) { s.metrics.visited.pop(); s.visitedSet.delete(postCell); }

  // 1 + 0. eval clock, then rng (exact modular inverse of the advance)
  s.eval = ev.t;
  s.rngState = rngOverride !== null ? rngOverride : rngRewind(s.rngState, ev.k);
}

// ── rewind(log, k) -> Driver at eval k ───────────────────────────────────────
// One deterministic fold of per-event inverses from the current position down
// to k. Builds a FRESH driver (the live run is untouched); pass {driver} for
// the live state or seal(log) first to embed the terminal state in the log.
export function rewind(log, k, { driver = null } = {}) {
  if (k < log.baseEval || k > log.baseEval + log.events.length) {
    throw new RangeError(`rewind target ${k} outside journal [${log.baseEval}, ${log.baseEval + log.events.length}]`);
  }
  const srcBundle = driver ? driver.bundle() : log.terminal;
  if (!srcBundle) throw new Error('rewind: pass {driver} or seal(log, driver) first');
  const d = driverFromBundle(JSON.parse(JSON.stringify(srcBundle)));
  const s = d.state;
  for (let i = log.events.length - 1; i >= 0 && s.eval > k; i--) {
    const ev = log.events[i];
    if (s.eval !== ev.t + 1) throw new Error(`fold misaligned: state eval ${s.eval}, event t ${ev.t}`);
    const first = i === 0 && ev.t === log.baseEval;
    undoEvent(s, ev, { rngOverride: first ? log.origin.rngState : null });
  }
  if (s.eval !== k) throw new Error(`fold stopped at eval ${s.eval}, wanted ${k}`);
  return d;
}

// ── fork: a new lineage = journal prefix (quilt-raw fork(j, t) pattern) ──────
export function forkLog(log, k, { driver = null } = {}) {
  const atK = rewind(log, k, { driver });
  return {
    driver: atK,
    log: {
      kind: 'dba-rewind-journal', v: 1, repo: log.repo, substrate: log.substrate,
      forkedFrom: log.originHash, baseEval: k,
      origin: atK.bundle(), originHash: stateHash(atK),
      events: [], sampledCanon: {}, terminal: null, terminalHash: null,
    },
  };
}

// ── seal + verify ─────────────────────────────────────────────────────────────
export function seal(log, driver) {
  log.terminal = driver.bundle();
  log.terminalHash = stateHash(driver);
  return log;
}

export function journalHash(log) {
  return fnv1a64(canonDeep({ baseEval: log.baseEval, originHash: log.originHash, events: log.events }));
}

// verifyRewind(log, ks) — bit-equality (canonical STRING equality, not just the
// 64-bit hash) at the origin and at every sampled k, against the forward-run
// canon captured at those ticks (sampleCanon during the forward run).
export function verifyRewind(log, ks, { driver = null } = {}) {
  const checks = [];
  let ok = true;
  for (const k of [...ks].sort((a, b) => a - b)) {
    const d = rewind(log, k, { driver });
    const rewindHash = stateHash(d);
    const fwdHash = k === log.baseEval
      ? log.originHash
      : (log.events[k - 1 - log.baseEval] ? log.events[k - 1 - log.baseEval].postHash : null);
    const hashOk = fwdHash !== null && rewindHash === fwdHash;
    const fwdCanon = log.sampledCanon[k] ?? null;
    const canonOk = fwdCanon === null ? null : stateCanon(d) === fwdCanon;
    const bitEqual = hashOk && canonOk !== false;
    if (!bitEqual) ok = false;
    checks.push({ k, fwdHash, rewindHash, hashOk, canonChecked: fwdCanon !== null, canonOk, bitEqual });
  }
  return { ok, checks };
}

// capture the forward canon at a tick during the forward run
export function sampleCanon(log, driver) {
  log.sampledCanon[driver.state.eval] = stateCanon(driver);
}
