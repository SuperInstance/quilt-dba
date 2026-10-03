// surfaces/jitSplit.mjs — the JIT Topological Splitting Engine (SPEC S3).
//
// When a region's Shannon entropy (over a 64-bucket histogram of its
// register values) exceeds ENTROPY_SPLIT_BITS (4.0), the region is split
// topologically: the second half is copied to a fresh scratch region and
// the base table is re-pointed ATOMICALLY. One decision, no threads:
//
//   NO locks, NO blocking, NO async on the hot path. This runtime is a
//   single-mutator world — JavaScript executes the whole split as one
//   synchronous section with no await points, so a reader can NEVER
//   interleave into the middle of it. The visible state transition is one
//   array-element assignment (the base-table re-point); the old view stays
//   byte-valid through the swap because a split COPIES and never moves
//   (copy-on-write: the old layout and the new layout share bytes until
//   the old layout is forgotten). Readers therefore always see either the
//   old layout or the new layout — never garbage, never partial state.
//
// Bounded split work: a split copies exactly HALF the region's bytes —
// the escaping half — and the topological decomposition is a halving tree,
// so the amortized copy cost across a full recursive split of n registers
// is n/2 + n/4 + ... = O(n) total, O(len) per step. Nothing allocates on
// the READ path; readers keep using typed-array views straight over the
// register file (S1 holds even across a split).

import { PROJECTION_GRANULE, REGISTERS_PER_GRANULE } from './surfaceC.mjs';

// SPEC pre-registered constant: per-region Shannon-entropy split threshold.
export const ENTROPY_SPLIT_BITS = 4.0;
export const ENTROPY_BUCKETS = 64;

// Shannon entropy (bits) of a register view over a 64-bucket histogram.
// Deterministic value scaling: every value is normalized against the
// region's own [min, max] (same bytes -> same buckets -> same entropy);
// the top bucket holds the max; non-finite values fold to 0. Empty (or
// all-non-finite) regions have entropy 0 by definition. A FLAT region
// (all one value) lands in a single bucket: entropy 0.
export function regionEntropy(regView) {
  const n = regView.length;
  if (n === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(regView[i]) ? regView[i] : 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return 0; // no finite values at all
  const span = max - min || 1;
  const hist = new Float64Array(ENTROPY_BUCKETS);
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(regView[i]) ? regView[i] : 0;
    const b = v === max ? ENTROPY_BUCKETS - 1 : Math.floor(((v - min) / span) * ENTROPY_BUCKETS);
    hist[b]++;
  }
  let h = 0;
  for (let b = 0; b < ENTROPY_BUCKETS; b++) {
    if (hist[b] === 0) continue;
    const p = hist[b] / n;
    h -= p * Math.log2(p);
  }
  return h;
}

export class JitSplitter {
  constructor(surface, { maxDepth = 12 } = {}) {
    this.surface = surface;
    this.table = [];   // base table: [{base, len, splitDepth}]
    this.views = new Map();  // base -> cached unmediated view (readers reuse it; no per-read allocation)
    this.splits = 0;
    this.maxDepth = 0;
    this._maxDepthCap = maxDepth;
    this._side = new Map();  // base -> split-phase record (the SPLITTING side table)
  }

  // Register a region for observation. The splitter's scratch allocations
  // are reserved ABOVE every tracked span (bump-allocator discipline), so
  // a scratch copy can never overlap a live region.
  track(base, len) {
    if (this.table.some((e) => e.base === base)) {
      throw Object.assign(new Error(`JitSplitter.track(${base}, ${len}): base already tracked`), { code: 'E_REGISTER_OVERRUN' });
    }
    const view = this.surface.mapRegion(base, len); // validates bounds loudly
    this.surface.reserveAbove(base + len);
    const entry = { base, len, splitDepth: 0 };
    this.table.push(entry);
    this.views.set(base, view);
    return entry;
  }

  // Reader-side view lookup: the CURRENT layout's view for a tracked base.
  // Returns the cached typed-array view itself — unmediated (S1).
  viewOf(base) {
    const e = this.table.find((t) => t.base === base);
    if (!e) return null;
    return this.views.get(base) ?? this.surface.mapRegion(e.base, e.len).data;
  }

  // Observe one region; split it copy-on-write when it is too hot.
  // Hot path: throws nothing (bad bases fail loud in track/viewOf, split
  // work itself never throws — the register file was bounds-checked at
  // track time and scratch is reserved above every tracked span).
  //   returns {split: true, at, depth} on a split,
  //           {split: false, entropy} otherwise.
  observe(base) {
    const idx = this.table.findIndex((t) => t.base === base);
    if (idx === -1) return { split: false, entropy: 0, unknown: true };
    const entry = this.table[idx];
    const view = this.views.get(base);
    const entropy = regionEntropy(view.data);
    const canSplit = entropy > ENTROPY_SPLIT_BITS
      && entry.len >= 2 * REGISTERS_PER_GRANULE   // a granule is the atom
      && entry.splitDepth < this._maxDepthCap;
    if (!canSplit) return { split: false, entropy };

    // ---- the split (one synchronous, single-mutator section) ----------
    const halfLen = entry.len >> 1;               // len is granule-aligned
    const scratchBase = this.surface.alloc(halfLen);
    // mark SPLITTING in the side table BEFORE any byte moves:
    this._side.set(base, { phase: 'SPLITTING', base, scratchBase, fromLen: entry.len, halfLen, depth: entry.splitDepth + 1 });
    // bounded copy-on-write: ONLY the second half is copied to scratch
    // (half the region's bytes; the first half stays exactly where it is).
    this.surface.registers
      .subarray(scratchBase, scratchBase + halfLen)
      .set(view.data.subarray(halfLen));          // set() = the bounded copy
    // ATOMIC RE-POINT — the single assignment this engine exists for:
    // one statement replaces the base-table entry; no reader can observe
    // the table between the old entry and the new (single-mutator, no
    // await). Old layout's bytes were copied, not moved: the old view
    // stays valid until (and after) the swap.
    this.table[idx] = { base: scratchBase, len: halfLen, splitDepth: entry.splitDepth + 1 };
    this.views.set(scratchBase, this.surface.mapRegion(scratchBase, halfLen));
    // the residual first half keeps the old base as its own region:
    this.table.push({ base, len: halfLen, splitDepth: entry.splitDepth + 1 });
    this.views.set(base, this.surface.mapRegion(base, halfLen));
    // split complete — side table records the event, never blocks again:
    this._side.set(base, { phase: 'SPLIT', base, scratchBase, fromLen: entry.len, halfLen, depth: entry.splitDepth + 1 });
    this.splits++;
    this.maxDepth = Math.max(this.maxDepth, entry.splitDepth + 1);
    return { split: true, at: base, depth: entry.splitDepth + 1 };
  }

  // The side table's current phase for a base (for tests/receipts).
  sideState(base) {
    return this._side.get(base) ?? null;
  }

  stats() {
    return {
      regions: this.table.length,
      splits: this.splits,
      maxDepth: this.maxDepth,
      granule: PROJECTION_GRANULE,
    };
  }
}
