# quilt-dba SPEC — Wave-69 Track B: Return Stick, Round 22 on Surface C

Dialect: `dba-spec/w69` · Seal: `spec/spec_sha.json` · Gate: `tools/spec_gate.mjs`
The gate speaks the repo's language (JS here, Python in cocapn); the seal
dialect `spec-sha-v1` is identical everywhere, so any repo can verify any
other repo's seal with its own tooling.

Status: PRE-REGISTERED before implementation.

## 0. Role in the fleet

quilt-dba owns durability: chain seals, crash-grade checkpoints, the rewind
journal, byte-exact recovery. Wave-69 adds **Surface C** — a bare-metal,
memory-mapped projection layer where the band law (one escalation mechanism,
three independent derivations: madlibs-jev replay ≡ purpose-loops pause ≡
reflex-router band-escalation, Round 22: 28/28 at 38% cost) is proven on a
third surface with an unmediated register interface.

## 1. Pre-registered constants

| Constant            | Value | Meaning                                              |
|---------------------|-------|------------------------------------------------------|
| CONTROL_LADDER      | 99→99→99 | the flat control rung: must stay level on every surface |
| ROUND22_TARGET_OPS  | 28    | behavioral parity target (Round 22's 28/28)           |
| ROUND22_COST_CAP    | 0.38  | escalated-run cost must not exceed 38% of baseline    |
| ENTROPY_SPLIT_BITS  | 4.0   | per-region Shannon-entropy threshold for JIT splitting |
| REGISTER_WORD_BITS  | 64    | Surface C register width (Float64Array + Uint32 tags) |
| PROJECTION_GRANULE  | 64    | mmap granule (bytes) for region mapping               |

## 2. Module layout (structural contract)

- `surfaces/surfaceC.mjs` — the memory-mapped projection layer:
  - a register file (`Float64Array` + `Uint32Array` tag words) is the
    physical substrate; `mapRegion(base, len)` hands out **unmediated**
    typed-array views (zero-copy, no accessor object in the read path);
  - no OS/kernel-abstraction objects in the hot path: reads/writes are
    direct register traffic; the projection is the documented interface;
  - snapshot/restore integrated with the existing rewind journal.
- `surfaces/controlMap.mjs` — the flat control hierarchy: every control
  cell maps to the same register bank; the 99→99→99 ladder runs across the
  surface and must land level three times (the negative control rung).
- `surfaces/jitSplit.mjs` — JIT topological splitting engine: when a
  region's Shannon entropy exceeds ENTROPY_SPLIT_BITS, the region is split
  copy-on-write and the base table is atomically re-pointed; **no thread
  locks** (single-mutator semantics: split work is incremental and
  amortised, bounded per operation; readers never block).
- `surfaces/bandLaw.mjs` — Round 22 on Surface C: the escalation-band
  mechanism (observe → band → escalate-to-burst → replay) must reach
  ROUND22_TARGET_OPS behavioral parity at ≤ ROUND22_COST_CAP relative cost,
  with the control ladder flat throughout.

## 3. Invariants

- **S1 Unmediated reads** — a mapped region read is a direct typed-array
  access; measured read path contains no per-access allocation.
- **S2 Flat control** — the 99→99→99 control ladder stays exactly level
  (99, 99, 99) on Surface C; any drift is a loud failure, never absorbed.
- **S3 Non-blocking split** — a JIT split never blocks a reader: partial
  split state is invisible (copy-on-write + atomic base-pointer swap).
- **S4 Scars survive rewind** — scars (execution-cost anomalies, die rolls,
  split events) recorded on Surface C survive rewind to any earlier
  checkpoint via the existing dba rewind journal; the scar chain re-verifies.
- **S5 Band parity** — the escalated run matches the flat run's observable
  behaviour op-for-op (28/28) at ≤ 38% cost; a band mechanism that only
  wins cost by changing behaviour is INDETERMINATE, not a pass.
- **S6 Byte-identity** — Surface C snapshot→restore round-trip is
  byte-exact, consistent with dba's crash-grade durability law (E-D4).

## 4. State-exchange pathway (sxc1)

quilt-dba is the persistent stitch: sxc1 envelopes arriving from exoj /
cocapn are appended to a chain-sealed stitch ledger (`stitches/sxc1.jsonl`),
hash-chained with the existing `shared/receipts.mjs` rowHash; a tampered or
mis-sealed envelope is refused loudly with the sender's named code preserved.

## 5. Fail-closed vocabulary

`E_SPEC_MISSING · E_SPEC_SHA_MISSING · E_SPEC_SHA_MALFORMED · E_SPEC_DIALECT ·
E_SPEC_TAMPERED · E_CONTROL_DRIFT · E_SPLIT_BLOCKED · E_BAND_PARITY ·
E_REWIND_SCAR_LOST · E_STITCH_SEAL · E_REGISTER_OVERRUN`
