# Weight Compensation Design

**Project:** Baby Milk Tracker / MilkWise  
**Author:** Kit  
**Date:** 2026-06-15  
**Last updated:** 2026-07-25  
**Status:** Implemented ✅

---

## 1. Problem Statement

The daily milk target is computed as:

```
dailyTargetMl = effectiveWeightKg × mlPerKgPerDay
```

As the baby gains weight, her nutritional need grows. Without automatic weight tracking, the target stays fixed unless a parent manually updates it — leading to systematic underestimation. Every status number (smoothed %, strict 24h %, next feed time, best bottle size) will trend toward "overfed" even when the baby is on track.

The solution is to use the baby's weight history to estimate her current weight automatically, and to derive the effective target from that estimate rather than a frozen value.

**Key constraint:** All derived numbers are computed on every page load. Nothing new is stored in the database as a result. The weight history (`weights.json`) is the only input.

---

## 2. Implemented Architecture

### 2.1 Growth model — WHO LMS z-score

The app uses the **WHO Child Growth Standards (2006)**, implemented as the LMS method in `src/lib/whoGrowth.ts`.

**Algorithm:**

1. Compute a z-score for each weight entry: `Z = [(X/M)^L − 1] / (L × S)` where L, M, S are the WHO parameters interpolated from the published table at the baby's age in months.
2. Average all z-scores to estimate the baby's **z-channel** — her individual growth percentile.
3. Project forward to today: `predictedWeight = M(today) × (1 + L(today) × S(today) × Z_mean)^(1/L(today))`

**Inputs required:** `dateOfBirthMs` and `sex` in `settings.json` (both optional; WHO prediction is skipped if missing).

### 2.2 7-day short-circuit rule

When the latest weight entry is **≤ 7 days old**, the measured weight is used directly — the WHO projection is skipped entirely.

**Reason:** The z-channel is an average over all historical measurements. If older entries put the baby at a higher z than the latest measurement, the projection can overshoot a freshly measured weight (e.g. showing 7.62 kg when 7.5 kg was measured yesterday). A recent measurement is always more accurate than a model projection.

The WHO model only runs when the most recent weigh-in is more than 7 days in the past.

```typescript
// page.tsx — effective weight derivation
const latestWeight = [...weights].sort((a, b) => b.timestamp - a.timestamp)[0];
const daysSinceLastWeigh = (startOfToday - latestWeight.timestamp) / 86_400_000;

if (daysSinceLastWeigh <= 7) {
  effectiveWeightKg = latestWeight.weightKg;   // use measured weight directly
  weightSource = 'manual';
} else {
  const predicted = predictWeightKg(weights, dateOfBirthMs, sex, startOfToday);
  if (predicted !== null) {
    effectiveWeightKg = predicted;
    weightSource = 'predicted';
  }
}
```

### 2.3 Day-boundary snap

The effective weight is computed once at `startOfToday` (midnight) and stays constant for the rest of the day. This keeps the daily target stable — it only steps up when you cross into a new day.

### 2.4 Display label

The dashboard header shows `7.50 kg` (no label) when using a recent measurement, or `7.62 kg (est.)` when using the WHO projection.

### 2.5 Analytics — WHO reference curves

The Analytics weight chart renders the baby's measured weights overlaid on WHO z-score reference curves (±2σ, ±1σ, median) for her age and sex, using `whoReferenceCurves()` from `whoGrowth.ts`.

---

## 3. What Was Not Built (from original plan)

| Original plan | Decision |
|---------------|----------|
| Jenss-Bayley growth model | Dropped — WHO LMS is more rigorous and already clinically validated for 0–24 months |
| `lib/weightGrowth.ts` | Never created — WHO logic lives in `lib/whoGrowth.ts` |
| Separate `/onboarding` route | Not built — baby profile (DOB + sex) is collected via an inline modal on the dashboard when `dateOfBirthMs` or `sex` is missing |
| Onboarding weight-entry gate | Not enforced — `weights.length === 0` falls back to `settings.weightKg` rather than blocking the dashboard |

---

## 4. targetMlPerDay — Removed

Historical feeds in `feeds.json` may still carry a `targetMlPerDay` field. This was written by `log/page.tsx` in earlier versions as a snapshot of `settings.weightKg × mlPerKgPerDay` at log time.

**As of v1.1.38 (2026-07-25), this field is no longer written.** The target at any past time is derivable from `weights.json` using `dailyTargetAtTime(t, weights, mlPerKgPerDay)`. The `migrateTargetStamps()` function and all reads of `targetMlPerDay` have been removed from the codebase.

Old entries in `feeds.json` that still carry the field are silently ignored at read time.

---

## 5. Files

| File | Role |
|------|------|
| `src/lib/whoGrowth.ts` | WHO LMS tables, z-score computation, weight prediction, reference curve generation |
| `src/app/page.tsx` | 7-day short-circuit + WHO prediction; derives `effectiveWeightKg` and `effectiveDailyTargetMl` |
| `src/lib/weights.ts` | `weightAtTime()` (step-function lookup for historical targets in trend graph), `dailyTargetAtTime()` |
| `src/app/analytics/page.tsx` | `WeightChart` component with WHO reference curves overlay |

---

## 6. Open Items

- `trendGraph.ts` uses `weightAtTime()` (step function — last observed weight) for historical daily targets. This is acceptable given sparse weigh-in frequency but could be upgraded to use WHO interpolation for smoother retrospective target lines.
- No weight-entry gate exists. If `weights.json` is empty and `settings.weightKg` is at its default, target calculations will use the stale default weight until the parent logs a weigh-in.
- The inline baby-profile modal does not surface until the parent navigates past the "baby profile needed" check on the dashboard. If `dateOfBirthMs` and `sex` are both set, the modal never shows — which is correct.
