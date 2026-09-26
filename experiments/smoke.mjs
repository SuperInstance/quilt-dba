// smoke.mjs — the DBA seed sheet's contract. ALL GREEN before any commit.
import { QuiltEngine } from '../engine/index.js';
import { buildSheet } from '../dba/sheet.mjs';
import { fnv1a64 } from '../shared/kit.mjs';
import { sealChain, verifyChain } from '../shared/receipts.mjs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  \u2713 ' + name); } else { fail++; console.log('  \u2717 ' + name); } };
const get = async (e, id) => (await e.get(id)).data;
const call0 = async (e, id, input) => (await e.call(id, input)).data;
const set = (e, id, v) => e.set(id, v);

const engine = new QuiltEngine('dba-smoke', { eager: true });
engine.loadSheet(buildSheet(1));

// 1. the 12 canonical primitives/cells exist
const CANON = ['sensors.vision', 'sensors.proprio', 'world.predict', 'reflex.orient', 'policy.action',
  'ledger.gamma', 'ledger.eta', 'ledger.check', 'state.stage', 'memory.episodic', 'memory.semantic',
  'teacher.feedback', 'skills.graph'];
let present = 0;
for (const id of CANON) { try { await get(engine, id); present++; } catch { } }
ok(present === CANON.length, `all ${CANON.length} canonical cells present (${present})`);

// 2. sensors evaluate in range
const vision = await call0(engine, 'sensors.vision');
ok(Number.isInteger(vision) && vision >= 0 && vision <= 1000, `sensors.vision in [0,1000] (${vision})`);

// 3. JEPA predicts a well-shaped next state
const pred = await call0(engine, 'world.predict');
ok(typeof pred.x === 'number' && typeof pred.y === 'number' && (pred.pred_reward === 0 || pred.pred_reward === 1),
  `world.predict shape (${JSON.stringify(pred)})`);

// 4. R4 boundary: 1585 passes, 1586 refuses — exact at the scaled integers
const bOk = await call0(engine, 'conservation.test', { gamma: 0, eta: 1585 });
const bNo = await call0(engine, 'conservation.test', { gamma: 0, eta: 1586 });
ok(bOk.verdict === 'ok' && bNo.verdict === 'refuse', 'boundary: gamma+eta 1585 ok / 1586 refuse');

// 5. live ledger gate consistent with its own sum
const chk = await call0(engine, 'ledger.check');
ok((chk.sum <= 1585) === (chk.verdict === 'ok'), `live gate consistent (sum=${chk.sum} ${chk.verdict})`);

// 6. policy action is a legal step
const act = await call0(engine, 'policy.action');
ok(Math.abs(act.dx) <= 1 && Math.abs(act.dy) <= 1 && (act.dx !== 0 || act.dy !== 0), `policy legal step (${act.dx},${act.dy})`);

// 7. determinism: same cell state -> same action (no hidden randomness)
const act2 = await call0(engine, 'policy.action');
ok(JSON.stringify(act) === JSON.stringify(act2), 'policy deterministic under fixed state');

// 8. no-lookahead: mutating a non-causal cell cannot move the policy
await set(engine, 'env.success_ring', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
const act3 = await call0(engine, 'policy.action');
ok(JSON.stringify(act3) === JSON.stringify(act), 'no-lookahead: policy blind to non-causal writes');

// 9. the JEV mock is LABELED and thresholded
const ring = Array(20).fill(1);
await set(engine, 'env.success_ring', ring);
const gateHot = await call0(engine, 'teacher.jev_gate');
ok(gateHot.mock === true && gateHot.action === 'execute', `jev mock labeled + executes at high success (p=${gateHot.noul.toFixed(2)})`);
await set(engine, 'env.success_ring', Array(20).fill(0));
const gateCold = await call0(engine, 'teacher.jev_gate');
ok(gateCold.action === 'discard', `jev discards at low success (p=${gateCold.noul.toFixed(2)})`);

// 10. GROWTH: stage-2 sheet loads, the new cell evaluates, beta1 moves
const b1a = await call0(engine, 'skills.graph');
engine.loadSheet(buildSheet(2));
await set(engine, 'growth.done', 1);
await set(engine, 'growth.stage', 2);
const lang = await call0(engine, 'sensors.language');
const b1b = await call0(engine, 'skills.graph');
ok(lang && lang.channel === 'teacher:offline-rule' && b1b.beta1 !== b1a.beta1,
  `growth: sensors.language live, beta1 ${b1a.beta1} -> ${b1b.beta1}`);

// 11. QRC entropy is labeled offline
const qrc = await get(engine, 'qrc.source');
ok(qrc.live === false, 'qrc labeled live:false (a mock never pretends to be quantum)');

// 12. receipt chain integrity on a toy chain
const rows = [{ kind: 'a', n: 1 }, { kind: 'b', n: 2 }];
sealChain(rows);
const toy = verifyChain(rows);
ok(toy.ok === true, 'receipt chain seals + verifies');

console.log(fail === 0 ? `\nSMOKE OK (${pass}/${pass + fail} checks)` : `\nSMOKE FAILED (${fail} of ${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
