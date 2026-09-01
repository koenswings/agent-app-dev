# Data Architecture

**Project:** Baby Milk Tracker / MilkWise  
**Author:** Kit  
**Date:** 2026-06-15  
**Status:** Reference document

---

## 1. Overview

The app uses **no database**. All persistence is three plain JSON files on the Pi filesystem, written and read by the Next.js API routes via Node.js `fs`. All numbers displayed in the UI are computed on the fly from these files; nothing displayed is stored directly.

```
/data/
  feeds.json       ← array of Feed objects
  settings.json    ← single Settings object
  weights.json     ← array of WeightEntry objects
```

The path is controlled by the `DATA_DIR` environment variable (default: `../../data` relative to the app root, placing it outside the Next.js project so Turbopack does not watch it).

---

## 2. Stored Data

### 2.1 feeds.json

An array of `Feed` objects. Each represents one feeding event.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (UUID v4 or timestamp+random) |
| `timestamp` | number | Unix milliseconds — when the feed **started** |
| `volume` | number | **Water ml** measured into the bottle |
| `targetMlPerDay` | number? | ~~Daily milk target active at log time.~~ **Deprecated — do not write.** This field was a workaround from before `weights.json` existed. The target at any past time is derivable from weight history via `dailyTargetAtTime()`. Existing entries may still carry the field; it is ignored in all new calculations. |

**Important:** `volume` is always stored in **water ml**, not formula ml. The conversion to formula ml happens at read time using the lookup table in `calculations.ts`. Never store formula ml directly.

**Immutability principle:** The only immutable facts about a feed are `id`, `timestamp`, and `volume`. Everything else (what the target was, what the weight was, what the hourly rate was) is derivable and must not be stored.

Current live state (idea02): **143 feed entries**, spanning 2026-05-31 to 2026-06-15.

---

### 2.2 settings.json

A single `Settings` object. Always read as a merge over `DEFAULT_SETTINGS` so missing fields get defaults.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `weightKg` | number | 6.27 | Baby weight in kg — legacy derived cache; kept in sync with latest weight entry by the weights POST route. No calculation should read this as the authoritative weight; use the WHO model or 7-day short-circuit rule in `page.tsx` instead. |
| `mlPerKgPerDay` | number | 150 | WHO recommended formula intake rate |
| `preferredBottleWaterMl` | number | 90 | Water ml — preferred bottle size; used for DailyTargetCard, Should Take, stomach cap |
| `yellowThresholdPct` | number | 5 | ±% deviation before status turns yellow |
| `redThresholdPct` | number | 10 | ±% deviation before status turns red |
| `timeFormat` | '24h'\|'12h' | '24h' | Clock format for all time displays |
| `dateOfBirthMs` | number? | — | Baby's date of birth in ms — enables WHO z-score growth model |
| `sex` | 'M'\|'F'? | — | Baby's sex — enables WHO z-score growth model |
| `feedingTimelineView` | 'timeline'\|'cards'? | — | Which view the Should Take card uses |

`settings.weightKg` is a derived cache automatically kept in sync by the weights POST route. It is a legacy field. **No calculation reads it as the authoritative weight.** The effective weight used for the daily target is derived in `page.tsx` via the WHO LMS model (or the 7-day short-circuit rule if a recent measurement exists) — see `weight-compensation-design.md`.

---

### 2.3 weights.json

An array of `WeightEntry` objects, one per weigh-in.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `timestamp` | number | Unix milliseconds — when this weight was measured |
| `weightKg` | number | Baby's weight in kg at this time |

Current live state (idea02): **11 weight entries**, spanning 2026-04-20 to 2026-06-15. Weights range from 4.13 kg (birth area) to 6.93 kg (latest). Data persists via Docker bind mount at `/instances/milkwise-idea02-001/data/weights.json` on idea02 — survives container restarts.

**Note:** The dev workspace copy on wizardly-hugle has no `weights.json` (no entries logged there). The live instance on idea02 is the production data store.

---

### 2.4 Baby profile

If `settings.dateOfBirthMs` or `settings.sex` is missing, the dashboard shows an inline modal prompting the parent to enter them. This enables the WHO z-score growth model. There is no hard gate — if the modal is dismissed or settings are absent, the app falls back to `settings.weightKg` for target calculations.

There is no `/onboarding` route. The planned redirect gate was not implemented.

---

### 2.5 Code-level constants (not in any file)

Several values are baked into the source code rather than stored:

| Constant | Location | Value | Description |
|----------|----------|-------|-------------|
| `FORMULA_TABLE` | `calculations.ts` | 7 pairs | Water→formula ml lookup table per manufacturer's ratio |
| `MIN_DEFICIT_ML` | `calculations.ts` | 15 ml | Minimum deficit before bottle recommendation activates |
| `MAX_WATER` / `MAX_FORMULA` | `calculations.ts` | 150 / 170 ml | Largest practical bottle size |
| Credit decay formula | `calculations.ts` | `max(0, milk − hourlyRate × (age − 24))` | How a bottle's contribution decays after 24h |

---

## 3. Core Derived Quantities

These are the fundamental computed values from which all displayed numbers ultimately derive. They are recomputed on every page load.

### 3.1 Formula conversion: waterToMilk(waterMl) → formulaMl

The single most important conversion in the app. Logged volumes are in **water ml** (what you pour). All energy calculations use **formula ml** (what the baby actually gets, including the powder).

The conversion is **non-linear** — it uses a lookup table interpolated linearly between entries:

| Water ml | Formula ml |
|----------|-----------|
| 30 | 35 |
| 60 | 70 |
| 90 | 100 |
| 120 | 135 |
| 150 | 170 |
| 180 | 200 |
| 210 | 240 |

Outside the table range, the nearest segment slope is extrapolated. A 90 ml water bottle → **100 ml formula** (the most common case).

### 3.2 Derived settings (from Settings + weight history)

**Current (pre-compensation) derivation:**
```
dailyTargetMl     = settings.weightKg × mlPerKgPerDay  (formula ml/day)
hourlyRate        = dailyTargetMl / 24                  (formula ml/hour)
milkPerBottle     = waterToMilk(standardBottleVolume)   (formula ml per standard bottle)
idealIntervalHours = milkPerBottle / hourlyRate         (hours between feeds)
```

**Post-compensation (correct) derivation:**
```
effectiveWeight   = effectiveWeightAtTime(t, weights)   (kg — from weight history, NOT settings)
dailyTargetMl(t)  = effectiveWeight(t) × mlPerKgPerDay  (time-dependent — changes as baby grows)
hourlyRate(t)     = dailyTargetMl(t) / 24
milkPerBottle     = waterToMilk(standardBottleVolume)   (unchanged)
idealIntervalHours(t) = milkPerBottle / hourlyRate(t)
```

**Critical:** `dailyTargetMl` is not a fixed session constant — it is time-dependent. A calculation evaluating historical data must use the weight at the historical time, not a current snapshot. Code that calls `deriveSettings(settings)` once and reuses `derived.dailyTargetMl` throughout the session will produce incorrect values for historical calculations after the baby grows.

At current live data (6.93 kg, 150 ml/kg/day, 90 ml standard bottle):
- `dailyTargetMl` = 1039.5 ml/day
- `hourlyRate` = 43.31 ml/hour
- `milkPerBottle` = 100 ml
- `idealIntervalHours` = 2.31 hours

### 3.3 Reference time for frozen calculations

A critical design principle: status numbers are **frozen at `lastFeed.timestamp`**, not at "now". This means if a parent checks the app 4 hours after the last feed, the status still shows what state the baby was in at that feed — not a decayed version.

```
lastFeed      = most recent Feed (by timestamp)
smoothedAt    = lastFeed.timestamp   (if any feeds exist; otherwise now)
```

### 3.4 Strict 24h total

All formula ml from feeds whose timestamp falls within the 24-hour window ending at `smoothedAt`:

```
cutoff = smoothedAt − 24 × 60 × 60 × 1000
strict24h = Σ waterToMilk(feed.volume)  for all feeds with timestamp ≥ cutoff
```

### 3.5 Bottle credit (the smoothed model)

Each feed contributes "credit" that decays after 24 hours:

```
ageHours = (refTime − feed.timestamp) / 3_600_000
credit = waterToMilk(feed.volume)                   if ageHours ≤ 24
credit = max(0, milk − hourlyRate × (ageHours − 24)) if ageHours > 24
```

The intuition: a bottle fully counts for 24 hours, then its contribution decays at the hourly rate until it reaches zero.

### 3.6 Smoothed total (frozen at lastFeed)

```
smoothedMl = Σ credit(feed, hourlyRate, smoothedAt)   over ALL feeds
```

This is the primary energy balance metric. It is evaluated at `smoothedAt = lastFeed.timestamp`.

### 3.7 Live smoothed total (ticking with clock)

Same formula as 3.6 but evaluated at `now` (updated every 60 seconds):

```
liveSmoothedMl = Σ credit(feed, hourlyRate, now)
```

### 3.8 Percentages

```
strict24hPct   = (strict24h   / dailyTargetMl) × 100
smoothedPct    = (smoothedMl  / dailyTargetMl) × 100
liveSmoothedPct = (liveSmoothedMl / dailyTargetMl) × 100
```

### 3.9 Status colour

```
diff = |pct − 100|
colour = green   if diff ≤ yellowThresholdPct
colour = yellow  if diff ≤ redThresholdPct
colour = red     otherwise
```

### 3.10 Standard next feed time

```
nextBottleMilkMl  = waterToMilk(standardBottleWaterMl)
standardIntervalMs = (nextBottleMilkMl / hourlyRate) × 3_600_000
standardNext      = lastFeed.timestamp + standardIntervalMs
```

This is the naive "when will this bottle be used up" time. It uses the selected next-bottle size, not the last feed size.

### 3.11 Adjusted next feed time (Predictor 3 — T*)

Binary search for the time T* at which:

```
smoothedAtTime(T*) = dailyTargetMl − nextBottleMilkMl
```

The idea: find the moment at which giving a standard bottle would bring the smoothed total exactly to `dailyTargetMl`. The search is clamped to `[lastFeed.timestamp, standardNext + maxCorrectionMs]`. If the baby is already underfed, T* = lastFeed.timestamp (feed now). If still overfed at the cap, T* = cap and `capped = true`.

### 3.12 Best bottle size now

```
deficitMl = dailyTargetMl − smoothedAtTime(now)
```

If `deficitMl ≤ 0` or `< 15 ml`: return "overfed", recommend waiting.  
Otherwise: snap `deficitMl` to the nearest entry in `FORMULA_TABLE` (max 170 ml formula = 150 ml water), return that entry as the recommended bottle.

### 3.13 Trend points (analytics)

For each feed within the selected window:

```
target(feed)  = dailyTargetAtTime(feed.timestamp, weights, mlPerKgPerDay, fallback)
hr(feed)      = target(feed) / 24
smoothed(feed) = Σ credit(f, hr(feed), feed.timestamp)   over ALL feeds
surplus(feed) = smoothed(feed) − target(feed)
```

Each feed becomes one point on the trend graph, plotted as surplus (positive = overfed, negative = underfed).

### 3.14 Analytics statistics

```
avgIntervalHours   = mean of all inter-feed gaps (sorted feeds, consecutive pairs)
consistencyScore   = σ (standard deviation) of inter-feed gaps
periodTotal(days)  = Σ feed.volume (water ml)  for feeds within last N days
                     (note: this is raw water ml — a deliberate raw count)
avgSurplusMl       = mean surplus over trend points in selected window
```

### 3.15 Weight analytics (WeightChart)

```
gainKg        = latest.weightKg − oldest.weightKg
daySpan       = (latest.timestamp − oldest.timestamp) / 86_400_000
gainPerWeek   = (gainKg / daySpan) × 7   (if daySpan > 0)
```

---

## 4. Screen-by-Screen UI Element Reference

### 4.1 Dashboard (page.tsx)

#### Header

| Element | Data |
|---------|------|
| "🍼 Baby Milk Tracker" | Static label |
| Subtitle: `6.47 kg · Target: 970 ml/day` | `settings.weightKg` · `round(dailyTargetMl)` |

#### DailyTargetCard (swipeable, 4 views)

**View 0 — Numeric (default):**

| Element | Derived from |
|---------|-------------|
| Large ml number | `round(dailyTargetMl)` |
| Bottle count | `dailyTargetMl / waterToMilk(displayBottleVolumeWater)` |
| "× 90ml bottles" label | `displayBottleVolumeWater` from settings |
| "every Xh Ym" | `idealIntervalHours` (using `displayBottleVolumeWater`) |
| Formula line below | `weightKg × mlPerKgPerDay` |
| Bottle pictograms | Each 🍼 = one standard bottle; opacity of partial = fractional remainder |
| Pictogram label (ml) | Full bottles: `standardBottleVolume`; partial: `round(partial × milkPerBottle)` |

**View 1 — Bottle Parade:**

| Element | Derived from |
|---------|-------------|
| 🍼 icons | `floor(dailyTargetMl / milkPerBottle)` full + partial |
| "X.X bottles of Y ml" | `totalBottles.toFixed(1)`, `standardBottleVolume` |
| "X ml target" | `round(dailyTargetMl)` |

**View 2 — Feed Clock:**

| Element | Derived from |
|---------|-------------|
| Time chips | `feedsPerDay = 24 / idealIntervalHours` times starting at 00:00, spaced by `idealIntervalHours` |
| "Every X.Xh" | `idealIntervalHours` |
| "~N feeds/day" | `round(24 / idealIntervalHours)` |

**View 3 — Fun Facts:**

| Element | Derived from |
|---------|-------------|
| "X.X cans of soda" | `dailyTargetMl / 330` |
| "N cups of tea" | `round(dailyTargetMl / 150)` |
| "X.XX litres" | `dailyTargetMl / 1000` |
| "X.X jam jars" | `dailyTargetMl / 500` |

---

#### StatusCard (swipeable, 12 views)

All views share the same underlying data: `smoothedMl`, `smoothedPct`, `liveSmoothedMl`, `liveSmoothedPct`, `strict24h`, `strictPct`, `dailyTargetMl`, and `feeds24h` (feeds from the last 24h window before now).

**View 0 — Status at last feed (PanelWithGauge — default):**

| Element | Derived from |
|---------|-------------|
| Large ml number | `round(smoothedMl)` |
| Percentage | `round(smoothedPct)` |
| Status text ("on track", "slightly over", etc.) | `statusText(smoothedPct, yellow, red)` |
| Border/background colour | `bgBorder(smoothedPct, yellow, red)` |
| Gauge bar fill height | `(smoothedPct − 60) / 80 × 100`, clamped 0–100% |
| Gauge delta label ("+Xml") | `|round(smoothedPct/100 × dailyTargetMl − dailyTargetMl)|` |
| 🍼 pictograms | One per feed in `feeds24h`; font-size scaled by `waterToMilk(volume) / milkPerBottle` |
| Pictogram label (ml) | `feed.volume` (water ml, as logged) |

**View 1 — Status now (PanelWithGaugeLive):**  
Same layout as View 0 but all values use `liveSmoothedMl` and `liveSmoothedPct` instead. The gauge animates with CSS transition on each 60s clock tick.

**View 2 — Dual gauge (PanelDualGauge):**  
Two side-by-side gauges: left = `smoothedPct` ("at feed"), right = `liveSmoothedPct` ("now"). Pictograms from `feeds24h`.

**View 3 — Intake trend 3 days (FeedTrendView):**  
Canvas graph. Each dot = one feed within the 3-day window; y-axis = `surplus` (from §3.13). Curve = Catmull-Rom spline through dots. Colour zones from `yellowThresholdPct` / `redThresholdPct`. Percentage badge = `round(smoothedPct)`.

**View 4 — STATUS LAST 24H (Panel, smoothed):**  
`smoothedMl`, `smoothedPct`, bottle count = `smoothedMl / milkPerBottle`, pictograms from `feeds24h`.

**View 5 — Strict 24h (Panel):**  
`strict24h`, `strictPct`, bottle count = `strict24h / milkPerBottle`, pictograms from `feeds24h`.

**View 6 — Progress bars (ProgressView):**  
Two horizontal bars: Smoothed (`smoothedMl`, `smoothedPct`) and Strict (`strict24h`, `strictPct`). Bar fill = `min(pct, 150) / 150 × 100%`. White tick at 66.7% of bar width = 100% target. Footer: `round(dailyTargetMl)`.

**View 7 — At a glance (SpotlightView):**  
Left: `round(smoothedPct)`%, `round(smoothedMl)` ml. Right: `round(strictPct)`%, `round(strict24h)` ml.

**View 8 — Balance bar (BiDirectionalView):**  
Centre-anchored bar. Fill extends left (underfed, blue) or right (overfed, orange). `diff = smoothedPct − 100`. `surplusMl = |round(smoothedMl − dailyTargetMl)|`. Bar fill = `min(|diff| / 40 × 50, 50)%`.

**View 9 — Intake gauge (ThermometerView):**  
Vertical thermometer. Fill = `(smoothedPct − 60) / 80 × 100%`, clamped. Delta: `round(|diff|)%` and `surplusMl` ml.

**View 10 — Emoji status (EmojiBalanceView):**  
Emoji and text chosen by `diff = smoothedPct − 100` and thresholds. `surplusMl = |round(smoothedMl − dailyTargetMl)|`.

**View 11 — History link (HistoryLinkView):**  
Shows `round(smoothedMl)` ml and `round(smoothedPct)`%. Link to `/history/smoothed`.

---

#### Three-clock row (Last feed / Next / Adjusted)

| Element | Derived from |
|---------|-------------|
| **Last feed** timestamp | `lastFeed.timestamp` |
| **Last feed** volume | `lastFeed.volume` (water ml) |
| **Next** timestamp | `standardNext` = `lastFeed.timestamp + (waterToMilk(standardBottleWaterMl) / hourlyRate) × 3_600_000` |
| **Next** relative label ("in 2h 15m") | `standardNext − now`, formatted |
| **Next** bottle pill (⬡ 90ml) | `standardBottleWaterMl` state variable (user-selectable; defaults to `settings.nextBottleWaterMl`) |
| **Adjusted** timestamp | T* from Predictor 3 (§3.11) |
| **Adjusted** relative label | `nextFeed − now`, formatted |
| **Adjusted** "+Nm later / −Nm earlier" | `round((nextFeed − standardNext) / 60_000)` minutes |
| **Adjusted** bottle pill | `nextBottleWaterMl` state variable |
| **Adjusted** "Feed now → X ml water" | `bestBottleSizeNow(feeds, hourlyRate, dailyTargetMl, now)` (§3.12) |
| **Adjusted** "⚠️ Over target — wait until HH:MM" | Shown when `bestBottleSizeNow.status === "overfed"` and `nextFeed` exists |

#### Summary row

| Element | Derived from |
|---------|-------------|
| Total feeds | `feeds.length` |
| Last 24h feeds | `feeds.filter(f => f.timestamp >= now − 86_400_000).length` |
| ml/hour | `round(hourlyRate × 10) / 10` |

---

### 4.2 Log Feed (/log)

| Element | Derived from |
|---------|-------------|
| Bottle size buttons (30/60/90/120/150 ml) | Fixed constants `QUICK_VOLUMES` |
| "90 ml water → 100 ml milk" conversion hint | `waterToMilk(bottleSize)` |
| Pre-filled volume field | `round(waterToMilk(bottleSize))` formula ml |
| Recommendation message (`?recommend=X`) | `bestBottleSizeNow` result passed via URL param from dashboard |
| Date field | `new Date()` formatted as YYYY-MM-DD; refreshes every 30s if not edited |
| Time field | `new Date()` formatted as HH:MM; refreshes every 30s if not edited |
| Recent feeds list | Last 3 feeds sorted by timestamp descending; shows `feed.timestamp` (formatted) and `feed.volume` (water ml) |

**On save:** `volume` (formula ml shown in input) is converted back to water ml via `milkToWater()` before writing. Only `id`, `timestamp`, and `volume` are written — `targetMlPerDay` is no longer stamped (removed in v1.1.38).

---

### 4.3 History (/history) — Feeds tab

| Element | Derived from |
|---------|-------------|
| Feed list (sorted newest first) | All `feeds` from `feedsWithCredit(feeds, hourlyRate)` |
| Date/time | `feed.timestamp` formatted |
| Volume (blue) | `feed.volume` (water ml as logged) |
| Age | `(now − feed.timestamp) / 3_600_000` hours |
| Credit | `bottleCredit(ageHours, waterToMilk(feed.volume), hourlyRate)` — formula ml remaining |
| Search filter | Matches `feed.timestamp` against date string input |

---

### 4.4 History (/history) — Weight tab

| Element | Derived from |
|---------|-------------|
| Weight entries (sorted newest first) | `weights` array |
| Weight value | `weight.weightKg` |
| Date/time | `weight.timestamp` formatted |

---

### 4.5 Analytics (/analytics) — Intake tab

#### Trend chart (TrendCanvas)

| Element | Derived from |
|---------|-------------|
| Each dot | One feed within window; y-position = `surplus` (§3.13) |
| Dot colour | Green if `|surplus| ≤ dailyTarget × yellowPct/100`; yellow if within red threshold; red/blue if beyond |
| Curve | Catmull-Rom spline through all dots |
| Green zone band | ±`dailyTargetMl × yellowThresholdPct / 100` around zero |
| Yellow zone band | ±`dailyTargetMl × redThresholdPct / 100` |
| Zero line | `surplus = 0` = exactly on daily target |
| Day separators | Midnight boundaries within the window |
| Period buttons (3d/7d/30d) | Sets `windowMs = days × 86_400_000` |

#### Statistics grid

| Element | Derived from |
|---------|-------------|
| Avg interval | `avgIntervalHours` (§3.14) |
| Ideal interval (sub-label) | `idealIntervalHours` |
| Consistency (σ) | `consistencyScore` (§3.14) — std dev of inter-feed gaps |
| Avg Nd surplus | `mean(trendPoint.surplus)` for all points in window |
| Total feeds | `feeds.length` |

#### Period totals

| Element | Derived from |
|---------|-------------|
| Last 3/7/14 days (ml) | `periodTotal(feeds, N)` = Σ `feed.volume` (raw water ml) within window |

Note: Period totals are in raw water ml, not formula ml. This is intentional — it shows raw intake, not converted.

#### Consistency explainer modal

Shows `avgIntervalHours`, `consistencyScore`, `idealIntervalHours` from §3.14.

---

### 4.6 Analytics (/analytics) — Weight tab

#### Statistics grid (WeightChart header)

| Element | Derived from |
|---------|-------------|
| Current weight | `sorted.last.weightKg` |
| Total gain | `latest.weightKg − oldest.weightKg` |
| Rate (g/week) | `(gainKg / daySpan) × 7 × 1000` |

#### Weight chart (canvas)

| Element | Derived from |
|---------|-------------|
| Each dot | `weight.weightKg` at `weight.timestamp` |
| Curve | Catmull-Rom spline through sorted weight entries |
| Dot label | `weight.weightKg` kg |
| Y axis | Auto-scaled: `min(weightKg) − 0.1` to `max(weightKg) + 0.1` |
| X axis | `sorted.first.timestamp` to `sorted.last.timestamp + 1 day` |
| Grid lines | Daily or weekly ticks depending on span |

---

### 4.7 Settings (/settings)

| Element | Derived from / writes to |
|---------|--------------------------|
| Baby weight field | Reads/writes `settings.weightKg` (legacy; also creates a WeightEntry) |
| ml per kg per day | Reads/writes `settings.mlPerKgPerDay` |
| On-track zone (±%) | Reads/writes `settings.yellowThresholdPct` |
| Seriously off threshold | Reads/writes `settings.redThresholdPct` |
| Preferred bottle size | Reads/writes `settings.preferredBottleWaterMl` |
| Time format | Reads/writes `settings.timeFormat` |
| Date of birth | Reads/writes `settings.dateOfBirthMs` |
| Sex | Reads/writes `settings.sex` |
| **Auto-calculated: Daily target** | `weightKg × mlPerKgPerDay` |
| **Auto-calculated: Hourly rate** | `dailyTargetMl / 24` |
| **Auto-calculated: Ideal interval** | `idealIntervalHours` |

Note: the auto-calculated panel uses `deriveSettings(settings)` with the current live form values, not the saved values. It updates immediately as the user types.

---

## 5. Data Flow Summary

```
feeds.json          settings.json       weights.json
     │                    │                   │
     ▼                    ▼                   ▼
 Feed[]            Settings             WeightEntry[]
     │                    │                   │
     │        ┌───────────┘                   │
     │        ▼                               │
     │  deriveSettings()                      │
     │   dailyTargetMl                        │
     │   hourlyRate           weightAtTime()  │
     │   milkPerBottle  ◄────────────────────┘
     │   idealInterval        (per-feed target
     │        │                for trend graph)
     │        │
     ├────────┼──── strict24hTotal()    → strict24h, strictPct
     │        │
     ├────────┼──── smoothedEffective() → smoothedMl, smoothedPct
     │        │         (at lastFeed.timestamp)
     │        │
     ├────────┼──── smoothedAtTime()    → liveSmoothedMl, liveSmoothedPct
     │        │         (at now, every 60s)
     │        │
     ├────────┼──── nextFeedTime()      → standardNext, adjustedNext (T*)
     │        │
     ├────────┼──── bestBottleSizeNow() → recommended bottle (water ml)
     │        │
     ├────────┼──── feedsWithCredit()   → ageHours, creditMl per feed
     │        │
     ├────────┼──── buildTrendPoints()  → surplus per feed (trend graph)
     │        │
     └────────┴──── dailyTotals()       → per-day totals (analytics)
                    avgIntervalHours()
                    consistencyScore()
                    periodTotal()
```

---

## 6. API Routes

All routes are Next.js Route Handlers (`app/api/*/route.ts`).

| Method | Route | Reads | Writes | Returns |
|--------|-------|-------|--------|---------|
| GET | `/api/feeds` | `feeds.json` | — | `Feed[]` |
| POST | `/api/feeds` | `feeds.json` | `feeds.json` | new `Feed` |
| DELETE | `/api/feeds/[id]` | `feeds.json` | `feeds.json` | `{ok: true}` |
| PATCH | `/api/feeds/[id]` | `feeds.json` | `feeds.json` | updated `Feed` |
| GET | `/api/settings` | `settings.json` | — | `Settings` |
| POST | `/api/settings` | — | `settings.json` | `Settings` |
| GET | `/api/weights` | `weights.json` | — | `WeightEntry[]` |
| POST | `/api/weights` | `weights.json`, `settings.json` | `weights.json`, `settings.json` | new `WeightEntry` |
| DELETE | `/api/weights/[id]` | `weights.json` | `weights.json` | `{ok: true}` |
| PATCH | `/api/weights/[id]` | `weights.json` | `weights.json` | `{ok: true}` |

The POST `/api/weights` route has a side effect: it also writes `settings.weightKg` to the most recent weight value.

---

## 7. Client-side State and Caching

The app uses React component state only — no Redux, no Zustand, no localStorage (localStorage was migrated away from). On every page load:

1. `load()` fetches `GET /api/feeds`, `GET /api/settings`, `GET /api/weights` in parallel.
2. All calculations are run synchronously in the render path.
3. A 60-second `setInterval` updates `now` (the clock) without re-fetching feeds.
4. A `window.focus` listener re-runs `load()` when the tab regains focus (handles navigation back from other pages).

There is no caching layer. Every focus event causes a full re-fetch from disk.

**Onboarding gate (post-implementation):** If `weights.length === 0` after `load()`, the dashboard redirects to `/onboarding` before rendering any calculated data. This guarantees all calculations have at least one weight entry to work from.
