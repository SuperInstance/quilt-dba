// smoke_ed4 — audit smoke for the E-D4 exact-rewind layer (written by main after the 25-b lane
// died post-run: the receipt chain + experiment were complete; this file was the missing piece).
// Checks: (1) receipt chain seals+verifies from disk; (2) R1 bit-equality claims re-checked from
// the summary file; (3) R2 resume-equivalence hashes consistent; (4) no-floats re-scan of the
// rewind layer source.
import { readFileSync } from 'fs';
import { verifyChain } from '../dba/receipts.mjs';

let ok = 0, total = 0;
function check(name, cond) {
  total++;
  if (cond) { ok++; console.log(`  ✓ ${name}`); }
  else console.log(`  ✗ ${name}`);
}

// (1) chain
const rows = readFileSync(new URL('./outputs/receipts_ed4.jsonl', import.meta.url), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const v = verifyChain(rows);
check('receipt chain seals + verifies (17 rows)', v && v.ok === true && rows.length === 17);

// (2) R1 exactness re-check from summary aggregates
const sum = JSON.parse(readFileSync(new URL('./outputs/e_d4_summary.json', import.meta.url), 'utf8'));
const r1 = sum.r1 ?? {};
check('R1 verdict reports exactness at sampled ks + full sweep', typeof r1.verdict === 'string' && /EXACT/i.test(r1.verdict));
check('R1 sampledOk === true', r1.sampledOk === true);
check('R1 sweep first mismatch === -1 (no mismatch across ' + (r1.sweepTicks ?? '?') + ' ticks)', r1.sweepFirstMismatch === -1);

// (3) R2 resume equivalence
const resumes = sum.r2?.resumes ?? [];
check('R2 resume points exist (>=2)', resumes.length >= 2);
check('R2 all resumes match terminal hash', resumes.every((s) => s.matchesTerminal === true));

// (4) no-floats re-scan of the rewind layer source
const src = readFileSync(new URL('../dba/rewind.mjs', import.meta.url), 'utf8');
const stripped = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
check('no float literals / Math.* / Math.random in dba/rewind.mjs',
  !/\b0x[0-9a-f]+\.[0-9a-f]|\b\d+\.\d+\b|Math\.(random|floor|ceil|round|abs|pow|sqrt|log|exp)\b/.test(stripped));
check('rewind layer exports rewind API', /export\s+(async\s+)?function\s+rewind|export\s+const\s+rewind/.test(src));

console.log(total && ok === total ? `SMOKE ED4 OK (${ok}/${total} checks)` : `SMOKE ED4 FAILED (${ok}/${total} checks)`);
process.exit(ok === total ? 0 : 1);
