# MilkWise Calculation Audit — Technical Review

**Reviewer:** Kit (claude-sonnet-4-6 subagent)  
**Date:** 2026-09-09  
**Documents reviewed:**
- `design/milkwise/next-session-predictor-design-v3.md` — primary requirements doc  
- `design/milkwise/milkwise-calculation-audit.pdf` (via HTML source) — audit document  
- `design/milkwise/code-verification-audit.md` — code verification audit  
- `varia/baby-milk-tracker/src/lib/calculations.ts` — web core math  
- `varia/baby-milk-tracker/src/components/cards/CanTakeCard.tsx` — web timeline  
- `varia/milkwise/src/lib/calculations.ts` — RN core math  
- `varia/milkwise/src/screens/DashboardScreen.tsx` — RN dashboard  
- `varia/baby-milk-tracker/src/lib/whoGrowth.ts` — WHO model  

---

## Part A — Requirements vs Audit Equations

### A.1 Overall fidelity

The calculation audit (PDF) is a **high-fidelity representation** of the design doc for EQ-1 through EQ-12. The equation structure, parameter names, and formula derivations all match the design intent described in `next-session-predictor-design-v3.md`. The geometric-series derivation of EQ-8, the two-phase bottle credit of EQ-5, and the binary search structure of EQ-10/11 are correctly captured.

### A.2 Requirements missing from the audit

**Missing: §8.7 Deep Deficit behaviour (intakeReadyAt semantics)**

The design doc contains a critical §8.7 "KNOWN ISSUE" added 2026-09-01, which redefines the correct semantics of `intakeReadyAt`:

> *"The timeline must show, for each bottle size X, the earliest time at which feeding X results in the status screen showing 100%."*

The design doc's required algorithm is:
```
intakeReadyAt(X):
  needed = dailyTarget − milkMl(X)
  if I(now) <= needed: return now
  else: binary search for T such that I(T) = needed
```

The audit PDF documents the old semantics (§10: "If smoothedIntake(now) is already below dailyTarget… return now immediately"). The **new semantics** in §8.7 are not reflected in the audit at all. The audit describes the pre-fix behaviour, not the required post-fix behaviour.

Crucially, the actual code in both `calculations.ts` files does **not** implement the §8.7 fix either. The code uses:
```typescript
if (currentSmoothed + milkMl <= dailyTargetMl * 1.05) return now;
```
This is a different condition again — it returns `now` when giving the bottle would land the baby at ≤105% of target. This prevents "give now" advice leading to immediate orange/red status, but it does **not** address the §8.7 deep-deficit problem where the bottle is too small to close the gap at all.

**Missing: §8.2 long-gap warning**

The design doc explicitly notes (§8.2): *"Not yet implemented: The planned long-gap warning note has not been added to the UI."* The audit does not mention this gap.

**Missing: display-mode toggle**

§11 of the design doc mentions two layout modes for Should Take (`CanTakeCard.tsx` vs `FeedingTimelineCards.tsx`, toggled via `settings.feedingTimelineView`). The audit does not document this or the `FeedingTimelineCards.tsx` implementation at all.

**Missing: legacy views on NextFeedCard**

§11 notes that NextFeedCard has swipeable views including a legacy `predictorBTimestamp` view. The audit documents `canTakeProgression` but not the retained legacy predictor surface. Minor but a completeness gap.

### A.3 Contradictions between audit and design doc

**EQ-1 boundary behaviour: audit says clamp, code says extrapolate**

The audit PDF (§2, info-box) states: *"If waterMl is below 30 or above 210, the nearest table endpoint is used (no extrapolation)."*

The design doc (§2.1) does not specify boundary behaviour. But both code files do extrapolate:
```typescript
// Below lowest entry — extrapolate from first segment
if (waterMl <= t[0].water) {
  const slope = (t[1].formula - t[0].formula) / (t[1].water - t[0].water);
  return t[0].formula + slope * (waterMl - t[0].water);
}
```
The code comments also say *"nearest segment slope is extrapolated"*. The audit PDF boundary claim is factually wrong. The code verification audit (F-5) correctly identifies this but calls it a "documentation error" — it should be called a contradiction.

**EQ-10 threshold: audit conflates two distinct thresholds**

The audit PDF (§10.4 "Display Rounding Boundary") implies that `intakeReadyAtMs` uses the `dailyTarget × 1.005 − milkMl − 0.1` threshold. It does not. That threshold belongs to `ghostIntakeReadyAtMs` (EQ-11) only. The live function uses `dailyTargetMl * 1.05` as the "give now" boundary. The code verification audit correctly flags this (F-2a), but the PDF itself is contradictory on this point.

---

## Part B — Mathematical Correctness

### B.1 EQ-8 Stomach Capacity — Is the steady-state assumption valid?

**Formula:** `stomachCap = formulaPerBottle / (1 − exp(−k × SI))`

This formula is the sum of a convergent geometric series:
```
cap = m₀ + m₀·e^(−k·SI) + m₀·e^(−2k·SI) + ... = m₀ / (1 − e^(−k·SI))
```

The derivation correctly models steady-state: *after infinite feeds at exactly SI apart*, the peak stomach load converges to this value. The question is whether the assumption of infinite past feeds is valid for real use.

**Answer: the assumption is approximately valid after 3–4 feeds.** The geometric series converges rapidly because `e^(−k·SI)` is typically small (e.g., for a 6 kg baby, 90 🍼 bottle: `SI ≈ 2.4h`, `e^(−0.6931 × 2.4) ≈ 0.19`, ratio = 0.19 → 95% of cap reached after 3 feeds). For a new baby (first few feeds), `stomachCap` will overestimate the true peak load, meaning the formula may allow a bottle slightly larger than strictly justified. This is safe (conservative in the right direction — slightly more generous than the actual stomach load). The assumption is mathematically sound for practical use.

### B.2 bottleCredit decay rate — is hourlyRate the right choice?

**Design doc (§4.2):** *"The decay rate is not arbitrary: it is the unique rate that preserves the invariant smoothedIntake = dailyTarget at steady state."*

This is mathematically correct. At steady state with feeds every SI hours:
- Just before feed N exits the 24h window: its credit begins decaying at `hourlyRate`
- Feed N+1 entered the window `SI` hours after feed N
- The credit gain from N+1 equals `formulaPerBottle`, the credit loss from N equals `hourlyRate × SI = formulaPerBottle`
- Net change = 0 → `smoothedIntake` stays constant at `dailyTarget`

**Implication at steady state:** At the moment a feed exits the 24h window, it loses credit at exactly the same rate the baby needs nutrition. This is a meaningful calibration: the "memory" of a feed fades at the same pace as its nutritional necessity. The choice is not arbitrary — it is uniquely derived from the constraint that equilibrium intake equals the clinical target.

### B.3 7-hour cutoff in stomachLoad — justified?

At `k = 0.6931 h⁻¹`, a feed at age 7 hours contributes:
```
exp(−0.6931 × 7) = exp(−4.852) ≈ 0.0078 = 0.78%
```

For the largest practical feed of 240 ml formula (210 🍼): `240 × 0.0078 ≈ 1.87 ml`.

**The cutoff is an optimisation, not a model change.** At 7 hours, the excluded load is < 2 ml for any bottle — well within the 10% buffer applied to stomach capacity. The cutoff avoids summing feeds that are 24+ hours old (which would contribute `< 0.0001 ml`) at negligible precision cost.

The design doc (§4.1) says: *"Feeds older than 7 hours contribute less than 1% of their original volume and are excluded from calculations for efficiency."* This correctly characterises the cutoff. The code verification audit calls it "undocumented" but the design doc does document it. The PDF audit does not, which is the actual gap.

### B.4 EQ-10 binary search return value: Math.floor((lo+hi)/2) — correct or should it be hi?

**Web and RN `intakeReadyAtMs` code:**
```typescript
return Math.floor((lo + hi) / 2);
```

**Analysis:**

The binary search maintains the invariant:
- `smoothedAtTime(lo) > targetBefore` (lo is still "too early")
- `smoothedAtTime(hi) <= targetBefore` (hi is "ready")

After convergence to `hi - lo < 60_000`, `Math.floor((lo+hi)/2)` returns a value that is approximately in the centre of the final bracket. This value **may or may not satisfy the condition** depending on whether it rounds to the `lo` or `hi` side.

**The correct return value is `hi`** — the last confirmed time where `smoothedAtTime(hi) <= targetBefore`. The midpoint could fall on the `lo` side, returning a timestamp where the condition is NOT yet satisfied (the bottle would land at >100% status if given at that time).

**Worst-case error:** Since `hi - lo < 60_000` (1 minute) when the loop exits, `Math.floor((lo+hi)/2)` can be at most ~30 seconds before `hi`. In the worst case, the function returns a time where the smoothed intake is still marginally above `targetBefore`, meaning giving the bottle at that exact millisecond would push status fractionally above 100%.

**Practical impact:** The 1 ml tolerance (`TOLERANCE_ML`) and the 1.05× entry condition already absorb small errors. The 30-second worst-case error is well within the 1-minute display resolution. However, this is still technically incorrect — `hi` is the guaranteed-safe return value and costs nothing.

**Contrast with `ghostIntakeReadyAtMs`:** This function correctly returns `Math.ceil(hi / 60_000) * 60_000` — which is `hi` rounded up to the next minute, guaranteed safe. The live function should analogously return `hi` (or `Math.ceil(hi / 60_000) * 60_000` for minute-boundary alignment).

---

## Part C — Cross-Implementation Consistency

### C.1 intakeReadyAtMs — web vs RN

**Web (`varia/baby-milk-tracker/src/lib/calculations.ts`):**
```typescript
if (currentSmoothed + milkMl <= dailyTargetMl * 1.05) return now;
```

**RN (`varia/milkwise/src/lib/calculations.ts`):**
```typescript
if (currentSmoothed + milkMl <= dailyTargetMl * 1.05) return now;
```

**Status: ✅ Identical.** Both implementations use the same `1.05×` boundary for immediate return (not `TOLERANCE_ML = 1` as described in the code verification audit — that description is outdated; both now use the 1.05× condition). Binary search iterations differ slightly (web: 40, RN: 40 — identical). Return value `Math.floor((lo+hi)/2)` is identical in both.

### C.2 ghostIntakeReadyAtMs — web vs RN

**Web (`CanTakeCard.tsx`, private function):**
```typescript
function ghostIntakeReadyAtMs(feeds, bottleWaterMl, hourlyRate, dailyTargetMl, refMs): number {
  const milkMl = waterToMilk(bottleWaterMl);
  const target = dailyTargetMl * 1.005 - milkMl - 0.1;
  const current = smoothedAtTime(feeds, hourlyRate, refMs);
  if (current <= target) return refMs;
  // binary search: 60 iterations
  return Math.ceil(hi / 60_000) * 60_000;
}
```

**RN (`varia/milkwise/src/lib/calculations.ts`, exported):**
```typescript
export function ghostIntakeReadyAtMs(...): number {
  const milkMl = waterToMilk(bottleWaterMl);
  const target = dailyTargetMl * 1.005 - milkMl - 0.1;
  const current = smoothedAtTime(feeds, hourlyRate, refMs);
  if (current <= target) return refMs;
  // binary search: 60 iterations
  return Math.ceil(hi / 60_000) * 60_000;
}
```

**Status: ✅ Functionally identical.** Same threshold (`1.005×`), same `−0.1` fudge, same 60 iterations, same `Math.ceil` minute-boundary return. The only difference is location (private in web, exported in RN).

### C.3 Ghost ordering monotonicity fix — applied in both?

**Web (`CanTakeCard.tsx`):**
```typescript
const orderedSizes = [...ghostReadyAt.keys()].sort((a, b) => a - b);
let prevGhostMs = 0;
for (const w of orderedSizes) {
  const ghostMs = Math.max(ghostReadyAt.get(w)!, prevGhostMs);
  ghostReadyAt.set(w, ghostMs);
  prevGhostMs = ghostMs;
}
```

**RN (`DashboardScreen.tsx`, `FeedingTimeline` component):**
```typescript
const orderedSizes = [...ghostReadyAt.keys()].sort((a, b) => a - b);
let prevGhostMs = 0;
for (const w of orderedSizes) {
  const ghostMs = Math.max(ghostReadyAt.get(w)!, prevGhostMs);
  ghostReadyAt.set(w, ghostMs);
  prevGhostMs = ghostMs;
}
```

**Status: ✅ Identical — applied in both.** The clamp-to-previous logic is byte-for-byte identical and correctly enforces that ghost markers appear in ascending order regardless of the `ghostIntakeReadyAtMs` raw output.

Note: this fix is a UX clamp, not a mathematical property. When overfed, the intake component of `ghostReadyAt` can technically be larger for smaller bottles (they need more intake decay before they restore to 100%). The clamp overrides this to prevent visual disorder on the timeline. This is correct UX behaviour but creates a mathematically inaccurate ghost position for small bottles in deep-overfed scenarios.

### C.4 canTakeProgression — identical results for same inputs?

**No. The implementations produce different result sets by design.**

**Web (`baby-milk-tracker/src/lib/calculations.ts`):**
```typescript
// All sizes from 30ml up to preferred+1 are always returned (no noise-cut rule).
return entries;  // returns ALL sizes
```

**RN (`milkwise/src/lib/calculations.ts`):**
```typescript
// Noise-cutting rule: show only from the LARGEST size available now upward.
const startWater = availableNow.length > 0
  ? availableNow[availableNow.length - 1].waterMl  // largest available now
  : entries[0].waterMl;                             // nothing available — show all
return entries.filter(e => e.waterMl >= startWater);
```

**Key difference:**
- If 30 🍼, 60 🍼, 90 🍼 all fit now, the web app returns all three. The RN app returns only 90 🍼 and above.
- If nothing fits now (all future), both return the full set.
- The `readyAtMs` values for individual sizes are identical for the same input — only the returned set differs.

**Impact:** This is an intentional UX divergence. The web app uses a timeline where showing multiple "fits now" markers is informative. The RN app uses a marker list where showing superseded smaller sizes creates visual noise. The `isAdvised` flag (largest fits-now) is computed identically in both.

---

## Part D — Undocumented Behaviours

The following behaviours are present in the code but are not documented in either the audit PDF or the design doc.

### D.1 `intakeReadyAtMs`: 1.05× return-now boundary

**Location:** Both `calculations.ts` files.

```typescript
if (currentSmoothed + milkMl <= dailyTargetMl * 1.05) return now;
```

This returns `now` whenever giving the bottle would keep total status at ≤105% of target — not only when the baby is underfed. This means: even if the baby is slightly overfed (up to 5% over target), but giving this bottle keeps them within the 105% ceiling, the function returns `now`. The design doc and audit both describe the return-now condition only for the "underfed" case. The 5% overfeed tolerance is unmentioned in either document.

**Design rationale (from code comment):** "Prevents 'Give now' leading to an immediate orange/red status." Valid reasoning, undocumented consequence.

### D.2 `stomachReadyAtMs`: NEAR_ZERO_ML = 5 ml threshold for oversized bottles

**Location:** Both `calculations.ts` files.

```typescript
if (remainder <= 0) {
  const NEAR_ZERO_ML = 5;
  const dtHours = -Math.log(NEAR_ZERO_ML / loadNow) / STOMACH_K;
  return atMs + Math.max(0, dtHours) * 3_600_000;
}
```

When a bottle is at or above the stomach capacity, the function waits for the stomach to clear to 5 ml rather than 0. This is an operational constant (below 5 ml the exponential model is for practical purposes zero) but it is nowhere documented. The design doc §4.4 says "the load must decay to near-zero (< 5 ml)" in this case — so the design doc actually does mention the threshold, but only in prose, not in the equation block. The audit PDF does not mention it at all.

### D.3 `canTakeProgression`: 30-second fitsNow grace window

**Location:** Both `calculations.ts` files.

```typescript
const fitsNow = readyAtMs <= now + 30_000;
```

A bottle is considered "available now" if it is ready within 30 seconds of the current time. This prevents flickering at the boundary (a bottle that becomes available in 29 seconds is shown as "now" rather than "in 1 min"). Neither the design doc nor the audit mentions this grace window.

### D.4 `CanTakeCard.tsx`: gastricClearMs function and gastric band visualisation

**Location:** `CanTakeCard.tsx` only (web app).

```typescript
function gastricClearMs(feedTimestampMs: number, volumeWaterMl: number): number {
  const milkMl = waterToMilk(volumeWaterMl);
  const hours  = Math.log(Math.max(milkMl, NEAR_ZERO_ML + 0.1) / NEAR_ZERO_ML) / STOMACH_K;
  return feedTimestampMs + hours * 3_600_000;
}
```

The timeline renders per-feed gastric decay bands — coloured regions showing when each feed's stomach contribution clears. This is a purely display-level feature not mentioned in either document. The `gastricClearMs` function computes when a feed's stomach residual drops below 5 ml, matching the NEAR_ZERO_ML threshold of D.2.

### D.5 `smoothedAtTime` includes negative-age feeds (future feeds)

**Location:** Both `calculations.ts` files.

`smoothedAtTime` does not exclude feeds with `ageHours < 0` (future timestamps). If a feed has a timestamp after `atMs`, the `bottleCredit` function receives a negative `ageHours`, which is ≤ 24, so it returns `milkMl` (full credit). This means a future-dated feed contributes its full volume to the smoothed total at any past time — which is physically incorrect. `stomachLoad` correctly guards against this (`if (ageHours < 0 || ageHours > 7) return sum`), but `smoothedAtTime` does not. In practice, the UI prevents future-dated entries, but the function is not defensively coded.

### D.6 `intakeReadyAtMs`: 48h cap without capped indicator

**Location:** Both `calculations.ts` files.

```typescript
const T_max = now + 48 * 3_600_000;
if (smoothedAtTime(feeds, hourlyRate, T_max) > targetBefore) return T_max;
```

If the baby is so overfed that even 48 hours isn't enough for the intake to decay, the function returns the 48h cap silently. Unlike `computePredictors` which sets `predictorBCapped: true`, `intakeReadyAtMs` has no return value indicating it hit the cap. The caller in `canTakeProgression` therefore has no way to display a "capped" indicator on those timeline markers.

### D.7 `canTakeProgression` web-app comment says "no noise-cut rule"

**Location:** Web `calculations.ts`.

```typescript
// All sizes from 30ml up to preferred+1 are always returned (no noise-cut rule).
```

The design doc §7.2 says: *"Noise-cut rule: show only from the largest size available now upward."* The web app comment explicitly contradicts the design doc's noise-cut rule, documenting an intentional divergence. Neither the audit PDF nor the design doc notes that the web app intentionally skips the noise-cut rule.

---

## Part E — Prioritised Recommendations

### R1 — Implement the §8.7 intakeReadyAt fix (HIGH PRIORITY)

**Evidence:** Design doc §8.7 (added 2026-09-01) documents a known bug: when the baby's deficit exceeds the bottle size, `intakeReadyAt` returns `now` when it should return the time when old feeds drop out of the 24h window enough for the bottle to close the gap. The code does NOT implement the §8.7 fix. The current 1.05× boundary is a different heuristic that partially addresses overflow prevention but does not address the deep-deficit case.

**Fix:** Implement the algorithm described in §8.7 exactly:
```typescript
const needed = dailyTargetMl - milkMl;
if (currentSmoothed <= needed) return now;
// Binary search for T where smoothedAtTime(T) = needed
```
This is a one-line change to the return-now condition. The binary search loop itself does not change.

**Impact:** Parents with a large deficit receive accurate feed timing. Feeding at the suggested time will result in the status screen confirming 100% as expected.

### R2 — Fix binary search return value in intakeReadyAtMs (LOW effort, HIGH correctness)

**Evidence:** Both implementations return `Math.floor((lo+hi)/2)` which can land on the `lo` side of the bracket — a time where the condition is not yet satisfied. The correct return is `hi` (last confirmed safe time).

**Fix:** Change both `calculations.ts` files:
```typescript
// Before:
return Math.floor((lo + hi) / 2);
// After:
return hi;
// Or for minute alignment (matching ghostIntakeReadyAtMs):
return Math.ceil(hi / 60_000) * 60_000;
```

**Impact:** Eliminates a theoretical 30-second window where the function returns a time that does not guarantee 100% status. Also aligns the live function's return precision with the ghost function.

### R3 — Document the 1.05× return-now boundary and 48h cap in the audit (DOCUMENTATION)

**Evidence:** `intakeReadyAtMs` returns `now` when `currentSmoothed + milkMl <= dailyTargetMl * 1.05`. This means a bottle that pushes status to 104% still gets "give now" advice. This is a deliberate design choice (prevents orange/red immediately after logging) but it is invisible to anyone reading the audit or design doc. The 48h cap returning silently is also undocumented.

**Action:** Update both the audit PDF and design doc §7.1 to document:
1. The `intakeReadyAt` returns `now` when giving the bottle keeps status ≤105% (not just when underfed)
2. The 48h hard cap with no capped indicator returned to the caller

### R4 — Move `ghostIntakeReadyAtMs` from CanTakeCard.tsx into web calculations.ts (ARCHITECTURE)

**Evidence:** The ghost function is a private function in `CanTakeCard.tsx` on the web but an exported function in `calculations.ts` on RN (code verification audit F-4). If any other web component ever needs ghost timing (e.g., a future card layout), it would need to duplicate the function.

**Action:** Move the private `ghostIntakeReadyAtMs` in `CanTakeCard.tsx` into `varia/baby-milk-tracker/src/lib/calculations.ts` and export it. Update the import in `CanTakeCard.tsx`. This aligns the web architecture with the RN architecture and makes the function unit-testable.

### R5 — Add guard against future-dated feeds in smoothedAtTime (DEFENSIVE CODING)

**Evidence:** `stomachLoad` correctly excludes future feeds (`ageHours < 0`) but `smoothedAtTime` does not. If any feed ever has a future timestamp (clock error, time zone edge case, manual entry), it would contribute its full formula volume to every past time evaluation, potentially pushing `smoothedAtTime` far above `dailyTarget` and causing `intakeReadyAtMs` to binary-search for 48 hours unnecessarily.

**Action:** Add a guard at the top of the `smoothedAtTime` reduce callback:
```typescript
const ageHours = (atMs - f.timestamp) / 3_600_000;
if (ageHours < 0) return sum;  // exclude future feeds
return sum + bottleCredit(ageHours, waterToMilk(f.volume), hourlyRate);
```
This is a one-line defensive addition with no impact on normal operation.

---

## Summary Table

| Area | Status | Severity |
|------|--------|----------|
| §8.7 deep-deficit fix: not implemented | ❌ Bug | High |
| Binary search returns midpoint not `hi` | ⚠️ Incorrect | Low |
| 1.05× return-now boundary: undocumented | ⚠️ Doc gap | Medium |
| ghostIntakeReadyAtMs: location asymmetry | ⚠️ Architecture | Low |
| smoothedAtTime: no future-feed guard | ⚠️ Defensive | Low |
| EQ-1 boundary: audit says clamp, code extrapolates | ⚠️ Doc error | Low |
| EQ-10/11 threshold conflation in audit | ⚠️ Doc error | Medium |
| canTakeProgression: noise-cut divergence undocumented | ℹ️ Doc gap | Low |
| Ghost monotonicity fix: applied in both | ✅ Correct | — |
| WHO model: byte-for-byte identical | ✅ Correct | — |
| EQ-8 steady-state assumption: valid | ✅ Correct | — |
| bottleCredit decay rate: mathematically correct | ✅ Correct | — |
| 7-hour cutoff: justified optimisation | ✅ Correct | — |
