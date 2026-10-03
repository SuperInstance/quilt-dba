# ANTI-ENTROPY LOG — quilt-dba

Append-only. Every fault found is recorded when found and again when fixed.
The log IS the repair receipt. (Wave-69 standing rule: anti-entropy logging.)

## F1 — no CI at all (found wave-69)

- Fault: the repo with the fleet's crash-grade durability claims had no
  GitHub Actions workflow. The smoke battery ran only when a lane remembered
  to run it locally; a push could silently break the durability law.
- Fix: `.github/workflows/ci.yml` — spec gate → `node --test tests/` (new
  wave-69 unit battery; the network-dependent smoke stays local, receipted,
  and is NOT the CI gate because CI must not depend on external services).

## F2 — test script absent (found wave-69)

- Fault: package.json scripts referenced experiments only; no `test`.
- Fix: `"test": "node --test tests/*.test.mjs"` added; `tests/` created with
  the wave-69 Surface C battery (offline, deterministic, no secrets).

## F3 — no specification-first layout (found wave-69)

- Fault: no spec/; durability invariants lived in commit messages and
  experiment receipts (admirable, but not gate-checked).
- Fix: `spec/SPEC.md` pre-registering Wave-69 Track B (Surface C: constants,
  module layout, invariants S1–S6, stitch pathway), sealed + gated.
