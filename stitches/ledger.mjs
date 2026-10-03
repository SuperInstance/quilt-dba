// stitches/ledger.mjs — the persistent sxc1 stitch ledger (SPEC §4).
//
// quilt-dba is the fleet's persistent stitch: sxc1 envelope IDS arriving
// from exoj (Track A emitter) and cocapn (validator mirror) are appended
// here, hash-chained with the SAME shared/receipts.mjs primitives the rest
// of dba's durability law runs on (fnv1a64 rowHash — dba's internal chain;
// the ENVELOPE's own sha256 sxc1 id is carried as payload, not re-derived).
//
// This ledger receipts WHICH envelope was stitched, when in chain order —
// it does not re-verify envelope internals (that lives at the receivers:
// exoj gan/envelope.mjs, cocapn sxc1/envelope.py). What it enforces:
//   - an env_id must be exactly 64 hex chars (else E_STITCH_SEAL), so a
//     malformed or hand-typed id can never enter the durable chain;
//   - append-only, never deletes; verify() re-derives every row from
//     genesis and localizes any tamper (the E-D4 discipline).

import { fnv1a64, verifyChain } from '../shared/receipts.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const STITCH_GENESIS = '0'.repeat(64);
const HEX64 = /^[0-9a-f]{64}$/;

export class StitchLedger {
  constructor() {
    this.rows = []; // [{seq, kind:'sxc1-stitch', env_id, prev, id}]
    this._prev = STITCH_GENESIS;
  }

  static isHex64(s) {
    return typeof s === 'string' && HEX64.test(s);
  }

  // Append one stitch. Fail-closed on a malformed env_id: nothing is
  // written, the caller gets E_STITCH_SEAL (SPEC fail-closed vocabulary).
  // The row receipts the ID ONLY — envelope internals are verified at the
  // receivers (exoj gan/envelope.mjs, cocapn sxc1/envelope.py), not here.
  stitch(envId) {
    if (!StitchLedger.isHex64(envId)) {
      throw Object.assign(
        new Error(`stitch refused: env_id ${JSON.stringify(envId)} is not 64-hex — a malformed id never enters the durable chain`),
        { code: 'E_STITCH_SEAL', envId },
      );
    }
    const seq = this.rows.length + 1;
    const row = { seq, kind: 'sxc1-stitch', env_id: envId };
    row.prev = this._prev;
    row.id = fnv1a64([row.prev, { seq: row.seq, kind: row.kind, env_id: row.env_id, prev: row.prev }]);
    this.rows.push(row);
    this._prev = row.id;
    return row.id;
  }

  tip() {
    return this._prev;
  }

  get size() {
    return this.rows.length;
  }

  // Re-derive every link: prev linkage AND fnv1a64 hash re-derivation
  // (both checks — linkage alone cannot see a value rewrite, hash alone
  // cannot see a splice).
  verify() {
    for (let i = 0; i < this.rows.length; i++) {
      const want = i === 0 ? STITCH_GENESIS : this.rows[i - 1].id;
      if (this.rows[i].prev !== want) return { ok: false, at: this.rows[i].seq, why: 'prev-link mismatch' };
      if (!StitchLedger.isHex64(this.rows[i].env_id)) return { ok: false, at: this.rows[i].seq, why: 'env_id not 64-hex' };
    }
    const asRows = this.rows.map((r) => {
      const { id, ...rest } = r;
      return { ...rest, row_hash: id };
    });
    const v = verifyChain(asRows, STITCH_GENESIS);
    if (!v.ok) return { ok: false, at: v.at, why: v.why };
    return { ok: true, links: this.rows.length, tip: this._prev };
  }

  // Persist to disk (JSONL, one row per line). Append-only by construction:
  // writes the full row set (rows are immutable once chained); the on-disk
  // form is the byte-exact serialisation of the verified chain.
  static load(path) {
    const led = new StitchLedger();
    if (!existsSync(path)) return led;
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      const row = JSON.parse(line);
      if (row.prev !== led._prev) {
        throw Object.assign(new Error(`stitch ledger ${path}: prev-link break at seq ${row.seq}`), { code: 'E_STITCH_SEAL', at: row.seq });
      }
      led.rows.push(row);
      led._prev = row.id;
    }
    const v = led.verify();
    if (!v.ok) {
      throw Object.assign(new Error(`stitch ledger ${path}: chain verify failed at seq ${v.at} (${v.why})`), { code: 'E_STITCH_SEAL', at: v.at });
    }
    return led;
  }

  save(path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, this.rows.map((r) => JSON.stringify(r)).join('\n') + (this.rows.length ? '\n' : ''));
    return path;
  }
}
