// smoke_ed3.mjs — the E-D3 lane's contract (NEW file; experiments/smoke.mjs
// stays untouched). ALL GREEN before the E-D3 commit.
// Checks the MOTH QRC stream cache's provenance + integrity, the stream
// consumers' determinism, and the no-key-leak scanner (with a positive
// control). The smoke does NOT re-fetch: PHASE 2 is offline over the cache.
import {
  loadStreamCache, BitReader, PrngReader, wilsonCI, noLeakScan, MIN_BITS,
} from '../dba/mothqrc.mjs';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  \u2713 ' + name); } else { fail++; console.log('  \u2717 ' + name); } };

const CACHE = 'experiments/outputs/moth_stream_cache.jsonl';
const LANE_FILES = [
  'dba/mothqrc.mjs', 'experiments/e_d3_mothqrc.mjs', 'experiments/smoke_ed3.mjs',
  'experiments/outputs/moth_stream_cache.jsonl', 'experiments/outputs/receipts_ed3.jsonl',
  'experiments/outputs/e_d3_summary.json',
];

// 1. cache exists + parses
ok(existsSync(CACHE), 'stream cache exists (experiments/outputs/moth_stream_cache.jsonl)');
const cache = loadStreamCache(CACHE);

// 2. every row carries the live/mock label pair and a timestamp
const labeled = cache.rows.every((r) => typeof r.live === 'boolean' && typeof r.mock === 'boolean' && r.live !== r.mock
  && typeof r.submitted_at === 'string' && r.completed_at !== undefined);
ok(labeled, 'every cache row labeled live/mock (never both) + timestamped');

// 3. live rows carry full provenance; fallback rows are honestly labeled
const liveRows = cache.rows.filter((r) => r.live);
const fallbackRows = cache.rows.filter((r) => !r.live);
const liveProv = liveRows.every((r) => r.job_id && r.engine && r.base && r.backend && r.mode === 'emu');
const fallbackHonest = fallbackRows.every((r) => r.mock === true && r.engine === 'offline-mulberry32');
ok(fallbackRows.length === 0 ? true : fallbackHonest, 'any fallback rows are labeled live:false/mock:true (a mock never pretends to be quantum)');
ok(liveRows.length === 0 ? !cache.live : liveProv, 'live rows carry job_id/engine/base/backend (provenance)');

// 4. graph-v1 row integrity: bits == sorted multiset expansion of measurements
const graphOk = liveRows.filter((r) => r.engine === 'graph-v1').every((r) => {
  const sorted = (r.measurements || []).slice().sort((a, b) => (a.bitstring < b.bitstring ? -1 : 1));
  let bits = '', ones = 0;
  for (const m of sorted) for (let i = 0; i < (m.count || 0); i++) for (const c of m.bitstring) { bits += c === '1' ? '1' : '0'; if (c === '1') ones++; }
  return bits === r.bits && ones === r.ones;
});
ok(graphOk, 'graph rows: bits string == canonical count-expanded measurements (re-derivable provenance)');

// 5. stream size + sanity band
ok(cache.live && cache.totalBits >= MIN_BITS, `stream is LIVE quantum with >= ${MIN_BITS} bits (${cache.totalBits})`);
const freq = cache.ones / cache.totalBits;
ok(freq > 0.35 && freq < 0.65, `monobit sanity band [0.35,0.65] (freq=${freq.toFixed(4)})`);

// 6. cache carries NO key material (patterns only; values never printed)
const cacheText = readFileSync(CACHE, 'utf8');
ok(!/Bearer\s+[A-Za-z0-9_\-\.]{8,}/.test(cacheText) && !/MOTH_KEY/.test(cacheText), 'cache has no Bearer header / no MOTH_KEY material');

// 7. BitReader: deterministic, cycles, accounts for consumption
const a = new BitReader(cache.bits, 0), b = new BitReader(cache.bits, 0);
let same = true;
for (let i = 0; i < 64; i++) if (a.read(1) !== b.read(1)) same = false;
const c = new BitReader(cache.bits, 0);
const before = c.consumed;
c.read(14); c.read(8);
ok(same && before === 0 && c.consumed === 22, 'BitReader deterministic + consumption accounting (0 -> 22)');
const cyc = new BitReader(cache.bits, cache.totalBits - 3);
let v = 0; for (let i = 0; i < 10; i++) v = v * 2 + cyc.read(1);
ok(cyc.cycles >= 1 && cyc.pos === (cache.totalBits - 3 + 10) % cache.totalBits, 'BitReader cycles past the end with wraparound');

// 8. PrngReader: deterministic per seed, differs across seeds, same interface
const p1 = new PrngReader(1234), p2 = new PrngReader(1234), p3 = new PrngReader(1235);
let d1 = [], d2 = [], d3 = [];
for (let i = 0; i < 32; i++) { d1.push(p1.read(1)); d2.push(p2.read(1)); d3.push(p3.read(1)); }
ok(JSON.stringify(d1) === JSON.stringify(d2) && JSON.stringify(d1) !== JSON.stringify(d3) && p1.consumed === 32,
  'PrngReader deterministic per seed + distinct across seeds + same read() interface');

// 9. Wilson CI sanity
const ci = wilsonCI(500, 1000);
ok(ci[0] < 0.5 && ci[1] > 0.5 && ci[0] > 0.45 && ci[1] < 0.55, `wilsonCI(500,1000) brackets 0.5 (${ci.map((x) => x.toFixed(3)).join(',')})`);

// 10. noLeakScan: CLEAN on lane files + POSITIVE CONTROL on a canary temp file
const key = typeof process !== 'undefined' && process.env ? (process.env.MOTH_KEY || null) : null;
const scan = noLeakScan(LANE_FILES, key);
ok(scan.clean && scan.filesScanned >= 4, `no-key-leak scan CLEAN over lane files (${scan.filesScanned} scanned)`);
const canaryPath = 'experiments/outputs/.smoke_ed3_canary.tmp';
writeFileSync(canaryPath, 'token = CANARYSECRETVALUE123456\n');
const scan2 = noLeakScan([canaryPath], 'CANARYSECRETVALUE123456');
unlinkSync(canaryPath);
ok(!scan2.clean && scan2.keyMatches.length === 1 && scan2.keyMatches[0] === canaryPath, 'scanner positive control: canary is caught (scanner actually works)');

console.log(fail === 0 ? `\nSMOKE E-D3 OK (${pass}/${pass + fail} checks)` : `\nSMOKE E-D3 FAILED (${fail} of ${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
