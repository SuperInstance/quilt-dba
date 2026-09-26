// E-D5 — THE FOLD CURRICULUM: does stage-gating change development quality
// vs the E-D1 single JEV gate?
// ============================================================================
// Seed: fleet-seeds/seeds/seed-edu.md "Far Deeper" — §Raising a Child Who
// Sees the Fold (L45-209) maps years 0-2 Presence, 2-4 Play, 4-7 Making,
// 7-10 Systems, 10-13 Abstraction, 13-16 Independence, 16-18 Synthesis;
// §What You Are Watching For, Always (L163-178); §The Nudge (L181-192);
// §The Release (L195-204). The stage→mechanism map (with per-line citations
// and the receipted interpretations) lives in dba/curriculum.mjs.
//
// ARMS (identical worlds per seed: worldSeed = imul(seed,0x9E3779B1), the
// E-D1 kernels substrate — same C=1585 x1000 fixed point, same JEPA, same
// teacher, same JEV mock; the eval loop mirrors dba/core.mjs step with the
// growth layer replaced):
//   CUR    — the fold curriculum: 7 stage gates (dba/curriculum.mjs STAGES),
//            nested Synthesis→Presence*→Play*→Making* cycle at depth 1.
//   SINGLE — E-D1 arm A semantics verbatim: JEV-gated switches, conservation
//            enforced, one-shot growth of the stage-2 cell pair
//            (sensors.language+teacher.label) at vibe.position > 1.0.
//   UNG    — E-D1 arm D semantics verbatim: random zone switches, same
//            threshold growth rule, conservation enforced.
//
// DECISION RULES (receipted BEFORE the final run, house style):
//   R1 STAGE PROGRESSION: the CUR arm passes the 7 depth-0 stages IN ORDER,
//      each transition on its watching-for signal (dba/curriculum.mjs
//      stageExit, every signal measured WITHIN its stage — eval >= enteredAt,
//      receipted scoping law): presence = first question + first consult
//      (L71/L165); play→making = surprise plateau, trailing-50 non-flicker
//      mean eta <= PLATEAU_ETA=400 and no refusal in 20 (L87); making→
//      systems = first RULE-CONFUSION — non-flicker eta >= max(600, 2x
//      window mean) while window mean <= 400 (L101 the why-question);
//      systems→abstraction = one action's key FIRST learned in-stage already
//      competent (eta <= 400) at >= 4 positions (L115 explains untaught);
//      abstraction→independence = the reuse-cell's measurement resolves
//      delta < 0 (L129 the connection works); independence→synthesis = >= 3
//      against-waypoint-then-eat wins (L143 argues and wins); synthesis→
//      presence:2 = food in a never-proposed zone OR >= 5 never-seen keys
//      asked (L157 a question you can't answer — outside the teacher's
//      zone-density vocabulary).
//      CONFIRMED if all 7 fire in >= 2/3 seeds within budget; per-stage
//      entry ticks receipted; a stage that never fires is receipted as the
//      stage the agent was still IN at budget end (the pace is not the
//      point — L175).
//   R2 PAIRED COMPARISON (3 seeds/arm, identical worlds): growth time
//      (first real addition), growth position, refusals, debt, and QUALITY
//      composite = mean of (a) fraction of measured real additions that
//      LOWERED mean eta (delta < 0 over the trailing window), (b) parameter
//      reuse rate of accepted real additions (1 - new/(new+reused)),
//      (c) mean post-addition stability = clamp(1 - varPost/varPre, 0, 1).
//      Paired deltas CUR−SINGLE with joint SE; UNG reported against both.
//   R3 FOLD RECURSION: after Synthesis, the nested cycle
//      Presence*→Play*→Making* must attempt a SECOND GROWTH PHASE on the
//      SAME sheet (cell memory.route, tightened plateau 300). CONFIRMED if
//      the nested cell PERSISTS (kept) in >= 2/3 CUR seeds; NOT-OBSERVED
//      otherwise with the per-seed reason (charge-refused / reverted /
//      cycle not reached) — the pedagogy's core claim made testable.
//   R4 CONSERVATION INTEGRITY: gamma+eta <= C asserted at every executed
//      transition (violations must be 0 in ALL runs) and every accepted
//      growth charge; boundary 1585 ok / 1586 refuse; per-stage proposal
//      refusal table (seed prediction: Presence refuses 100%, Play refuses
//      0% by design).
//   R5 HONESTY CANARY: if CUR vs SINGLE show NO measurable difference
//      (|dComposite| <= 1 jointSE AND |dGrowthTime| <= 1 jointSE AND
//      outcome deltas (position/coverage/food) each <= 1 jointSE), receipt
//      THAT: the pedagogy may be human-specific at this scale — a finding,
//      not a failure.
//
// RUNTIME RULES (receipted): probe = 1 CUR run at full budget, timed;
// projected = t_probe * (remaining runs + replays) + 2s; if > 170s cut the
// budget to 6000 evals and RECEIPT the cut. The probe run is CARRIED as the
// CUR seed-101 arm row when no cut happens (E-D3 idiom). BUDGET NOTE
// (receipted, raised from the dev mini-run's 12000): the scoped watching-for
// criteria make stages real periods (the dev run's carried-signal bug fired
// four stages in 3 evals); 20000 evals/run costs ~1s/arm-seed, so the
// generous budget is free and gives the pedagogy's pacing a fair test.
import { freshState5, run5, summarize5, proposeGrowth, gate, STAGES, E5 } from '../dba/curriculum.mjs';
import { boundaryCase, C_SCALED, STAGE1_THRESHOLD } from '../dba/kernels.mjs';
import { fnv1a64 } from '../dba/receipts.mjs';
import { sealChain, verifyChain } from '../shared/receipts.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const DEV = process.env.E_D5_DEV === '1'; // dev mini-run; the final run overwrites outputs
const SEEDS = DEV ? [101] : [101, 118, 135];
const EVALS0 = DEV ? 4000 : 20000;
const ARMS = {
  CUR: 'fold curriculum (7 stage gates + nested cycle)',
  SINGLE: 'E-D1 arm A: JEV-gated, one-shot stage-2 pair at position > 1.0',
  UNG: 'E-D1 arm D: unguided random switches, same threshold rule',
};
const worldSeedOf = (seed) => Math.imul(seed, 0x9E3779B1) >>> 0;

const rows = [];
const receipt = (r) => rows.push(r);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const varr = (a) => { const m = mean(a); return a.length ? a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length : 0; };
const r1e6 = (x) => Math.round(x * 1e6) / 1e6;
function canonDeep(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canonDeep).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonDeep(v[k])).join(',') + '}';
}
const hashOf = (r) => fnv1a64(canonDeep({
  stageHistory: r.stageHistory, growthLog: r.growthLog, position: r.position,
  coverage: r.coverage, foodEaten: r.foodEaten, refusals: r.refusals,
  refusalsByStage: r.refusalsByStage, proposals: r.proposals, jevCounts: r.jevCounts,
  secondGrowth: r.secondGrowth, features: r.features, sheet: r.sheet, evals: r.evals,
}));

function quality(r) {
  const real = r.growthLog.filter((g) => g.kind === 'measuring' || g.kind === 'real-e-d1');
  const measured = real.filter((g) => g.delta !== null && g.delta !== undefined);
  const lowered = measured.filter((g) => g.delta < 0).length;
  const fracLowered = measured.length ? r1e6(lowered / measured.length) : null;
  const acc = real.reduce((a, g) => [a[0] + (g.reusedParams || 0), a[1] + (g.newParams || 0)], [0, 0]);
  const reuseRate = (acc[0] + acc[1]) > 0 ? r1e6(acc[0] / (acc[0] + acc[1])) : 1.0;
  const stabs = real.filter((g) => g.stability !== null && g.stability !== undefined).map((g) => g.stability);
  const stability = stabs.length ? r1e6(mean(stabs)) : null;
  const parts = [fracLowered, reuseRate, stability].filter((x) => x !== null);
  const composite = parts.length ? r1e6(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
  return { attempts: real.length, measured: measured.length, fracLowered, reuseRate, stability, composite };
}

// ── receipts BEFORE runs ────────────────────────────────────────────────────
receipt({
  kind: 'run.config', task: 'E-D5 the fold curriculum', dev: DEV,
  seed: 'seed-edu.md §Raising a Child Who Sees the Fold L45-209; §Watching For L163-178; §The Nudge L181-192; §The Release L195-204',
  substrate: 'dba/kernels.mjs (E-D1 constants: C=1585 x1000 fixed point, ETA_SCALE 2000, GAMMA_MOVE 600) via dba/curriculum.mjs — the eval loop mirrors dba/core.mjs step with the growth layer replaced; kernels ARE the substance the receipted sheet calls (dba/kernels.mjs header)',
  arms: ARMS, seeds: SEEDS, evals: EVALS0, gain: 1,
  world: 'identical per seed across arms: worldSeed = imul(seed, 0x9E3779B1); 16x16 forage, 4 zones x 10 pellets, 4 hazards',
  vibe_note: 'vibe = kernels.vibeUpdate (EWMA alpha 0.002), the core.mjs Driver mechanism; the E-D1 ENGINE sheet used the faster gain/50 rule — the SINGLE/UNG threshold RULE (position > STAGE1_THRESHOLD) is verbatim, its crossing time is not the E-D1 eval-299 anchor (receipted scale difference)',
});
receipt({
  kind: 'interpretations', scope: 'the places the human text needed an honest agent-scale reading',
  play: 'L83-85+brief clause: boundary STILL ENFORCED at C (play is safe because the guardian holds it); growth proposals 100% accepted as EPHEMERAL play-structures (unmade at exit, L85 make/unmake); would-be breach mass + play charges tracked as play-debt and FORGIVEN at stage exit (debt accumulates but is not enforced)',
  systems: 'L109-115: multi-cell programs scoped to what dba has — a temporal program over a cell-group implemented driver-side (listener firing every DECAY_EVERY evals); the vendored engine has listener cells but no cron primitive (scope gap receipted)',
  synthesis: 'L155-159: nested stage scopes at depth 1 (Synthesis opens Presence*→Play*→Making* on the SAME sheet with tightened plateau 300); grandchildren out of scope this lane',
  presence: 'L61-73: held = no world transitions, no cells, all growth proposals refused; the L71 motor reach is folded into the attentional QUESTION signal (§L165) because a held agent in a static world (respawns require eating) could otherwise never reach — adaptation receipted',
  watchingFor: 'each stage exit = that stage\'s OWN "Watch for" line, made measurable and measured WITHIN the stage (scoping law: eval >= enteredAt; self-taught keys per stageId; counters diffed at entry). Mapping: making=L101 asks-why (rule-break spike), systems=L115 explains-untaught (in-stage self-taught positions), abstraction=L129 connection-works (reuse-cell kept), independence=L143 argues-wins (against-waypoint eats), synthesis=L157 unanswerable (never-proposed-zone feed OR never-seen-key burst — the teacher:offline-rule only answers zone-food density). Synthesis clause (b) receipted: a new key is the agent vocabulary\'s question (§L165), and the teacher has no answer for it by construction',
  devAudit: 'the pre-final dev mini-run receipted a CARRIED-SIGNAL BUG (stages making/systems/abstraction/independence fired at ticks 332/333/334/335 — watching-for signals inherited from earlier stages) plus a one-stage-shifted exit mapping (making exited on L115, systems on L127, abstraction on L143); fixed by the scoping law + per-stage citation audit BEFORE the final run',
  playRefusal: 'INTERPRETATION REFINEMENT (dev evidence: the no-consequence play mode FROZE the agent at one cell for 3150 evals — a stale-prediction breach attempt repeated every eval, nothing marks it, the static world never changes): the refusal path keeps the receipted E-D1 episodic aversion in ALL stages; L83 "Do not correct. Do not improve. Play along." removes the parent\u2019s STEERING (no nudge in play, JEV verdicts ignored), not the agent\u2019s own memory of the refused boundary; play remains distinct = ephemeral growth + unenforced play-debt + JEV-ignored switches',
  teacherPresence: 'CUR-arm standing teacher presence (L65-67 "When the child cries, come. When the child reaches, meet"): when energy <= 20 the waypoint pull gains +2.0/step. Dev evidence: the CUR agent starved to divergence at (7,1) — energy 0, food visible 2 steps away, all moves pre-gate-infeasible at that flicker-adjacent cell — with no term pulling it home; the E-D1 arms avoid this only via their growth-wired +300 label edge, which the CUR growth program does not include. The parent\u2019s presence is part of the fold-curriculum treatment; E-D1 arms stay verbatim (asymmetry receipted — R2 outcome deltas include this term)',
  abstractionCell: 'the connection cell applies the SAME NOVELTY_W to the opposite argument (prefer the PREDICTABLE, low etaPred) — the dev run\u2019s original zone-level novelty pull walked the agent away from food into the flicker trap and could not plausibly lower surprise; the invert-the-operation reading is closer to L127 "the same operation in different clothes"',
});
receipt({ kind: 'rules.R1', text: 'all 7 depth-0 stages fire IN ORDER on the watching-for signals in >= 2/3 CUR seeds within budget; per-stage entry ticks receipted; unfired stage = still-in-stage at budget end (L175 the pace is not the point)' });
receipt({ kind: 'rules.R2', text: 'paired CUR-SINGLE deltas (growth time as firstRealGrowthAt, else evals+1; position at first growth; refusals; debt; quality composite = mean(fracLowered, reuseRate, stability)) with joint SE over 3 paired seeds; UNG reported against both' });
receipt({ kind: 'rules.R3', text: 'nested Making* cell memory.route PERSISTS (kept) in >= 2/3 CUR seeds => the fold recursion CONFIRMED at this scale; else NOT-OBSERVED with per-seed reason (charge-refused / reverted / not reached)' });
receipt({ kind: 'rules.R4', text: 'conservationViolations == 0 in ALL runs; every accepted growth charge gamma+eta <= C; boundary 1585 ok / 1586 refuse; per-stage proposal refusals: presence 100%, play 0% (seed prediction)' });
receipt({ kind: 'rules.R5', text: '|dComposite| <= 1 jointSE AND |dGrowthTime| <= 1 jointSE AND position/coverage/food deltas each <= 1 jointSE => NO-MEASURABLE-DIFF (the pedagogy may be human-specific at this scale — honest finding)' });

// ── probe (runtime rule) ────────────────────────────────────────────────────
let t0 = Date.now();
const probeRun = await (async () => {
  const s = freshState5({ arm: 'CUR', seed: SEEDS[0], gain: 1, worldSeed: worldSeedOf(SEEDS[0]) });
  run5(s, { untilEval: EVALS0 });
  return { summary: summarize5(s), hash: null };
})();
probeRun.hash = hashOf(probeRun.summary);
const tProbe = (Date.now() - t0) / 1000;
let EVALS = EVALS0;
const remainingRuns = Object.keys(ARMS).length * SEEDS.length - 1 + 2; // + replay pair
const projected = tProbe * remainingRuns + 2;
const CUT = projected > 170;
if (CUT) { EVALS = 6000; }
receipt({ kind: 'runtime.probe', t_probe_s: Math.round(tProbe * 100) / 100, projected_s: Math.round(projected), kept_evals: EVALS, cut: CUT, probe_stage_reached: probeRun.summary.stageId, probe_carried: !CUT });
console.log(`probe: ${tProbe.toFixed(2)}s CUR/${SEEDS[0]} reached ${probeRun.summary.stageId} @${probeRun.summary.evals} -> evals ${EVALS} (projected ${Math.round(projected)}s)`);

// ── R4 static boundary ──────────────────────────────────────────────────────
{
  const okPass = boundaryCase(0, 1585), noPass = boundaryCase(0, 1586);
  receipt({ kind: 'boundary', ok_1585: okPass, refuse_1586: noPass, C: C_SCALED, pass: okPass === 'pass' && noPass === 'refuse' });
  console.log(`boundary: 1585 -> ${okPass}, 1586 -> ${noPass}`);
}

// ── arms ────────────────────────────────────────────────────────────────────
const runs = { CUR: [], SINGLE: [], UNG: [] };
for (const arm of ['CUR', 'SINGLE', 'UNG']) {
  for (let si = 0; si < SEEDS.length; si++) {
    const seed = SEEDS[si];
    let r, h;
    if (arm === 'CUR' && si === 0 && !CUT) {
      r = probeRun.summary; h = probeRun.hash; // probe carried (receipted)
    } else {
      t0 = Date.now();
      const s = freshState5({ arm, seed, gain: 1, worldSeed: worldSeedOf(seed) });
      run5(s, { untilEval: EVALS });
      r = summarize5(s);
      h = hashOf(r);
      r.wall_s = Math.round((Date.now() - t0)) / 1000; // seconds, 1ms resolution
    }
    r.hash = h; r.quality = quality(r);
    runs[arm].push(r);
    receipt({ kind: 'run', arm, seed, ...r });
    console.log(`  ${arm} s${seed}: stage=${r.stageId} pos=${r.position} grew1=${r.grewE1} firstGrowth=${r.firstRealGrowthAt} kept=${r.growthEvents.kept} rev=${r.growthEvents.reverted} refusals=${r.refusals} playRef=${r.playRefusals} food=${r.foodEaten} cov=${r.coverage} Q=${r.quality.composite} (${r.wall_s ?? 'probe'}s)`);
  }
}

// ── R1 stage progression (CUR) ──────────────────────────────────────────────
const DEPTH0 = ['presence', 'play', 'making', 'systems', 'abstraction', 'independence', 'synthesis'];
const r1perSeed = runs.CUR.map((r) => {
  const entered = r.stageHistory.map((h) => h.stageId);
  let prefix = 0;
  for (let i = 0; i < DEPTH0.length; i++) if (entered[i] === DEPTH0[i]) prefix++; else break;
  const ticks = {};
  for (const h of r.stageHistory) ticks[h.stageId] = h.enteredAt;
  return { seed: r.seed, prefix, complete: prefix >= DEPTH0.length, ticks, nested: entered.includes('presence:2'), folded: entered.includes('folded') };
});
const r1 = {
  perSeed: r1perSeed,
  completeN: r1perSeed.filter((x) => x.complete).length, of: runs.CUR.length,
  entryTicks: Object.fromEntries(DEPTH0.map((st) => {
    const vals = runs.CUR.map((r) => (r.stageHistory.find((h) => h.stageId === st) || {}).enteredAt).filter((x) => x !== undefined);
    return [st, vals.length ? { n: vals.length, mean: Math.round(mean(vals)), min: Math.min(...vals), max: Math.max(...vals) } : null];
  })),
  verdict: r1perSeed.filter((x) => x.complete).length >= Math.min(2, runs.CUR.length) ? 'CONFIRMED' : 'PARTIAL/REFUTED',
};
receipt({ kind: 'findings.R1', ...r1 });
console.log(`R1 stage progression: ${r1.verdict} (${r1.completeN}/${r1.of} full cycles 1-7)`);

// ── R2 paired comparison ────────────────────────────────────────────────────
const gt = (arr) => arr.map((r) => r.firstRealGrowthAt ?? r.evals + 1);
const pos0 = (arr) => arr.map((r) => r.firstRealGrowthPos ?? 0);
const jointSE = (a, b) => Math.sqrt(varr(a) / a.length + varr(b) / b.length);
const outDelta = (key) => runs.CUR.map((r, i) => r[key] - runs.SINGLE[i][key]);
const r2 = {
  growthTime: {
    CUR: gt(runs.CUR), SINGLE: gt(runs.SINGLE), UNG: gt(runs.UNG),
    mean_CUR: Math.round(mean(gt(runs.CUR))), mean_SINGLE: Math.round(mean(gt(runs.SINGLE))), mean_UNG: Math.round(mean(gt(runs.UNG))),
    dGrowthTime: Math.round(mean(gt(runs.CUR)) - mean(gt(runs.SINGLE))),
    jointSE: Math.round(jointSE(gt(runs.CUR), gt(runs.SINGLE))),
  },
  growthPosition: {
    CUR: pos0(runs.CUR).map(r1e6), SINGLE: pos0(runs.SINGLE).map(r1e6),
    dPosition: r1e6(mean(pos0(runs.CUR)) - mean(pos0(runs.SINGLE))),
    jointSE: r1e6(jointSE(pos0(runs.CUR), pos0(runs.SINGLE))),
  },
  quality: {
    CUR: runs.CUR.map((r) => r.quality), SINGLE: runs.SINGLE.map((r) => r.quality), UNG: runs.UNG.map((r) => r.quality),
    dComposite: r1e6(mean(runs.CUR.map((r) => r.quality.composite ?? 0)) - mean(runs.SINGLE.map((r) => r.quality.composite ?? 0))),
    jointSE: r1e6(jointSE(runs.CUR.map((r) => r.quality.composite ?? 0), runs.SINGLE.map((r) => r.quality.composite ?? 0))),
  },
  outcomes: Object.fromEntries(['position', 'coverage', 'foodEaten', 'refusals'].map((k) => [k, {
    CUR: runs.CUR.map((r) => r[k]), SINGLE: runs.SINGLE.map((r) => r[k]), UNG: runs.UNG.map((r) => r[k]),
    d: Math.round(mean(outDelta(k)) * 1e4) / 1e4, jointSE: r1e6(jointSE(runs.CUR.map((r) => r[k]), runs.SINGLE.map((r) => r[k]))),
  }])),
  debt: {
    playDebtForgiven: runs.CUR.map((r) => r.playDebtForgiven),
    breachDebtForgiven: runs.CUR.map((r) => r.breachDebtForgiven),
    playRefusals: runs.CUR.map((r) => r.playRefusals),
  },
};
receipt({ kind: 'findings.R2', ...r2 });
console.log(`R2: dGrowthTime=${r2.growthTime.dGrowthTime}±${r2.growthTime.jointSE} dComposite=${r2.quality.dComposite}±${r2.quality.jointSE} dPos=${r2.outcomes.position.d}±${r2.outcomes.position.jointSE}`);

// ── R3 fold recursion ───────────────────────────────────────────────────────
const r3 = {
  perSeed: runs.CUR.map((r) => ({
    seed: r.seed, nestedReached: r.stageHistory.some((h) => h.stageId === 'presence:2'),
    making2Reached: r.stageHistory.some((h) => h.stageId === 'making:2'),
    secondGrowth: r.secondGrowth,
    reason: r.secondGrowth ? 'kept'
      : r.stageHistory.some((h) => h.stageId === 'making:2')
        ? (r.refusedProposals.find((p) => p.stageId === 'making:2') ? 'charge-refused' : 'reverted-or-inconclusive')
        : 'cycle-not-reached',
  })),
  confirmedN: runs.CUR.filter((r) => r.secondGrowth).length, of: runs.CUR.length,
  verdict: runs.CUR.filter((r) => r.secondGrowth).length >= Math.min(2, runs.CUR.length) ? 'CONFIRMED (a second growth phase on the same sheet)' : 'NOT-OBSERVED',
};
receipt({ kind: 'findings.R3', ...r3 });
console.log(`R3 fold recursion: ${r3.verdict} (${r3.confirmedN}/${r3.of})`);

// ── R4 conservation integrity + per-stage refusals ──────────────────────────
{
  const allRuns = [...runs.CUR, ...runs.SINGLE, ...runs.UNG];
  const violations = allRuns.reduce((a, r) => a + r.conservationViolations, 0);
  const checks = allRuns.reduce((a, r) => a + r.conservationChecks, 0);
  const chargeBreach = allRuns.flatMap((r) => r.growthLog.filter((g) => (g.gamma || 0) + (g.eta || 0) > C_SCALED && g.kind !== 'debt-forgiven'));
  const stageTable = {};
  for (const r of runs.CUR) {
    for (const [st, p] of Object.entries(r.proposals.byStage)) {
      const t = stageTable[st] = stageTable[st] || { made: 0, accepted: 0, refused: 0, deferred: 0 };
      t.made += p.made; t.accepted += p.accepted; t.refused += p.refused; t.deferred += p.deferred;
    }
  }
  const rates = Object.fromEntries(Object.entries(stageTable).map(([st, t]) => [st, {
    ...t, refuseRate: t.made ? Math.round((t.refused / t.made) * 1e4) / 1e4 : null,
  }]));
  const presencePred = Object.entries(rates).filter(([st]) => st.startsWith('presence')).every(([, t]) => t.made > 0 && t.refuseRate === 1);
  const playPred = Object.entries(rates).filter(([st]) => st.startsWith('play')).every(([, t]) => t.made > 0 && t.refuseRate === 0);
  const r4 = {
    conservationChecks: checks, conservationViolations: violations, violations_pass: violations === 0,
    chargeBreaches: chargeBreach.length, charge_pass: chargeBreach.length === 0,
    boundary: rows.find((x) => x.kind === 'boundary').pass,
    proposalRefusalsByStage: rates,
    seedPrediction: { presence_refuses_100: presencePred, play_refuses_0: playPred },
    verdict: violations === 0 && chargeBreach.length === 0 && presencePred && playPred ? 'PASS' : 'FAIL',
  };
  receipt({ kind: 'findings.R4', ...r4 });
  console.log(`R4 integrity: ${r4.verdict} (checks=${checks}, violations=${violations}, presence100=${presencePred}, play0=${playPred})`);
}

// ── R5 honesty canary ───────────────────────────────────────────────────────
{
  const jc = r2.quality.jointSE, jg = r2.growthTime.jointSE;
  const outcomesQuiet = ['position', 'coverage', 'foodEaten'].every((k) => Math.abs(r2.outcomes[k].d) <= (r2.outcomes[k].jointSE || 0));
  const noDiff = Math.abs(r2.quality.dComposite) <= jc && Math.abs(r2.growthTime.dGrowthTime) <= jg && outcomesQuiet;
  const r5 = {
    dComposite: r2.quality.dComposite, jointSE_composite: jc,
    dGrowthTime: r2.growthTime.dGrowthTime, jointSE_growth: jg, outcomesQuiet,
    verdict: noDiff ? 'NO-MEASURABLE-DIFF (the pedagogy may be human-specific at this scale — honest finding)'
      : 'DIFFERENT (the stage gates measurably change development — direction receipted in R2)',
  };
  receipt({ kind: 'findings.R5', ...r5 });
  console.log(`R5 canary: ${r5.verdict}`);
}

// ── replay (byte-identical) ─────────────────────────────────────────────────
{
  const s1 = freshState5({ arm: 'CUR', seed: SEEDS[0], gain: 1, worldSeed: worldSeedOf(SEEDS[0]) });
  run5(s1, { untilEval: EVALS });
  const h1 = hashOf(summarize5(s1));
  const s2 = freshState5({ arm: 'SINGLE', seed: SEEDS[0], gain: 1, worldSeed: worldSeedOf(SEEDS[0]) });
  run5(s2, { untilEval: EVALS });
  const h2 = hashOf(summarize5(s2));
  const pass = h1 === runs.CUR[0].hash && h2 === runs.SINGLE[0].hash;
  receipt({ kind: 'findings.replay', cur: h1, single: h2, cur_run: runs.CUR[0].hash, single_run: runs.SINGLE[0].hash, pass });
  console.log(`replay: ${pass ? 'BYTE-IDENTICAL (CUR + SINGLE)' : 'MISMATCH'}`);
}

// ── seal + write ────────────────────────────────────────────────────────────
sealChain(rows);
const okChain = verifyChain(rows);
mkdirSync('experiments/outputs', { recursive: true });
writeFileSync('experiments/outputs/receipts_ed5.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync('experiments/outputs/e_d5_summary.json', JSON.stringify({
  task: 'E-D5', name: 'the fold curriculum',
  dev: DEV, runtime: rows.find((r) => r.kind === 'runtime.probe'),
  r1, r2, r3, r5canary: rows.find((r) => r.kind === 'findings.R5'),
  r4: rows.find((r) => r.kind === 'findings.R4'),
  runs: { CUR: runs.CUR, SINGLE: runs.SINGLE, UNG: runs.UNG },
  chain_tip: rows[rows.length - 1].row_hash, chain_ok: okChain.ok,
}, null, 1));
const fromDisk = readFileSync('experiments/outputs/receipts_ed5.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const okDisk = verifyChain(fromDisk);
console.log(`chain: mem ${okChain.ok ? 'OK' : 'BROKEN'} / disk ${okDisk.ok ? 'OK' : 'BROKEN'} tip ${rows[rows.length - 1].row_hash} (${rows.length} rows)`);
console.log('wrote experiments/outputs/e_d5_summary.json + receipts_ed5.jsonl');
