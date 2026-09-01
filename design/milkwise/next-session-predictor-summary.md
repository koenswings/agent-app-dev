# Next Feeding Session Predictor — Design Summary

**Document:** next-session-predictor-design-v2  
**Status:** ~~Draft (2026-06-09)~~ **ARCHIVED 2026-07-25** | **Authors:** Kit + Koen

> ⚠️ **This document is archived.** It describes Predictors 1/2/3 and the v2 design, which have been superseded by the v3 predictor architecture ("Next Feed" + "Should Take" cards). See `next-session-predictor-design-v3.md` for the current design.

---

## Core Energy Model

- **Unit:** Prepared milk ml (water ml × conversion factor, e.g. 90 ml water → 100 ml milk)
- **Daily target:** `weightKg × 150 ml/kg/day`
- **Hourly drain rate:** `dailyTarget / 24`
- **Milk balance:** tracks cumulative intake minus continuous drain — target is balance = 0

### Water → Prepared Milk Conversion

| Water ml | Prepared milk ml |
|----------|-----------------|
| 30 | 35 |
| 60 | 70 |
| 90 | 100 |
| 120 | 135 |
| 150 | 170 |
| 180 | 200 |
| 210 | 240 |

### Smoothed vs Strict 24h Tracking

- **Strict:** sums only feeds within the last 24h — drops abruptly when a feed crosses the boundary
- **Smoothed:** feeds past 24h retain decaying partial credit → much smoother curve; used for all calculations

**Smoothed credit formula:**

```
bottleCredit(age, milkMl) =
    milkMl                                     if age ≤ 24h
    max(0, milkMl − hourlyRate × (age − 24))   if age > 24h

smoothed(T) = Σ bottleCredit(age_i, milkMl_i) for all feeds before T
```

---

## Three Predictors

All predictors answer: **when should the next bottle be given?**

| # | Name | Logic |
|---|------|-------|
| **P1** | Standard | `lastFeed.start + milkMl / hourlyRate` — pure drain time |
| **P2** | Adjusted | Corrects P1 by ±25% based on current surplus/deficit |
| **P3** | Optimised (T*) | Binary search for the exact time where `smoothed(T*) + nextBottleMl = dailyTarget` — guarantees zero surplus |

**Default:** P3 is on by default (`useTargetAwarePredictor = true`)

### Predictor 1 — Standard

When has the energy from the current session been fully consumed?

```
standardNext = session.start + totalMilkMl / hourlyRate
```

### Predictor 2 — Adjusted

Adjusts P1 to compensate for over/underfeeding:

```
surplus = smoothed − dailyTargetMl
rawCorrection = (surplus / hourlyRate) × 3600000   // ms
maxCorrectionMs = standardIntervalMs × (maxCorrectionPct / 100)

adjustedNext = standardNext + clamp(rawCorrection, −maxCorrectionMs, +maxCorrectionMs)
```

### Predictor 3 — Optimised (T*)

Searches for the time T* where the existing pool has decayed to exactly `dailyTarget − nextBottleMl`, so giving one bottle brings the total to exactly the daily target:

```
targetBefore = dailyTargetMl − milkPerBottle
```

Binary search in `[lastFeed, lastFeed + maxCorrectionMs]`:

1. If `smoothed(lastFeed) ≤ targetBefore` → **T\* = lastFeed** (feed now)
2. If `smoothed(T_max) > targetBefore` → **T\* = T_max** (cap applies)
3. Otherwise → **binary search** until `smoothed(T*) = targetBefore`

---

## App Design

### Logging

- One entry per session: **start time** + total milk given
- Bottle size pre-fills the milk amount (editable if baby didn't finish)
- Always log the **start** of the session (when the first step was given)

### Display Principle

The app always shows the energy state **at the moment of the last feed**, not at the current clock time:

```
smoothedAt = lastFeed.timestamp
```

- Status, bottle counts, and next feed times only update when a new feed is logged
- Only relative time labels ("in 2h 15m") update on clock ticks

### Dashboard Layout

1. **Log Feed button**
2. **Daily Target card** (swipeable) — ml, bottle equivalent, interval
3. **Status card** (swipeable) — smoothed 24h intake, strict 24h intake, gauge, mood
4. **Three-column row** — Last feed | Next (standard) | Adjusted (T*)
5. **Summary row** — total feeds, last 24h count, ml/hour

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `weightKg` | — | Baby weight in kg |
| `mlPerKgPerDay` | 150 | Daily target formula (ml/kg/day) |
| `displayBottleVolumeWater` | 90 | Bottle size (water ml) for dashboard display |
| `yellowThresholdPct` | 5 | On-track zone: within ±5% of target |
| `redThresholdPct` | 10 | Seriously off: beyond ±10% |
| `timeFormat` | 24h | Time display format |
| `maxCorrectionPct` | 25 | Cap: max correction = ±25% of standard interval |
| `useTargetAwarePredictor` | true | true = P3 (T*), false = P2 |

---

## Key Design Decisions

1. **Prepared milk ml** (not water ml) used for all energy calculations
2. **150 ml/kg/day** is the default daily target, configurable via settings
3. **Smoothed calculation** preferred over strict 24h sum to avoid abrupt fluctuations
4. **Predictor 3 (T*)** is the default — accounts for ongoing decay, guarantees zero surplus after feeding (within cap)
5. **Single log per session** (Option B) chosen over step-by-step logging for simplicity
6. **Display anchored to last feed time**, not current clock — handles delayed logging correctly
7. **±25% correction cap** prevents extreme timing adjustments, spreading corrections across sessions
