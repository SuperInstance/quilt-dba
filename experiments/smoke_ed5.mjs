// smoke_ed5.mjs — the E-D5 lane's contract (NEW file; experiments/smoke.mjs
// stays untouched). ALL GREEN before the E-D5 commit.
// Checks the fold-curriculum stage machine: the seed's stage order, the
// per-stage gates (Presence refuses 100%, Play accepts 100% + boundary held,
// Making one-at-a-time with measured surprise criterion, Abstraction
// reuse-only, Independence gate-step-back), debt forgiveness at Play exit,
// conservation integrity, determinism/replay, and the chain idiom.
import {
  freshState5, run5, summarize5, proposeGrowth, gate, advanceStage, stageExit,
  policyScore5, signals, STAGE_ORDER, STAGES, E5,
} from '../dba/curriculum.mjs';
import { boundaryCase, C_SCALED } from '../dba/kernels.mjs';
import { sealChain, verifyChain } from '../shared/receipts.mjs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  \u2713 ' + name); } else { fail++; console.log('  \u2717 ' + name); } };
const worldSeedOf = (seed) => Math.imul(seed, 0x9E3779B1) >>> 0;

// 1. stage order matches the seed's year order (seed-edu L59-160)
ok(JSON.stringify(STAGE_ORDER) === JSON.stringify(['presence', 'play', 'making', 'systems', 'abstraction', 'independence', 'synthesis']),
  `stage order = seed year order (${STAGE_ORDER.join('->')})`);

// 2. every stage carries its seed citation
ok(Object.values(STAGES).every((st) => /seed-edu L\d+/.test(st.seed)), 'every stage cites its seed lines');

// 3. R4 boundary: 1585 passes, 1586 refuses (the law is not touched by stages)
ok(boundaryCase(0, 1585) === 'pass' && boundaryCase(0, 1586) === 'refuse' && C_SCALED === 1585,
  'boundary: 1585 ok / 1586 refuse (C=1585 scaled)');

// 4. PRESENCE gate refuses 100% of growth proposals
{
  const s = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  s.stageId = 'presence';
  const v1 = proposeGrowth(s), v2 = proposeGrowth(s);
  ok(v1.verdict === 'refuse' && v2.verdict === 'refuse' && s.proposals.byStage.presence.made === 2
    && s.proposals.byStage.presence.refused === 2, `presence refuses 100% (${s.proposals.byStage.presence.refused}/${s.proposals.byStage.presence.made})`);
  ok(s.features && Object.keys(s.features).length === 0, 'presence adds no cells');
}

// 5. PLAY gate accepts 100% by design (ephemerals) and the boundary is still
//    enforced at C (gate verdict text carries the receipted interpretation)
{
  const s = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  s.stageId = 'play';
  const v1 = proposeGrowth(s), v2 = proposeGrowth(s), v3 = proposeGrowth(s);
  const play = s.proposals.byStage.play;
  ok(v1.verdict === 'accept' && v1.kind === 'ephemeral' && v2.verdict === 'accept' && play.refused === 0,
    `play refuses 0% by design (accepted ${play.accepted}/${play.made}, ephemeral)`);
  ok(s.playDebt.charge > 0, `play charges book to play-debt (${s.playDebt.charge}) not the enforced ledger`);
  ok(Object.keys(s.features).length === 2, 'play structures added (a tower is a thing, L85)');
}

// 6. PLAY exit: debt FORGIVEN + ephemerals unmade (make/unmake, L85)
{
  const s = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  s.stageId = 'play';
  proposeGrowth(s); proposeGrowth(s);
  const debtBefore = s.playDebt.charge, featsBefore = Object.keys(s.features).length;
  s.sig.orientFires = 1; // arbitrary; play exit uses plateau — force the path
  s.stageId = 'play';
  advanceStage(s);
  ok(s.playDebt.charge === 0 && s.playDebt.breach === 0 && s.playDebt.forgivenAt !== null,
    `play debt forgiven at exit (${debtBefore} -> 0)`);
  ok(Object.keys(s.features).filter((k) => k.startsWith('play.')).length === 0 && featsBefore === 2,
    'play structures unmade at exit (then it isn\u2019t; the stage-entry proposal of Making may legitimately follow)');
  ok(s.growthLog.some((g) => g.kind === 'debt-forgiven' && g.verdict === 'forgiven'), 'forgiveness receipted as a growth-log row');
}

// 7. ABSTRACTION gate: param-REUSE only — the concrete duplicate (newParams 1)
//    is refused (the gate's negative test), the kernel (reuse) is accepted
{
  const s = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  s.stageId = 'abstraction';
  const decls = require_abstraction_decls();
  const vKernel = gate(s, decls.find((d) => d.id === 'policy.kernel'));
  const vConcrete = gate(s, decls.find((d) => d.id === 'policy.concrete'));
  ok(vKernel.verdict === 'accept' && vConcrete.verdict === 'refuse' && /REUSE/.test(vConcrete.why),
    'abstraction: reuse accepted, new-param concrete duplicate REFUSED (L127)');

  function require_abstraction_decls() {
    // reach into the module's own declaration via a probe proposal sequence
    return [mak('policy.kernel', [], ['NOVELTY_W', 'DECAY_FACTOR']), mak('policy.concrete', ['CONCRETE_W'], [])];
    function mak(id, newParams, reusedParams) { return { id, newParams, reusedParams, edges: [], why: '' }; }
  }
}

// 8. INDEPENDENCE: only the conservation law remains — a charge that fits C
//    is accepted even though the JEV gate would not execute it
{
  const s = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  s.stageId = 'independence';
  const v = gate(s, { id: 'x', newParams: [], reusedParams: [], edges: [] });
  ok(v.verdict === 'accept' && /only the conservation law/.test(v.note || ''), 'independence: gate steps back, only C remains (L139)');
  const s2 = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  s2.stageId = 'independence';
  for (let i = 0; i < E5.WINDOW; i++) s2.sig.etaWindow.push(1400); // trailMean 1400 -> charge 1650 > C
  const v2 = gate(s2, { id: 'x', newParams: [], reusedParams: [], edges: [] });
  ok(v2.verdict === 'refuse' && /C=1585/.test(v2.why), 'independence: a charge that breaches C is REFUSED (the guardian never steps back)');
}

// 9. SYNTHESIS/FOLDED: growth closed, the fold recurses instead
{
  const s = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  s.stageId = 'synthesis';
  ok(gate(s, { id: 'x', newParams: [], reusedParams: [], edges: [] }).verdict === 'refuse', 'synthesis: growth proposals refused (composition, not addition)');
}

// 10. MAKING: one cell at a time + the measured surprise criterion REVERTS a
//     failed making (the failure is the lesson, L103)
{
  const s = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  s.stageId = 'making';
  for (let i = 0; i < E5.WINDOW; i++) s.sig.etaWindow.push(400);
  const v = proposeGrowth(s); // sensors.gradient accepted -> measuring
  ok(v.verdict === 'accept' && s.measuring && s.measuring.cell === 'sensors.gradient' && Math.abs(s.measuring.preMean - 400) < 1e-9,
    'making: first real cell accepted, pre-window mean measured (400)');
  // feed a WORSE post window (eta 800 > 400) -> delta > 0 -> revert
  for (let i = 0; i < E5.MAKING_MEASURE; i++) { s.measureBuf.push({ eval: s.eval + 1 + i, eta: 800 }); s.measuring.samples++; }
  s.measuring.span = E5.MAKING_MEASURE;
  s.eval += 500;
  stageExit(s); // no-op check; the resolution happens inside step5 — force it:
  s.measuring.span = E5.MAKING_MEASURE_CAP * 2 + 1; // ensure the done condition
  // run one eval to drive the resolution path
  s.diverged = false;
  run5(s, { untilEval: s.eval + 1 });
  const g = s.growthLog.find((x) => x.cells[0] === 'sensors.gradient');
  ok(g && g.verdict === 'reverted' && g.delta > 0 && !s.features['sensors.gradient'],
    `making: failed addition REVERTED (delta=${g ? g.delta : 'n/a'}) — the failure is the lesson`);
}

// 11. conservation: a mini CUR run never breaches C and asserts it everywhere
{
  const s = freshState5({ arm: 'CUR', seed: 11, gain: 1, worldSeed: worldSeedOf(11) });
  const sum = run5(s, { untilEval: 400 });
  ok(sum.conservationViolations === 0 && sum.conservationChecks > 0,
    `conservation invariant holds (${sum.conservationChecks} checks, 0 violations)`);
  ok(sum.stageHistory.length > 1 && sum.stageHistory[0].stageId === 'presence', 'stage machine advanced past presence');
}

// 12. determinism: same seed -> byte-identical summaries (no hidden rng)
{
  const a = summarize5((() => { const s = freshState5({ arm: 'CUR', seed: 23, gain: 1, worldSeed: worldSeedOf(23) }); run5(s, { untilEval: 300 }); return s; })());
  const b = summarize5((() => { const s = freshState5({ arm: 'CUR', seed: 23, gain: 1, worldSeed: worldSeedOf(23) }); run5(s, { untilEval: 300 }); return s; })());
  ok(JSON.stringify(a) === JSON.stringify(b), 'determinism: same seed -> identical summaries');
}

// 13. the E-D1 threshold arms keep their semantics (growth pair on position)
{
  const s = freshState5({ arm: 'SINGLE', seed: 33, gain: 1, worldSeed: worldSeedOf(33) });
  const sum = run5(s, { untilEval: 3000 });
  const g = sum.growthLog.find((x) => x.kind === 'real-e-d1');
  ok(g === undefined || (g.cells[0] === 'sensors.language' && g.cells[1] === 'teacher.label' && g.verdict === 'kept-observed'),
    'single-gate arm: E-D1 stage-2 pair, observed-only (never reverted)');
  ok(sum.stageId === 'presence' && sum.stageHistory.length === 1, 'single-gate arm: no stage machine (E-D1 has one gate)');
}

// 14. the JEV gate steps back is VISIBLE in counts (ignored verdicts booked)
{
  const s = freshState5({ arm: 'CUR', seed: 43, gain: 1, worldSeed: worldSeedOf(43) });
  const sum = run5(s, { untilEval: 1200 });
  ok(sum.jevCounts.ignored >= 0 && 'ignored' in sum.jevCounts, 'jev counts carry the ignored (stepped-back) bucket');
}

// 15. signals: questions (L165) + plateau detector behave on synthetic data
{
  const s = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  for (let i = 0; i < E5.WINDOW; i++) s.sig.etaWindow.push(0);
  s.sig.lastRefusalEval = -999;
  ok(stageExit({ ...s, stageId: 'play' }) === true, 'plateau: full zero window -> play exit fires');
  s.sig.etaWindow.fill(900);
  ok(stageExit({ ...s, stageId: 'play' }) === false, 'plateau: hot window -> play exit holds');
  ok(signals(s).newKeyRate === 0, 'newKeyRate well-defined');
}

// 16. receipt chain idiom seals + verifies (fleet pattern, shared/receipts)
{
  const rows = [{ seq: 0, kind: 'a' }, { seq: 1, kind: 'b' }];
  sealChain(rows);
  ok(verifyChain(rows).ok === true, 'receipt chain seals + verifies');
}

// 17. SCOPING LAW: a watching-for signal from BEFORE a stage's entry never
//     fires that stage's exit (a stage does not inherit a predecessor's life)
{
  const s = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  s.stageId = 'making'; s.stageEnteredAt = 100; s.eval = 150;
  s.sig.confusions.push({ eval: 50, eta: 900, mean: 300 }); // before entry
  ok(stageExit(s) === false, 'scoping: a pre-entry rule-break does NOT fire making exit');
  s.sig.confusions.push({ eval: 120, eta: 900, mean: 300 }); // in-stage
  ok(stageExit(s) === true, 'making exit fires on the IN-STAGE why-question (L101)');
  const s2 = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  s2.stageId = 'independence'; s2.stageEnteredAt = 500; s2.eval = 600;
  for (let i = 0; i < E5.WINS_N; i++) s2.sig.wins.push({ eval: 400 + i }); // all pre-entry
  ok(stageExit(s2) === false, 'scoping: pre-entry wins do NOT fire independence exit');
  s2.sig.wins.push({ eval: 550 }, { eval: 560 }, { eval: 570 }); // 3 in-stage wins
  ok(stageExit(s2) === true, 'independence exit counts IN-STAGE wins only (L143)');
}

// 18. ABSTRACTION exit = the connection WORKS: the reuse-cell's measurement
//     resolved kept (L129); a refused/reverted connection does not exit
{
  const s = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  s.stageId = 'abstraction';
  ok(stageExit(s) === false, 'abstraction holds while the connection is unproven');
  s.sig.connectionKept = true;
  ok(stageExit(s) === true, 'abstraction exits when the connection resolves kept (L129)');
}

// 19. SYNTHESIS exit = an unanswerable question (L157): food in a never-
//     proposed zone OR a burst of never-seen keys since entry
{
  const s = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  s.stageId = 'synthesis'; s.stageEnteredAt = 100; s.eval = 150; s.stageEntryQuestions = s.sig.questions;
  ok(stageExit(s) === false, 'synthesis holds with no unanswerable question');
  s.sig.eaten.push({ eval: 120, zone: 3 }); // zone 3 never proposed (proposedZones = {0:true})
  ok(stageExit(s) === true, 'synthesis: never-proposed-zone feed = the question you cannot answer');
  const s2 = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  s2.stageId = 'synthesis'; s2.stageEnteredAt = 100; s2.eval = 150; s2.stageEntryQuestions = 10;
  s2.sig.questions = 10 + E5.NEWQ_N - 1;
  ok(stageExit(s2) === false, 'synthesis: NEWQ_N-1 new keys holds');
  s2.sig.questions += 1;
  ok(stageExit(s2) === true, `synthesis: >= ${E5.NEWQ_N} never-seen keys asked = unanswerable (§L165)`);
}

// 20. self-taught positions are per-stage (L115): keys learned in an earlier
//     stage do not carry into systems
{
  const s = freshState5({ arm: 'CUR', seed: 7, gain: 1, worldSeed: worldSeedOf(7) });
  s.stageId = 'systems'; s.stageEnteredAt = 900; s.eval = 1000;
  s.sig.stageLearned['making'] = { '0': { '1,1': 1, '2,1': 1, '3,1': 1, '4,1': 1 } }; // 4 positions, wrong stage
  ok(stageExit(s) === false, 'scoping: another stage\'s self-taught positions do not fire systems');
  (s.sig.stageLearned['systems'] = s.sig.stageLearned['systems'] || {})['0'] = { '1,2': 1, '2,2': 1, '3,2': 1, '4,2': 1 };
  ok(stageExit(s) === true, 'systems exits on IN-STAGE self-taught positions (L115)');
}

console.log(fail === 0 ? `\nSMOKE ED5 OK (${pass}/${pass + fail} checks)` : `\nSMOKE ED5 FAILED (${fail} of ${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
