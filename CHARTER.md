# CHARTER — quilt-dba

**Charter:** build the quilt-native developmental agent of the seed-proto spec:
an AI agent that *is* a Quilt sheet; development is reactive evaluation;
checkpointing is `git commit`; teacher feedback is an (offline, this session)
Murmur cell; alignment is the conservation law γ + η ≤ C = log₂(3) ≈ 1.585
enforced by the engine — not a policy the agent negotiates.

**Canon pointer:** `github.com/SuperInstance/SuperInstance-papers/tree/main/seed-proto`
— the seed-agent spec (§2 eight primitives, §3 conservation law, §4 agent-as-sheet
12-cell declaration, §5 developmental loop + checkpointing-as-git). Local mirror
of the spec used by this lane: `fleet-seeds/seeds/seed3.md` §2–5.

**Scope of this repo:** the seed sheet declaration (`dba/sheet.mjs`), the
world driver (`dba/driver.mjs`), the vendored engine (`engine/`, byte-identical
copy of `quilt-quant/engine`), the E-D1 developmental experiment, smoke checks,
and the receipt chain. It does NOT modify any other repo; it imports nothing
across repos (the murmur receipt + moth vault idioms are copied out verbatim
into `shared/`, labeled).

## Holes in the canon this repo filled (receipted in-chain)

The canon declares roles and the law; it does not declare units, cadences, or
the concrete γ/η of a forage-stage agent. Filled here, each receipted in
`experiments/outputs/receipts_ed1.jsonl` row `run.config` and in `README.md`:

1. position units + the stage-1 scaling (growth at ~3.7–4.2k evals, within the
   ≤20k bar, after the first curriculum intervention) — the brief's named
   spec hole;
2. γ action-class costs (stay/orient/move/curiosity = 100/150/250/450 x1000);
3. η = JEPA squared prediction error of the last observed transition, checked
   against the proposed action's γ; observation and model-learning ungated;
4. refusal semantics (effective action = stay, receipted by kind, prior state
   kept — no memory append, no vibe ratchet);
5. wall-aware BFS reward-gradient sensor (Manhattan bearing + naive descent
   both break foraging — found, fixed, receipted);
6. velocity = EWMA(2/100) of surprise improvement; ratchet on allowed
   transitions only;
7. curiosity gate (η_ewma > 300) with conservation-headroom throttle;
8. JEV mock calibration v2 (top-choice weighted score as confidence — the
   normalized share is a degenerate gate at 5 tasks);
9. cadences: JEV 100, escalate tenure 300, arm-D random switch 600, QRC every 4;
10. forage world constants (16×16, 5 tasks, respawn-on-eat);
11. fixed-point doctrine details: everything decision-feeding is an integer
    (x1000); floats only in labeled-mock display fields;
12. dead-lane draft defect fixes (JEPA action conditioning, duplicate respawn,
    learning_progress write-back, sensors.language in checkpoint state).

## Non-negotiables honored this session

- plain node, deps `yaml` only; **no external APIs** (MOTH vault offline;
  every quantum read labeled `live:false, mock:true`; REAL bytes only from the
  two cached packets, digests receipted);
- the teacher is a deterministic offline rule labeled `teacher:offline-rule`
  — **no LLM this session**;
- conservation enforcement is refusal + receipt + prior-state-keep, never a
  warning;
- determinism: single `env.rng` cell (mulberry32 u32) for all world
  stochasticity; byte-identical replay from checkpoints (verified);
- other repos untouched; engine copied, not imported.
