// dba/jev_live.mjs — the LIVE typesafe "System One" gate for the developmental
// loop (E-D2). One client, one batched call per decision point, hard budget,
// fail-closed to the sheet's mock gate. Import-only: this file touches no
// other dba module's state.
//
// Wire protocol (LIVE-VERIFIED this lane, jev-1.13.0):
//   POST {base}/v1/systemone   Authorization: Bearer <key>
//   body: { model, state, questions: { name: { type, instructions, criteria? } } }
//     type: 'noul' (continuous p) | 'choice' (criteria dict -> distribution)
//           | 'score' (criteria plain LIST -> level-scale score + legend)
//   response: { model, answers: { name: { type, noul?|choice?|score?,
//     confidence?, probabilities?, legend? } }, usage: {input,output} tokens }
//   ONE call answers N typed questions in one pass (~334ms measured).
//   ENDPOINT NOTE (receipted E-D2): the brief/worklog recorded
//   api.typesafe.dev, but live DNS shows .dev is NXDOMAIN (checked via
//   1.1.1.1: parent zone typesafe.dev exists, api subdomain has no A record)
//   while api.typesafe.ai answers with the exact receipted model jev-1.13.0.
//   The cortex crib (cortex/typesafe.mjs) also uses .ai. Base = .ai.
//
// SECURITY DOCTRINE (Task 22, absolute): the key is loaded AT RUNTIME ONLY
// (process.env.TYPESAFE_KEY, else parsed from /home/z/my-project/.env), held
// in the client closure, and NEVER written to any file, log, receipt,
// journal, commit message, or console output. Journal rows carry the prompt
// HASH, never the prompt; response summaries carry typed answers, never raw
// payloads or headers. selfScan() re-checks written text against the live key.
//
// BUDGET DOCTRINE (receipted E-D2): four caps — per-seed live answers, per-
// process run, per-experiment total, and the phase ladder (which consults get
// funded). One retry with exponential backoff on 429/5xx/network, then FAIL
// CLOSED: the caller arbitrates that round with the sheet's mock gate verdict
// and the journal row is flagged fallback_used:true. A live gate that cannot
// answer must never stall the loop and must never silently pretend: every row
// carries a source label (live | cache | negcache | budget_mock |
// fail_closed_*). Positive AND negative decisions are disk-cached so a re-run
// of the experiment is a zero-call, bit-identical replay.

import { fnv1a64 } from './receipts.mjs';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const ENV_PATH = '/home/z/my-project/.env';

// runtime-only key loading (process.env first, then the .env file). The value
// never leaves this module except into the Authorization header.
export function loadTypesafeKey(envPath = ENV_PATH) {
  if (process.env.TYPESAFE_KEY) return process.env.TYPESAFE_KEY;
  try {
    const txt = readFileSync(envPath, 'utf8');
    const m = txt.match(/^\s*TYPESAFE_KEY\s*=\s*(\S+)\s*$/m);
    if (m) return m[1];
  } catch { /* no env file: stay null, callers fail closed */ }
  return null;
}

// ── the receipted question batch (phrased BEFORE the final run) ─────────────
// Three typed questions, ONE call — mirrors the Task 22 probe contract.
//   advance    noul    the DECISION: same thresholds as the sheet mock gate
//   task_choice choice  telemetry only (gates nothing)
//   readiness  score   telemetry only; criteria is a plain LIST (Task 22)
export const TASK_NAMES = ['cluster', 'line', 'corners', 'scatter'];
export const TASK_BLURBS = [
  'cluster: 3 rewards close together (easiest)',
  'line: 4 rewards in a row across the map',
  'corners: 4 rewards in the map corners',
  'scatter: 5 rewards spread widely (hardest)',
];
export const READINESS_LEVELS = ['far from ready', 'not ready', 'borderline', 'ready', 'mastered'];

export function buildState({ task, success, ringLen, position, evalIdx, proposal }) {
  const next = Math.min(3, task + 1);
  return 'Developmental forager. Current curriculum task ' + task + ' (' + TASK_NAMES[task] + ')' +
    '. Recent reward success ' + (Math.round(success * 1000) / 1000) + ' over the last ' + ringLen + ' steps' +
    '. Developmental position ' + position + ' (growth threshold 1000). Evaluation ' + evalIdx + '.' +
    (proposal
      ? ' The offline-rule teacher PROPOSES advancing to task ' + next + ' (' + TASK_NAMES[next] + ').'
      : ' No curriculum change is pending; the teacher asks for a standing readiness read.');
}

export function makeQuestions({ task, proposal }) {
  void task; void proposal; // question shape is state-INDEPENDENT (stable prompt
  // structure across decision points => cache-comparable); the STATE string
  // carries the situation, the questions stay fixed. Receipted E-D2.
  return {
    advance: {
      type: 'noul',
      instructions: 'Execute the proposed curriculum advance now? Answer yes only if the agent is ready for a harder task.',
    },
    task_choice: {
      type: 'choice',
      instructions: 'Which task layout should the agent train on next?',
      criteria: Object.fromEntries(TASK_NAMES.map((n, i) => ['t' + i, TASK_BLURBS[i]])),
    },
    readiness: {
      type: 'score',
      instructions: 'Rate the agent readiness to advance to a harder task.',
      criteria: READINESS_LEVELS.slice(), // plain level LIST (Task 22 contract)
    },
  };
}

// verdict mapping — thresholds IDENTICAL to the sheet's mock gate
// (dba/sheet.mjs jevMock: p > 0.95 execute, p >= 0.70 escalate, else discard)
export function mapAction(answers) {
  const a = answers && answers.advance;
  const p = a && typeof a.noul === 'number' && Number.isFinite(a.noul) ? a.noul : null;
  const action = p === null ? null : p > 0.95 ? 'execute' : p >= 0.70 ? 'escalate' : 'discard';
  const tc = answers && answers.task_choice;
  const rd = answers && answers.readiness;
  return {
    action, p,
    choice: tc ? tc.choice ?? null : null,
    choice_conf: tc ? tc.confidence ?? null : null,
    score: rd ? rd.score ?? null : null,
    score_conf: rd ? rd.confidence ?? null : null,
  };
}

function summarise(answers, model) {
  const m = mapAction(answers);
  const rd = answers && answers.readiness;
  return {
    model: model ?? null,
    advance_noul: m.p === null ? null : Math.round(m.p * 1000) / 1000,
    advance_action: m.action,
    choice: m.choice, choice_conf: m.choice_conf,
    score: m.score, score_conf: m.score_conf,
    score_has_legend: !!(rd && rd.legend),
  };
}

export class LiveJev {
  constructor({
    key = null, base = 'https://api.typesafe.ai', model = 'jev-1.13.0',
    cachePath = null, journalPath = null, timeoutMs = 30000,
    capSeed = 10, capRun = 25, capTotal = 40,
    transport = null, inject = null, ns = 'LIVE-ED2',
  } = {}) {
    this.key = key;
    this.base = base.replace(/\/$/, '');
    this.model = model;
    this.cachePath = cachePath;
    this.journalPath = journalPath;
    this.timeoutMs = timeoutMs;
    this.capSeed = capSeed; this.capRun = capRun; this.capTotal = capTotal;
    this.transport = transport; // DI: async (payload) => {ok,status,json,ms,error_class}
    this.inject = inject;       // DI: (decisionId) => null | 'persistent' | 'once'
    this.ns = ns;
    this.seedUsed = new Map();  // tag prefix -> live answers this seed
    this.runUsed = 0; this.totalUsed = 0;
    this.attemptCount = 0;
    this.latencies = [];        // total per-call ms on successful live answers
    this.tokens = { input: 0, output: 0 };
    this.rows = [];             // in-memory mirror of the journal
    this.cache = {};
    if (cachePath && existsSync(cachePath)) {
      try { this.cache = JSON.parse(readFileSync(cachePath, 'utf8')); } catch (e) {
        // E-D7 (receipted): a corrupt cache used to SILENTLY reset to {} here —
        // a torn/0-byte cache file erased the negative cache and turned the
        // receipted zero-call deterministic replay into fresh live spend with
        // no warning. Fail closed instead: refuse loudly, live-call machinery
        // untouched. The operator moves the file aside or repairs it.
        throw new Error(`LiveJev: live-decision cache at ${cachePath} is corrupt (${String(e?.message ?? e).slice(0, 80)}) — refusing silent reset (move the file aside or repair it)`);
      }
    }
    if (journalPath) mkdirSync(dirname(journalPath), { recursive: true });
  }

  hashOf(state, questions) {
    return fnv1a64([this.ns, this.model, state, questions]);
  }

  seedTagOf(tag) { return String(tag).split(':')[1] ?? String(tag); } // 'ed2:s101:t50' -> 's101'

  budgetLeftTotal() { return Math.max(0, this.capTotal - this.totalUsed); }
  budgetLeftRun() { return Math.max(0, this.capRun - this.runUsed); }

  #journal(row) {
    const r = { ts: new Date().toISOString(), ...row };
    this.rows.push(r);
    if (this.journalPath) appendFileSync(this.journalPath, JSON.stringify(r) + '\n');
    return r;
  }

  #writeCache() {
    if (!this.cachePath) return;
    // cache holds answers + failure markers only: no key, no prompt text
    mkdirSync(dirname(this.cachePath), { recursive: true });
    writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 1));
  }

  stats() {
    const ls = this.latencies.slice().sort((a, b) => a - b);
    const pick = (q) => ls.length ? ls[Math.min(ls.length - 1, Math.ceil(q * ls.length) - 1)] : null;
    const mean = ls.length ? Math.round(ls.reduce((a, b) => a + b, 0) / ls.length) : null;
    return {
      live_answers_total: this.totalUsed, live_answers_run: this.runUsed,
      cap_seed: this.capSeed, cap_run: this.capRun, cap_total: this.capTotal,
      attempts: this.attemptCount,
      latency_ms: { n: ls.length, mean, p50: pick(0.5), p95: pick(0.95), max: ls.length ? ls[ls.length - 1] : null },
      tokens: { ...this.tokens },
      journal_rows: this.rows.length,
    };
  }

  // THE one-pass batched decision. Returns
  //   { ok:true,  source:'live'|'cache', answers, verdict, usage, cached }
  //   { ok:false, source:'budget_mock'|'fail_closed_*', verdict(fallback), why, fallback_used:true }
  async consult({ tag = null, seedTag = null, decisionId = null, state, questions, fallbackAction = null, kind = 'consult' }) {
    if (!seedTag) seedTag = this.seedTagOf(tag);
    const promptHash = this.hashOf(state, questions);
    const qn = Object.keys(questions).length;

    // 1. positive cache: a previously ANSWERED identical call (zero-cost replay)
    const hit = this.cache[promptHash];
    if (hit && !hit.__failed) {
      this.#journal({ kind, tag, decision_id: decisionId, prompt_hash: promptHash, n_questions: qn, source: 'cache', cached: true, attempts: 0, latency_ms: 0, fallback_used: false, response_summary: summarise(hit.answers, hit.model), budget: this.#budgetSnap() });
      return { ok: true, source: 'cache', cached: true, attempts: 0, answers: hit.answers, usage: hit.usage || null, verdict: mapAction(hit.answers) };
    }
    // 2. negative cache: a previously FAILED identical call replays fail-closed
    //    (deterministic replay: the trajectory must not depend on network luck)
    if (hit && hit.__failed) {
      this.#journal({ kind, tag, decision_id: decisionId, prompt_hash: promptHash, n_questions: qn, source: hit.why, cached: true, negcache: true, attempts: 0, latency_ms: 0, fallback_used: true, fallback_action: hit.fallback_action, budget: this.#budgetSnap() });
      return { ok: false, source: hit.why, cached: true, attempts: 0, why: hit.why, action: hit.fallback_action, verdict: { action: hit.fallback_action, p: null }, fallback_used: true };
    }

    // 3. budget caps -> fail closed to the caller's mock verdict
    const seedLeft = this.capSeed - (this.seedUsed.get(seedTag) || 0);
    if (seedLeft <= 0 || this.runUsed >= this.capRun || this.totalUsed >= this.capTotal) {
      const why = this.totalUsed >= this.capTotal ? 'cap_total' : this.runUsed >= this.capRun ? 'cap_run' : 'cap_seed';
      this.#journal({ kind, tag, decision_id: decisionId, prompt_hash: promptHash, n_questions: qn, source: 'budget_mock', fallback_used: true, fallback_action: fallbackAction, why, budget: this.#budgetSnap() });
      return { ok: false, source: 'budget_mock', why, attempts: 0, action: fallbackAction, verdict: { action: fallbackAction, p: null }, fallback_used: true };
    }

    // 4. failure injection (R4): 'persistent' fails both attempts, 'once' fails
    //    only the first (retry then succeeds) — synthetic, zero real spend
    const inj = this.inject && decisionId ? this.inject(decisionId) : null;

    // 5. attempts: one retry with exponential backoff on 429/5xx/network
    const payload = { model: this.model, state, questions };
    let msTotal = 0, attempts = 0, last = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts = attempt;
      if (inj && (inj === 'persistent' || attempt === 1)) {
        last = { ok: false, status: 0, json: null, ms: 1, error_class: 'synthetic_injection' };
        msTotal += 1;
        this.#journal({ kind, tag, decision_id: decisionId, prompt_hash: promptHash, attempt, source: 'attempt_failed', error_class: 'synthetic_injection', latency_ms: 1, fallback_used: false });
        if (inj === 'persistent') break;
        await sleep(400 * Math.pow(2, attempt - 1)); // receipted exponential backoff
        continue;
      }
      this.attemptCount++;
      const r = this.transport
        ? await this.transport(payload)
        : await this.#defaultTransport(payload);
      msTotal += r.ms;
      last = r;
      if (r.ok && r.json) break;
      this.#journal({ kind, tag, decision_id: decisionId, prompt_hash: promptHash, attempt, source: 'attempt_failed', http_status: r.status ?? null, error_class: r.error_class ?? 'unknown', latency_ms: r.ms, fallback_used: false });
      const retryable = r.error_class === 'http_429' || r.error_class === 'http_5xx' || r.error_class === 'network' || r.error_class === 'timeout';
      if (attempt === 1 && retryable) { await sleep(400 * Math.pow(2, attempt - 1)); continue; }
      break;
    }

    // 6. outcome
    if (last && last.ok && last.json && last.json.answers) {
      const answers = last.json.answers;
      const verdict = mapAction(answers);
      if (verdict.p === null || verdict.action === null) {
        // contract violation on a 200: fail closed (receipted)
        this.cache[promptHash] = { __failed: true, why: 'fail_closed_contract', fallback_action: fallbackAction, at: new Date().toISOString() };
        this.#writeCache();
        this.#journal({ kind, tag, decision_id: decisionId, prompt_hash: promptHash, attempts, source: 'fail_closed_contract', latency_ms: msTotal, fallback_used: true, fallback_action: fallbackAction, why: 'answers.advance.noul missing/non-numeric on HTTP 200', budget: this.#budgetSnap() });
        return { ok: false, source: 'fail_closed_contract', why: 'contract', attempts, action: fallbackAction, verdict: { action: fallbackAction, p: null }, fallback_used: true };
      }
      this.runUsed++; this.totalUsed++;
      this.seedUsed.set(seedTag, (this.seedUsed.get(seedTag) || 0) + 1);
      this.latencies.push(msTotal);
      const usage = last.json.usage || null;
      if (usage) { this.tokens.input += usage.input_tokens || 0; this.tokens.output += usage.output_tokens || 0; }
      this.cache[promptHash] = { answers, model: last.json.model || this.model, usage, at: new Date().toISOString() };
      this.#writeCache();
      this.#journal({ kind, tag, decision_id: decisionId, prompt_hash: promptHash, attempts, source: 'live', latency_ms: msTotal, fallback_used: false, response_summary: summarise(answers, last.json.model), usage, budget: this.#budgetSnap() });
      return { ok: true, source: 'live', cached: false, attempts, answers, usage, verdict };
    }

    const why = last ? (last.error_class === 'synthetic_injection' ? 'fail_closed_synthetic' : last.error_class === 'network' || last.error_class === 'timeout' ? 'fail_closed_network' : last.error_class && last.error_class.startsWith('http') ? 'fail_closed_http' : 'fail_closed_unknown') : 'fail_closed_unknown';
    this.cache[promptHash] = { __failed: true, why, fallback_action: fallbackAction, at: new Date().toISOString() };
    this.#writeCache();
    this.#journal({ kind, tag, decision_id: decisionId, prompt_hash: promptHash, attempts, source: why, latency_ms: msTotal, http_status: last?.status ?? null, error_class: last?.error_class ?? null, fallback_used: true, fallback_action: fallbackAction, budget: this.#budgetSnap() });
    return { ok: false, source: why, why, attempts, action: fallbackAction, verdict: { action: fallbackAction, p: null }, fallback_used: true };
  }

  #budgetSnap() { return { run_used: this.runUsed, total_used: this.totalUsed, cap_run: this.capRun, cap_total: this.capTotal }; }

  async #defaultTransport(payload) {
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.base}/v1/systemone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      });
      const ms = Date.now() - t0;
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { json = null; }
      const error_class = res.ok ? null : res.status === 429 ? 'http_429' : res.status >= 500 ? 'http_5xx' : `http_${res.status}`;
      return { ok: res.ok, status: res.status, json, ms, error_class };
    } catch (e) {
      const name = (e && e.name) || '';
      return { ok: false, status: 0, json: null, ms: Date.now() - t0, error_class: name === 'AbortError' ? 'timeout' : 'network' };
    } finally { clearTimeout(timer); }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// privacy self-scan: assert a written text carries NO key material.
export function textHasSecret(text, key) {
  if (key && String(key).length >= 8 && text.includes(key)) return true;
  if (text.includes('Bearer ')) return true;
  if (/apikey_[A-Za-z0-9_]{8,}/.test(text)) return true;
  if (/moth_[A-Za-z0-9]{8,}/.test(text)) return true;
  return false;
}
