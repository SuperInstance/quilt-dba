# quilt-dba — the developmental agent as a sheet

> Canon: [SuperInstance-papers/seed-proto](https://github.com/SuperInstance/SuperInstance-papers/tree/main/seed-proto)
> (seed1 DBA blueprint → seed2 quilt-native reduction → seed3 developer's guide).
> The claim under test: **the quilt engine already contains every primitive
> needed to grow an agent — nothing new at the substrate level, everything new
> at the declaration level.** This repo is that declaration, running.

## The 12-cell seed sheet (seed3 §4, integer-scaled ×1000)

| cell | primitive | what it does |
|---|---|---|
| `sensors.vision` / `sensors.proprio` | Z_in | salience 0..1000; own position |
| `world.predict` / `world.surprise` | JEPA | momentum prediction + integer L1 surprise |
| `reflex.orient` | pincher | salience > 800 ⇒ orient, no teacher, fast path |
| `policy.action` | Z_out | reflex-override → greedy + curiosity (+ teacher label when grown) |
| `ledger.gamma` / `ledger.eta` / `ledger.check` | DoubleEntry | γ = compute cost, η = surprise; **γ+η ≤ C = log₂3 ≈ 1.585 (scaled 1585)** |
| `state.stage` / `state.position` | Vibe | position accumulates only while surprise DECLINES |
| `memory.episodic` / `memory.semantic` | GC | visit ring; decayed reward estimate (0.98) |
| `teacher.feedback` / `teacher.jev_gate` | Murmur | OFFLINE rule teacher + JEV typed-decision mock (LABELED) |
| `skills.graph` | Graph | β₁ = E − V + C over the live cell graph |
| `qrc.features` | MOTH reservoir | deterministic offline stream, `live:false` |
| `conservation.test` | guard | input-driven boundary probe |

## What E-D1 found (first light)

- **R1 GROWTH: CONFIRMED** — the sheet LITERALLY GROWS: at eval 299 the
  stage-2 cells (`sensors.language`, `growth.stage`) load into the live graph
  and β₁ moves (−1 → 1). Adding cells IS advancing stages.
- **R2 JEV-GATE: CONFIRMED, with a receipted caveat** — the gated curriculum
  grows in every seed (growthAt 299); the unguided one NEVER grows (position
  10 vs 24500, rewards 4994 but no development). The gate keeps the agent in
  the zone where surprise DECLINES — reward alone is not development. Caveat:
  arms are deterministic, so cross-seed variance is vacuous by construction;
  next wave adds stochastic worlds.
- **R3 THE LAW: NEVER-BOUND in vivo at these parameters** (honest negative) —
  the cheap deterministic policy never breaches C on its own; the boundary
  test (1585 passes, 1586 refuses, exact at the scaled integers) carries the
  guarantee. The law's bite is reserved for expensive compute (teacher
  consults, growth checks) + high surprise.
- **R5 REPLAY: BYTE-IDENTICAL** from a mid-run checkpoint.

## Honest holes filled (the seeds don't specify these)

γ/η computations (γ = 100 + 150·consults; η = surprise; additive; scaled ×1000),
stage-position units (gain/50 clamped 0..10), JEV mock calibration
(p = 0.5+0.5·tanh((success−0.75)·8), thresholds 0.95/0.70), the task set
(4 layouts of rising spread), and the determinism caveat above.

## Run

```
npm install
node experiments/smoke.mjs        # 13/13
node experiments/e_d1_stages.mjs  # receipted, chain-verified
```
