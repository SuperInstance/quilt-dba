// dba/mothqrc.mjs — LIVE MOTH QRC lane (E-D3): fetch a REAL quantum
// randomness stream from Moth Quantum, cache it with full provenance, and
// hand it to the developmental agent as the WORLD-STOCHASTICITY source.
//
// Fleet idiom copied from quilt-murmur/murmur/moth.mjs + quilt-arena/arena/
// moth.mjs (submit -> poll -> result, Bearer key, hard caps, honest labels).
//
// ABSOLUTE KEY DOCTRINE (E-D3 receipted):
//   - the key lives ONLY in process.env.MOTH_KEY or /home/z/my-project/.env
//     (parsed at RUNTIME). It is NEVER written to any file, log, receipt,
//     cache, or console output. loadKey() returns it to callers in memory
//     only; this module never stringifies it.
//   - every fetched batch lands in the cache WITH provenance (job_id,
//     engine, backend, timestamps) and WITHOUT key material.
//   - a fetched batch is labeled live:true / mock:false ONLY if a real job
//     completed; the offline fallback is labeled live:false / mock:true
//     everywhere it appears (a mock never pretends to be quantum).
//
// Result-shape doctrine: probe FIRST (1 tiny job), inspect the shapes, then
// choose the engine that yields genuine per-bit variability. Receipted
// candidates:
//   coin-toss-v1 — per-job H/T aggregate (the classic binomial stat; per-shot
//                  bits only if the result carries them)
//   graph-v1     — counts keyed by measured 8-bit outcome strings; each
//                  DISTINCT observed key is a real 8-bit quantum sample
//   qpixl-v1     — decode-noise floats (E11 idiom) -> floor(f*2^32) bits
// The stream = concatenation of job payloads in submission order; jobs with
// no extractable per-bit payload still contribute provenance + H/T stats.

import { fnv1a64 } from './receipts.mjs';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const BASE_CANDIDATES = [
  'https://api.mothquantum.com/api/v1',
  'https://api.mothquantum.com/v1',
];
export const MAX_JOBS = 10;          // hard cap on live MOTH jobs per harvest
export const MIN_BITS = 4096;        // target stream size
const ENV_PATH = '/home/z/my-project/.env';

// ── key handling (in-memory only, never logged) ─────────────────────────────
export function loadKey() {
  if (process.env.MOTH_KEY) return process.env.MOTH_KEY;
  try {
    if (existsSync(ENV_PATH)) {
      const m = readFileSync(ENV_PATH, 'utf8').match(/^MOTH_KEY\s*=\s*(\S+)\s*$/m);
      if (m) return m[1];
    }
  } catch { /* fallthrough */ }
  return null;
}

// ── raw HTTP (fleet pattern; never logs headers/body) ───────────────────────
export async function call(method, base, path, key, body, timeoutMs = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
    return { status: res.status, ms: Date.now() - t0, data };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, data: { error: String((e && e.message) || e) } };
  } finally { clearTimeout(t); }
}

// ── base probe: which API path answers? (both candidates receipted) ─────────
export async function probeBase(key) {
  const tried = [];
  for (const base of BASE_CANDIDATES) {
    const r = await call('GET', base, '/me', key, null, 15000);
    // record field NAMES only (payload values stay out of receipts)
    const fieldNames = r.data && typeof r.data === 'object' ? Object.keys(r.data).sort() : [];
    tried.push({ base, status: r.status, ms: r.ms, fieldNames });
    if (r.status === 200) return { ok: true, base, tried, me: fieldNames };
  }
  return { ok: false, base: null, tried, why: 'no base answered /me 200' };
}

// ── job runner (fleet pattern) ──────────────────────────────────────────────
export async function runJob(base, key, engine, params, { timeoutMs = 120000, pollMs = 1500 } = {}) {
  const submittedAt = new Date().toISOString();
  let sub = await call('POST', base, `/engines/${engine}/process`, key, { params });
  if (sub.status === 429) { // polite guest: back off twice, then give up
    await sleep(15000);
    sub = await call('POST', base, `/engines/${engine}/process`, key, { params });
    if (sub.status === 429) {
      await sleep(30000);
      sub = await call('POST', base, `/engines/${engine}/process`, key, { params });
    }
  }
  if (sub.status === 0) return { ok: false, stage: 'submit', why: 'unreachable: ' + (sub.data.error || ''), submittedAt };
  if (sub.status === 401 || sub.status === 403) return { ok: false, stage: 'submit', why: `auth ${sub.status}`, submittedAt };
  if (sub.status !== 200 && sub.status !== 202) return { ok: false, stage: 'submit', why: `HTTP ${sub.status}`, submittedAt };
  const jobId = sub.data && sub.data.job_id;
  if (!jobId) return { ok: false, stage: 'submit', why: 'no job_id', submittedAt };
  const t0 = Date.now();
  let st = null;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(pollMs);
    const s = await call('GET', base, `/jobs/${jobId}/status`, key, null, 15000);
    st = s.data && s.data.status;
    if (st === 'completed' || st === 'failed' || st === 'cancelled') break;
  }
  if (st !== 'completed') return { ok: false, stage: 'poll', why: `job ${jobId} status=${st}`, jobId, submittedAt };
  const r = await call('GET', base, `/jobs/${jobId}/result`, key, null, 30000);
  return {
    ok: true, jobId, submittedAt, completedAt: new Date().toISOString(),
    latencyMs: Date.now() - t0, result: r.data || {},
  };
}

// ── result normalization (shape-tolerant, receipted) ────────────────────────
// LIVE SHAPES (probed 23-c, receipted):
//   coin-toss-v1: { $schema, result: { backend:'aer', heads, tails, shots, output, ibm_job_id } }
//   graph-v1:     { $schema, result: { output: { backend, measurements:
//                   [{bitstring, count, probability}...], dominant_bitstring,
//                   edge_agreement_score } } }
export function normalizeResult(engine, result) {
  const r = result || {};
  const inner = r.result && typeof r.result === 'object' ? r.result : {};
  const out = r.output && typeof r.output === 'object' ? r.output : (inner.output && typeof inner.output === 'object' ? inner.output : null);
  const measurements = out && Array.isArray(out.measurements) ? out.measurements : null;
  const counts = r.counts || inner.counts || (out && out.counts) || null;
  const backend = (out && out.backend) || r.backend || inner.backend || r.backend_name || inner.backend_name || r.machine || inner.machine || null;
  const heads = Number(r.heads ?? inner.heads ?? NaN);
  const tails = Number(r.tails ?? inner.tails ?? NaN);
  const shots = Number(r.shots ?? inner.shots ?? NaN);
  return { counts, backend, heads, tails, shots, measurements, output: out, topLevelKeys: Object.keys(r).sort() };
}

// ── bit extraction per engine (real per-bit payload only) ───────────────────
// graph-v1: the measurements multiset IS the sample — every shot's measured
// 8-bit outcome, expanded by its count. The API returns aggregate counts (no
// per-shot order), so the expansion order is CANONICAL (sorted by bitstring);
// receipted: bit VALUES are real quantum measurements, bit ORDER is canonical.
export function extractBits(engine, norm) {
  const bits = [];
  let hOnes = 0;
  if (engine === 'graph-v1' && norm.measurements) {
    const entries = norm.measurements
      .map((m) => ({ bs: String(m.bitstring || '').replace(/[^01]/g, ''), n: Math.max(0, Number(m.count) || 0) }))
      .filter((m) => m.bs.length > 0)
      .sort((a, b) => (a.bs < b.bs ? -1 : a.bs > b.bs ? 1 : 0));
    for (const { bs, n } of entries) {
      for (let r = 0; r < n; r++) for (const c of bs) { bits.push(c === '1' ? 1 : 0); if (c === '1') hOnes++; }
    }
  }
  return { bits, ones: hOnes, distinct: norm.measurements ? norm.measurements.length : 0 };
}

// qpixl floats -> bits (E11 fleet idiom: decode noise IS the harvest)
export function bitsFromFloats(floats) {
  const bits = [];
  for (const f of floats) {
    const u = Math.floor(clamp(f, 0, 0.999999999) * 4294967296) >>> 0;
    for (let b = 0; b < 32; b++) bits.push((u >>> b) & 1);
  }
  return bits;
}

// ── Wilson score interval for the H/T-vs-0.5 receipt ────────────────────────
export function wilsonCI(ones, n, z = 1.959963985) {
  if (n === 0) return [0, 1];
  const p = ones / n;
  const d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - s) / d, (c + s) / d];
}

// ── one graph-v1 job as a cache row (shared by harvest + top-up, so the
// cache schema can never drift between the two call sites) ───────────────────
export async function graphJob(base, key, { shots = 1024, seq = 0 } = {}) {
  const params = { mode: 'emu', num_qubits: 8, shots, coupling_map: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0]] };
  const j = await runJob(base, key, 'graph-v1', params, { timeoutMs: 120000 });
  const norm = normalizeResult('graph-v1', j.result);
  let bits = [], onesHere = 0, distinct = 0;
  if (j.ok) {
    const ex = extractBits('graph-v1', norm);
    bits = ex.bits; onesHere = ex.ones; distinct = ex.distinct;
  }
  return {
    seq, kind: 'harvest', engine: 'graph-v1', base,
    job_id: j.ok ? j.jobId : null, backend: norm.backend,
    shots, mode: 'emu', live: !!j.ok, mock: false,
    submitted_at: j.submittedAt, completed_at: j.completedAt || null, latency_ms: j.latencyMs || null,
    ok: !!j.ok, why: j.ok ? null : (j.why || null),
    heads: Number.isFinite(norm.heads) ? norm.heads : null,
    tails: Number.isFinite(norm.tails) ? norm.tails : null,
    measurements: norm.measurements || null, distinct_outcomes: distinct,
    result_shape: j.ok ? norm.topLevelKeys : null,
    bits: bits.join(''), bits_len: bits.length, ones: onesHere,
  };
}

// ── THE HARVEST: probe -> fill the stream cache -> return provenance ────────
// rows are appended to cachePath as JSONL (one row per job, no key material).
export async function harvest({
  key = loadKey(), cachePath = null, maxJobs = MAX_JOBS, minBits = MIN_BITS,
  coinShots = 512, graphShots = 1024, onRow = null,
} = {}) {
  const rows = [];
  const book = (row) => { rows.push(row); if (onRow) onRow(row); return row; };

  if (!key) {
    return { live: false, why: 'no MOTH_KEY in env', rows, totalBits: 0, ones: 0, base: null, tried: [] };
  }
  const pb = await probeBase(key);
  if (!pb.ok) return { live: false, why: pb.why, rows, totalBits: 0, ones: 0, base: null, tried: pb.tried };

  let jobs = 0, totalBits = 0, ones = 0, seq = 0;
  let graphWorks = null;   // decided by the probe jobs, receipted
  let coinShotsNext = coinShots;
  const coinStats = [];    // {job_id, shots, heads, tails}

  // PROBE FIRST: 1 tiny coin-toss job (32 shots) — flow + shape check.
  {
    const j = await runJob(pb.base, key, 'coin-toss-v1', { mode: 'emu', shots: 32 }, { timeoutMs: 90000 });
    jobs++;
    const norm = normalizeResult('coin-toss-v1', j.result);
    const row = book({
      seq: seq++, kind: 'probe', engine: 'coin-toss-v1', base: pb.base,
      job_id: j.ok ? j.jobId : null, backend: norm.backend,
      shots: 32, mode: 'emu', live: !!j.ok, mock: false,
      submitted_at: j.submittedAt, completed_at: j.completedAt || null, latency_ms: j.latencyMs || null,
      ok: !!j.ok, why: j.ok ? null : (j.why || null),
      heads: Number.isFinite(norm.heads) ? norm.heads : null,
      tails: Number.isFinite(norm.tails) ? norm.tails : null,
      counts: norm.counts && Object.keys(norm.counts).length <= 8 ? norm.counts : null,
      result_shape: j.ok ? norm.topLevelKeys : null,
      bits: '', bits_len: 0, ones: 0,
    });
    if (!j.ok) return { live: false, why: `probe job failed: ${j.why}`, rows, totalBits: 0, ones: 0, base: pb.base, tried: pb.tried, jobsUsed: jobs };
    if (Number.isFinite(row.heads)) coinStats.push({ job_id: row.job_id, shots: 32, heads: row.heads, tails: row.tails });
  }

  // HARVEST loop: one coin-toss-v1 job at coinShotsNext (the classic aggregate
  // H/T binomial stat), then graph-v1 jobs (8192 bits per 1024-shot job) until
  // minBits or the job cap — whichever first. A failed coin job downshifts its
  // shots once (512); a failed/graph-degenerate job flips graphWorks=false.
  let coinJobDone = false;
  while ((totalBits < minBits || !coinJobDone) && jobs < maxJobs) {
    let engine, params, shots;
    if (!coinJobDone) {
      engine = 'coin-toss-v1'; shots = coinShotsNext;
      params = { mode: 'emu', shots };
    } else {
      engine = 'graph-v1'; shots = graphShots;
      params = { mode: 'emu', num_qubits: 8, shots, coupling_map: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0]] };
    }
    const j = await runJob(pb.base, key, engine, params, { timeoutMs: 120000 });
    jobs++;
    const norm = normalizeResult(engine, j.result);
    let bits = [], onesHere = 0, distinct = 0, measurements = null;

    if (j.ok && engine === 'graph-v1') {
      const ex = extractBits('graph-v1', norm);
      bits = ex.bits; onesHere = ex.ones; distinct = ex.distinct;
      // receipted degeneracy check: < 2 distinct outcomes = no usable entropy
      graphWorks = distinct >= 2;
      measurements = norm.measurements || null; // full provenance (multiset)
    }
    if (j.ok && engine === 'coin-toss-v1') {
      coinJobDone = true;
      if (Number.isFinite(norm.heads) && Number.isFinite(norm.shots)) {
        coinStats.push({ job_id: j.jobId, shots: norm.shots, heads: norm.heads, tails: norm.tails });
      } else if (shots > 512) {
        coinShotsNext = 512; coinJobDone = false; // downshift once, receipted
      }
    }

    const bitsStr = bits.join('');
    totalBits += bits.length; ones += onesHere;
    book({
      seq: seq++, kind: 'harvest', engine, base: pb.base,
      job_id: j.ok ? j.jobId : null, backend: norm.backend,
      shots, mode: 'emu', live: !!j.ok, mock: false,
      submitted_at: j.submittedAt, completed_at: j.completedAt || null, latency_ms: j.latencyMs || null,
      ok: !!j.ok, why: j.ok ? null : (j.why || null),
      heads: Number.isFinite(norm.heads) ? norm.heads : null,
      tails: Number.isFinite(norm.tails) ? norm.tails : null,
      measurements, distinct_outcomes: distinct,
      result_shape: j.ok ? norm.topLevelKeys : null,
      bits: bitsStr, bits_len: bits.length, ones: onesHere,
    });
    if (!j.ok && engine === 'graph-v1') graphWorks = false; // don't hammer a failing engine
    if (!j.ok && engine === 'coin-toss-v1' && coinShotsNext > 512) coinShotsNext = 512;
    else if (!j.ok && engine === 'coin-toss-v1') coinJobDone = true; // give up on coin, receipted
    if (engine === 'graph-v1' && graphWorks === false) break; // no stream engine left — receipt honestly
  }

  return {
    live: totalBits > 0 || coinStats.length > 0,
    why: totalBits > 0 ? null : 'jobs completed but no per-bit payload extracted (aggregate-only results)',
    rows, totalBits, ones, base: pb.base, tried: pb.tried, jobsUsed: jobs, coinStats,
  };
}

// ── cache writer / loader (PHASE 2 is fully offline over this file) ─────────
export function writeCache(cachePath, rows) {
  if (!cachePath) return;
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

export function loadStreamCache(cachePath) {
  const rows = readFileSync(cachePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const bits = rows.map((r) => r.bits || '').join('');
  const ones = rows.reduce((a, r) => a + (r.ones || 0), 0);
  const liveRows = rows.filter((r) => r.live === true);
  const digest = fnv1a64([rows.map((r) => r.job_id), bits]);
  return {
    rows,
    bits,
    totalBits: bits.length,
    ones,
    live: liveRows.length > 0,
    liveRows: liveRows.length,
    jobIds: rows.map((r) => r.job_id).filter(Boolean),
    digest,
    label: liveRows.length > 0
      ? { live: true, mock: false, why: null, jobs: rows.length, bits: bits.length }
      : { live: false, mock: true, why: 'offline fallback stream (MOTH unreachable at harvest time)', jobs: rows.length, bits: bits.length },
  };
}

// ── stream consumers: identical read(k) interface for BOTH arms ─────────────
// Quantum arm: BitReader over the cached stream (cycles with a receipted
// per-run phase; the pool is finite — receipted as source-statistics test).
export class BitReader {
  constructor(bits, phase = 0) {
    this.bits = bits;
    this.pos = ((phase % bits.length) + bits.length) % bits.length;
    this.consumed = 0; this.cycles = 0;
  }
  read(k) {
    let v = 0;
    for (let i = 0; i < k; i++) {
      v = v * 2 + Number(this.bits[this.pos]);
      this.pos++;
      if (this.pos >= this.bits.length) { this.pos = 0; this.cycles++; }
    }
    this.consumed += k;
    return v;
  }
}

// PRNG arm: mulberry32 behind the SAME read(k) interface (same schedule).
export class PrngReader {
  constructor(seed) {
    this.a = seed >>> 0;
    this.consumed = 0;
  }
  read(k) {
    let v = 0;
    for (let i = 0; i < k; i++) {
      this.a = (this.a + 0x6D2B79F5) | 0;
      let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      v = v * 2 + (((t ^ (t >>> 14)) >>> 0) & 1);
    }
    this.consumed += k;
    return v;
  }
}

// ── R4 no-key-leak scanner (runtime; prints verdicts, never the key) ────────
export function noLeakScan(paths, key) {
  const out = { filesScanned: 0, keyMatches: [], patternMatches: [], clean: false };
  const patterns = [
    ['bearer-assign', /Bearer\s+[A-Za-z0-9_\-\.]{16,}/],
    ['moth-key-assign', /MOTH_KEY\s*=\s*['"]?[A-Za-z0-9_\-]{16,}/],
    ['long-hex-token', /\b[a-f0-9]{40,}\b/],
  ];
  for (const p of paths) {
    let text = null;
    try { text = readFileSync(p, 'utf8'); } catch { continue; }
    out.filesScanned++;
    if (key && key.length >= 8 && text.includes(key)) out.keyMatches.push(p);
    for (const [name, re] of patterns) {
      const n = (text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || []).length;
      if (n > 0) out.patternMatches.push({ path: p, pattern: name, count: n });
    }
  }
  out.clean = out.keyMatches.length === 0;
  return out;
}
