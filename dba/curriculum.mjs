// dba/curriculum.mjs — E-D5: THE FOLD CURRICULUM (lane 25-d; file-disjoint
// from the E-D4/rewind lane: dba/rewind.mjs, experiments/e_d4_rewind.mjs,
// experiments/smoke_ed4.mjs and their outputs are NOT touched).
//
// Translates seed-edu.md "Raising a Child Who Sees the Fold" (§L45-209) into
// STAGE GATES for the quilt-dba developmental agent, and tests whether
// stage-gating changes development quality vs the E-D1 single JEV gate.
//
// ── STAGE → MECHANISM MAP (each stage cites the seed lines it implements) ──
//
//  PRESENCE (0-2y; L59-74). "You hold the child. The child holds nothing"
//    (L61); "there is an inside, and there is an outside, and the boundary
//    is real" (L63). Agent: SENSING ONLY — sensors fire, JEPA predicts,
//    world surprise is observed, the world ticks (respawns), but NO world
//    transition is executed ("You hold the child" = no commitment), no cells
//    are added, and EVERY growth proposal is refused (gate = refuse-all).
//    Exit (L71 "Watch for: the first time the child reaches for something
//    and then looks at you"): the reflex.orient reach (salience over the
//    reflex bar = food at the boundary) AND the teacher has consulted at
//    least once (the look). No steering during Presence (the parent holds).
//
//  PLAY (2-4y; L77-90). "Play is the child's method" (L79); "be a playmate,
//    not a teacher... Do not correct. Do not improve. Play along" (L83);
//    "the fold can be made and unmade... making and breaking are the same
//    operation seen from two sides" (L85). Agent: curriculum switches EXECUTE
//    ungated (the gate is consulted and LOGGED but its verdict is ignored —
//    the playmate does not gate); NO aversion marks on refusal (no
//    correction); growth proposals accepted 100% (R4 prediction: Play
//    refuses 0% by design) as EPHEMERAL play-structures (added, then removed
//    at stage exit — a tower is a thing, then it isn't). RECEIPTED
//    INTERPRETATION (the brief's own clause): the seed's point is that play
//    is safe BECAUSE the guardian holds the boundary — so the conservation
//    law is STILL ENFORCED at C on world transitions (breaching transitions
//    are refused and rolled back), but the DEBT ACCOUNTING is not enforced:
//    would-be breach mass (arm-B accounting, Σ max(0, sum−C)) and the growth
//    charges of play-structures accumulate in a separate play-debt ledger
//    that is FORGIVEN (zeroed, logged) at stage exit.
//
//  MAKING (4-7y; L93-104). "Not playthings — real things" (L95); "things
//    have rules... invariants exist" (L99); "Let them ruin things... The
//    failure is the lesson" (L103). Agent: FIRST REAL CELL ADDITIONS, ONE AT
//    A TIME; each addition must MEASURABLY lower world surprise — after the
//    addition, over a trailing window of executed transitions, mean eta must
//    DROP below the pre-addition window (delta < 0; the E-D1 gate but
//    stricter, per brief); an addition that fails is REVERTED.
//    Exit (L101 "Watch for: the first time the child asks 'why' — genuine
//    confusion about a rule"): a RULE-CONFUSION event — on a non-flicker
//    eval with a competent trailing window (mean eta <= PLATEAU_ETA), the
//    executed transition's eta breaches max(RULE_CONFUSION_ABS, 2x window
//    mean): the learned rule broke where it used to hold. That breach IS the
//    why-question. (selfFed — food outside the teacher zone — stays as
//    §L115-context telemetry only.)
//
//  SYSTEMS (7-10y; L107-118). "How things connect" (L109); "follow the
//    child's questions. Not lead — follow" (L111). Agent: MULTI-CELL
//    programs allowed — a temporal program over a CELL-GROUP (the
//    consolidation listener watching [memory.episodic, memory.semantic]).
//    RECEIPTED SCOPE GAP: the vendored engine has listener cells
//    (shared/kit.mjs listenerCell) but no cron/every-schedule primitive, so
//    the temporal firing (every DECAY_EVERY evals) is implemented
//    driver-side here and scoped to what exists. Switch proposals become
//    child-led (argmax over the AGENT's semantic coverage — follow, not
//    lead). Exit (L115 "Watch for: the first time the child explains
//    something to you that you didn't teach"): SELF-TAUGHT COMPETENCE — one
//    action's transition key, FIRST LEARNED during this stage (first write
//    already competent: eta <= ABSTRACTION_KEY_ETA), at >=
//    ABSTRACTION_POSITIONS distinct positions — the agent now predicts
//    right somewhere no teacher pointed.
//
//  ABSTRACTION (10-13y; L121-132). "The same pattern appears in different
//    places" (L123); "the same operation in different clothes" (L127). Agent:
//    growth continues, but new cells must REUSE EXISTING KERNEL PARAMS (a
//    proposal declaring newParams > 0 is refused; parameter reuse rate is
//    measured over accepted + attempted proposals). The parameterized
//    policy-kernel cell applies the SAME NOVELTY_W weight to the OPPOSITE
//    argument — novelty preferred the unknown; the kernel prefers the
//    PREDICTABLE (low etaPred): the same operation in different clothes, no
//    new constants. Exit (L129 "Watch for: the first time the child makes a
//    connection you didn't see... They are folding folds. They are
//    composing"): THE CONNECTION WORKS — the stage's reuse-cell
//    (policy.kernel) is accepted and its measurement resolves delta < 0
//    (the old op genuinely lowers surprise in its new clothes). A reverted
//    connection is re-attempted (the pace is not the point, L175).
//
//  INDEPENDENCE (13-16y; L135-146). "Do not be the authority. Be the safety
//    net" (L139); "Do not hover. Do not check" (L145). Agent: THE JEV GATE
//    STEPS BACK — switch proposals are consulted, logged, and executed
//    regardless of verdict; ONLY the conservation law remains (every world
//    transition still C-checked; growth accepted iff its charge fits under
//    C). Exit (L143 "Watch for: the first time the child argues with you and
//    wins... by thinking"): >= WINS_N times the agent moves AGAINST the
//    teacher waypoint and eats anyway — the world upholds its
//    counter-argument.
//
//  SYNTHESIS (16-18y; L149-160). "They see connections across everything...
//    a view" (L151); "listen as a peer" (L153); "the fold is what they are.
//    Not what they do" (L155); "Leave them here: forever" (L159). Agent:
//    composition across stages — the TEACHER now proposes FROM the agent's
//    own dwell data (the relationship inverts; L203 "You are no longer the
//    teacher. You are the witness"). Exit (L157 "Watch for: the first time
//    the child asks you a question you can't answer... genuinely new"): a
//    question OUTSIDE the teacher's vocabulary — the teacher:offline-rule
//    only answers zone-food density, so the unanswerable question is either
//    (a) food eaten in a zone the teacher NEVER proposed this run, or
//    (b) >= NEWQ_N never-seen JEPA keys asked since stage entry (§L165 "the
//    questions are the fold"; a new key is an ask about a transition the
//    teacher has no answer for). Exit opens the NESTED cycle: a new Presence
//    INSIDE the grown sheet (the fold folds again), replaying
//    Presence*→Play*→Making* at depth 1 with TIGHTENED competence
//    thresholds (NESTED_PLATEAU_ETA).
//    RECEIPTED SCOPE: recursion depth capped at 1 this lane (grandchildren
//    out of scope); the nested cycle is the testable form of R3.
//
//  §WHAT YOU ARE WATCHING FOR, ALWAYS (L163-178): "Not the answers. The
//    questions." (L165) — the agent's QUESTION is a JEPA transition key it
//    has never evaluated (a candidate move into an unvisited (x,y,a) key);
//    new-key rate is tracked every eval. "A child who asks the same
//    questions is stuck" (L167) — stuckness (zero new keys + zero food over
//    a trailing window) triggers THE NUDGE (L181-192: "You don't nudge with
//    words... Just ask a smaller question" L187): the teacher's next
//    proposal targets the ADJACENT zone with the most food — a smaller
//    question, never an answer (the nudge never touches the policy).
//    "Do not confuse compliance with understanding" (L173) and "the pace is
//    not the point" (L175): stage criteria are SIGNAL-based, never
//    schedule-based — a stage lasts exactly as long as its watching-for
//    takes to fire. RECEIPTED SCOPING LAW (dev-run audit, pre-final): every
//    watching-for is measured WITHIN its own stage — a stage never inherits
//    a predecessor's signal history (selfFed / wins / confusions filter on
//    eval >= stageEnteredAt; self-taught keys are recorded per stageId;
//    new-key and consult counters diff against their stage-entry values).
//    Without this, four stages fire instantly on carried signal (the dev
//    mini-run receipted ticks 332/333/334/335) and the curriculum gates
//    nothing — the seed's stages are periods of a life, not global flags.
//
//  TEACHER PRESENCE (receipted, applies to the CUR arm at every stage):
//    seed-edu L65-67 "When the child cries, come. When the child reaches,
//    meet. The rhythm of need and satisfaction is the first lesson." — the
//    teacher:offline-rule's waypoint pull strengthens when the agent is
//    hungry (energy <= HUNGER_FLOOR: +HUNGER_PULL toward the waypoint).
//    Dev-run evidence: the CUR agent starved to divergence at (7,1) — energy
//    0, food visible 2 steps away, every move pre-gate-infeasible at that
//    flicker cell — because no term pulled it back while it wandered; the
//    E-D1 arms never starve only because their growth wires the +300 label
//    edge (a food channel the CUR growth program does not include). The
//    parent's standing presence is part of the fold-curriculum treatment;
//    the E-D1 arms keep their receipted semantics verbatim.
//
// ── SUBSTRATE ──────────────────────────────────────────────────────────────
// The eval loop below mirrors dba/core.mjs step() (E-D1/E-D3 receipted
// semantics: same kernels, same constants, same refusal/rollback path) with
// the E-D1 one-shot growth layer (core.mjs §12) REPLACED by the stage
// machine for the CUR arm; the SINGLE and UNG arms keep the E-D1 threshold
// rule (position > STAGE1_THRESHOLD => the stage-2 cell pair) verbatim.
// All ledger quantities are SCALED INTEGERS (unit 1/1000 bit; C = 1585);
// boundary semantics reused verbatim from dba/kernels.mjs (1585 ok / 1586
// refuse). state.stage stays pinned at 1 so kernels.policyScore's own
// stage>=2 branch stays inert; grown behavior is feature-driven here.

import * as K from './kernels.mjs';
import { fnv1a64 } from './receipts.mjs';
import { makeRng } from './core.mjs';

// ── stage table (order IS the seed's year order) ───────────────────────────
export const STAGE_ORDER = ['presence', 'play', 'making', 'systems', 'abstraction', 'independence', 'synthesis'];

export const STAGES = {
  presence:     { name: 'Presence',     depth: 0, gate: 'held',        seed: 'seed-edu L59-74' },
  play:         { name: 'Play',         depth: 0, gate: 'play',        seed: 'seed-edu L77-90' },
  making:       { name: 'Making',       depth: 0, gate: 'gate',        seed: 'seed-edu L93-104' },
  systems:      { name: 'Systems',      depth: 0, gate: 'gate-follow', seed: 'seed-edu L107-118' },
  abstraction:  { name: 'Abstraction',  depth: 0, gate: 'gate',        seed: 'seed-edu L121-132' },
  independence: { name: 'Independence', depth: 0, gate: 'free',        seed: 'seed-edu L135-146' },
  synthesis:    { name: 'Synthesis',    depth: 0, gate: 'peer',        seed: 'seed-edu L149-160' },
  // nested cycle (depth 1): the fold folds again — tightened thresholds
  'presence:2': { name: 'Presence*',    depth: 1, gate: 'held',        seed: 'seed-edu L149-159 (nested)' },
  'play:2':     { name: 'Play*',        depth: 1, gate: 'play',        seed: 'seed-edu L149-159 (nested)' },
  'making:2':   { name: 'Making*',      depth: 1, gate: 'gate',        seed: 'seed-edu L149-159 (nested)' },
  'folded':     { name: 'Folded',       depth: 1, gate: 'peer',        seed: 'seed-edu L159-163 (terminal)' },
};

// ── criteria constants (receipted BEFORE runs in experiments/
//    e_d5_curriculum.mjs; units are scaled ints, eta = round(2000*mse)) ─────
export const E5 = {
  WINDOW: 50,              // trailing window for surprise statistics (evals)
  PLATEAU_ETA: 400,        // Making entry: mean eta <= 400 (mse <= 0.2) ...
  NESTED_PLATEAU_ETA: 300, // ... nested Making*: deeper (the fold folds again)
  PLATEAU_NO_REFUSAL: 20,  // ... and no refusal in the last 20 evals (kept)
  RULE_CONFUSION_ABS: 600, // Making exit (L101 asks-why): a non-flicker eval
                           // with eta >= max(600, 2x window mean) while the
                           // window is competent (mean <= PLATEAU_ETA) — the
                           // learned rule broke where it used to hold
  ABSTRACTION_POSITIONS: 4,  // Systems exit (L115): one action self-taught at
                             // >= 4 positions DURING the stage
  ABSTRACTION_KEY_ETA: 400,  // "self-taught" = first-write eta <= 400
  WINS_N: 3,               // Independence exit: >= 3 against-teacher wins (L143)
  WINS_WINDOW: 200,        // cap of the new-key rolling window (§L165 telemetry)
  NEWQ_N: 5,               // Synthesis exit (L157): >= 5 never-seen keys asked
                           // since entry — questions the teacher cannot answer
  MAKING_MEASURE: 80,      // executed transitions to measure a new cell's delta
  MAKING_MIN_SAMPLES: 20,  // min samples for a span-cap judgment
  MAKING_MEASURE_CAP: 200, // eval-span cap before judging with what is there
  GAMMA_GROWTH: 250,       // growth-check charge (dba/sheet.mjs hole-fill note)
  LISTEN_EVERY: K.DECAY_EVERY, // Systems listener period — REUSES DECAY_EVERY
  NUDGE_WINDOW: 100,       // stuckness window (§The Nudge)
  LABEL_BONUS: 300,        // single-gate arm's label-channel bias (sheet.mjs)
  HUNGER_FLOOR: 20,        // teacher presence (L65-67): energy <= 20 ...
  HUNGER_PULL: 2.0,        // ... => +2.0/step toward the teacher waypoint
};

// ── cell declarations (real growth program; sheet graph anchored to the
//    receipted engine sheet: stage-1 V=24 E=22, dba/sheet.mjs skills.graph) ──
const DECL = {
  making: [{
    id: 'sensors.gradient', newParams: [], reusedParams: [],
    edges: [['memory.semantic', 'sensors.gradient'], ['sensors.gradient', 'policy.action']],
    why: 'first real thing: local known-food gradient (L95 "real things")',
  }],
  systems: [{
    id: 'consolidate.temporal', newParams: [], reusedParams: ['DECAY_EVERY'],
    edges: [['memory.episodic', 'consolidate.temporal'], ['memory.semantic', 'consolidate.temporal'], ['consolidate.temporal', 'memory.semantic']],
    why: 'temporal program over a cell-group (L109); period reuses DECAY_EVERY',
  }],
  abstraction: [{
    id: 'policy.kernel', newParams: [], reusedParams: ['NOVELTY_W'],
    edges: [['memory.semantic', 'policy.kernel'], ['policy.kernel', 'policy.action']],
    why: 'the same op in different clothes (L127): NOVELTY_W applied to predicted surprise — prefer the predictable',
  }, {
    // the gate's NEGATIVE TEST: a redundant CONCRETE duplicate proposing a new
    // constant — Abstraction must refuse it (L127 "the same operation in
    // different clothes", not another operation).
    id: 'policy.concrete', newParams: ['CONCRETE_W'], reusedParams: [],
    edges: [['memory.semantic', 'policy.concrete'], ['policy.concrete', 'policy.action']],
    why: 'negative test: a new-param concrete duplicate must be REFUSED by the reuse gate',
  }],
  independence: [{
    id: 'reflex.tune', newParams: [], reusedParams: ['EWMA_ALPHA'],
    edges: [['state.stage', 'reflex.tune'], ['reflex.tune', 'reflex.orient']],
    why: 'self-tuned reflex bar from own learning velocity (L137 "beyond you")',
  }],
  'making:2': [{
    id: 'memory.route', newParams: [], reusedParams: ['NOVELTY_W'],
    edges: [['memory.semantic', 'memory.route'], ['memory.route', 'policy.action']],
    why: 'nested SECOND GROWTH PHASE: route preference over known-food sites',
  }],
  play: [
    { id: 'play.tower.a', newParams: [], reusedParams: [], edges: [], ephemeral: true, why: 'L85 a tower is a thing' },
    { id: 'play.tower.b', newParams: [], reusedParams: [], edges: [], ephemeral: true, why: 'L85 then it isn\u2019t' },
  ],
  'play:2': [
    { id: 'play.tower.a2', newParams: [], reusedParams: [], edges: [], ephemeral: true, why: 'nested make' },
    { id: 'play.tower.b2', newParams: [], reusedParams: [], edges: [], ephemeral: true, why: 'nested unmake' },
  ],
};
const SHEET0 = { V: 24, E: 22 }; // receipted engine-sheet anchor (dba/sheet.mjs)

// ── fresh state (mirrors Driver.freshState + stage fields) ─────────────────
export function freshState5({ arm, seed, gain, worldSeed }) {
  const world = K.genWorld(worldSeed >>> 0);
  const s = {
    arm, seed, gain, worldSeed: worldSeed >>> 0,
    eval: 0,
    stage: 1,                 // E-D1's stage field, pinned to 1 (labelW branch inert)
    stageId: 'presence',      // E5 stage machine (CUR arm; SINGLE/UNG stay here unused)
    rngState: ((worldSeed >>> 0) ^ 0xA5A5A5A5) >>> 0,
    env: { x: 8, y: 8, energy: K.ENERGY0 },
    food: world.food.slice(),
    respawnQ: [],
    hazards: world.hazards,
    jepaWin: {}, jepaErr: {},
    ledger: { gamma: 0, eta: 0, sum: 0 },
    sPrev: 0,
    vibe: { position: 0, velocity: 0 },
    memory: { ring: [], semantic: {}, decayTick: 0 },
    aversion: {},
    aversionBreach: {},       // CUR boundary lesson (L63/L73): cell -> {until, w}
                              // — repeated refusals of the SAME target escalate
                              // the agent's own episodic mark until it outweighs
                              // the pull that keeps bashing (E-D1 arms: flat 8,
                              // verbatim)
    teacher: { zone: 0, label: 'zone:0', sinceEval: 0, proposes: 0, channel: 'teacher:offline-rule', waypoint: null },
    jev: { last: null, counts: { execute: 0, escalate: 0, discard: 0, ignored: 0 }, label: K.JEV_LABEL },
    features: {},             // added-cell id -> true (behavioral effects)
    sheet: { ...SHEET0 },
    growthLog: [],            // {eval, stageId, cells, kind, gamma, eta, verdict, delta?}
    proposals: { made: 0, accepted: 0, refused: 0, deferred: 0, idle: 0, byStage: {} },
    refusedProposals: [],     // {eval, stageId, cell, why} (cap 256)
    playDebt: { breach: 0, charge: 0, forgivenAt: null },
    measuring: null,          // Making one-at-a-time: {cell, at, preMean, samples, span, observeOnly}
    measureBuf: [],           // {eval, eta} executed transitions while measuring
    stageHistory: [{ stageId: 'presence', enteredAt: 0, depth: 0 }],
    stageEnteredAt: 0,        // scoping law: watching-for signals count only
                              // from their stage's entry tick (seed-edu L175)
    stageEntryOrient: 0,
    stageEntryProposes: 0,
    stageEntryQuestions: 0,   // s.sig.questions at stage entry (synthesis exit)
    counts: {
      refusals: 0, refusalsByStage: {}, playRefusals: 0, appliedViolations: 0,
      orients: 0, foodEaten: 0, holds: 0, starveEvals: 0, growthRefusals: 0,
      conservationChecks: 0, conservationViolations: 0, nonFinite: 0, maxEta: 0,
      sustainSurprise: 0, maxSustain: 0, nudges: 0,
    },
    sig: {
      etaWindow: [],          // last WINDOW executed etas (non-flickered: weather excluded)
      lastRefusalEval: -999,
      questions: 0,           // cumulative never-seen JEPA keys asked (L165)
      orientFires: 0,
      selfFed: [],            // {eval, zone} foods eaten outside the teacher zone (telemetry)
      confusions: [],         // {eval, eta, mean} L101 rule-break events (the why-question)
      wins: [],               // {eval} against-teacher-then-eat wins (L143)
      eaten: [],              // {eval, zone} all foods eaten (cap 400)
      proposedZones: { 0: true },
      stageLearned: {},       // stageId -> {action: {"x,y": 1}} keys FIRST learned
                              // in that stage already competent (L115 self-taught)
      connectionKept: false,  // abstraction: the reuse-cell's measurement resolved
                              // delta < 0 (L129 the connection works)
      newKeyWindow: [],       // per-eval count of never-seen candidate keys
      against: [],
    },
    diverged: false, divergenceWhy: null,
    grewE1: false,            // SINGLE/UNG: the E-D1 stage-2 pair has fired
    secondGrowth: null,       // nested Making* kept cell (R3)
    labelDir: null,
    foodSet: new Set(world.food.filter((c) => c >= 0)),
    visited: { '8,8': 1 },
  };
  return s;
}

const idx = (x, y) => y * K.GRID + x;

// ── signals (§What You Are Watching For, Always — L163-178) ────────────────
export function signals(s) {
  const w = s.sig.etaWindow;
  const mean = w.length ? w.reduce((a, b) => a + b, 0) / w.length : Infinity;
  const varr = w.length > 1 ? w.reduce((a, b) => a + (b - mean) ** 2, 0) / w.length : 0;
  const nw = s.sig.newKeyWindow;
  return {
    meanEta: mean, varEta: varr, n: w.length,
    newKeyRate: nw.length ? nw.reduce((a, b) => a + b, 0) / nw.length : 0,
  };
}
function plateau(s, floor) {
  const w = s.sig.etaWindow;
  if (w.length < E5.WINDOW) return false;
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  return mean <= floor && (s.eval - s.sig.lastRefusalEval) > E5.PLATEAU_NO_REFUSAL;
}
function winsSinceEntry(s) {
  return s.sig.wins.filter((f) => f.eval >= s.stageEnteredAt).length;
}
function confusionsSinceEntry(s) {
  return s.sig.confusions.filter((f) => f.eval >= s.stageEnteredAt);
}
function selfTaughtPositions(s) {
  // L115: one action's key first learned (already competent) during THIS stage
  const byAction = s.sig.stageLearned[s.stageId] || {};
  let best = 0;
  for (const a of Object.keys(byAction)) best = Math.max(best, Object.keys(byAction[a]).length);
  return best;
}
function novelZoneFed(s) {
  // the QUESTION the parent cannot answer: since stage entry, food in a zone
  // the teacher never proposed this run (proposed = named, executed or not)
  for (let i = s.sig.eaten.length - 1; i >= 0; i--) {
    const e = s.sig.eaten[i];
    if (e.eval < s.stageEnteredAt) break;
    if (!s.sig.proposedZones[e.zone]) return true;
  }
  return false;
}
function unanswerableQuestions(s) {
  // L157 clause (b): never-seen keys ASKED since entry — the teacher
  // (zone-food vocabulary) has no answer for them (§L165)
  return s.sig.questions - s.stageEntryQuestions;
}

// stage EXIT criteria (the seed's own watching-for, made measurable — the
// mapping is RECEIPTED in experiments/e_d5_curriculum.mjs rules.R1; every
// signal is measured WITHIN its stage: eval >= s.stageEnteredAt).
export function stageExit(s) {
  switch (s.stageId) {
    // PRESENCE exit: the first QUESTION (a never-seen JEPA key = the reach,
    // L71/§L165) AND the first teacher consult (the look). RECEIPTED
    // ADAPTATION: under 'held' the world is static (respawns require eating),
    // so the L71 motor reach is folded into the attentional question signal
    // — a held agent in a static world could otherwise never reach.
    case 'presence':     return s.sig.questions >= 1 && s.teacher.proposes >= 1;
    case 'play':         return plateau(s, E5.PLATEAU_ETA);                        // L87 keeps a thing
    case 'making':       return confusionsSinceEntry(s).length >= 1;               // L101 asks why
    case 'systems':      return selfTaughtPositions(s) >= E5.ABSTRACTION_POSITIONS; // L115 explains untaught
    case 'abstraction':  return s.sig.connectionKept === true;                     // L129 the connection works
    case 'independence': return winsSinceEntry(s) >= E5.WINS_N;                    // L143 argues and wins
    case 'synthesis':    return novelZoneFed(s) || unanswerableQuestions(s) >= E5.NEWQ_N; // L157 unanswerable
    // nested Presence*: the look INSIDE the grown sheet (a consult in scope;
    // the reach is satisfied by the Synthesis crossing itself) — RECEIPTED.
    case 'presence:2':   return s.teacher.proposes > s.stageEntryProposes;
    case 'play:2':       return plateau(s, E5.NESTED_PLATEAU_ETA);                 // deeper fold
    case 'making:2':     return s.measuring === null;                              // second growth phase resolves
    default:             return false;                                             // 'folded' terminal (L159)
  }
}

// effective gate: the stage machine gates the CUR arm; SINGLE/UNG/A/B run the
// E-D1 'gate' mode for the whole run (their growth rule is the threshold one).
export function curGate(s) {
  return s.arm === 'CUR' ? STAGES[s.stageId].gate : 'gate';
}

// ── growth proposals + stage gates ─────────────────────────────────────────
const PROBE = (stageId) => ({
  id: `ask:${stageId}`, newParams: [], reusedParams: [], edges: [], probe: true,
  why: 'the sheet asks (growth.pending); the stage gate answers',
});

function nextProposal(s) {
  const q = DECL[s.stageId];
  if (!q) return PROBE(s.stageId); // no declared cells: the sheet still asks
  const spent = new Set(
    s.growthLog.filter((g) => g.stageId === s.stageId && g.verdict !== 'reverted').flatMap((g) => g.cells)
  );
  for (const d of q) if (!spent.has(d.id) && !s.features[d.id]) return d;
  return null; // declared queue exhausted: idle, NOT a refusal
}

// THE STAGE GATE — the heart of E-D5. Returns a verdict row.
export function gate(s, decl) {
  const g = STAGES[s.stageId].gate;
  const sig = signals(s);
  const trailMean = Number.isFinite(sig.meanEta) ? Math.round(sig.meanEta) : 0;
  const charge = { gamma: E5.GAMMA_GROWTH, eta: trailMean };
  const chargeFits = charge.gamma + charge.eta <= K.C_SCALED;
  const acc = (kind, extra) => ({ verdict: 'accept', kind, charge, ...extra });
  const rej = (why) => ({ verdict: 'refuse', why, charge });

  if (g === 'held') return rej('presence: refuse all growth proposals (seed-edu L61-73)');
  if (g === 'play') {
    // RECEIPTED INTERPRETATION: proposals 100% accepted as ephemerals; the
    // charge books to play-debt (not enforced); the boundary is still held
    // at C for world transitions (L83 playmate; L85 make/unmake).
    return acc('ephemeral', { playDebt: true });
  }
  // Making+: real additions, charge enforced under C from here on.
  if (!chargeFits) return rej(`growth charge ${charge.gamma}+${charge.eta} > C=${K.C_SCALED} (the guardian holds the boundary)`);
  if (s.stageId === 'abstraction' && decl.newParams.length > 0) {
    return rej(`abstraction: proposal introduces ${decl.newParams.length} new params; only param-REUSE allowed (seed-edu L127)`);
  }
  if (g === 'free') return acc('real', { note: 'independence: only the conservation law remains (seed-edu L139)' });
  if (g === 'peer') return rej('synthesis/folded: composition stage — growth is closed, the fold recurses instead (seed-edu L155-159)');
  return acc('real', {}); // making / systems / making:2 (gate, gate-follow)
}

function applyGrowth(s, decl, kind, charge) {
  s.features[decl.id] = decl.ephemeral ? 'ephemeral' : true;
  s.sheet.V += 1;
  s.sheet.E += decl.edges.length;
  s.growthLog.push({
    eval: s.eval, stageId: s.stageId, cells: [decl.id], kind,
    gamma: charge.gamma, eta: charge.eta, edges: decl.edges.length,
    newParams: decl.newParams.length, reusedParams: decl.reusedParams.length,
    verdict: kind === 'ephemeral' ? 'ephemeral' : 'measuring',
    position: Math.round(s.vibe.position * 1e6) / 1e6,
  });
}

function revertGrowth(s, cell) {
  const g = s.growthLog.find((x) => x.cells[0] === cell && x.verdict === 'measuring');
  if (g) g.verdict = 'reverted';
  delete s.features[cell];
  const d = Object.values(DECL).flat().find((x) => x.id === cell);
  s.sheet.V -= 1; s.sheet.E -= (d ? d.edges.length : 0);
}

// ── THE NUDGE (§The Nudge L181-192: "always a question, never an answer") ──
function stuck(s) {
  const w = s.sig.newKeyWindow.slice(-E5.NUDGE_WINDOW);
  const noQuestions = w.length >= E5.NUDGE_WINDOW && w.every((n) => n === 0);
  const cut = s.eval - E5.NUDGE_WINDOW;
  const noFood = !s.sig.eaten.some((f) => f.eval >= cut);
  return noQuestions && noFood;
}
function nudgeZone(s) {
  // a SMALLER question: the adjacent zone with the most food (never the answer)
  const zx = s.env.x >> 3, zy = s.env.y >> 3;
  let best = null, bestN = -1;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const z = (zx + dx) + 2 * (zy + dy);
    if (z < 0 || z > 3) continue;
    const n = K.zoneFoodCount(s, z);
    if (n > bestN) { bestN = n; best = z; }
  }
  return best;
}

// ── one developmental eval (mirrors dba/core.mjs step, stage layer added) ──
export function step5(s) {
  if (s.diverged) return null;

  // ---- 0. world tick: respawns (world dynamics stand regardless — core.mjs)
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

  // ---- 1-2. sensors + reflex (the reach; Z_in) -----------------------------
  const obs = K.observe(s, fnv1a64);
  const reflexBar = s.features['reflex.tune']
    ? Math.max(0.7, 0.8 - 0.05 * Math.min(1, Math.max(0, s.vibe.velocity)))
    : 0.8;
  const orient = obs.salience > reflexBar ? K.reflexOrient({ ...obs, salience: 1 }) : null;
  if (orient) s.sig.orientFires++;

  // ---- 3. world.predict (JEPA; candidates = the agent's QUESTIONS, L165) ---
  const cands = [];
  let newKeys = 0;
  for (let a = 0; a < 4; a++) {
    const [dx, dy] = K.ACTIONS[a];
    const nx = s.env.x + dx, ny = s.env.y + dy;
    if (nx < 0 || nx >= K.GRID || ny < 0 || ny >= K.GRID) { cands.push({ a, oob: true }); continue; }
    const p = K.jepaPredict(s, s.env.x, s.env.y, a, obs.win);
    if (s.jepaWin[p.key] === undefined) { newKeys++; s.sig.questions++; }
    cands.push({ a, oob: false, tx: nx, ty: ny, ...p });
  }
  s.sig.newKeyWindow.push(newKeys);
  if (s.sig.newKeyWindow.length > E5.WINS_WINDOW) s.sig.newKeyWindow.shift();

  // ---- 4. conservation projected (pre-gate) --------------------------------
  for (const c of cands) if (!c.oob) c.feasible = K.conservationOK(K.GAMMA_MOVE, c.etaPredScaled);
  s.teacher.waypoint = curGate(s) === 'held' ? null : K.teacherWaypoint(s);

  // ---- 5. policy.action (with grown-cell effects) --------------------------
  let action = null, gammaScaled = 0, viaReflex = false;
  if (curGate(s) === 'held') {
    s.counts.holds++; // PRESENCE: "You hold the child" — sensing only, no commitment
  } else if (orient) {
    const oc = cands.find((c) => c.a === orient.a && !c.oob && c.feasible);
    if (oc) { action = oc; gammaScaled = K.GAMMA_MOVE; viaReflex = true; s.counts.orients++; }
    else if (s.arm === 'CUR') {
      // THE PARENT MEETS THE REACH (receipted; L67 "When the child reaches,
      // meet."): flicker-poisoned etaPred at food-adjacent keys must not
      // starve the agent one step from VISIBLE food (dev evidence: energy 0 at
      // (7,1), food at (6,2), every outbound key pre-gate-infeasible). The
      // projected pre-gate is a POLICY filter, not the law: the reach attempts
      // the transition and the ACTUAL conservation check below still gates it
      // (breach => refusal + rollback — the guardian holds the boundary).
      const raw = cands.find((c) => c.a === orient.a && !c.oob);
      if (raw) { action = raw; gammaScaled = K.GAMMA_MOVE; viaReflex = true; s.counts.orients++; }
    }
  }
  if (!action && curGate(s) !== 'held') {
    if (s.env.energy <= 0) {
      s.counts.starveEvals++; s.counts.holds++;
      if (s.counts.starveEvals >= K.STARVE_LIMIT && !s.diverged) { s.diverged = true; s.divergenceWhy = 'starvation>=1000'; }
    } else {
      let best = null;
      for (const c of cands) {
        if (c.oob || !c.feasible) continue;
        const { score, parts } = policyScore5(s, obs, c);
        c.score = score; c.parts = parts;
        if (score > -Infinity && (best === null || score > best.score)) best = c;
      }
      if (best) {
        action = best;
        gammaScaled = K.GAMMA_MOVE + (K.curiosityDominated(best.parts) ? K.GAMMA_CURIO : 0);
      } else s.counts.holds++;
    }
  }

  // ---- 6-7. env.step + actual conservation check (the guardian, ALL stages)
  let learned = false, etaScaled = 0, ate = 0;
  if (action) {
    const gateMode = curGate(s);
    const snap = {
      x: s.env.x, y: s.env.y, energy: s.env.energy,
      food: s.food.slice(), foodSet: new Set(s.foodSet),
      respawnQ: s.respawnQ.map((r) => [r[0], r[1]]), foodEaten: s.counts.foodEaten,
    };
    const awayFromWaypoint = s.teacher.waypoint
      ? K.manhattan(s.env.x, s.env.y, s.teacher.waypoint[0], s.teacher.waypoint[1]) <
        K.manhattan(action.tx, action.ty, s.teacher.waypoint[0], s.teacher.waypoint[1])
      : false;
    s.env.x = action.tx; s.env.y = action.ty;
    s.env.energy = Math.max(0, s.env.energy - K.MOVE_COST);
    const cell = idx(s.env.x, s.env.y);
    const pellet = s.food.indexOf(cell);
    if (pellet >= 0) {
      s.food[pellet] = -1; s.foodSet.delete(cell);
      s.env.energy = Math.min(K.ENERGY_MAX, s.env.energy + K.FOOD_ENERGY);
      s.counts.foodEaten++; ate = 1;
      s.respawnQ.push([s.eval + K.RESPAWN_DELAY, pellet]);
    }
    const obs2 = K.observe(s, fnv1a64);
    const mse = K.mseOf(action.predWin, obs2.win);
    etaScaled = Math.round(K.ETA_SCALE * mse);
    s.ledger.gamma = gammaScaled; s.ledger.eta = etaScaled; s.ledger.sum = gammaScaled + etaScaled;
    s.counts.maxEta = Math.max(s.counts.maxEta, etaScaled);
    s.counts.conservationChecks++;
    if (!K.conservationOK(gammaScaled, etaScaled)) {
      if (s.arm === 'B') { // ablated arm (E-D1 arm B semantics; law-probe only)
        s.counts.appliedViolations++; learned = true;
        s.jepaWin[action.key] = obs2.win;
        s.jepaErr[action.key] = s.jepaErr[action.key] === undefined ? mse : 0.7 * s.jepaErr[action.key] + 0.3 * mse;
        K.ringAppend(s.memory.ring, { e: s.eval, x: s.env.x, y: s.env.y, r: s.counts.foodEaten, eta: etaScaled, kind: 'violation' });
      } else {
        // REFUSE: rollback, receipt, prior state stands (core.mjs refusal path).
        // The boundary is STILL enforced in Play (the guardian holds it) and the
        // would-be breach mass books to play-debt (forgiven at stage exit).
        // RECEIPTED INTERPRETATION REFINEMENT (dev-run audit, pre-final): the
        // refusal path keeps the receipted E-D1 episodic aversion marking in
        // ALL stages — aversion is the AGENT'S OWN memory.episodic cell
        // (seed3 refusal semantics), not the parent's correction; L83 "Do not
        // correct. Do not improve. Play along." removes the parent's STEERING
        // (no nudge in play; JEV verdicts ignored), not the world's own answer.
        // Evidence: with no-consequence refusals the dev mini-run FROZE at one
        // cell for 3150 evals (stale-prediction breach attempt repeated every
        // eval, nothing marks it, static world never changes) — play became a
        // refusal attractor and the nested cycle could not proceed.
        s.env.x = snap.x; s.env.y = snap.y; s.env.energy = snap.energy;
        s.food = snap.food; s.foodSet = snap.foodSet; s.respawnQ = snap.respawnQ;
        s.counts.foodEaten = snap.foodEaten; ate = 0;
        s.counts.refusals++;
        s.sig.lastRefusalEval = s.eval;
        if (gateMode === 'play') {
          s.counts.playRefusals++;
          s.playDebt.breach += Math.max(0, gammaScaled + etaScaled - K.C_SCALED);
        } else {
          const bucket = s.arm === 'CUR' ? s.stageId : 'e-d1';
          s.counts.refusalsByStage[bucket] = (s.counts.refusalsByStage[bucket] || 0) + 1;
        }
        s.aversion[idx(action.tx, action.ty)] = s.eval + K.AVERSION_TTL;
        // THE BOUNDARY IS REAL (receipted CUR refinement; L63 "there is an
        // inside, and there is an outside, and the boundary is real", L73
        // "the boundary is real in both directions"): a repeated refusal of
        // the SAME target escalates the agent's own episodic mark. Dev
        // evidence: seed 135 bashed one refused food-boundary ~20000 times
        // (flat aversion 8 < visible reward 10) and never left play. The
        // escalated mark is still the agent's OWN memory (memory.episodic
        // semantics), self-issued, TTL-bounded; E-D1 arms stay flat/verbatim.
        if (s.arm === 'CUR') {
          const ck = String(idx(action.tx, action.ty));
          const prev = s.aversionBreach[ck];
          const w = prev && s.eval < prev.until ? Math.min(prev.w + K.AVERSION_PENALTY, 40) : K.AVERSION_PENALTY;
          s.aversionBreach[ck] = { until: s.eval + K.AVERSION_TTL, w };
        }
        K.ringAppend(s.memory.ring, { e: s.eval, x: action.tx, y: action.ty, r: 0, eta: etaScaled, kind: 'refusal' });
        etaScaled = 0; learned = false;
      }
    } else {
      // invariant: an executed transition NEVER breaches C (asserted everywhere)
      if (gammaScaled + etaScaled > K.C_SCALED) s.counts.conservationViolations++;
      learned = true;
      const newKey = s.jepaErr[action.key] === undefined; // first experience of this transition
      s.jepaWin[action.key] = obs2.win;
      s.jepaErr[action.key] = newKey ? mse : 0.7 * s.jepaErr[action.key] + 0.3 * mse;
      // self-taught competence (L115): a key FIRST experienced during this
      // stage, already right (eta <= ABSTRACTION_KEY_ETA) — recorded per stage
      if (newKey && etaScaled <= E5.ABSTRACTION_KEY_ETA) {
        const [kx, ky, ka] = action.key.split(',');
        const byA = s.sig.stageLearned[s.stageId] = s.sig.stageLearned[s.stageId] || {};
        (byA[ka] = byA[ka] || {})[kx + ',' + ky] = 1;
      }
      // the why-question (L101): during Making, on a non-flicker eval with a
      // competent trailing window, the learned rule BREAKS (eta >= max(abs, 2x mean))
      if (s.stageId === 'making' && !obs.flicked && s.sig.etaWindow.length >= E5.WINDOW) {
        const wMean = s.sig.etaWindow.reduce((a, b) => a + b, 0) / s.sig.etaWindow.length;
        if (wMean <= E5.PLATEAU_ETA && etaScaled >= Math.max(E5.RULE_CONFUSION_ABS, 2 * wMean)) {
          s.sig.confusions.push({ eval: s.eval, eta: etaScaled, mean: Math.round(wMean) });
        }
      }
      K.ringAppend(s.memory.ring, { e: s.eval, x: s.env.x, y: s.env.y, r: s.counts.foodEaten, eta: etaScaled, kind: viaReflex ? 'reflex' : 'policy' });
      if (!s.visited[cell]) s.visited[cell] = 1;
      if (ate) {
        const z = K.zoneOf(s.env.x, s.env.y);
        s.sig.eaten.push({ eval: s.eval, zone: z });
        if (s.sig.eaten.length > 400) s.sig.eaten.shift();
        if (z !== s.teacher.zone) s.sig.selfFed.push({ eval: s.eval, zone: z });
        if (awayFromWaypoint) s.sig.wins.push({ eval: s.eval });
      }
      if (s.measuring) { // feed the Making measurement window
        s.measuring.samples++;
        s.measureBuf.push({ eval: s.eval, eta: etaScaled });
        if (s.measureBuf.length > 800) s.measureBuf.shift();
      }
    }
  }

  // ---- 8. memory + GC + grown-cell temporal firing --------------------------
  if (ate) s.memory.semantic[idx(s.env.x, s.env.y)] = (s.memory.semantic[idx(s.env.x, s.env.y)] || 0) + 2;
  s.memory.decayTick++;
  if (s.memory.decayTick % K.DECAY_EVERY === 0) K.semanticDecay(s.memory.semantic);
  if (s.features['consolidate.temporal'] && s.eval % E5.LISTEN_EVERY === 0) {
    // Systems: the temporal program over the [episodic, semantic] group fires:
    // recent (non-refusal) visits keep a bounded trace in semantic.
    for (const r of s.memory.ring) {
      if (r.kind === 'refusal') continue;
      const k2 = idx(r.x, r.y);
      s.memory.semantic[k2] = Math.min(10, (s.memory.semantic[k2] || 0) + 1);
    }
  }
  for (const k2 of Object.keys(s.aversion)) if (s.eval >= s.aversion[k2]) delete s.aversion[k2];
  for (const k2 of Object.keys(s.aversionBreach)) if (s.eval >= s.aversionBreach[k2].until) delete s.aversionBreach[k2];
  if (learned && !obs.flicked) { // competence window excludes flicker weather
    s.sig.etaWindow.push(etaScaled);
    if (s.sig.etaWindow.length > E5.WINDOW) s.sig.etaWindow.shift();
  }

  // ---- 9. teacher.feedback + JEV gate (mode per stage) ----------------------
  const depleted = K.zoneFoodCount(s, s.teacher.zone) <= K.ZONE_DEPLETE;
  if (s.eval - s.teacher.sinceEval >= K.TEACHER_EVERY || depleted) {
    s.teacher.proposes++;
    if (s.arm === 'CUR') proposeGrowth(s); // the sheet asks at the same rhythm
    const gateMode = curGate(s);
    if (s.arm === 'D' || s.arm === 'UNG') { // unguided: random zone (E-D1 arm D)
      const r = makeRng(s.rngState);
      setZone(s, Math.floor(r.fn() * K.N_ZONES) % K.N_ZONES);
      s.rngState = r.state;
    } else {
      let to;
      if (gateMode === 'gate-follow' || gateMode === 'peer') {
        // Systems ("follow, not lead" L111) / Synthesis ("listen as a peer"
        // L153; "no longer the teacher... the witness" L203): propose FROM agent.
        to = agentLedZone(s);
      } else {
        to = K.teacherPropose(s);
        if (stuck(s) && (gateMode === 'gate' || gateMode === 'gate-follow')) {
          const nz = nudgeZone(s); // THE NUDGE: a smaller question, never an answer
          if (nz !== null) { to = nz; s.counts.nudges++; }
        }
      }
      if (to !== s.teacher.zone) {
        s.sig.proposedZones[to] = true; // named is proposed (executed or not) — L157 scope
        const [cx, cy] = K.ZONE_CENTERS[to];
        const desc = {
          type: 'curriculum.switch', from: s.teacher.zone, to,
          densityNorm: Math.min(1, K.zoneFoodCount(s, to) / K.FOOD_PER_ZONE),
          distNorm: Math.min(1, K.manhattan(s.env.x, s.env.y, cx, cy) / 22),
          energyNorm: s.env.energy / K.ENERGY_MAX,
        };
        const verdict = K.jevDecide(desc);
        s.jev.last = verdict;
        s.jev.counts[verdict.verdict]++;
        let execute = false;
        if (gateMode === 'play' || gateMode === 'free' || gateMode === 'peer') {
          execute = true; s.jev.counts.ignored++; // the gate steps back / plays along
        } else if (verdict.verdict === 'execute') execute = true;
        else if (verdict.verdict === 'escalate') execute = K.jevEscalateRule(desc);
        if (execute) setZone(s, to);
        s.teacher.sinceEval = s.eval;
      } else s.teacher.sinceEval = s.eval;
    }
  }

  // ---- 10. vibe (E-D1 verbatim) ---------------------------------------------
  const lp = K.vibeUpdate(s, etaScaled, learned);

  // ---- 11. divergence watch (E-D1 verbatim) ---------------------------------
  if (!Number.isFinite(s.vibe.position) || !Number.isFinite(s.vibe.velocity) || !Number.isFinite(s.env.energy)) {
    s.counts.nonFinite++;
    if (!s.diverged) { s.diverged = true; s.divergenceWhy = 'non-finite'; }
  }
  if (learned && etaScaled >= K.SURPRISE_PIN) s.counts.sustainSurprise++; else s.counts.sustainSurprise = 0;
  s.counts.maxSustain = Math.max(s.counts.maxSustain, s.counts.sustainSurprise);
  if (s.counts.sustainSurprise >= K.SUSTAIN_LIMIT && !s.diverged) { s.diverged = true; s.divergenceWhy = 'surprise>=900 sustained>=1000'; }

  // ---- 12. growth: E-D1 threshold rule for SINGLE/UNG; Making measurement ---
  if ((s.arm === 'SINGLE' || s.arm === 'UNG' || s.arm === 'A') && !s.grewE1 && s.vibe.position > K.STAGE1_THRESHOLD) {
    // E-D1 verbatim: the stage-2 cell pair fires once on the vibe threshold
    // (dba/sheet.mjs anchor: V 24->26, E 22->26, beta1 -1 -> +1).
    s.grewE1 = true;
    s.features['sensors.language'] = true;
    s.sheet.V += 2; s.sheet.E += 4;
    s.growthLog.push({
      eval: s.eval, stageId: 'e-d1:stage2', cells: ['sensors.language', 'teacher.label'],
      kind: 'real-e-d1', gamma: 0, eta: 0, edges: 4, newParams: 0, reusedParams: 0,
      verdict: 'kept', position: Math.round(s.vibe.position * 1e6) / 1e6,
    });
    const pre = preStats(s);
    // measured post-hoc (the E-D1 gate never reverted; measurement is telemetry)
    s.measuring = { cell: 'sensors.language', at: s.eval, preMean: pre.mean, preVar: pre.var, samples: 0, span: 0, observeOnly: true, zeroBaseline: pre.zero };
  }
  if (s.measuring) {
    const m = s.measuring;
    m.span++;
    const done = m.samples >= E5.MAKING_MEASURE
      || (m.span >= E5.MAKING_MEASURE_CAP && m.samples >= E5.MAKING_MIN_SAMPLES)
      || m.span >= E5.MAKING_MEASURE_CAP * 2;
    if (done) {
      const post = s.measureBuf.filter((x) => x.eval > m.at).map((x) => x.eta);
      const postMean = post.length ? post.reduce((a, b) => a + b, 0) / post.length : NaN;
      const postVar = post.length > 1 ? post.reduce((a, b) => a + (b - postMean) ** 2, 0) / post.length : NaN;
      const delta = postMean - m.preMean;
      const g = s.growthLog.find((x) => x.cells[0] === m.cell && (x.verdict === 'measuring' || (m.observeOnly && x.verdict === 'kept')));
      if (g) {
        g.delta = Number.isNaN(delta) ? null : Math.round(delta * 1000) / 1000;
        g.postMean = Number.isNaN(postMean) ? null : Math.round(postMean * 1000) / 1000;
        g.postVar = Number.isNaN(postVar) ? null : Math.round(postVar * 1000) / 1000;
        g.preVar = Math.round((m.preVar || 0) * 1000) / 1000;
        g.stability = (Number.isNaN(postVar) || !m.preVar) ? null
          : Math.max(0, Math.min(1, 1 - postVar / m.preVar));
        if (m.observeOnly) g.verdict = 'kept-observed'; // never reverted: E-D1 semantics
        else if (Number.isNaN(delta)) g.verdict = 'inconclusive-kept'; // no data: receipted
        else if (delta < 0) g.verdict = 'kept';
        else { g.verdict = 'reverted'; revertGrowth(s, m.cell); } // L103: failure is the lesson
        g.zeroBaseline = !!m.zeroBaseline; // receipted: pre-window was not full
      }
      s.measuring = null;
      if (s.stageId === 'making:2' && g && (g.verdict === 'kept' || g.verdict === 'inconclusive-kept') && m.cell === 'memory.route') {
        s.secondGrowth = { cell: g.cells[0], at: g.eval, delta: g.delta };
      }
      // L129 the connection works: during Abstraction, a kept measurement of
      // the stage's OWN reuse-cell (policy.kernel) IS the connection the parent
      // didn't see — a measurement left over from an earlier stage resolving
      // here does not count (receipted: dev run fired the exit on making's cell)
      if (s.stageId === 'abstraction' && g && g.verdict === 'kept' && m.cell === 'policy.kernel') {
        s.sig.connectionKept = true;
      }
    }
  }

  // ---- 13. stage machine: exit on the watching-for, enter the next ----------
  if (s.arm === 'CUR' && stageExit(s)) advanceStage(s);

  s.eval++;
  return { ate, etaScaled, learned, viaReflex, lp, stageId: s.stageId };
}

function setZone(s, z) {
  s.teacher.zone = z; s.teacher.label = `zone:${z}`; s.sig.proposedZones[z] = true; s.teacher.sinceEval = s.eval;
}
function agentLedZone(s) {
  // the agent's own semantic coverage picks the zone (the relationship inverts)
  const sums = [0, 0, 0, 0];
  for (const k2 of Object.keys(s.memory.semantic)) {
    const [x, y] = k2.split(',').map(Number);
    if (s.memory.semantic[k2] >= 2) sums[K.zoneOf(x, y)] += s.memory.semantic[k2];
  }
  let best = s.teacher.zone, bestV = -1;
  for (let z = 0; z < 4; z++) if (sums[z] > bestV) { bestV = sums[z]; best = z; }
  return best;
}

// policy with grown-cell effects (kernels.policyScore + feature terms)
export function policyScore5(s, obs, c) {
  const base = K.policyScore(s, obs, c, s.env.x, s.env.y);
  if (!base.parts) return base;
  const [dx, dy] = K.ACTIONS[c.a];
  const tx = s.env.x + dx, ty = s.env.y + dy;
  if (tx < 0 || tx >= K.GRID || ty < 0 || ty >= K.GRID) return base;
  let bonus = 0;
  // TEACHER PRESENCE (receipted; L65-67 "When the child cries, come"): the
  // waypoint pull strengthens when the agent is hungry — the parent closes in.
  // CUR arm only: the E-D1 arms keep their receipted policy verbatim.
  if (s.arm === 'CUR' && s.env.energy <= E5.HUNGER_FLOOR && s.teacher.waypoint) {
    bonus += E5.HUNGER_PULL * (K.manhattan(s.env.x, s.env.y, s.teacher.waypoint[0], s.teacher.waypoint[1]) -
                               K.manhattan(tx, ty, s.teacher.waypoint[0], s.teacher.waypoint[1]));
  }
  if (s.features['sensors.gradient']) {
    const dCur = dKnown(s, s.env.x, s.env.y), dNew = dKnown(s, tx, ty);
    if (dCur !== null && dNew !== null) bonus += (dCur - dNew); // known-food gradient
  }
  if (s.features['policy.kernel']) {
    // the same operation in different clothes (L127): the novelty weight,
    // applied to the OPPOSITE argument — prefer the PREDICTABLE candidate
    // (innate curiosity prefers surprise; the kernel prefers the known rule)
    bonus += K.NOVELTY_W * (1 - Math.min(1, c.etaPredScaled / 1000));
  }
  if (s.features['memory.route'] && (s.memory.semantic[idx(tx, ty)] || 0) >= 4) {
    bonus += 0.5; // route back to known food (nested second-phase cell)
  }
  if (s.features['sensors.language'] && s.labelDir && s.labelDir[0] === dx && s.labelDir[1] === dy) {
    bonus += E5.LABEL_BONUS; // single-gate arm's stage-2 edge (sheet.mjs +300)
  }
  // the escalated boundary lesson replaces the flat mark (same channel, CUR only)
  const br = s.aversionBreach[String(idx(tx, ty))];
  if (br && s.eval < br.until) bonus -= (br.w - K.AVERSION_PENALTY);
  return { score: base.score + bonus, parts: base.parts };
}
function dKnown(s, x, y) {
  let best = null;
  for (const k2 of Object.keys(s.memory.semantic)) {
    if (s.memory.semantic[k2] < 4) continue;
    const [sx, sy] = k2.split(',').map(Number);
    const d = K.manhattan(x, y, sx, sy);
    if (best === null || d < best) best = d;
  }
  return best;
}
function zoneMeanSemantic(s, x, y) {
  const z = K.zoneOf(x, y); let n = 0, sum = 0;
  for (const k2 of Object.keys(s.memory.semantic)) {
    const [sx, sy] = k2.split(',').map(Number);
    if (K.zoneOf(sx, sy) !== z) continue;
    sum += s.memory.semantic[k2]; n++;
  }
  return n ? sum / n : 0;
}
void zoneMeanSemantic; // retained: zone-level novelty telemetry helper

// label direction for the single-gate arm's stage-2 edge (sheet.mjs sensors.language)
export function labelDirection(s) {
  let best = null, bd = 1e9;
  for (const [dx, dy] of K.ACTIONS) {
    const nx = s.env.x + dx, ny = s.env.y + dy;
    if (nx < 0 || nx >= K.GRID || ny < 0 || ny >= K.GRID) continue;
    let d = 1e9;
    for (const c of s.foodSet) {
      const cx = c % K.GRID, cy = Math.floor(c / K.GRID);
      d = Math.min(d, Math.abs(cx - nx) + Math.abs(cy - ny));
    }
    if (d < bd) { bd = d; best = [dx, dy]; }
  }
  return best;
}

// ── growth proposal processing (the sheet asks; the stage gate answers) ────
export function proposeGrowth(s) {
  const decl = nextProposal(s);
  if (!decl) { s.proposals.idle++; return { verdict: 'idle' }; } // nothing to ask
  const st = s.proposals.byStage[s.stageId] =
    (s.proposals.byStage[s.stageId] || { made: 0, accepted: 0, refused: 0, deferred: 0 });
  st.made++; s.proposals.made++;
  if (s.measuring && !s.measuring.observeOnly) { // Making: one cell at a time
    st.deferred++; s.proposals.deferred++;
    return { verdict: 'defer' };
  }
  const verdict = gate(s, decl);
  if (verdict.verdict === 'refuse') {
    st.refused++; s.proposals.refused++;
    s.counts.growthRefusals++;
    if (s.refusedProposals.length < 256) {
      s.refusedProposals.push({ eval: s.eval, stageId: s.stageId, cell: decl.id, why: verdict.why });
    }
    return verdict;
  }
  st.accepted++; s.proposals.accepted++;
  if (verdict.kind === 'ephemeral') {
    applyGrowth(s, decl, 'ephemeral', verdict.charge);
    s.playDebt.charge += verdict.charge.gamma + verdict.charge.eta;
  } else {
    applyGrowth(s, decl, 'measuring', verdict.charge);
    const pre = preStats(s);
    s.measuring = { cell: decl.id, at: s.eval, preMean: pre.mean, preVar: pre.var, samples: 0, span: 0, observeOnly: false, zeroBaseline: pre.zero };
  }
  return verdict;
}

function preStats(s) {
  const w = s.sig.etaWindow;
  if (w.length < E5.WINDOW) return { mean: 0, var: 0, zero: true };
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  const v = w.reduce((a, b) => a + (b - mean) ** 2, 0) / w.length;
  return { mean, var: v, zero: false };
}

// ── stage transitions ───────────────────────────────────────────────────────
export function advanceStage(s) {
  const NEXT = {
    presence: 'play', play: 'making', making: 'systems', systems: 'abstraction',
    abstraction: 'independence', independence: 'synthesis',
    synthesis: 'presence:2',           // THE FOLD FOLDS AGAIN (seed-edu L155-159)
    'presence:2': 'play:2', 'play:2': 'making:2', 'making:2': 'folded',
  };
  const cur = s.stageId;
  const next = NEXT[cur];
  if (!next) return null;
  const h = s.stageHistory[s.stageHistory.length - 1];
  h.exitedAt = s.eval;
  // PLAY exit: forgive the debt (play is not held against the child) + the
  // ephemerals come down: making and breaking are the same operation (L85).
  if (cur === 'play' || cur === 'play:2') {
    s.growthLog.push({
      eval: s.eval, stageId: cur, cells: [], kind: 'debt-forgiven',
      gamma: s.playDebt.charge, eta: 0, edges: 0, newParams: 0, reusedParams: 0,
      verdict: 'forgiven', breach: s.playDebt.breach,
      position: Math.round(s.vibe.position * 1e6) / 1e6,
    });
    s.playDebt.breach = 0; s.playDebt.charge = 0; s.playDebt.forgivenAt = s.eval;
    for (const g of s.growthLog) {
      if (g.stageId === cur && g.kind === 'ephemeral' && g.verdict === 'ephemeral') {
        g.verdict = 'unmade';
        for (const c of g.cells) delete s.features[c];
        s.sheet.V -= g.cells.length; s.sheet.E -= g.edges;
      }
    }
  }
  s.stageId = next;
  s.stageEntryOrient = s.sig.orientFires; // nested Presence*: orient AFTER entry
  s.stageEntryProposes = s.teacher.proposes; // nested Presence*: consults AFTER entry
  // SCOPING LAW (receipted pre-final, seed-edu L175): each stage's watching-for
  // is measured on the STAGE'S OWN window — a stage does not inherit its
  // predecessor's signal history. Entry ticks anchor the eval filters
  // (wins/confusions/novelZone), the new-key and consult counters diff from
  // their entry values, self-taught keys are keyed by stageId, the surprise
  // window resets at Play entry, and Abstraction's connection flag clears.
  s.stageEnteredAt = s.eval;
  s.stageEntryQuestions = s.sig.questions;
  if (next === 'abstraction') s.sig.connectionKept = false;
  if (next === 'play' || next === 'play:2') s.sig.etaWindow = [];
  s.stageHistory.push({ stageId: next, enteredAt: s.eval, depth: STAGES[next].depth });
  if (s.arm === 'CUR') proposeGrowth(s); // the new stage's gate sees the ask now
  return next;
}

// ── run loop ───────────────────────────────────────────────────────────────
export function run5(s, { untilEval = 12000 } = {}) {
  while (s.eval < untilEval && !s.diverged) {
    if (s.features['sensors.language']) s.labelDir = labelDirection(s); // stage-2 edge
    step5(s);
  }
  return summarize5(s);
}

export function summarize5(s) {
  const rows = s.growthLog.filter((g) => g.kind !== 'debt-forgiven');
  const realAttempts = rows.filter((g) => g.kind === 'measuring' || g.kind === 'real-e-d1');
  const kept = rows.filter((g) => g.verdict === 'kept' || g.verdict === 'kept-observed');
  const reverted = rows.filter((g) => g.verdict === 'reverted');
  const unmade = rows.filter((g) => g.verdict === 'unmade');
  const firstReal = kept[0] || null;
  const forgiveRows = s.growthLog.filter((g) => g.kind === 'debt-forgiven');
  return {
    arm: s.arm, seed: s.seed, worldSeed: s.worldSeed, evals: s.eval,
    stageId: s.stageId, stageHistory: s.stageHistory.map((h) => ({ ...h })),
    position: Math.round(s.vibe.position * 1e6) / 1e6, velocity: Math.round(s.vibe.velocity * 1e6) / 1e6,
    coverage: Object.keys(s.visited).length, foodEaten: s.counts.foodEaten,
    refusals: s.counts.refusals, refusalsByStage: { ...s.counts.refusalsByStage },
    playRefusals: s.counts.playRefusals, growthRefusals: s.counts.growthRefusals,
    playDebtForgiven: forgiveRows.reduce((a, g) => a + g.gamma, 0),
    breachDebtForgiven: forgiveRows.reduce((a, g) => a + (g.breach || 0), 0),
    proposals: JSON.parse(JSON.stringify(s.proposals)),
    refusedProposals: s.refusedProposals.slice(0, 64),
    growthLog: rows.map((g) => ({ ...g })),
    sheet: { ...s.sheet }, beta1: s.sheet.E - s.sheet.V + 1,
    features: Object.keys(s.features).filter((k2) => s.features[k2] === true).sort(),
    jevCounts: { ...s.jev.counts }, teacherProposes: s.teacher.proposes, nudges: s.counts.nudges,
    questions: s.sig.questions, finalMeanEta: Number.isFinite(signals(s).meanEta) ? Math.round(signals(s).meanEta) : null,
    diverged: s.diverged, divergenceWhy: s.divergenceWhy,
    grewE1: s.grewE1,
    maxEta: s.counts.maxEta, conservationChecks: s.counts.conservationChecks,
    conservationViolations: s.counts.conservationViolations,
    secondGrowth: s.secondGrowth,
    firstRealGrowthAt: firstReal ? firstReal.eval : null,
    firstRealGrowthPos: firstReal ? firstReal.position : null,
    growthEvents: {
      realAttempts: realAttempts.length, kept: kept.length, reverted: reverted.length,
      ephemeral: unmade.length, e1pair: rows.filter((g) => g.kind === 'real-e-d1').length,
    },
  };
}
