// surfaces/controlMap.mjs — the flat control hierarchy (SPEC S2).
//
// 'Bypassing the OS abstraction' concretely: there is NO hierarchy object
// between the control cells and the register bank. Each cell IS a mapped
// region on the same SurfaceC register file — a cell's read is a typed-array
// load through its region view, a cell's write is a typed-array store, and
// that is the whole mechanism. Nothing mediates; nothing allocates per
// access; nothing can drift without leaving a tag-word fingerprint.
//
// The control ladder: 99 ops per rung, three rungs, and after every rung the
// CONTROL LEVEL must be unchanged — every op completed against a cell whose
// tag word sat in the expected state, so each rung reads 99 ops-completed-
// at-level, and the recorded ladder is exactly 99 -> 99 -> 99. Any drift is
// a LOUD failure (E_CONTROL_DRIFT naming the rung), never absorbed — this
// mirrors purpose-loops' lib/control-ladder.mjs assertFlatControl (the
// negative control must stay flat or the experiment is INDETERMINATE).

import { TAG_CONTROL_EXPECTED } from './surfaceC.mjs';
import { PROJECTION_GRANULE } from './surfaceC.mjs';

export const CONTROLS_PER_GRANULE = PROJECTION_GRANULE / 8; // 8 registers per cell

// Map K control cells DIRECTLY onto the register bank, one granule each,
// pinned at the TOP of the file so workload traffic (which maps lower
// spans) cannot trample them. Returns bare cell handles: the region views
// themselves, plus the absolute index of each cell's tag word.
export function mapCells(surface, k = 3) {
  if (!Number.isInteger(k) || k <= 0) {
    throw Object.assign(new Error(`controlMap.mapCells: k must be a positive integer (got ${k})`), { code: 'E_CONTROL_DRIFT' });
  }
  if (k * CONTROLS_PER_GRANULE > surface.n) {
    throw Object.assign(new Error('controlMap.mapCells: more cells than the register bank holds'), { code: 'E_REGISTER_OVERRUN' });
  }
  const top = surface.n - k * CONTROLS_PER_GRANULE;
  const cells = [];
  for (let i = 0; i < k; i++) {
    const base = top + i * CONTROLS_PER_GRANULE;
    // mapRegion hands back unmediated views; the cell keeps them as-is.
    const region = surface.mapRegion(base, CONTROLS_PER_GRANULE);
    cells.push({
      i,
      base,
      len: CONTROLS_PER_GRANULE,
      region,                     // {data, tags, base, len} — the raw views
      tagWord: () => region.tags[0],            // the cell's tag word = slot 0's tag
      stamp: () => { region.tags[0] = TAG_CONTROL_EXPECTED; }, // arm the level marker
      // read/write ARE register view accesses — one line, no layer:
      read: (idx) => region.data[idx],
      write: (idx, v) => { region.data[idx] = v; },
    });
  }
  for (const c of cells) c.stamp(); // all cells armed: level = K
  return cells;
}

// The CONTROL LEVEL: number of control cells whose tag word is in the
// expected state. A drift here is what the ladder refuses to absorb.
export function controlLevel(cells) {
  let level = 0;
  for (const c of cells) if (c.tagWord() === TAG_CONTROL_EXPECTED) level++;
  return level;
}

// The flat control ladder on Surface C (SPEC S2). Three rungs; each rung
// performs `opsPerRung` deterministic ops (op j: read mapped register
// j % regionLen of cell j % K, write back (value + 1) % 1000 — no
// randomness anywhere). Per op the cell's tag word must be in the expected
// state or the ladder throws E_CONTROL_DRIFT naming the rung; the rung's
// reading is the count of ops completed at the unchanged control level.
// Returns { ladder: [99, 99, 99], flat: true } — or throws, loudly.
// Accepts either a SurfaceC (cells are mapped and armed here) or an
// ALREADY-MAPPED cells array (the caller controls arming — this is how the
// drift path is tested: trample a tag word, pass the cells in, watch the
// ladder refuse by name).
export function runLadder(surfaceOrCells, opsPerRung = 99, { k = 3 } = {}) {
  const cells = Array.isArray(surfaceOrCells) ? surfaceOrCells : mapCells(surfaceOrCells, k);
  const expected = Array.isArray(surfaceOrCells) ? cells.length : k; // a passed-in array defines its own K
  const levelBefore = controlLevel(cells);
  if (levelBefore !== expected) {
    throw Object.assign(new Error(`control ladder: cells not armed at rung 0 (level ${levelBefore}/${expected})`), { code: 'E_CONTROL_DRIFT', rung: 0 });
  }
  const ladder = [];
  for (let r = 0; r < 3; r++) {
    let completedAtLevel = 0;
    for (let j = 0; j < opsPerRung; j++) {
      const cell = cells[j % cells.length];
      const idx = j % cell.len;
      // the CONTROL LEVEL check IS the tag-word read — one u32 load:
      if (cell.tagWord() !== TAG_CONTROL_EXPECTED) {
        throw Object.assign(
          new Error(`control drift at rung ${r}, op ${j}: cell ${cell.i} tag word left expected state 0x${TAG_CONTROL_EXPECTED.toString(16)} (found 0x${cell.tagWord().toString(16)}) — the negative control moved, the surface is INDETERMINATE`),
          { code: 'E_CONTROL_DRIFT', rung: r, op: j, cell: cell.i },
        );
      }
      const v = cell.read(idx);              // unmediated load
      cell.write(idx, (v + 1) % 1000);       // unmediated store, deterministic
      completedAtLevel++;
    }
    // end-of-rung: the level itself must be unchanged (all cells still armed)
    const levelAfter = controlLevel(cells);
    if (levelAfter !== levelBefore) {
      throw Object.assign(
        new Error(`control drift at rung ${r}: control level moved ${levelBefore} -> ${levelAfter} mid-experiment`),
        { code: 'E_CONTROL_DRIFT', rung: r, expected: levelBefore, found: levelAfter },
      );
    }
    ladder.push(completedAtLevel);
  }
  // assertFlatControl, mirrored from purpose-loops lib/control-ladder.mjs:
  // the recorded series must be exactly flat, end to end.
  for (let i = 1; i < ladder.length; i++) {
    if (ladder[i] !== ladder[0]) {
      throw Object.assign(
        new Error(`control ladder NOT FLAT at rung ${i + 1}: ${ladder[0]} -> ${ladder[i]} (expected ${ladder.map(() => ladder[0]).join(' -> ')}, found ${ladder.join(' -> ')})`),
        { code: 'E_CONTROL_DRIFT', at: i + 1, expected: ladder[0], found: ladder[i] },
      );
    }
  }
  return { ladder, flat: true, level: levelBefore, cells: cells.length };
}
