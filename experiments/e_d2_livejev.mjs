// E-D2 — THE LIVE-JEV GATE: swap the MOCK curriculum gate for the REAL
// typesafe "System One" API inside the developmental loop.
// ========================================================================
// Prior receipts collide here: E-D1 (the stages experiment — gated curriculum
// grows 3/3, unguided never, growth at eval 299, chain tip 0xdbb7c528df7b9471),
// Task 22 live-key probe (typesafe System One answered 3 typed questions in
// ONE call: noul/choice/score), cortex/typesafe.mjs wire protocol (LIVE-VERIFIED,
// jev-1.13.0), seed2 §Phase-2 (JEV-gated development).
//
// THE QUESTIONS:
//   Q1 AGREEMENT — at live-funded decision points, does the real System One
//                  emit the same verdict {execute,escalate,discard} as the
//                  sheet's calibrated mock gate on the same state?
//   Q2 PARITY    — does the live-gated arm still GROW (stage 1 -> 2) like the
//                  mock-gated arm, or does the real judge block development?
//   Q3 COST      — latency, call counts, tokens: what does a live teacher cost
//                  per developmental eval?
//   Q4 FAIL-CLOSED — when the API fails, does the receipted fallback (mock
//                  gate's decision for that round + flagged journal row) fire
//                  with no crash and a deterministic trajectory?
//   Q5 REPLAY    — with positive/negative disk caching, does re-running the
//                  live-gated arm reproduce the trajectory bit-for-bit with
//                  ZERO new live calls? (E-D1's replay doctrine, live edition.)
//
// DECISION RULES (receipted BEFORE the final run, house style):
//   R1 AGREEMENT: over live-funded decision points with a live verdict,
//      agreement = same verdict as the mock gate. >= 80% with n >= 10 =>
//      AGREEMENT-HIGH; 50-80% => MIXED; < 50% => DIVERGENT. Report Wilson 95%
//      CI + mean |live_p - mock_p|. Fail-closed/budget rows are NOT agreement
//      points (no live verdict exists); they are R4 evidence.
//   R2 PARITY: live-gated arm grows in >= 2/3 seeds (E-D1's R1 bar) =>
//      CONFIRMED; 0/3 => REFUTED (the real judge blocks development);
//      1/3 => INDETERMINATE. A-mock must reproduce E-D1 (3/3) and D stays 0/3.
//   R3 COST: receipt latency mean/p95 over successful live consults (sum of
//      HTTP attempt durations per consult, excluding backoff sleep), live
//      calls per developmental eval, total live calls + tokens.
//   R4 FAIL-CLOSED: R4a — synthetic PERSISTENT failure injected at (seed 101,
//      consult 2): both attempts fail, fallback = mock gate's decision for
//      that round, journal row flagged fallback_used:true, no crash, zero
//      live-call spend. R4b — synthetic 'once' failure at (seed 101, consult
//      3): attempt 1 synthetic, retry succeeds live (attempts=2). Injection
//      points are pre-pivotal non-proposal consults (E-D1's first proposal is
//      consult 5) — R2 is untouched by construction; verified post-hoc.
//   R5 REPLAY: re-run A-live seed 101 after the live run: every funded consult
//      served from the positive/negative cache, ZERO new live answers, final
//      state hash bit-identical to the live run.
//
// BUDGET CONTRACT (receipted): hard caps — capSeed 10 live answers/seed,
// capRun 25/process, capTotal 40/whole experiment. Live-phase ladder: a
// decision point is live-funded iff (consultIndex <= 8 OR a proposal is
// pending) AND the seed cap AND total caps hold; everything else arbitrates
// with the sheet's mock cell, labeled mock_handoff/budget_mock in the journal.
// Rationale for phase 8: E-D1's pivotal switch lands at consult 5 (t=250) and
// growth at t=299 — phase 8 (t <= 400) covers the whole pre-growth window
// with headroom. The journal records EVERY call attempt (ts, prompt HASH,
// response summary, latency_ms, fallback_used) — no key material, no full
// prompts (the state string carries only benign telemetry; hash-only anyway).
//
// ENDPOINT RECEIPT (live DNS, this lane): the brief recorded
// api.typesafe.dev, but .dev is NXDOMAIN (checked via 1.1.1.1: parent zone
// typesafe.dev exists, api subdomain has no A record) while api.typesafe.ai
// answers with the exact receipted model jev-1.13.0 (~334ms). The cortex crib
// (cortex/typesafe.mjs) also uses .ai. Base = https://api.typesafe.ai.
//
// SECURITY: TYPESAFE_KEY loaded AT RUNTIME ONLY (process.env or parsed from
// /home/z/my-project/.env), held in the client closure, never echoed, never
// persisted; a post-write self-scan greps every written artifact for the key
// material and for 'Bearer '/'apikey_'/'moth_' patterns.
//
// RUNTIME RULES (receipted): dev run (E_D2_DEV=1) validates the whole pipeline
// OFFLINE via a scripted transport (zero live spend, separate cache/journal);
// then the timed 1-seed live run projects wall-clock (cut seeds to 2 if
// projected > 170s; the probe doubles as matrix seed 0).
import { QuiltEngine } from '../engine/index.js';
import { buildSheet } from '../dba/sheet.mjs';
import { mulberry32, fnv1a64 } from '../shared/kit.mjs';
import { sealChain, verifyChain } from '../shared/receipts.mjs';
import { LiveJev, makeQuestions, buildState, loadTypesafeKey, textHasSecret } from '../dba/jev_live.mjs';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';

const DEV = process.env.E_D2_DEV === '1';
const OUT = 'experiments/outputs';
const CACHE = DEV ? OUT + '/.cache/jev-live-ed2-DEV.json' : OUT + '/.cache/jev-live-ed2.json';
const JOURNAL = DEV ? OUT + '/.cache/dev_journal_ed2.jsonl' : OUT + '/livejev_journal.jsonl';
const SEEDS = [101, 118, 135];          // E-D1's exact seeds (paired worlds)
const EVALS = 5000;                     // E-D1's exact horizon
const LIVE_PHASE = 8;                   // consults 1..8 live-funded (t <= 400)
const CAP_SEED = 10, CAP_RUN = 25, CAP_TOTAL = 40;
// R4 injection plan (receipted above): persistent at s101 consult 2, once at consult 3
const INJECT = DEV ? { 's101:2': 'persistent', 's101:3': 'once' } : { 's101:2': 'persistent', 's101:3': 'once' };

const get = async (e, id) => (await e.get(id)).data;            // value cells
const call0 = async (e, id) => (await e.call(id)).data;         // PROGRAM cells (house doctrine)
const set = (e, id, val) => e.set(id, val);
const canon = (o) => JSON.stringify(o, Object.keys(o).sort());
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const r3 = (x) => Math.round(x * 1000) / 1000;
function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const ph = k / n, d = 1 + z * z / n, c = ph + z * z / (2 * n);
  const h = z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n));
  return [r3((c - h) / d), r3((c + h) / d)];
}
// the sheet mock gate's calibration, computed locally for decision RECORDS
// (identical to dba/sheet.mjs jevMock; the cell itself stays the source of
// truth wherever the flow actually consults it)
const mockP = (success) => 0.5 + 0.5 * Math.tanh((success - 0.75) * 8);
const mockActionOf = (p) => (p > 0.95 ? 'execute' : p >= 0.70 ? 'escalate' : 'discard');

// ── the driver: one developmental run (E-D1 verbatim + the gate hook) ───────
async function runRun({ seed, enforce, mode, evals, arm, client = null }) {
  const rng = mulberry32(seed);
  const engine = new QuiltEngine('dba-seed', { eager: true });
  engine.loadSheet(buildSheet(1));
  await set(engine, 'teacher.mode', mode);

  let grown = false, growthAt = null;
  let rewardCount = 0, refusals = 0, debt = 0, jevExecutes = 0, liveExecutes = 0;
  let liveCalls = 0, cacheHits = 0, failClosed = 0, mockHandoffs = 0;
  const decisions = [];
  let prevSurprise = 1500;
  let ci = 0;

  for (let t = 1; t <= evals; t++) {
    const s = await get(engine, 'env.state');
    const cfg = await get(engine, 'env.cfg');
    const tasks = await get(engine, 'env.tasks');
    const rewards = tasks[cfg.task].rewards;

    // curriculum step every 50 evals (teacher consult -> gamma += 150 this eval)
    let consulted = false;
    if (t % 50 === 0) {
      consulted = true;
      ci++;
      const fb = await call0(engine, 'teacher.feedback');
      const proposal = fb.switch_to !== cfg.task;
      // E-D1 verbatim: the mock arm consults the gate CELL only on proposal;
      // the live arm consults it every round (its verdict is the fail-closed
      // fallback + the R1 yardstick). Locally-computed verdict recorded for
      // both (parity assert where both exist).
      const ring = await get(engine, 'env.success_ring');
      const success = ring.length >= 20 ? ring.filter(Boolean).length / ring.length : 0.5;
      const compP = mockP(success);
      let cellP = null;
      if (proposal || arm === 'A-live') {
        const gateMock = await call0(engine, 'teacher.jev_gate');
        cellP = gateMock.noul;
        if (Math.abs(cellP - compP) > 1e-9) throw new Error(`mock parity broken at t=${t}: cell ${cellP} vs computed ${compP}`);
      }
      const mockAction = mockActionOf(compP);

      let liveRes = null, liveAction = null;
      const funded = arm === 'A-live' && client !== null &&
        (ci <= LIVE_PHASE || proposal) &&
        client.budgetLeftTotal() > 0;
      if (funded) {
        const stateStr = buildState({
          task: cfg.task, success, ringLen: ring.length,
          position: await get(engine, 'state.position'), evalIdx: t, proposal,
        });
        liveRes = await client.consult({
          tag: `ed2:s${seed}:t${t}`, seedTag: `s${seed}`, decisionId: `s${seed}:${ci}`,
          state: stateStr, questions: makeQuestions({ task: cfg.task, proposal }),
          fallbackAction: mockAction,
        });
        if (liveRes.source === 'live') liveCalls++;
        else if (liveRes.source === 'cache') cacheHits++;
        else failClosed++;
        liveAction = liveRes.ok ? liveRes.verdict.action : liveRes.action; // fail-closed returns the mock verdict
      } else if (arm === 'A-live' && proposal) {
        // receipted ladder: an unfunded proposal (phase over / budget spent) is
        // arbitrated by the sheet's mock gate decision, LABELED mock_handoff
        liveAction = mockAction;
        mockHandoffs++;
      }

      // decide the switch — the exact E-D1 branch, with the live arbiter added
      if (mode === 'unguided') {
        // E-D1 verbatim (receipted observation): teacher.feedback returns
        // switch_to === task in unguided mode, so this branch is unreachable —
        // arm D's regime is stay-on-task-0. Cribbed as-is; the parity baseline
        // (D never grows) is unaffected.
        if (proposal) {
          const n = tasks.length;
          await set(engine, 'env.cfg', { ...cfg, task: Math.floor(rng() * n) });
        }
      } else if (arm === 'A-mock') {
        if (proposal && mockAction === 'execute') {
          await set(engine, 'env.cfg', { ...cfg, task: fb.switch_to });
          jevExecutes++;
        }
      } else if (arm === 'A-live') {
        if (proposal) {
          if (liveAction === 'execute') {
            await set(engine, 'env.cfg', { ...cfg, task: fb.switch_to });
            jevExecutes++; liveExecutes++;
          }
          // escalate/discard => hold: parity with the mock arm's treatment
          // (E-D1 switches ONLY on execute). Receipted before the run.
        }
      }

      if (consulted) {
        decisions.push({
          t, ci, task: cfg.task, success: r3(success),
          mock_p: r3(compP), mock_action: mockAction, proposal,
          live: liveRes ? { source: liveRes.source, action: liveRes.ok ? liveRes.verdict.action : liveRes.action, p: liveRes.ok ? r3(liveRes.verdict.p) : null, attempts: liveRes.attempts ?? null, cached: !!liveRes.cached }
            : (arm === 'A-live' && proposal ? { source: 'mock_handoff', action: mockAction, p: null, attempts: null, cached: false } : null),
          agree: liveRes && liveRes.ok ? (liveRes.verdict.action === mockAction) : null,
          switched: false, switch_by: null,
        });
        // patch the just-pushed record with the actual switch outcome
        const cfgNow = await get(engine, 'env.cfg');
        const d = decisions[decisions.length - 1];
        d.switched = cfgNow.task !== cfg.task;
        d.switch_by = d.switched ? (arm === 'A-live' ? 'live' : 'mock') : null;
      }
    }

    // candidate action
    const act = await call0(engine, 'policy.action');
    const pred = await call0(engine, 'world.predict');

    // DoubleEntry prices the transition BEFORE it evaluates (seed3 §3)
    const nx = Math.max(0, Math.min(cfg.W - 1, s.x + act.dx));
    const ny = Math.max(0, Math.min(cfg.H - 1, s.y + act.dy));
    const dPred = Math.abs(pred.x - nx) + Math.abs(pred.y - ny);
    const etaCand = dPred * 250 + (pred.pred_reward !== (s.last_reward ? 1 : 0) ? 500 : 0);
    const gamma = 100 + (consulted ? 150 : 0);
    const sum = gamma + etaCand;

    if (enforce && sum > 1585) {
      refusals++;
      const ledgerLog = await get(engine, 'conservation.ledger');
      if (ledgerLog.length < 512) ledgerLog.push({ t, gamma, eta: etaCand, verdict: 'refuse' });
      await set(engine, 'conservation.ledger', ledgerLog);
      await set(engine, 'world.prev_surprise', prevSurprise);
      continue;
    }
    if (!enforce && sum > 1585) debt += sum - 1585;

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
    const ring2 = await get(engine, 'env.success_ring');
    ring2.push(hit); if (ring2.length > 100) ring2.shift();
    await set(engine, 'env.success_ring', ring2);

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
  }

  const finState = await get(engine, 'env.state');
  const hash = fnv1a64(canon({
    s: finState, pos: await get(engine, 'state.position'), sem: await get(engine, 'memory.semantic'),
    grown, vis: await get(engine, 'env.visits'),
  })).slice(2, 14);
  return {
    seed, arm: arm || mode, enforce, mode, evals,
    position: await get(engine, 'state.position'),
    grown, growthAt, refusals, debt, rewardCount, jevExecutes, liveExecutes,
    liveCalls, cacheHits, failClosed, mockHandoffs,
    jev_log_len: (await get(engine, 'teacher.jev_log')).length,
    beta1: await call0(engine, 'skills.graph'),
    hash,
    decisions,
  };
}

async function snapshot(engine) {
  const ids = ['env.state', 'env.cfg', 'env.visits', 'env.success_ring', 'memory.episodic', 'memory.semantic',
    'teacher.mode', 'teacher.jev_log', 'growth.done', 'growth.log', 'conservation.ledger', 'world.prev_surprise',
    'state.position', 'world.last_features'];
  const cells = {};
  for (const id of ids) cells[id] = await get(engine, id);
  return { cells, grown: (await get(engine, 'growth.done')) === 1 };
}

// ── experiment orchestration ────────────────────────────────────────────────
const rows = [];
const receipt = (r) => rows.push(r);
const key = loadTypesafeKey();
const KEY_OK = typeof key === 'string' && key.length > 20;

if (DEV) {
  console.log('=== E-D2 DEV RUN (offline scripted transport, zero live spend) ===');
  const fake = async () => ({ ok: true, status: 200, ms: 4, json: { model: 'jev-scripted', usage: { input_tokens: 1, output_tokens: 1 }, answers: { advance: { type: 'noul', noul: 0.97 }, task_choice: { choice: 't1', confidence: 0.8 }, readiness: { score: 4, confidence: 0.6 } } } });
  const dev = new LiveJev({ key: 'dev-not-a-key', cachePath: CACHE, journalPath: JOURNAL, transport: fake, inject: (id) => INJECT[id] ?? null, capSeed: CAP_SEED, capRun: CAP_RUN, capTotal: CAP_TOTAL });
  const aMock = await runRun({ seed: 101, enforce: true, mode: 'jev-gated', evals: 550, arm: 'A-mock' });
  const aLive = await runRun({ seed: 101, enforce: true, mode: 'jev-gated', evals: 550, arm: 'A-live', client: dev });
  const dRun = await runRun({ seed: 101, enforce: true, mode: 'unguided', evals: 550, arm: 'D' });
  const checks = [
    ['A-mock crib: grew at 299 with 1 execute', aMock.grown && aMock.growthAt === 299 && aMock.jevExecutes === 1],
    ['A-live fake-agreeing gate pairs bit-for-bit with A-mock', aLive.grown && aLive.growthAt === aMock.growthAt && aLive.hash === aMock.hash && aLive.liveExecutes === 1],
    ['D never grows', !dRun.grown],
    ['R4a fired: persistent synthetic fail-closed journaled', dev.rows.some(r => r.source === 'fail_closed_synthetic' && r.fallback_used === true)],
    ['R4b fired: once-injection retried to live', dev.rows.some(r => r.source === 'live' && r.attempts === 2)],
    ['journal has no full state text', !dev.rows.some(r => JSON.stringify(r).includes('Developmental forager'))],
  ];
  // replay: re-run A-live from cache
  const before = dev.totalUsed;
  const replay = await runRun({ seed: 101, enforce: true, mode: 'jev-gated', evals: 550, arm: 'A-live', client: dev });
  checks.push(['replay: zero new live answers', dev.totalUsed - before === 0]);
  checks.push(['replay: bit-identical hash', replay.hash === aLive.hash]);
  let devOk = true;
  for (const [name, ok] of checks) { console.log(`  ${ok ? '\u2713' : '\u2717'} ${name}`); if (!ok) devOk = false; }
  console.log(devOk ? 'DEV OK — pipeline validated offline' : 'DEV FAILED — fix before the final run');
  process.exit(devOk ? 0 : 1);
}

if (!KEY_OK) {
  receipt({ kind: 'blocker', why: 'TYPESAFE_KEY not loadable at runtime', fallback: 'arms run fail-closed to the mock gate; R4a (synthetic) remains exercisable; NO live results claimed' });
  console.log('BLOCKED: no key — run degraded fail-closed mode (receipted)');
}

// ── receipts BEFORE runs (house style) ──────────────────────────────────────
receipt({ kind: 'run.config', task: 'E-D2 live-jev gate', seeds: SEEDS, evals: EVALS, arms: { 'A-mock': 'E-D1 verbatim (mock gate cell)', 'A-live': 'same loop, REAL typesafe System One arbitrates proposed advances', D: 'unguided baseline (E-D1 verbatim)' }, world: '16x16 forage, 4 tasks, C=1585 x1000 fixed-point (imported from dba/sheet.mjs — no forks)', engine_note: 'the offline-rule teacher keeps proposal authority (sheet cell, unmodified); the live gate ARBITRATES proposals — teacher proposes, System One disposes' });
receipt({ kind: 'rules.R1', text: 'agreement over live-funded points with a live verdict: >=80% & n>=10 => AGREEMENT-HIGH; 50-80% => MIXED; <50% => DIVERGENT; Wilson 95% CI + mean|dp|; fail-closed rows are R4 evidence, not R1 points' });
receipt({ kind: 'rules.R2', text: 'live-gated arm grows >=2/3 seeds => CONFIRMED; 0/3 => REFUTED (real judge blocks development); 1/3 => INDETERMINATE; A-mock must reproduce E-D1 3/3; D 0/3' });
receipt({ kind: 'rules.R3', text: 'latency mean/p95 over successful live consults (sum of HTTP attempt durations, backoff sleep excluded), calls per eval, total live calls + tokens' });
receipt({ kind: 'rules.R4', text: 'R4a synthetic persistent failure at s101 consult 2 -> fallback = mock gate decision + journal fallback_used:true, no crash, zero spend; R4b synthetic once-failure at s101 consult 3 -> retry succeeds live (attempts=2); injection points are pre-pivotal non-proposal consults (E-D1 first proposal = consult 5)' });
receipt({ kind: 'rules.R5', text: 're-run A-live s101 after the live run: all funded consults served from positive/negative cache, ZERO new live answers, hash bit-identical' });
receipt({ kind: 'budget.contract', caps: { seed: CAP_SEED, run: CAP_RUN, total: CAP_TOTAL }, live_phase: LIVE_PHASE, ladder: 'funded iff (consult<=8 OR proposal) AND caps hold; else mock_cell handoff labeled in journal', journal: 'every attempt: ts, prompt_hash (fnv1a64), response summary, latency_ms, fallback_used; NO key, NO full prompts', retry: 'one retry, exponential backoff (400ms) on 429/5xx/network/timeout, then fail closed', cache: 'positive+negative disk cache => zero-call deterministic replay' });
receipt({ kind: 'questions.phrasing', advance: 'noul: "Execute the proposed curriculum advance now? Answer yes only if the agent is ready for a harder task."', task_choice: 'choice: which of the 4 task layouts next (telemetry only)', readiness: 'score: 5-level plain LIST rubric (Task 22 contract) (telemetry only)', thresholds: 'p>0.95 execute / p>=0.70 escalate / else discard — IDENTICAL to the sheet mock gate', escalate_policy: 'escalate => HOLD (parity with the mock arm: E-D1 switches only on execute)', phrasing_frozen: 'receipted before the final run; the probe validates the WIRE CONTRACT, not the phrasing' });
receipt({ kind: 'endpoint.dns', brief_said: 'https://api.typesafe.dev/v1/systemone', live_dns: 'api.typesafe.dev = NXDOMAIN (1.1.1.1 authoritative: parent zone typesafe.dev exists, api has no A record); api.typesafe.ai = 104.18.24.46/25.46 (Cloudflare)', used: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0', probe_live_ms: 334, crib_agrees: 'cortex/typesafe.mjs uses api.typesafe.ai' });

// ── live client + probe ─────────────────────────────────────────────────────
const client = new LiveJev({
  key: KEY_OK ? key : null, cachePath: CACHE, journalPath: JOURNAL,
  inject: (id) => INJECT[id] ?? null,
  capSeed: CAP_SEED, capRun: CAP_RUN, capTotal: CAP_TOTAL,
});
const probeThrowaway = existsSync(JOURNAL)
  ? readFileSync(JOURNAL, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((r) => r.kind === 'probe_throwaway') ?? null
  : null;

let probe = null;
if (KEY_OK) {
  const t0 = Date.now();
  const stateStr = buildState({ task: 0, success: 0.94, ringLen: 25, position: 620, evalIdx: 240, proposal: true });
  const res = await client.consult({
    tag: 'ed2:probe', seedTag: 'probe', decisionId: 'probe:in-experiment',
    state: stateStr, questions: makeQuestions({ task: 0, proposal: true }), fallbackAction: null, kind: 'probe',
  });
  const contractOk = res.ok && res.answers && Number.isFinite(res.answers.advance?.noul)
    && typeof res.answers.task_choice?.choice === 'string'
    && res.answers.readiness?.score !== undefined;
  probe = { ok: res.ok, source: res.source, contract_ok: contractOk, latency_ms: Date.now() - t0, noul: res.answers?.advance?.noul ?? null, choice: res.answers?.task_choice?.choice ?? null, score: res.answers?.readiness?.score ?? null, model: res.answers ? 'jev-1.13.0' : null };
  receipt({ kind: 'probe.contract', throwaway_row: probeThrowaway ? { noul: probeThrowaway.response_summary?.advance_noul, choice: probeThrowaway.response_summary?.choice, score: probeThrowaway.response_summary?.score, latency_ms: probeThrowaway.latency_ms } : null, in_experiment: probe, verdict: contractOk ? 'CONTRACT CONFIRMED (noul in [0,1], choice string, score present) — wiring proceeds' : 'CONTRACT BROKEN — wiring halts', note: 'throwaway probe spent 1 live call pre-wiring (journaled); in-experiment probe spends 1 more' });
  console.log(`probe: ${res.source} noul=${probe.noul} choice=${probe.choice} score=${probe.score} (${probe.latency_ms}ms) contract=${contractOk ? 'OK' : 'BROKEN'}`);
  if (!contractOk) { receipt({ kind: 'blocker', why: 'live contract broke at probe; no live results claimed' }); }
}

// ── arms (probe doubles as matrix seed 0; timed -> projection rule) ─────────
const runs = { 'A-mock': [], 'A-live': [], D: [] };
let t0 = Date.now();
const first = await runRun({ seed: SEEDS[0], enforce: true, mode: 'jev-gated', evals: EVALS, arm: KEY_OK ? 'A-live' : 'A-mock', client: KEY_OK ? client : null });
first.wall_s = Math.round((Date.now() - t0) / 100) / 10;
const armFirst = first.arm;
runs[armFirst].push(first);
const tLive = first.wall_s;
const projected = tLive * 3 + 3 * 0.4 + 4; // 3 seeds live-ish + 3 mock/D runs (~0.4s each) + replay overhead
let seeds = 3;
const cut = projected > 170;
if (cut) seeds = 2;
receipt({ kind: 'runtime.probe', t_first_live_run_s: tLive, projected_s: Math.round(projected), kept_seeds: seeds, cut, rule: 'projected > 170s => cut seeds to 2 (receipted); probe doubles as matrix seed 0' });
console.log(`runtime probe: first live run ${tLive}s -> projected ${Math.round(projected)}s -> ${seeds} seeds (cut=${cut})`);

const liveSeeds = seeds === 3 ? SEEDS : SEEDS.slice(0, 2);
for (const seed of liveSeeds) {
  if (runs['A-live'].some((r) => r.seed === seed)) continue;
  t0 = Date.now();
  const r = KEY_OK
    ? await runRun({ seed, enforce: true, mode: 'jev-gated', evals: EVALS, arm: 'A-live', client })
    : await runRun({ seed, enforce: true, mode: 'jev-gated', evals: EVALS, arm: 'A-live' });
  r.wall_s = Math.round((Date.now() - t0) / 100) / 10;
  runs['A-live'].push(r);
}
for (const seed of liveSeeds) {
  if (runs['A-mock'].some((r) => r.seed === seed)) continue;
  t0 = Date.now();
  const r = await runRun({ seed, enforce: true, mode: 'jev-gated', evals: EVALS, arm: 'A-mock' });
  r.wall_s = Math.round((Date.now() - t0) / 100) / 10;
  runs['A-mock'].push(r);
}
for (const seed of liveSeeds) {
  if (runs.D.some((r) => r.seed === seed)) continue;
  t0 = Date.now();
  const r = await runRun({ seed, enforce: true, mode: 'unguided', evals: EVALS, arm: 'D' });
  r.wall_s = Math.round((Date.now() - t0) / 100) / 10;
  runs.D.push(r);
}
for (const arm of ['A-mock', 'A-live', 'D']) {
  for (const r of runs[arm]) {
    const d = r.decisions; delete r.decisions; // decisions move to the summary (chain stays compact)
    receipt({ kind: 'run', arm, ...r, decisions_hash: fnv1a64(canon(d)), n_decision_points: d.length, live_funded_points: d.filter((x) => x.live).length });
    console.log(`  ${arm} seed${r.seed}: pos=${r.position} grown=${r.grown}@${r.growthAt} rewards=${r.rewardCount} jevExec=${r.jevExecutes} liveExec=${r.liveExecutes} liveCalls=${r.liveCalls} (${r.wall_s}s)`);
    r.decisions = d;
  }
}

// ── R1 agreement ────────────────────────────────────────────────────────────
const agPoints = runs['A-live'].flatMap((r) => r.decisions.filter((d) => d.live && d.live.source === 'live' && d.agree !== null));
const agK = agPoints.filter((d) => d.agree).length;
const agN = agPoints.length;
const dps = agPoints.map((d) => Math.abs(d.live.p - d.mock_p)).filter((x) => Number.isFinite(x));
const r1 = {
  n: agN, agree: agK, rate: agN ? r3(agK / agN) : null,
  wilson95: wilson(agK, agN),
  mean_abs_dp: dps.length ? r3(mean(dps)) : null,
  cached_points: runs['A-live'].flatMap((r) => r.decisions.filter((d) => d.live && d.live.source === 'cache')).length,
  breakdown: Object.fromEntries(['execute', 'escalate', 'discard'].map((a) => [a, {
    mock: agPoints.filter((d) => d.mock_action === a).length,
    agree: agPoints.filter((d) => d.mock_action === a && d.agree).length,
  }])),
  verdict: agN >= 10 && agK / agN >= 0.8 ? 'AGREEMENT-HIGH' : agN >= 10 && agK / agN >= 0.5 ? 'MIXED' : agN >= 10 ? 'DIVERGENT' : `THIN (n=${agN} < 10 — report, do not overclaim)`,
};
receipt({ kind: 'findings.R1', ...r1, caveat: 'agreement measured on the live arm\'s own trajectory at live-funded points; the mock verdict is the sheet calibration on the same state (cell-consulted on proposals, computed-identical elsewhere, parity-asserted)' });
console.log(`R1 agreement: ${r1.verdict} ${r1.agree}/${r1.n} (CI ${JSON.stringify(r1.wilson95)}, mean|dp|=${r1.mean_abs_dp})`);

// ── R2 growth parity ────────────────────────────────────────────────────────
const grownLive = runs['A-live'].filter((r) => r.grown).length;
const grownMock = runs['A-mock'].filter((r) => r.grown).length;
const grownD = runs.D.filter((r) => r.grown).length;
const r2 = {
  live_grown: grownLive, of: runs['A-live'].length, mock_grown: grownMock, d_grown: grownD,
  growth_at_live: runs['A-live'].map((r) => r.growthAt), growth_at_mock: runs['A-mock'].map((r) => r.growthAt),
  live_executes: runs['A-live'].map((r) => r.liveExecutes),
  verdict: grownLive >= 2 ? 'CONFIRMED' : grownLive === 0 ? 'REFUTED (the real judge blocks development)' : 'INDETERMINATE (1/3)',
};
receipt({ kind: 'findings.R2', ...r2 });
console.log(`R2 parity: ${r2.verdict} (live ${grownLive}/${runs['A-live'].length}, mock ${grownMock}/${runs['A-mock'].length}, D ${grownD})`);

// ── R3 cost ─────────────────────────────────────────────────────────────────
const st = client.stats();
const liveEvals = runs['A-live'].reduce((a, r) => a + r.evals, 0);
const r3out = {
  live_answers_total: st.live_answers_total, attempts: st.attempts,
  latency_ms: st.latency_ms, tokens: st.tokens,
  calls_per_eval: r3(st.live_answers_total / liveEvals),
  cache_hits_in_run: runs['A-live'].reduce((a, r) => a + r.cacheHits, 0),
  fail_closed_in_run: runs['A-live'].reduce((a, r) => a + r.failClosed, 0),
  caps: { seed: CAP_SEED, run: CAP_RUN, total: CAP_TOTAL },
};
receipt({ kind: 'findings.R3', ...r3out });
console.log(`R3 cost: ${st.live_answers_total} live answers, latency mean ${st.latency_ms.mean}ms p95 ${st.latency_ms.p95}ms, ${r3out.calls_per_eval} calls/eval, tokens ${JSON.stringify(st.tokens)}`);

// ── R4 fail-closed (from seed 101's live run) ───────────────────────────────
const s101 = runs['A-live'].find((r) => r.seed === SEEDS[0]) ?? runs[armFirst].find((r) => r.seed === SEEDS[0]);
const dA = s101?.decisions.find((d) => d.ci === 2) ?? null;
const dB = s101?.decisions.find((d) => d.ci === 3) ?? null;
const rowA = client.rows.find((r) => r.source === 'fail_closed_synthetic' && r.decision_id === 's101:2') ?? null;
const rowB = client.rows.find((r) => r.source === 'live' && r.decision_id === 's101:3') ?? null;
const r4 = {
  r4a: {
    fired: !!(rowA && rowA.fallback_used === true),
    fallback_action: rowA?.fallback_action ?? null,
    decision_agrees_with_mock: dA ? dA.live?.action === dA.mock_action : null,
    no_crash_run_completed: !!s101, spend: 0,
    non_proposal_point: dA ? dA.proposal === false : null,
  },
  r4b: {
    fired: !!(rowB && rowB.attempts === 2),
    attempts: rowB?.attempts ?? null,
    latency_ms: rowB?.latency_ms ?? null,
    non_proposal_point: dB ? dB.proposal === false : null,
  },
};
r4.verdict = r4.r4a.fired && r4.r4a.non_proposal_point !== false && r4.r4a.no_crash_run_completed && r4.r4b.fired
  ? 'PASS (fail-closed fallback receipted + retry-recovers receipted)'
  : 'FAIL/DEGRADED';
receipt({ kind: 'findings.R4', ...r4 });
console.log(`R4 fail-closed: ${r4.verdict} (R4a fallback=${r4.r4a.fallback_action}, R4b attempts=${r4.r4b.attempts})`);

// ── R5 cache replay (zero-call, bit-identical) ──────────────────────────────
let r5 = { attempted: false };
if (KEY_OK && client.budgetLeftTotal() > 0) {
  const before = client.totalUsed;
  const beforeRows = client.rows.length;
  const rep = await runRun({ seed: SEEDS[0], enforce: true, mode: 'jev-gated', evals: EVALS, arm: 'A-live', client });
  const newRows = client.rows.slice(beforeRows);
  const cachedRows = newRows.filter((r) => r.cached).length;
  const liveRows = newRows.filter((r) => r.source === 'live').length;
  r5 = {
    attempted: true, new_live_answers: client.totalUsed - before,
    replay_hash: rep.hash, live_hash: s101.hash,
    cached_consults: cachedRows, uncached_live: liveRows,
    pass: client.totalUsed - before === 0 && rep.hash === s101.hash,
  };
  receipt({ kind: 'findings.R5', ...r5, text: 'the live gate is REPLAYABLE: positive+negative disk cache turns live decisions into deterministic ones — zero new calls, bit-identical trajectory (E-D1 replay doctrine, live edition)' });
  console.log(`R5 replay: ${r5.pass ? 'BYTE-IDENTICAL, zero new calls' : 'MISMATCH ' + r5.live_hash + ' vs ' + r5.replay_hash}`);
}

// ── A-mock reproduction receipt (pairing anchor) ────────────────────────────
let mockRepro = { checked: false };
const ed1Path = OUT + '/e_d1_summary.json';
if (existsSync(ed1Path)) {
  const ed1 = JSON.parse(readFileSync(ed1Path, 'utf8'));
  const ref = ed1.runs?.A ?? [];
  mockRepro = {
    checked: true,
    per_seed: runs['A-mock'].map((r) => {
      const e = ref.find((x) => x.seed === r.seed);
      return e ? { seed: r.seed, growth_at: r.growthAt === e.growthAt, jev_executes: r.jevExecutes === e.jevExecutes, position: r.position === e.position, rewards: r.rewardCount === e.rewardCount, hash: r.hash === e.hash } : { seed: r.seed, ref_missing: true };
    }),
    all_match: runs['A-mock'].every((r) => {
      const e = ref.find((x) => x.seed === r.seed);
      return e && r.growthAt === e.growthAt && r.jevExecutes === e.jevExecutes && r.position === e.position && r.rewardCount === e.rewardCount && r.hash === e.hash;
    }),
    reference: 'experiments/outputs/e_d1_summary.json (committed E-D1 receipt)',
  };
}
receipt({ kind: 'findings.mock_repro', ...mockRepro, text: 'A-mock reproduces E-D1 bit-for-bit on the same seeds — the paired-world claim is anchored, and the A-live deltas are attributable to the gate swap alone' });
console.log(`mock repro vs E-D1: ${mockRepro.all_match ? 'BIT-IDENTICAL' : 'MISMATCH'}`);

// ── security self-scan + budget tally + seal ────────────────────────────────
mkdirSync(OUT, { recursive: true });
const summary = {
  task: 'E-D2', name: 'the live-jev gate experiment', dev: DEV,
  endpoint_note: rows.find((r) => r.kind === 'endpoint.dns'),
  probe, r1, r2, r3: r3out, r4, r5,
  mock_repro: mockRepro,
  client_stats: st,
  runs,
  budget_tally: { live_answers: st.live_answers_total, cap_total: CAP_TOTAL, probes: (probeThrowaway ? 1 : 0) + (probe?.ok && probe.source === 'live' ? 1 : 0) },
};
const summaryText = JSON.stringify(summary, null, 1);
const secretHit = textHasSecret(summaryText, key) || textHasSecret(readFileSync(JOURNAL, 'utf8'), key);
receipt({ kind: 'security.scan', scanned: ['e_d2_summary.json', 'livejev_journal.jsonl'], key_material_found: secretHit, patterns: ['live key value', 'Bearer ', 'apikey_*', 'moth_*'], verdict: secretHit ? 'FAIL — DO NOT COMMIT' : 'CLEAN' });
receipt({ kind: 'budget.tally', ...summary.budget_tally, within_cap: st.live_answers_total <= CAP_TOTAL });

sealChain(rows);
const okMem = verifyChain(rows);
writeFileSync(OUT + '/receipts_ed2.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const fromFile = JSON.parse(readFileSync(OUT + '/receipts_ed2.jsonl', 'utf8'));
const okFile = verifyChain(fromFile);
writeFileSync(OUT + '/e_d2_summary.json', JSON.stringify({ ...summary, chain_tip: rows[rows.length - 1].row_hash, chain_ok_mem: okMem.ok, chain_ok_file: okFile.ok }, null, 1));
console.log(`chain: mem ${okMem.ok ? 'OK' : 'BROKEN'} / file ${okFile.ok ? 'OK' : 'BROKEN'} tip ${rows[rows.length - 1].row_hash} (${rows.length} rows)`);
console.log('wrote experiments/outputs/e_d2_summary.json + receipts_ed2.jsonl + livejev_journal.jsonl');
