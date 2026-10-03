#!/usr/bin/env node
// tools/spec_seal.mjs — (re)seal spec/SPEC.md: record its sha256 in spec/spec_sha.json.
// The seal is content-only (no wall-clock in hashed material); re-sealing after a
// spec change is a documented, intentional act — the gate makes silent drift loud.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
if (!existsSync('spec/SPEC.md')) { console.error('E_SPEC_MISSING: spec/SPEC.md not found'); process.exit(1); }
const spec_sha = createHash('sha256').update(readFileSync('spec/SPEC.md')).digest('hex');
const name = JSON.parse(readFileSync('package.json', 'utf8')).name ?? 'unknown';
const prior = existsSync('spec/spec_sha.json') ? JSON.parse(readFileSync('spec/spec_sha.json', 'utf8')) : null;
const seal = {
  dialect: 'spec-sha-v1',
  repo: name,
  spec_sha,
  resealed_from: prior ? prior.spec_sha : null,
  note: prior ? 're-seal: intentional documented spec change' : 'initial seal',
  sealed_at: new Date().toISOString(),
};
writeFileSync('spec/spec_sha.json', JSON.stringify(seal, null, 2) + '\n');
console.log(`SEALED ${spec_sha.slice(0, 16)}… (prior: ${prior ? prior.spec_sha.slice(0, 16) + '…' : 'none'})`);
