#!/usr/bin/env node
// tools/spec_gate.mjs — self-defending compiler gate (wave-69).
// Refuses compilation when the specification is missing, unsealed, or tampered.
// Named fail-closed codes: E_SPEC_MISSING, E_SPEC_SHA_MISSING, E_SPEC_SHA_MALFORMED,
// E_SPEC_DIALECT, E_SPEC_TAMPERED. Exit 0 => gate open.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
const die = (code, msg) => { console.error(`SPEC_GATE ${code}: ${msg}`); process.exit(1); };
if (!existsSync('spec/SPEC.md')) die('E_SPEC_MISSING', 'spec/SPEC.md not found — specification-first layout is required before code generation');
if (!existsSync('spec/spec_sha.json')) die('E_SPEC_SHA_MISSING', 'spec/spec_sha.json not found — pre-registration required (run: node tools/spec_seal.mjs)');
let seal;
try { seal = JSON.parse(readFileSync('spec/spec_sha.json', 'utf8')); }
catch { die('E_SPEC_SHA_MALFORMED', 'spec/spec_sha.json is not valid JSON'); }
if (seal.dialect !== 'spec-sha-v1') die('E_SPEC_DIALECT', `unknown seal dialect ${JSON.stringify(seal.dialect)} — expected "spec-sha-v1"`);
const live = createHash('sha256').update(readFileSync('spec/SPEC.md')).digest('hex');
if (seal.spec_sha !== live) die('E_SPEC_TAMPERED', `spec seal mismatch: recorded ${String(seal.spec_sha).slice(0, 16)}… live ${live.slice(0, 16)}… — if this change is intentional and documented, re-seal via: node tools/spec_seal.mjs`);
console.log(`SPEC_GATE OK ${seal.spec_sha.slice(0, 16)}…`);
