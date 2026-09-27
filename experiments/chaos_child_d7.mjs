// experiments/chaos_child_d7.mjs — the E-D7 VICTIM process (E-C1/E-C2 child
// pattern). Runs a REAL A-arm developmental run on the dba core substrate
// (dba/core.mjs Driver journaled through dba/rewind.mjs recordStep) and
// persists TWO surfaces, both honest current-shape:
//   1. checkpoint bundles  — JSON.stringify(Driver.bundle()) every --ckptEvery
//      evals (the exact shape dba/driver.mjs:184 writes on the engine path —
//      bare bundle, NO integrity tag; that omission is R3's finding).
//   2. the durable rewind journal — one JSONL row per eval event + meta row
//      (E-D4's journal is memory-only today; this is the durable shape R5
//      tests: byte-prefix recovery + truncate-to-good-then-continue).
//
// argv: --dir <tmpdir> --evals N --seed S --ckptEvery K
//       --mode clean|fsync|buffer|torn   (journal write discipline;
//        torn = two-chunk journal row writes so a SIGKILL can land mid-row;
//        ckpt writes are single writeFileSync calls in every mode)
//       --jgap <ms>  (torn mode: pause between the two halves of a row)
// Prints one JSON line on natural completion: {ok, evals, terminalHash}.

import fs from 'node:fs';
import path from 'node:path';
import { Driver } from '../dba/core.mjs';
import { checkpoint, recordStep, seal, stateHash } from '../dba/rewind.mjs';
import { journalToJSONL } from './chaos_persist_d7.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const dir = arg('dir', null);
const evals = parseInt(arg('evals', '500'), 10);
const seed = parseInt(arg('seed', '7'), 10);
const ckptEvery = parseInt(arg('ckptEvery', '100'), 10);
const mode = arg('mode', 'clean');
const jgap = parseInt(arg('jgap', '2'), 10);
if (!dir) { console.error('chaos_child_d7: --dir required'); process.exit(2); }

const CKPT_DIR = path.join(dir, 'ckpts');
fs.mkdirSync(CKPT_DIR, { recursive: true });
const JOURNAL = path.join(dir, 'rewind_journal.jsonl');
try { fs.unlinkSync(JOURNAL); } catch { /* first run */ }

const d = new Driver({ arm: 'A', seed, gain: 1 });
const log = checkpoint(d, { arm: 'A', seed, gain: 1, evals });
// meta row first (the child's journal starts as a valid 1-row file)
fs.appendFileSync(JOURNAL, JSON.stringify(journalToJSONL(log)[0]) + '\n');

const writeRow = (row) => {
  const line = JSON.stringify(row) + '\n';
  if (mode === 'torn') {
    const fd = fs.openSync(JOURNAL, 'a');
    const buf = Buffer.from(line, 'utf8');
    const half = buf.length >> 1;
    fs.writeSync(fd, buf.subarray(0, half));
    if (jgap > 0) { const t0 = Date.now(); while (Date.now() - t0 < jgap) { /* sync spin: a real gap the SIGKILL can land in */ } }
    fs.writeSync(fd, buf.subarray(half));
    fs.closeSync(fd);
  } else {
    fs.appendFileSync(JOURNAL, line);
    if (mode === 'fsync') { /* appendFileSync is unbuffered to the page cache; fdatasync of an append-only fd */ try { const fd2 = fs.openSync(JOURNAL, 'r+'); fs.fdatasyncSync(fd2); fs.closeSync(fd2); } catch { /* best effort */ } }
  }
};

for (let i = 0; i < evals; i++) {
  const i0 = log.events.length;
  recordStep(d, log, {});
  writeRow({ kind: 'event', ev: log.events[i0] });
  if ((i + 1) % ckptEvery === 0) {
    fs.writeFileSync(path.join(CKPT_DIR, `ckpt_${String(i + 1).padStart(6, '0')}.json`), JSON.stringify(d.bundle()));
  }
}
seal(log, d);
fs.appendFileSync(JOURNAL, JSON.stringify({ kind: 'terminal', terminal: log.terminal, terminalHash: log.terminalHash }) + '\n');
console.log(JSON.stringify({ ok: true, evals: d.state.eval, terminalHash: log.terminalHash, journalHash: stateHash(d) }));
