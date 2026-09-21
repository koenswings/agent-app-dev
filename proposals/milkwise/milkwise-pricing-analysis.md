# MilkWise — Pricing Options & Income Estimates

**Prepared by:** Kit
**Date:** June 2026

---

## The Two Options

### Option 1 — Three-tier model

| Tier | Price | What you get |
|---|---|---|
| **Free** | €0 | Feed logging, dashboard, 7-day chart |
| **Pro** | €4.99 one-time | Full analytics, CSV export, iCloud/Google Drive backup |
| **Household** | €1.99/month or €9.99/year | Everything in Pro + real-time co-parent sync |

### Option 2 — Two-tier model

| Tier | Price | What you get |
|---|---|---|
| **Free** | €0 | Feed logging, dashboard, 7-day chart |
| **Pro + Household** | €4.99 one-time | Everything: analytics, export, backup, co-parent sync |

---

## Key Assumptions

**App store cut:** 15% (first year for apps earning under $1M — Apple and Google both apply this)

**Usage window:** Parents typically use a feeding tracker for 3–9 months. Average: 6 months.

**Download projections:**

| Period | Conservative | Moderate | Optimistic |
|---|---|---|---|
| Year 1 avg/month | 500 | 1,500 | 3,000 |
| Year 2 avg/month | 1,000 | 3,000 | 6,000 |

---

## Conversion Rate Assumptions

### Option 1

- **Free → Pro (€4.99):** 15% — modest because it's a two-step funnel; some users stop here
- **Pro → Household monthly (€1.99/mo):** 25% of Pro buyers — those with a co-parent who actively use the app together
- **Pro → Household annual (€9.99/yr):** 35% of Pro buyers — most who want sync prefer the annual deal
- **Avg Household active duration:** 6 months monthly / 10 months annual (churn: baby grows up)

### Option 2

- **Free → Pro+Household (€4.99):** 25% — higher than Option 1 because it's a single decision, simpler pitch, and more perceived value for the same price

---

## Revenue Per 1,000 Downloads (Lifetime Value)

### Option 1

| Revenue source | Calculation | Amount |
|---|---|---|
| Pro buyers | 150 × €4.99 | €749 |
| Household monthly (25% of 150 = 38 users × €1.99 × 6 months) | 38 × €11.94 | €453 |
| Household annual (35% of 150 = 53 users × €9.99 × ~1 renewal) | 53 × €9.99 | €530 |
| **Gross per 1,000 downloads** | | **€1,732** |
| **After 15% store cut** | | **€1,472** |
| Supabase infrastructure cost | ~€0 (free tier to 50k MAU) | €0 |
| **Net per 1,000 downloads** | | **€1,472** |

### Option 2

| Revenue source | Calculation | Amount |
|---|---|---|
| Pro+Household buyers | 250 × €4.99 | €1,248 |
| **Gross per 1,000 downloads** | | **€1,248** |
| **After 15% store cut** | | **€1,061** |
| Supabase infrastructure cost | ~€0 (free tier) | €0 |
| **Net per 1,000 downloads** | | **€1,061** |

---

## Annual Income Projections

### Year 1

| Scenario | Downloads | Option 1 (net) | Option 2 (net) |
|---|---|---|---|
| Conservative | 6,000 | **€8,832** | €6,366 |
| Moderate | 18,000 | **€26,496** | €19,098 |
| Optimistic | 36,000 | **€52,992** | €38,196 |

### Year 2

| Scenario | Downloads | Option 1 (net) | Option 2 (net) |
|---|---|---|---|
| Conservative | 12,000 | **€17,664** | €12,732 |
| Moderate | 36,000 | **€52,992** | €38,196 |
| Optimistic | 72,000 | **€105,984** | €76,392 |

---

## Side-by-Side Comparison

| Factor | Option 1 | Option 2 |
|---|---|---|
| Revenue per 1,000 downloads | **€1,472** | €1,061 |
| Year 1 moderate scenario | **€26,496** | €19,098 |
| Year 2 moderate scenario | **€52,992** | €38,196 |
| Conversion complexity | Two decisions (Pro, then Household) | One decision |
| Recurring revenue | ✅ Yes — monthly subscribers | ❌ No |
| Infrastructure risk | Low — you get paid per active user | Higher — one-time fee funds indefinite sync |
| Pricing clarity | Moderate | ✅ Simple |
| Upgrade appeal | Good upsell message | ✅ "Everything for €4.99" is a strong hook |
| Long-term sustainability | ✅ Better — revenue scales with active users | Weaker — grows only from new downloads |

---

## Verdict

**Option 1 earns ~39% more revenue** at every scale — because the recurring Household subscription converts well and adds meaningful lifetime value per user without raising the entry price.

**Option 2 is simpler to sell** and will convert better at the top of the funnel, but it undersells the ongoing service. Providing indefinite cloud sync for a one-time €4.99 means you're funding Supabase infrastructure and support for free as the user base grows.

**The risk of Option 2** is not the Supabase cost (free tier is generous) — it's that you lose the lever to grow revenue from an existing user base. With Option 1, every new co-parent household is a recurring revenue opportunity. With Option 2, they all paid once and you can never charge them again.

**Recommendation: Option 1.** The Household subscription is easily justified — "you're paying for the ongoing sync service, not the app." If conversion proves slow, you can always run a promotional period of "Pro+Household for €4.99" without permanently destroying the model.
