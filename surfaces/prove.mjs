// surfaces/prove.mjs — mint the Wave-69 Surface C receipt (Run-of-record).
// Executes the full Round-22 shape ON the memory-mapped surface and writes
// experiments/outputs/w69_surface_c_receipt.json. Run: node surfaces/prove.mjs
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SurfaceC } from './surfaceC.mjs';
import { runLadder } from './controlMap.mjs';
import { JitSplitter, regionEntropy } from './jitSplit.mjs';
import { StickyScarRegistry } from './scars.mjs';
import { prove, seedBlocks, perturbPayloads } from './bandLaw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'experiments/outputs/w69_surface_c_receipt.json');

// ---- run of record --------------------------------------------------------
const surface = new SurfaceC(512);
const scars = surface.scars;

// S2 — the flat control ladder, FIRST (the negative control must hold
// before any mechanism runs): 99 ops × 3 rungs, level must stay 99→99→99.
seedBlocks(surface); // the ladder shares the register bank, top-pinned cells aside
const ladder = runLadder(surface, 99);
if (!ladder.flat || ladder.ladder.length !== 3 || ladder.ladder.some((l) => l !== 99)) {
  throw new Error(`E_CONTROL_DRIFT: control ladder not flat on Surface C: ${ladder.ladder}`);
}

// S5 — the band law, Round 22 shape (seeds its own world on the same bank).
const band = prove(surface, { scars });

// S4 — scars survive rewind, exercised live inside the proof run:
// snapshot -> mutate the world (a payload shift + a scar) -> restore the
// EARLIER image -> registers byte-restored, scar chain intact + verified.
const snap = surface.snapshot();
const scarsBefore = scars.size;
perturbPayloads(surface, [2]); // move the world AFTER the image was taken
scars.scar('prove-checkpoint', 'world moved past the S4 checkpoint', 2 * 8);
const restored = SurfaceC.restore(snap, { into: surface });
const regOk = Buffer.compare(restored.snapshot(), snap) === 0;
const scarsOk = scars.size === scarsBefore + 1 && scars.verify().ok;
if (!regOk || !scarsOk) throw new Error('E_REWIND_SCAR_LOST: rewind lost state or history');
perturbPayloads(surface, [2]); // undo the S4 probe's world move (deterministic re-apply)

// S3 — the JIT split on the same bank: the perturbed block's entropy is
// recorded honestly (a +17 payload shift yields few buckets: low bits), and
// a STORM block — deterministic wide-spread values across all 64 buckets —
// must trip the threshold and split. Readers never see partial state.
const jit = new JitSplitter(surface);
const flatBase = jit.track(0, 8);
const hotBase = jit.track(9 * 8, 8); // op 9 is in the perturbed set
const eFlat = regionEntropy(jit.viewOf(flatBase.base).data);
const eHot = regionEntropy(jit.viewOf(hotBase.base).data);
// the storm: 64 registers sweeping the full value range (spans all buckets)
const stormBase = jit.track(surface.alloc(64), 64);
for (let i = 0; i < 64; i++) jit.viewOf(stormBase.base).data[i] = (i * 1103515245 + 12345) % 9973;
const eStorm = regionEntropy(jit.viewOf(stormBase.base).data);
const split = jit.observe(stormBase.base);
if (split.split !== true) throw new Error(`E_SPLIT_BLOCKED: storm block entropy ${eStorm} failed to split — the JIT engine is INDETERMINATE`);
// post-split: the two halves are the storm's own bytes, split not scrambled
const halves = [jit.viewOf(stormBase.base), jit.viewOf(jit.table[1].base)];
const eHalfMax = Math.max(regionEntropy(halves[0].data), regionEntropy(halves[1].data));
if (!(eHalfMax <= eStorm + 1e-9)) throw new Error('E_SPLIT_BLOCKED: split produced entropy gain out of nowhere');

// cross-repo fixture: stitch the REAL exoj spec seal as the first sxc1 id
const exojSealPath = '/home/z/my-project/exoj/spec/spec_sha.json';
let exojSeal = null;
if (existsSync(exojSealPath)) {
  exojSeal = JSON.parse(readFileSync(exojSealPath, 'utf8')).spec_sha;
}

const receipt = {
  dialect: 'w69-surface-c-receipt/v1',
  surface: 'C',
  substrate: 'Float64Array register file + Uint32Array tag words (SurfaceC, 512 registers)',
  projection: 'mapRegion = mmap(2); subarray views = unmediated loads/stores (zero-copy)',
  round22: band,
  controlLadder: { ladder: ladder.ladder, flat: ladder.flat, opsPerRung: 99, level: ladder.level },
  scarsSurviveRewind: { proven: true, registrySize: scars.size, chainVerified: scars.verify().ok, byteRestored: regOk },
  jitSplit: { entropyFlatBlock: Math.round(eFlat * 1e4) / 1e4, entropyHotBlock: Math.round(eHot * 1e4) / 1e4, entropyStormBlock: Math.round(eStorm * 1e4) / 1e4, splitTriggered: split.split === true, splitDepth: split.depth ?? 0, postSplitEntropyMax: Math.round(eHalfMax * 1e4) / 1e4, stats: jit.stats() },
  stitch: exojSeal
    ? { firstEnvId: exojSeal, source: 'SuperInstance/exoj spec/spec_sha.json (real cross-repo receipt)' }
    : { firstEnvId: null, source: 'exoj seal unavailable at proof time' },
  law: band.law,
  vendoredSha256: band.vendoredSha256,
  spec: 'spec/SPEC.md (pre-registered, sealed spec-sha-v1)',
  note: 'Costs are measured work units (fingerprint scan = len, eager key-mix = keyLen x 64 rounds, replay = 1), never declared. Parity is op-for-op against the eager baseline.',
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(receipt, null, 2) + '\n');
const sha = createHash('sha256').update(readFileSync(OUT)).digest('hex');
console.log(`SURFACE C RECEIPT ${OUT}`);
console.log(`  round22: ${band.parity} parity @ costRatio ${band.costRatio} (cap ${band.costCap}), ${band.escalations} escalations`);
console.log(`  control ladder: ${ladder.ladder.join(' -> ')} (flat=${ladder.flat})`);
console.log(`  scars: ${scars.size}, chain verified=${scars.verify().ok}, rewind-safe=${scarsOk}`);
console.log(`  jit: flat=${receipt.jitSplit.entropyFlatBlock}b hot=${receipt.jitSplit.entropyHotBlock}b storm=${receipt.jitSplit.entropyStormBlock}b split=${receipt.jitSplit.splitTriggered} depth=${receipt.jitSplit.splitDepth} (stats ${JSON.stringify(jit.stats())})`);
console.log(`  receipt sha256: ${sha.slice(0, 16)}…`);
