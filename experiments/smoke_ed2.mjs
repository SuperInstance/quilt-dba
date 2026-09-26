// smoke_ed2.mjs — E-D2 lane contract. ALL GREEN before any commit.
// OFFLINE by doctrine: every check uses dependency-injected transports or
// synthetic injection — ZERO live API calls from smoke. (The live path is
// exercised by experiments/e_d2_livejev.mjs under its receipted budget.)
import { LiveJev, mapAction, makeQuestions, buildState, loadTypesafeKey,
  textHasSecret, TASK_NAMES, READINESS_LEVELS } from '../dba/jev_live.mjs';
import { sealChain, verifyChain } from '../shared/receipts.mjs';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  \u2713 ' + name); } else { fail++; console.log('  \u2717 ' + name); } };

// 1. verdict mapping uses the MOCK gate's exact thresholds
const A = (p) => ({ advance: { type: 'noul', noul: p }, task_choice: { choice: 't1' }, readiness: { score: 3 } });
ok(mapAction(A(0.9601)).action === 'execute', 'p 0.9601 -> execute (> 0.95 strict)');
ok(mapAction(A(0.95)).action === 'escalate', 'p 0.9500 -> escalate (boundary: not > 0.95)');
ok(mapAction(A(0.70)).action === 'escalate', 'p 0.7000 -> escalate (>= 0.70)');
ok(mapAction(A(0.6999)).action === 'discard', 'p 0.6999 -> discard');
ok(mapAction({}).action === null && mapAction({ advance: { noul: NaN } }).p === null, 'missing/NaN noul -> null verdict (contract guard)');

// 2. question batch shape: 3 typed questions, score criteria is a plain LIST
const qs = makeQuestions({ task: 0, proposal: true });
const names = Object.keys(qs);
ok(names.length === 3 && qs.advance.type === 'noul' && qs.task_choice.type === 'choice' && qs.readiness.type === 'score',
  'question batch: advance(noul) + task_choice(choice) + readiness(score)');
ok(Array.isArray(qs.readiness.criteria) && qs.readiness.criteria.length === 5,
  'readiness criteria is a plain level LIST of 5 (Task 22 contract)');
ok(Object.keys(qs.task_choice.criteria).length === 4, 'task_choice offers all 4 curriculum tasks');

// 3. state builder carries only benign telemetry (no instructions embedded)
const st = buildState({ task: 0, success: 0.92, ringLen: 25, position: 640, evalIdx: 250, proposal: true });
ok(st.includes('task 0 (cluster)') && st.includes('PROPOSES advancing to task 1') && st.includes('Evaluation 250'),
  'state string reports task/success/position/eval + proposal');
ok(!st.includes('Bearer') && !st.includes('key'), 'state string carries no key material');

// 4. key loader: runtime-only, presence check without printing
const key = loadTypesafeKey();
ok(typeof key === 'string' && key.length > 20, 'TYPESAFE_KEY loads at runtime from env/.env (value never echoed)');

// 5. fail-closed on persistent synthetic injection: no transport call, no budget
const tmp = 'experiments/outputs/.cache/smoke_ed2';
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
const jevFail = new LiveJev({
  key: 'smoke-test-key-not-real', cachePath: tmp + '/c1.json', journalPath: tmp + '/j1.jsonl',
  inject: () => 'persistent',
});
const r1 = await jevFail.consult({ tag: 'ed2:sX:t1', decisionId: 'sX:1', state: 'smoke state 1', questions: qs, fallbackAction: 'escalate' });
ok(r1.ok === false && r1.source === 'fail_closed_synthetic' && r1.action === 'escalate' && r1.fallback_used === true,
  'persistent synthetic failure -> fail-closed with the mock fallback action');
ok(jevFail.totalUsed === 0 && jevFail.runUsed === 0, 'failed attempts consume ZERO answer budget');
ok(jevFail.rows.some(r => r.source === 'fail_closed_synthetic' && r.fallback_used === true), 'fail-closed journaled with fallback_used:true');

// 6. negative cache: the SAME decision replays fail-closed with no injection
const jevNeg = new LiveJev({ key: 'k', cachePath: tmp + '/c1.json', journalPath: tmp + '/j2.jsonl' });
const r2 = await jevNeg.consult({ tag: 'ed2:sX:t1', decisionId: 'sX:1', state: 'smoke state 1', questions: qs, fallbackAction: 'escalate' });
ok(r2.ok === false && r2.cached === true && r2.source === 'fail_closed_synthetic' && jevNeg.rows[0].negcache === true,
  'negative cache replays the fail-closed decision deterministically');

// 7. retry-then-succeed on 'once' injection: first attempt synthetic, second live
let calls = 0;
const fakeOk = async () => { calls++; return { ok: true, status: 200, ms: 5, json: { model: 'jev-1.13.0', answers: { advance: { type: 'noul', noul: 0.97 }, task_choice: { choice: 't1', confidence: 0.8 }, readiness: { score: 3, confidence: 0.5 } }, usage: { input_tokens: 10, output_tokens: 2 } } }; };
const jevRetry = new LiveJev({ key: 'k', cachePath: tmp + '/c2.json', journalPath: tmp + '/j3.jsonl', transport: fakeOk, inject: (id) => (id === 'sY:1' ? 'once' : null) });
const r3 = await jevRetry.consult({ tag: 'ed2:sY:t1', decisionId: 'sY:1', state: 'smoke state 2', questions: qs, fallbackAction: 'discard' });
ok(r3.ok === true && r3.source === 'live' && r3.verdict.action === 'execute' && calls === 1,
  "'once' injection: attempt 1 synthetic -> retry hits transport -> live execute (0.97)");

// 8. positive cache: identical call is served from cache, transport not re-called
const r4 = await jevRetry.consult({ tag: 'ed2:sY:t2', decisionId: 'sY:2', state: 'smoke state 2', questions: qs, fallbackAction: 'discard' });
ok(r4.ok === true && r4.source === 'cache' && calls === 1, 'identical call served from cache (zero new calls)');

// 9. budget caps: per-seed cap and global cap both fail closed
const jevCap = new LiveJev({ key: 'k', cachePath: tmp + '/c3.json', journalPath: tmp + '/j4.jsonl', transport: fakeOk, capSeed: 2, capTotal: 40 });
await jevCap.consult({ tag: 'ed2:sZ:t1', decisionId: null, state: 'cap state a', questions: qs, fallbackAction: 'discard' });
await jevCap.consult({ tag: 'ed2:sZ:t2', decisionId: null, state: 'cap state b', questions: qs, fallbackAction: 'discard' });
const r5 = await jevCap.consult({ tag: 'ed2:sZ:t3', decisionId: null, state: 'cap state c', questions: qs, fallbackAction: 'discard' });
ok(r5.ok === false && r5.source === 'budget_mock' && r5.why === 'cap_seed', 'per-seed cap exhausted -> budget_mock fail-closed');
const jevCap2 = new LiveJev({ key: 'k', cachePath: tmp + '/c4.json', journalPath: tmp + '/j5.jsonl', transport: fakeOk, capSeed: 99, capTotal: 1 });
await jevCap2.consult({ tag: 'ed2:sW:t1', decisionId: null, state: 'cap state d', questions: qs, fallbackAction: 'discard' });
const r6 = await jevCap2.consult({ tag: 'ed2:sW:t2', decisionId: null, state: 'cap state e', questions: qs, fallbackAction: 'discard' });
ok(r6.ok === false && r6.why === 'cap_total', 'experiment-total cap exhausted -> budget_mock fail-closed');

// 10. HTTP 500 twice -> one backoff retry then fail-closed http
let n500 = 0;
const jev500 = new LiveJev({ key: 'k', cachePath: tmp + '/c5.json', journalPath: tmp + '/j6.jsonl', transport: async () => { n500++; return { ok: false, status: 500, json: null, ms: 3, error_class: 'http_5xx' }; } });
const r7 = await jev500.consult({ tag: 'ed2:sV:t1', decisionId: null, state: 'http state', questions: qs, fallbackAction: 'escalate' });
ok(r7.ok === false && r7.source === 'fail_closed_http' && n500 === 2 && jev500.totalUsed === 0,
  '5xx: one retry then fail-closed http (2 attempts, zero budget)');

// 11. journal privacy: rows carry prompt HASH not prompt; no key material anywhere
const rowsTxt = [tmp + '/j1.jsonl', tmp + '/j3.jsonl', tmp + '/j4.jsonl', tmp + '/j6.jsonl']
  .map(p => readText(p)).join('');
ok(!textHasSecret(rowsTxt, key) && !rowsTxt.includes('smoke state 1'), 'journal: no key material, no full prompts (hash only)');

// 12. stats: latency ledger only counts successful live answers (definition
//     receipted: latency = SUM of HTTP attempt durations per consult,
//     including a synthetic/failed retry attempt; excludes backoff sleep)
const s = jevRetry.stats();
ok(s.live_answers_total === 1 && s.latency_ms.n === 1 && s.latency_ms.mean >= 5, 'stats: one live answer, latency ledger correct');

// 13. receipt chain still seals + verifies (fleet toolkit intact)
const rows = [{ kind: 'ed2', n: 1 }, { kind: 'ed2', n: 2 }];
sealChain(rows);
ok(verifyChain(rows).ok === true, 'receipt chain seals + verifies');

console.log(fail === 0 ? `\nSMOKE ED2 OK (${pass}/${pass + fail} checks)` : `\nSMOKE ED2 FAILED (${fail} of ${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);

function readText(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }
