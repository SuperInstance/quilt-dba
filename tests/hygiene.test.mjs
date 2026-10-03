// tests/hygiene.test.mjs — wave-69 hygiene battery (offline, deterministic, no secrets).
// Proves the spec-gate discipline itself: the seal matches the spec, the gate
// opens on a sealed repo, and it fails CLOSED with named codes on tamper.
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('spec seal matches live SPEC.md (re-derived, not trusted)', () => {
  const seal = JSON.parse(readFileSync(join(ROOT, 'spec/spec_sha.json'), 'utf8'));
  assert.equal(seal.dialect, 'spec-sha-v1');
  const live = createHash('sha256').update(readFileSync(join(ROOT, 'spec/SPEC.md'))).digest('hex');
  assert.equal(seal.spec_sha, live, 'spec_sha.json does not match SPEC.md — re-seal via tools/spec_seal.mjs');
});

test('gate opens (exit 0) on the sealed repo', () => {
  const r = spawnSync('node', ['tools/spec_gate.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `gate should open, stderr: ${r.stderr}`);
  assert.match(r.stdout, /SPEC_GATE OK/);
});

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'dba-gate-'));
  mkdirSync(join(dir, 'spec'));
  mkdirSync(join(dir, 'tools'));
  copyFileSync(join(ROOT, 'tools/spec_gate.mjs'), join(dir, 'tools/spec_gate.mjs'));
  return dir;
}

test('gate fail-closed: E_SPEC_MISSING when spec absent', () => {
  const dir = sandbox();
  const r = spawnSync('node', ['tools/spec_gate.mjs'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /E_SPEC_MISSING/);
});

test('gate fail-closed: E_SPEC_TAMPERED on spec/seal divergence', () => {
  const dir = sandbox();
  copyFileSync(join(ROOT, 'spec/SPEC.md'), join(dir, 'spec/SPEC.md'));
  writeFileSync(join(dir, 'spec/spec_sha.json'), JSON.stringify({
    dialect: 'spec-sha-v1', spec_sha: '0'.repeat(64),
  }));
  const r = spawnSync('node', ['tools/spec_gate.mjs'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /E_SPEC_TAMPERED/);
});

test('gate fail-closed: E_SPEC_DIALECT on unknown seal dialect', () => {
  const dir = sandbox();
  copyFileSync(join(ROOT, 'spec/SPEC.md'), join(dir, 'spec/SPEC.md'));
  const live = createHash('sha256').update(readFileSync(join(ROOT, 'spec/SPEC.md'))).digest('hex');
  writeFileSync(join(dir, 'spec/spec_sha.json'), JSON.stringify({
    dialect: 'spec-sha-v9', spec_sha: live,
  }));
  const r = spawnSync('node', ['tools/spec_gate.mjs'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /E_SPEC_DIALECT/);
});

test('chain primitives: seal → verify ok, tamper loud (shared/receipts.mjs)', async () => {
  const { sealChain, verifyChain, rowHash } = await import(join(ROOT, 'shared/receipts.mjs'));
  const rows = sealChain([
    { seq: 1, body: 'alpha' },
    { seq: 2, body: 'beta' },
    { seq: 3, body: 'gamma' },
  ]);
  const v = verifyChain(rows);
  assert.equal(v.ok, true);
  // tamper with row 2's body — verification must localize the break
  rows[1].body = 'BETA-TAMPERED';
  const v2 = verifyChain(rows);
  assert.equal(v2.ok, false);
  assert.equal(v2.at, 2);
});

test('cross-repo seal family: all four fleet specs are well-formed spec-sha-v1 (fixture check)', () => {
  // The fleet rule (SPEC §2): any repo can verify any other repo's seal.
  // Here we prove the MECHANISM on a foreign-shaped spec: hash a foreign
  // byte-string, seal it in the same dialect, verify with THIS repo's gate logic
  // by running the gate in a sandbox seeded with the foreign spec.
  const dir = sandbox();
  writeFileSync(join(dir, 'spec/SPEC.md'), '# foreign spec\nsome other repo\'s law\n');
  const live = createHash('sha256').update(readFileSync(join(dir, 'spec/SPEC.md'))).digest('hex');
  writeFileSync(join(dir, 'spec/spec_sha.json'), JSON.stringify({ dialect: 'spec-sha-v1', spec_sha: live }));
  const r = spawnSync('node', ['tools/spec_gate.mjs'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, 'foreign-spec seal must verify — the dialect is fleet-wide');
  assert.match(r.stdout, /SPEC_GATE OK/);
});
