// surfaces/surfaceC.mjs — the memory-mapped projection layer (SPEC S1, S6).
//
// THE MMAP ANALOGY, stated once (this is the documented interface):
//
//   ArrayBuffer (registers.buffer)  ≙  the physical register block
//   mapRegion(base, len)             ≙  mmap(2): a projection of a span of
//                                       that block into "address space"
//   the returned typed-array views   ≙  unmediated loads/stores
//
// A mapped region read IS a direct typed-array access. There is no accessor
// object, no getter, no per-read allocation: `mapRegion` hands out subarray
// VIEWS over the very same ArrayBuffer the register file lives on, so a
// store through a view lands in the register file with nothing in between —
// the way a store through an mmap'd page lands in the file. Zero-copy:
// `view.buffer === surface.registers.buffer` is the load-bearing invariant
// (asserted in tests), and the hot read path is `data[i]`, full stop.
//
// Parallel to the Float64Array register file runs a Uint32Array tag word
// file (REGISTER_WORD_BITS = 64: one f64 register + one u32 tag per slot).
// Tags are also mapped as unmediated views; control cells stamp them (see
// controlMap.mjs), JIT splits stamp them (see jitSplit.mjs).
//
// snapshot/restore is the crash-grade durability law (SPEC S6): snapshot()
// returns ONE byte-exact Buffer holding BOTH arrays (register bytes then
// tag bytes); static restore() rebuilds byte-identically. Scars are NOT in
// the image — they are metadata about history, not register state (S4);
// restoring into a live surface leaves its scar chain untouched.
//
// Fail-closed: every bad mapping request (out of bounds, misaligned to the
// PROJECTION_GRANULE, empty) is an E_REGISTER_OVERRUN — a register-space
// overrun of one kind or another, never absorbed.

import { StickyScarRegistry } from './scars.mjs';

// mmap granule: regions are carved in whole 64-byte granules (8 f64
// registers), exactly as an OS maps whole pages. Bytes, then registers.
export const PROJECTION_GRANULE = 64;
export const REGISTERS_PER_GRANULE = PROJECTION_GRANULE / 8; // 8 f64 = 64 B
export const REGISTER_WORD_BITS = 64;

// Tag-word state for a CONTROL cell (controlMap.mjs): the expected state a
// control cell's tag word must sit in for the ladder to read level.
export const TAG_CONTROL_EXPECTED = 0xc0dec0de;

export class SurfaceC {
  constructor(n = 4096) {
    if (!Number.isInteger(n) || n <= 0 || n % REGISTERS_PER_GRANULE !== 0) {
      throw Object.assign(
        new Error(`SurfaceC: register count must be a positive multiple of ${REGISTERS_PER_GRANULE} (got ${n})`),
        { code: 'E_REGISTER_OVERRUN' },
      );
    }
    this.n = n;
    // The physical substrate: one ArrayBuffer per file, no wrapper objects.
    this.registers = new Float64Array(n);
    this.tags = new Uint32Array(n); // parallel tag words
    // Integrated sticky scars: metadata about history (S4). Deliberately
    // ABSENT from snapshot()/restore() — see the S4 note above.
    this.scars = new StickyScarRegistry();
    this._allocCursor = 0; // bump allocator for scratch regions (jitSplit)
  }

  // ---- the projection ---------------------------------------------------

  // mmap(2) onto the register block. base and len are in REGISTERS (f64
  // slots); both must be whole granules, and [base, base+len) must lie in
  // the file. Returns unmediated views — no accessor objects anywhere.
  mapRegion(base, len) {
    const overrun = (why) => Object.assign(
      new Error(`SurfaceC.mapRegion(${base}, ${len}): ${why} (n=${this.n}, granule=${REGISTERS_PER_GRANULE} registers)`),
      { code: 'E_REGISTER_OVERRUN', why },
    );
    if (!Number.isInteger(base) || !Number.isInteger(len) || len <= 0 || base < 0) {
      throw overrun('non-integer, negative, or empty span');
    }
    if (base % REGISTERS_PER_GRANULE !== 0 || len % REGISTERS_PER_GRANULE !== 0) {
      throw overrun('span not granule-aligned');
    }
    if (base + len > this.n) throw overrun('overrun past end of register file');
    // subarray = a VIEW over the same ArrayBuffer. Writes through these go
    // straight to the register file; there is nothing between reader and
    // bytes (S1: the unmediated read path is `data[i]`).
    const data = this.registers.subarray(base, base + len);
    const tags = this.tags.subarray(base, base + len);
    return { data, tags, base, len };
  }

  // Bump allocator for fresh scratch regions (jitSplit.mjs). Bare metal:
  // claims a span; nobody unclaims it (the surface never reuses bytes a
  // split might still be reading from — copy-on-write stays safe forever).
  alloc(len) {
    if (!Number.isInteger(len) || len <= 0 || len % REGISTERS_PER_GRANULE !== 0) {
      throw Object.assign(new Error(`SurfaceC.alloc(${len}): len must be a positive granule multiple`), { code: 'E_REGISTER_OVERRUN' });
    }
    const base = this._allocCursor;
    if (base + len > this.n) {
      throw Object.assign(new Error(`SurfaceC.alloc(${len}): register file exhausted at base ${base}`), { code: 'E_REGISTER_OVERRUN' });
    }
    this._allocCursor = base + len;
    return base;
  }

  // Raise the bump-alloc cursor above a span claimed by a direct mapping
  // (jitSplit.track): scratch regions must never overlap a tracked region.
  reserveAbove(upto) {
    if (upto > this.n) {
      throw Object.assign(new Error(`SurfaceC.reserveAbove(${upto}): past end of register file (n=${this.n})`), { code: 'E_REGISTER_OVERRUN' });
    }
    this._allocCursor = Math.max(this._allocCursor, upto);
    return this._allocCursor;
  }

  // ---- durability (S6) ---------------------------------------------------

  // One byte-exact Buffer: [n * 8 register bytes][n * 4 tag bytes].
  // The scar chain is DELIBERATELY NOT HERE (S4: scars are metadata about
  // history; the snapshot is register state).
  snapshot() {
    const regBytes = new Uint8Array(this.registers.buffer, 0, this.n * 8);
    const tagBytes = new Uint8Array(this.tags.buffer, 0, this.n * 4);
    return Buffer.concat([Buffer.from(regBytes), Buffer.from(tagBytes)]);
  }

  // Rebuild from a snapshot image. Byte law: 12n bytes = n*(8+4); a raw
  // memory image, same-endian by construction on this surface's platform.
  //   restore(buf)          -> a COLD surface (fresh, empty scar registry:
  //                            a cold boot has no history yet)
  //   restore(buf, {into})  -> rewind INTO a live surface: register file and
  //                            tags are overwritten byte-exactly, and the
  //                            scar chain is LEFT UNTOUCHED (S4: the rewind
  //                            rewinds state, never history).
  static restore(buf, { into } = {}) {
    if (!Buffer.isBuffer(buf) || buf.length % 12 !== 0 || buf.length === 0) {
      throw Object.assign(new Error(`SurfaceC.restore: malformed image (${buf && buf.length} bytes, need a positive multiple of 12)`), { code: 'E_REGISTER_OVERRUN', why: 'malformed-image' });
    }
    const n = buf.length / 12;
    const target = into ?? new SurfaceC(n);
    if (target.n !== n) {
      throw Object.assign(new Error(`SurfaceC.restore: image is ${n} registers, target surface is ${target.n}`), { code: 'E_REGISTER_OVERRUN', why: 'size-mismatch' });
    }
    const regs = new Float64Array(buf.buffer, buf.byteOffset, n);
    const tags = new Uint32Array(buf.buffer, buf.byteOffset + n * 8, n);
    target.registers.set(regs);
    target.tags.set(tags);
    return target;
  }
}
