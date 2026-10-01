# Referral — predictive-paddle v3: the pinning failure this sheet avoids by construction

**Status: CANDIDATE referral edge** (weight law: VERIFIED=1.0 only when a merged
PR in the target repo cites it; this PR is the citation attempt, merge-gated).

## The measured failure (source lane, closed at honest FAIL)

`SuperInstance/quilt-arcade`, branch `predictive-paddle-cx-attractor`, PR #6 —
`experiments/predictive_paddle_v3.FINDINGS.md` (sealed FAIL, third strike, lane
closed). A fruitfly-CX ring attractor ported as runtime-defined `sense.*` cells,
driven by exact, sparse event cues (serves/walls/returns ~30–70 wall-ticks apart):

- Per-event certainty aging `A_eff = A·0.98^Δ` with Δ = updates-since-event = 1–4
  per approach phase. Commits monotonically pin A→1 within ~15 commits; rejects
  halve A but commits re-raise within 1–2 events. Nothing pulls it back.
- Pull gate `w = max(0.15, min(0.85, err/30))·(1−A_eff)` → w ≈ 0.003–0.05 → the
  ring **freezes ~15 units from truth** (between mean_err 15.23) across a 50-match
  census. H1 20.8% FAIL, advisory arm net-negative (72% < 86% control).
- Mechanism class: **a self-referential gate throttles exactly when cues are exact
  and sparse** — the gate's assumptions (dense noisy events) are the port casualty.

## What this supports here (verified by direct read of dba/sheet.mjs, dba/core.mjs, dba/driver.mjs)

This sheet's estimation contract avoids every leg of that failure by construction:

1. `world.surprise` is a **pure per-eval function** of live state
   (`|p−s|·250 + reward_miss·500`) — statelessly recomputed each evaluation, no
   persistent accumulator is ever gated, so nothing can pin.
2. `state.stage` gain `max(0, prev−cur)` is **additive and clamped [0,10]/eval** —
   no multiplicative certainty factor throttles position updates.
3. `memory.decayTick` ages semantic memory on the **driver-owned eval counter**
   (`driver.mjs` loop index) — checkpointed with `run.meta.evalIndex`, never reset
   mid-run, and exactly rewind-invertible per E-D4 (`rewind.mjs` marks it COMPUTED).

The v3 receipt is therefore supporting evidence *for* this contract: exact-cue
sparse sensors plus any event-gated multiplicative certainty → freeze (measured,
receipted); per-eval stateless surprise plus bounded additive gain → no attractor
to freeze. Convergent with reverse-actualization wave-79 (same-model loops keep
their attractor) and GPU-EXPERIMENTS rule 5 (controls must vary by a different path).

## Boundary note (honest, for future sheets)

The v2 infrastructure twin of the pinning defect is a **counter that RESETS while
persistent cells persist** (their `tick.count` was reset by `new_game` while
`sense.*` cells persisted → A_eff ≈ e^(T/50) → 1e44 explosion). No dba counter
resets mid-run today (`evalIndex`/`decayTick` are driver-owned and
checkpoint-consistent). If episode or task resets are ever added, keep any
resettable counter out of persistent-cell aging — age by a driver-owned clock or
statelessly per eval, as this sheet already does.
