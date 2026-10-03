// surfaces/scars.mjs — sticky scar chain for Surface C.
//
// A THIN chain registry over shared/receipts.mjs: fnv1a64 + append-only
// hash chain, ported to the scar row shape, NOT re-implemented. Scars are
// permanent marks left on the surface by history — execution-cost anomalies,
// die rolls, split events (SPEC S4). They are METADATA ABOUT HISTORY, not
// register state: a rewind of the register file must never rewind the scar
// chain (the past happened; the scars say so).
//
// Never deletes: there is no delete API by construction. verify() re-derives
// every link from the genesis prev ('0' * 64) and localizes any tamper.

import { fnv1a64, rowHash, verifyChain } from '../shared/receipts.mjs';

export const SCAR_GENESIS = '0'.repeat(64);

export class StickyScarRegistry {
  constructor() {
    this.rows = [];      // [{seq, kind, note, atRegisterBase?, prev, id}]
    this._prev = SCAR_GENESIS;
  }

  // Append one scar. id = fnv1a64([prev, rest]) — the receipts.mjs style,
  // with the row's own prev field inside the hashed payload so linkage
  // tamper is hash-visible. Returns the scar id.
  scar(kind, note, atRegisterBase) {
    const seq = this.rows.length + 1;
    const row = { seq, kind, note };
    if (atRegisterBase !== undefined) row.atRegisterBase = atRegisterBase;
    row.prev = this._prev;
    const rest = {
      seq: row.seq, kind: row.kind, note: row.note,
      ...(atRegisterBase !== undefined ? { atRegisterBase: row.atRegisterBase } : {}),
      prev: row.prev,
    };
    row.id = fnv1a64([row.prev, rest]);
    this.rows.push(row);
    this._prev = row.id;
    return row.id;
  }

  // Re-derive the whole chain. Reuses shared/receipts.mjs verifyChain by
  // presenting each scar's id as the row_hash it re-derives — plus the
  // explicit linkage check (row[i].prev must be row[i-1].id, row[0].prev
  // must be genesis), which hash re-derivation alone cannot see.
  verify() {
    for (let i = 0; i < this.rows.length; i++) {
      const want = i === 0 ? SCAR_GENESIS : this.rows[i - 1].id;
      if (this.rows[i].prev !== want) {
        return { ok: false, at: this.rows[i].seq, why: 'prev-link mismatch' };
      }
    }
    const asRows = this.rows.map((r) => {
      const { id, ...rest } = r;
      return { ...rest, row_hash: id };
    });
    const v = verifyChain(asRows, SCAR_GENESIS);
    if (!v.ok) return { ok: false, at: v.at, why: v.why };
    return { ok: true, links: this.rows.length, tip: this._prev };
  }

  tip() {
    return this._prev;
  }

  get size() {
    return this.rows.length;
  }
}
