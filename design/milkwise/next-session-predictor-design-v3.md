# MilkWise Feeding Predictor — Design Document

**Status:** Current  
**Last updated:** 2026-07-25  
**Authors:** Kit + Koen  

---

## 1. Objective

After every logged feed, MilkWise gives parents three concrete recommendations:

- **Next Feed** — when to feed next, assuming the ideal rhythm (standard interval, preferred bottle size)
- **Should Take** — a timeline of when each standard bottle size should be given, combining stomach readiness and intake balance
- **Status card** — a real-time view of 24h intake and current stomach room

Together these answer: *Is the baby on track? When should the next feed happen? How much can the stomach take, and when?*

---

## 2. Foundations

### 2.1 Water vs Prepared Formula

Formula is prepared by mixing powder into water. Parents measure water ml; nutrition comes from prepared formula ml. All energy calculations use prepared formula ml. The conversion follows the manufacturer table:

| Water ml | Formula ml |
|----------|------------|
| 30  | 35  |
| 60  | 70  |
| 90  | 100 |
| 120 | 135 |
| 150 | 170 |
| 180 | 200 |
| 210 | 240 |

For intermediate values, interpolate linearly between adjacent table entries. Throughout the app, water-based bottle sizes are shown with a 🍼 icon; formula ml values are shown in plain ml.

### 2.2 Daily Target and Hourly Rate

The clinical guideline is 150 ml of prepared formula per kilogram of body weight per day, endorsed by Kind en Gezin, NHS, AAP, and WHO/ESPGHAN.

```
dailyTarget  = weightKg × mlPerKgPerDay    (default mlPerKgPerDay = 150)
hourlyRate   = dailyTarget / 24            (ml of formula per hour)
```

The baby's weight is tracked via a weight history. MilkWise fits a WHO LMS z-score model to the recorded weights and predicts today's weight, so the daily target grows automatically as the baby gains weight.

### 2.3 Feed Logs

Each log entry records:
- **Timestamp** — when the feed started (ms since epoch)
- **Volume** — water ml given (the app converts this to formula ml for all calculations)

---

## 3. The 24-Hour Intake Model

### 3.1 What We Measure

The central metric is the **smoothed 24h intake**: the total formula milk the baby has received over a rolling 24-hour window, with partial credit given to bottles just older than 24 hours so that the curve never drops abruptly when an old feed rolls off.

This aligns exactly with how the clinical guideline is stated — 150 ml per kg per *24 hours* — and naturally forgets history: a week of illness-era underfeeding leaves no lasting offset once 24 hours of normal feeding resumes.

### 3.2 The Intake Function

```
bottleCredit(age, milkMl) =
    milkMl                                       if age ≤ 24h
    max(0, milkMl − hourlyRate × (age − 24h))    if age > 24h

intake(T) = Σ bottleCredit(T − feed_i.timestamp, feed_i.milkMl)
            for all feeds i logged before T
```

Each bottle contributes its full formula volume for the first 24 hours. After that, its credit erodes at exactly `hourlyRate` per hour — the same rate at which the baby consumes energy — until it reaches zero. In steady-state feeding, exactly one bottle is always in the decay zone, producing a gentle continuous downward slope between feeds.

**At equilibrium** (regular feeds, consistent bottle size): `intake(T)` oscillates between `dailyTarget` (just before each feed) and `dailyTarget + preferredBottleMilkMl` (just after). The standard interval `SI` is the natural period of this oscillation.

### 3.3 Standard Interval

```
SI = preferredBottleMilkMl / hourlyRate
```

If the baby were fed exactly one preferred bottle every SI hours, intake would stay in perfect equilibrium. The standard interval is the reference rhythm for this baby and bottle size.

*Example: 6.9 kg baby, 90 🍼 preferred bottle (100 ml formula):*  
`hourlyRate = 43.1 ml/h` · `SI ≈ 2h 19m`

### 3.4 Surplus and Deficit

```
surplus(T) = intake(T) − dailyTarget
```

- **surplus > 0** — baby has received more than the 24h target; well fed
- **surplus = 0** — exactly on track; ready for the next preferred bottle at the standard time
- **surplus < 0** — behind; the baby is underfed relative to the 24h target

---

## 4. Gastric Emptying Model

### 4.1 Clinical Basis

Gastric emptying of standard infant formula in healthy term infants follows **first-order (monoexponential) kinetics**: the fraction of milk leaving the stomach per unit time is constant, independent of how full the stomach is.

```
G(t) = G₀ × e^(−k × t)
```

| Symbol | Meaning |
|--------|---------|
| `G(t)` | Formula remaining in stomach t hours after the feed (ml) |
| `G₀`  | Volume given at the feed (formula ml) |
| `k`   | Decay constant = ln(2) / t½ |
| `t½`  | Gastric half-emptying time |

Multiple studies using gastric scintigraphy and real-time ultrasound in healthy term neonates place **t½ at 45–65 minutes** for standard formula (Van Den Driessche et al., 2003; Husband & Husband 1969; Cavell 1981). MilkWise uses **t½ = 60 min** as a conservative central estimate, giving:

```
k = ln(2) / 1h = 0.6931 h⁻¹
```

Full gastric emptying (>95% cleared) occurs at approximately 4 × t½ ≈ 4 hours. Feeds older than 7 hours contribute less than 1% of their original volume and are excluded from calculations for efficiency.

### 4.2 Stomach Load

The total formula currently in the stomach at time T:

```
stomachLoad(T) = Σᵢ feed_i.milkMl × e^(−k × (T − feed_i.timestamp))
```

where the sum is over all feeds within the last 7 hours.

### 4.3 Stomach Capacity

The stomach's maximum comfortable capacity is the **steady-state peak load** reached in a perfect feeding cycle with the preferred bottle at the standard interval. This is the highest the stomach ever reaches under ideal conditions — the physical maximum stretch point without overloading.

In steady-state feeding, the stomach load just after each feed converges to:

```
stomachCap = preferredBottleMilkMl / (1 − e^(−k × SI))
```

where `SI` is the standard interval (§3.3), itself derived from the two core settings:

```
SI            = preferredBottleMilkMl / hourlyRate
hourlyRate    = weightKg × mlPerKgPerDay / 24
stomachCap    = preferredBottleMilkMl / (1 − e^(−k × preferredBottleMilkMl × 24 / (weightKg × mlPerKgPerDay)))
```

Both `preferredBottleMilkMl` and `mlPerKgPerDay` are user-configurable settings (§9). The stomach cap therefore updates automatically when either the preferred bottle size, the baby's weight, or the clinical target changes.

**Rationale:** Any compensation strategy (giving a larger bottle to recover a deficit) must not stretch the stomach beyond the point it would naturally reach in a perfect preferred-bottle cycle. Using the steady-state peak as the hard ceiling is the tightest physically grounded bound — it permits no more stretch than normal preferred feeding already implies.

**Example values** (default `mlPerKgPerDay = 150`):

| Baby weight | Preferred bottle | SI | Stomach cap |
|-------------|------------------|----|-------------|
| 4 kg | 90 🍼 (101 ml) | 3h 37m | ~115 ml |
| 4 kg | 120 🍼 (135 ml) | 4h 50m | ~144 ml |
| 6 kg | 90 🍼 (101 ml) | 2h 25m | ~121 ml |
| 6 kg | 120 🍼 (135 ml) | 3h 14m | ~148 ml |

Note: these values differ from the old lookup table. The old table was a coarse approximation (next bottle size up); this formula is derived directly from the feeding model.

### 4.4 When Does a Given Bottle Size Fit?

For a bottle of size `m_new` (formula ml), the earliest time at which it can be given without exceeding the stomach capacity is found by solving:

```
stomachLoad(T) + m_new ≤ stomachCapMilk
```

If this is already satisfied at the current time, the bottle fits now. Otherwise, since `stomachLoad` decays exponentially:

```
stomachLoad(now) × e^(−k × dt) + m_new ≤ stomachCapMilk
dt_min = −ln((stomachCapMilk − m_new) / stomachLoad(now)) / k
```

If `stomachCapMilk − m_new ≤ 0` (the bottle fills the stomach completely), the load must decay to near-zero (< 5 ml), giving a longer wait. Bottle sizes where `m_new ≥ stomachCapMilk` are never shown — they cannot physically fit.

---

## 5. Next Feed Card

The **Next Feed** card is the rhythm anchor. It always shows:

- **Time:** `T_standard = lastFeed.timestamp + SI`
- **Volume:** the preferred bottle size

No adjustments for surplus or deficit. This is what the baby expects based on the established feeding rhythm; many parents choose to stick to this regardless of the balance calculations. The Should Take card (§7) handles the corrective view.

---

## 6. Status Card

The Status card shows two measurements side by side, updated after every logged feed:

### 6.1 24h Intake · At Last Feed

`intake(lastFeed.timestamp)` — the smoothed 24h intake frozen at the moment of the last feed. Frozen by design: the app shows the energy state at the last known event, not a number that drifts between feeds.

Displayed as ml and as a percentage of `dailyTarget`. The gauge bar runs from 0 to 130% of target; a white marker sits at 100%. Green when within ±5% of target, blue when below, orange when above.

### 6.2 Stomach Room · Now

`stomachCapMilk − stomachLoad(now)` — the formula volume currently available in the stomach. This updates live (60-second clock tick), because the stomach empties continuously regardless of when the last feed was logged.

Displayed as ml free, of-cap ml, and digesting ml. The vessel graphic fills from the bottom: teal-tinted empty space above, amber-to-red digesting load below. Green/teal means room available; orange means filling up; red means very little room left.

---

## 7. Should Take Card

The **Should Take** card answers: *taking into account both the intake balance and the stomach, when should each standard bottle size be given?*

### 7.1 Unified Constraint

For each bottle size X, the earliest appropriate time is the **later** of two constraints:

```
readyAt(X) = max(stomachReadyAt(X), intakeReadyAt(X))
```

**stomachReadyAt(X):** when has the stomach digested enough to hold X without exceeding the cap? (computed by the formula in §4.4)

**intakeReadyAt(X):** when has the 24h intake decayed low enough that giving X brings it back to the daily target? Formally, find T_B such that:

```
intake(T_B) = dailyTarget − milkMl(X)
```

i.e. intake has decayed to the point where giving X restores it to `dailyTarget`. If intake is already at or below this threshold, `intakeReadyAt = now` (underfed case: give as soon as the stomach allows). Found by binary search; capped at 48 hours.

### 7.2 Which Sizes to Show

- Include all standard bottle sizes from 30 🍼 up to and including **preferred + 1** (one size above preferred).
- Exclude any size where `milkMl(X) ≥ stomachCapMilk` (physically cannot fit).
- **Noise-cut rule:** show only from the **largest size available now** upward. If 60 🍼 already fits now, there is no reason to show 30 🍼.
- **Ordering is guaranteed by the formula:** both `stomachReadyAt` and `intakeReadyAt` are monotonically increasing with bottle size — larger bottles need more stomach room and more intake decay. Therefore `readyAt(X) = max(stomachReadyAt(X), intakeReadyAt(X))` automatically sequences larger bottles later. No special-casing is needed.

### 7.3 Overfed Case

When the baby is well fed, the intake constraint pushes all sizes into the future — none are available now. The timeline shows all markers to the right of the "now" position, with a note: *"Well fed — all sizes available later."*

### 7.4 Display

A horizontal timeline spans from now to the furthest `readyAt` time. Each bottle size is a marker (dot + tick) on the line, positioned proportionally to its `readyAt` time. The bottle size (e.g. `60 🍼`) is labelled above the marker; the clock time and relative time (e.g. `14:32 · in 23m`) are below. Available-now markers are green; future markers are rose-coloured.

### 7.5 Relationship to Next Feed

At equilibrium (baby on track, regular feeds): `intakeReadyAt(preferred) = T_standard`, so the preferred bottle marker on the Should Take timeline aligns with the Next Feed time. When they diverge, it is meaningful: Next Feed anchors to the rhythm; Should Take reflects the correction.

---

## 8. Edge Cases

### 8.1 No Feed History

Both intake and stomachLoad are zero. Should Take shows all sizes available now. Next Feed shows a time based on an assumed last feed of "now". The Status card shows 0 ml intake (0%) and full stomach room.

### 8.2 Long Gap (> 24h Since Last Feed)

`intake(now)` approaches zero. The Status card shows 0% intake. Should Take shows all sizes immediately available.

> ⚠️ **Not yet implemented:** The planned long-gap warning note (*"Long gap detected — if the baby has been unwell, resume normal feeding gradually"*) has not been added to the UI.

### 8.3 Deficit Larger Than One Bottle Can Cover

When the intake-optimal volume at T_standard exceeds the stomach cap, Predictor A is not directly surfaced (it has been replaced by the Should Take approach). The Should Take card naturally handles this: only sizes that actually fit in the stomach are shown, ordered by when they can be given.

### 8.7 Deep Deficit — Bottle Cannot Restore 100% Status (⚠️ KNOWN ISSUE — requires fix)

**Observed:** 2026-09-01. Baby had a 250 ml deficit at 15:00. The preferred bottle is 120 🍼 (~135 ml formula). Adding 135 ml to I=960 ml gives 1095 ml, still well below D=1210.5 ml. The app proposed a feed time of ~18:15 (stomach/intake constraint), but at that time the status screen would only show ~89%, not 100%.

Koen fed at 17:55 and the status showed 100% — because by 17:55 enough earlier feeds had dropped out of the 24h rolling window, reducing the effective `I(T)` such that 120 ml was finally sufficient to reach `D`.

**Root cause:** The current `intakeReadyAt` definition assumes that bottle size X can always bring intake back to `dailyTarget`. It returns `now` when `I(T) < dailyTarget − milkMl(X)` (underfed case). But this is only correct when `milkMl(X) >= dailyTarget − I(T)`. When the deficit exceeds the bottle size, the formula silently falls back to stomach-readiness alone — and proposes a time that will NOT result in 100% status.

**Required behaviour (Koen, 2026-09-01):** The timeline must show, for each bottle size X, the **earliest time at which feeding X results in the status screen showing 100%** (i.e. `I(T_feed) + milkMl(X) >= dailyTarget`). This is the only semantically meaningful time to show.

**Correct algorithm for `intakeReadyAt(X)`:**

```
intakeReadyAt(X):
  needed = dailyTarget − milkMl(X)   // intake must be <= this for X to reach 100%
  if I(now) <= needed:
    return now                         // X already covers the remaining deficit
  else:
    // I(now) > needed: either overfed, OR deficit > bottle size (I < D but I > needed)
    // Must wait for I(T) to decay (via feeds dropping out of 24h window) until I(T) <= needed
    binary search for T such that I(T) = needed
    return T
```

Note: when the deficit exceeds the bottle size (`I(now) < D` but `I(now) > D - milkMl(X)`), the baby IS underfed — but the bottle is too small to close the gap alone. The correct response is NOT `now`; it is: wait until enough old feeds drop out of the 24h window such that the bottle finally tips the balance to 100%.

**Implementation note:** `I(T)` is not a smooth exponential — it is a step function that drops discretely when old feeds exit the 24h window. The binary search must account for this: evaluate `I(T)` by summing only feeds within the `[T − 24h, T]` window at the candidate time T.

**Priority:** High. This misleads parents into waiting longer than necessary, or feeding at a time where the status screen does not confirm 100% as expected.

### 8.4 Very Early Re-feed

If the parent logs a new feed very shortly after the previous one (e.g. the baby resumed a split feed), the stomach capacity constraint ensures the next markers on Should Take cannot be before the stomach is ready.

### 8.5 Different Bottle Sizes in History

The `intake()` function uses each feed's actual formula ml, so mixed bottle sizes in history are handled correctly. The predictors always target the current `preferredBottleMilkMl` setting. Changing the preferred size in settings immediately updates the Should Take timeline and the Next Feed card.

### 8.6 Why the Gap Between Bottle Sizes Grows When the Baby is Underfed

**Intuition:** The stomach empties exponentially. At high stomach load, decay is fast — 30 ml disappears quickly. At low stomach load, the same 30 ml takes much longer. So when the stomach is already nearly empty, waiting for even a modest amount of additional room takes disproportionately long.

**Worked example (screenshot, July 2026):**

| Parameter | Value |
|-----------|-------|
| Preferred bottle | 120 🍼 (137 ml milk) |
| Baby weight | ~5.5 kg |
| Stomach cap | ~146 ml milk |
| Stomach load at observation time | 63 ml milk |
| Stomach room available | 91 ml milk |
| 24h intake at last feed | −376 ml (severely underfed) |

The 90 🍼 bottle (101 ml milk) fits immediately: 63 + 101 = 164 ml, which is within the cap + 10% buffer (161 ml).

The 120 🍼 bottle (137 ml milk) does not fit: 63 + 137 = 200 ml, exceeds the 161 ml effective cap by 39 ml.

The stomach must decay from 63 ml down to ~24 ml before the 120 🍼 bottle can be given:

```
remainder = cap − m_new = 146 − 137 = 9 ml (without buffer)
dt = ln(63 / 9) / k = ln(7) / 0.693 × 60 min ≈ 105 min
```

With the 10% buffer applied (`cap × 1.1 = 161 ml`):

```
remainder = 161 − 137 = 24 ml
dt = ln(63 / 24) / 0.693 × 60 min ≈ 53 min
```

This matches the timeline exactly: the 90 🍼 shows *now*, the 120 🍼 shows *in ~53 min*.

**Why the gap seems large despite a small decay target:**

A parent might expect that if the stomach only needs to shed ~39 ml of load, and 30 ml takes ~27 minutes at full cap, then 39 ml should take around 35 minutes. That reasoning applies only at the top of the decay curve, where decay is fastest. At 63 ml load — far from the cap — the exponential has slowed considerably. The same 39 ml shed now takes 53 minutes, not 35.

This is not a bug. It is the correct, physiologically grounded behaviour of exponential gastric emptying. The gap between bottle sizes on the timeline accurately reflects how long the stomach actually needs — and that gap widens the more the stomach has already emptied.

**Key takeaway:** The minimum label-spacing heuristic on the Should Take timeline ("30 ml decay time from cap") is a display minimum, not a physical prediction. When the stomach is well below cap, real gaps between sizes will be larger than this minimum, and this is physically correct.

---

## 9. Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `weightKg` | — | Baby weight in kg; kept in sync with weight history |
| `mlPerKgPerDay` | 150 | Daily target formula per kg |
| `preferredBottleWaterMl` | 90 | Parent's preferred bottle size (water ml) |
| `yellowThresholdPct` | 5 | Status gauge on-track band (±% of target) |
| `redThresholdPct` | 10 | Status gauge warning band |
| `timeFormat` | 24h | Clock display format |
| `dateOfBirthMs` | — | Baby's date of birth (enables WHO z-score model) |
| `sex` | — | Baby's sex M/F (enables WHO z-score model) |

The stomach capacity is not a direct user setting; it is derived automatically from `preferredBottleWaterMl`, `weightKg`, and `mlPerKgPerDay` using the steady-state peak formula in §4.3. Changing any of these three settings immediately updates the cap.

---

## 10. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| 24h rolling window, not all-time balance | Aligns with the clinical guideline; does not try to compensate for illness-era underfeeding; naturally forgets |
| Smoothed credit decay past 24h | Avoids cliff-edge drops when old bottles exit the window; `hourlyRate` as decay rate mirrors energy consumption rate |
| Next Feed = rhythm anchor, no adjustments | Parents who feed by schedule get a clean, unambiguous next time; corrections are separate (Should Take) |
| Should Take = unified stomach + intake constraint | Both physical and nutritional constraints applied together; no contradictory advice between cards |
| Preferred-only ceiling for Should Take | Giving more than the preferred bottle is outside the app's core advisory role; the parent can always choose to give a larger bottle based on the stomach room shown in the Status card |
| Noise-cut: show only from largest-available-now upward | Smaller available sizes are superseded; showing them is noise |
| Stomach cap = steady-state peak of preferred bottle cycle | Physically grounded: cap equals the highest load the stomach naturally reaches in a perfect preferred cycle; derived from `preferredBottleMilkMl`, `weightKg`, and `mlPerKgPerDay` — no lookup table, no arbitrary multiplier |
| Gastric emptying: exponential, t½ = 60 min | Clinical standard (scintigraphy/ultrasound studies); conservative central estimate within 45–65 min clinical range |
| Status card frozen at last feed for intake; live for stomach | Intake at last feed is the meaningful snapshot (display principle); stomach room should always reflect right now |
| WHO LMS z-score for weight prediction | Globally validated reference (WHO 2006); automatic target growth without manual weight updates |
| 7-day short-circuit for recent measurements | If latest weight ≤ 7 days old, use it directly and skip WHO projection — a fresh measurement is always more accurate than a model extrapolation |

---

## 11. Implementation Notes (as of v1.1.38)

- **Next Feed card** (`NextFeedCard.tsx`) is a swipeable card. Views 0 and 2 show the standard interval time (rhythm anchor, no adjustments). Views 1 and 3 show the legacy adjusted next feed using `predictors.predictorBTimestamp`. The adjusted views remain available but are not the primary recommendation.
- **Should Take card** is available in two layout modes: horizontal timeline (`CanTakeCard.tsx`) and card grid (`FeedingTimelineCards.tsx`). The user can toggle between them via `settings.feedingTimelineView`.
- **§8.2 long-gap warning** is not implemented in the UI.
