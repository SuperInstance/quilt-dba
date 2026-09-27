// experiments/chaos_persist_d7.mjs — TEST-ONLY durability adapters for E-D7
// (the chaos-smith pattern: quilt-arch/persist.mjs + yiluodi's
// chaos_persist2.mjs — the ENGINE/DRIVER sources are untouched; everything
// here is harness-side tooling, receipted as such in the E-D7 chain).
//
//   sealCheckpoint / loadCheckpoint  — the SEALED checkpoint shape
//     {kind:'dba-checkpoint-v1', state_hash, bundle}: the core-substrate
//     bundle (Driver.bundle()) carries NO integrity tag today (R3's finding),
//     and adding one inside bundle() would change every sealed E-D4 hash —
//     so the fix is an EXTERNAL seal/verify layer, same convention the
//     engine-path bundle already declares (driver.mjs `state_hash` field)
//     but actually VERIFIED on load (the engine-path loader never checks it).
//   recoverJSONL — torn-write-tolerant prefix recovery for the durable
//     rewind journal (complete rows only; torn tail reported, never merged).
//   journalToJSONL / journalFromJSONL — durable on-disk shape for the
//     dba-rewind-journal (E-D4's journal is memory-only today — receipted
//     gap): row0 meta {origin, originHash}, one row per event, terminal row.

import fs from 'node:fs';
import { fnv1a64 } from '../dba/receipts.mjs';
import { canonDeep } from '../dba/rewind.mjs';

export function sealCheckpoint(bundle) {
  return { kind: 'dba-checkpoint-v1', v: 1, repo: 'quilt-dba', state_hash: fnv1a64(canonDeep(bundle)), bundle };
}

// LOUD loader: throws on torn JSON (caller's JSON.parse), on hash mismatch,
// on missing fields — never returns a silently-wrong state.
export function verifySealedCheckpoint(obj) {
  if (!obj || obj.kind !== 'dba-checkpoint-v1' || !obj.bundle || typeof obj.state_hash !== 'string') {
    throw new Error('sealed checkpoint: malformed wrapper (refusing)');
  }
  const want = fnv1a64(canonDeep(obj.bundle));
  if (want !== obj.state_hash) {
    throw new Error(`sealed checkpoint: integrity mismatch (want ${want}, got ${obj.state_hash}) — REFUSING`);
  }
  return obj.bundle;
}

// Torn-write-tolerant recovery for newline-delimited JSON rows.
// Never throws for a corrupt file — returns the verdict (arch/persist idiom).
export function recoverJSONL(path) {
  const raw = fs.readFileSync(path);
  let tornBytes = 0;
  let end = raw.length;
  if (end > 0 && raw[end - 1] !== 0x0a) {
    const lastNl = raw.lastIndexOf(0x0a);
    tornBytes = end - (lastNl + 1);
    end = lastNl + 1;
  }
  const text = raw.subarray(0, end).toString('utf8');
  const lines = text.length ? text.split('\n').filter((s) => s.length > 0) : [];
  const rows = [];
  let firstBad = null;
  let goodBytes = 0;
  for (const line of lines) {
    try { rows.push(JSON.parse(line)); } catch (err) {
      firstBad = { index: rows.length, why: String(err?.message ?? err).slice(0, 120) };
      break;
    }
    goodBytes += Buffer.byteLength(line, 'utf8') + 1;
  }
  return { rows, lines: lines.length, tornBytes, firstBad, goodBytes, complete: firstBad === null && tornBytes === 0 };
}

// The durable rewind journal: meta row + one row per event (+ optional terminal).
export function journalToJSONL(log) {
  const rows = [{
    kind: 'dba-rewind-journal', v: 1, repo: log.repo, substrate: log.substrate,
    baseEval: log.baseEval, origin: log.origin, originHash: log.originHash,
  }];
  for (const ev of log.events) rows.push({ kind: 'event', ev });
  if (log.terminal) rows.push({ kind: 'terminal', terminal: log.terminal, terminalHash: log.terminalHash });
  return rows;
}

export function journalFromJSONL(rows) {
  if (!rows.length || rows[0].kind !== 'dba-rewind-journal') throw new Error('journal file: meta row missing/first (refusing)');
  const meta = rows[0];
  const log = {
    kind: 'dba-rewind-journal', v: 1, repo: meta.repo, substrate: meta.substrate,
    baseEval: meta.baseEval, origin: meta.origin, originHash: meta.originHash,
    events: [], sampledCanon: {}, terminal: null, terminalHash: null,
  };
  for (const r of rows.slice(1)) {
    if (r.kind === 'event') log.events.push(r.ev);
    else if (r.kind === 'terminal') { log.terminal = r.terminal; log.terminalHash = r.terminalHash; }
  }
  return log;
}
