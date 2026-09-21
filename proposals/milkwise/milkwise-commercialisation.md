# MilkWise — Mobile App Commercialisation Plan

**Prepared by:** Kit (App Developer, IDEA Platform)
**Date:** June 2026
**Status:** In Progress

---

## 1. Executive Summary

MilkWise is a precision bottle-feeding tracker built around two insights that existing apps miss: not all feeds are equal over time, and both underfeeding *and* overfeeding carry risks. Its Smoothed Effective calculation gives parents a continuously accurate picture of their baby's energy intake — modelled on running energy balance, not just a rigid 24-hour window — with colour warnings in both directions.

The web app is complete and running. This document covers the plan to bring MilkWise to iOS and Android, ship it on the App Store and Google Play, price it correctly, and market it to reach new parents globally.

---

## 2. The Opportunity

New parents are overwhelmed and sleep-deprived. They need tools that are fast, clear, and trustworthy — especially around feeding, which is the single biggest anxiety for parents of newborns and young infants.

The baby tracking app market is large and growing:

- Over 2,500 baby tracker apps exist on Google Play alone (as of early 2026)
- The category is dominated by broad "do everything" trackers: sleep, nappies, feeding, milestones
- **No major competitor focuses exclusively on the science of milk intake for bottle-fed babies**

That gap is MilkWise's opening.

---

## 3. Competitive Landscape

### 3.1 Direct Competitors

| App | Focus | Price | Weakness |
|---|---|---|---|
| **Huckleberry** | Sleep + feeding | Free / $5.74–$9.99/mo | General purpose; feeding is secondary; no Smoothed calculation |
| **Baby Tracker Pro** | All-in-one log | Free + subscription | No intake analytics; no Smoothed metric |
| **TinyTracks** | Breast milk stash + feeding | In-app purchases | Focused on breastfeeding/pumping; weak on bottle-fed analytics |
| **Glow Baby** | All-in-one | Free + subscription | Very broad; no weight-based targets; no per-feed credit scoring |
| **Baby Feed Timer** | Simple feed timer | ~€2.99 one-off | Minimal; no analytics; no targets |

### 3.2 Key Differentiators for MilkWise

1. **Smoothed Effective metric** — the only app that scores each bottle by how recently it was given, based on an energy balance model: your baby burns energy at a constant hourly rate, so a bottle given 30h ago has partially "spent" its energy. Subtracting the spent portion gives a running energy intake estimate that doesn't drop off a cliff at 24h.
2. **Two-sided warnings** — MilkWise warns on *both* underfeeding and overfeeding. The good zone is 80–105%. Above 105% is flagged yellow; above 110% is red. Below 80% is yellow; below 70% is red. No other baby tracker catches overfeeding.
3. **Weight-based targets** — daily target, hourly rate, and ideal interval all derive from the baby's actual weight
4. **Transparent calculations** — every number can be traced back to the underlying feeds; no black boxes
5. **Designed for bottle feeding** — most apps are breastfeeding-first; MilkWise is built for formula and expressed milk parents
6. **Night-mode first** — the dark UI is deliberate; most feeds happen at night

### 3.3 Market Positioning

> *"MilkWise is not another baby diary. It's a precision feeding calculator for parents who want to know — not guess — whether their baby is on track."*

Target user: parents of formula-fed or combination-fed infants aged 0–12 months, particularly those who have been told a target intake by a paediatrician or health visitor and want to track compliance in real time.

---

## 4. Pricing Strategy

### 4.1 Market Benchmarks

| App | Monthly | Annual (monthly equiv.) |
|---|---|---|
| Huckleberry Plus | $11.99 | $5.74 |
| Huckleberry Premium | $14.99 | $9.99 |
| Baby Tracker Pro | ~$3.99 | ~$2.49 |
| TinyTracks Premium | ~$4.99 | ~$2.99 |

### 4.2 Recommended Pricing for MilkWise

MilkWise is a focused, single-purpose tool. Parents use it intensively for 3–9 months, then stop. A perpetual subscription would feel unfair; a one-time purchase fits the product lifecycle.

**Recommended model: Free with one-time unlock**

| Tier | Price | What you get |
|---|---|---|
| **Free** | €0 | Unlimited feed logging, basic dashboard, 7-day chart |
| **MilkWise Pro** | €4.99 one-time | Smoothed Effective metric, full analytics, CSV export, push notifications, widget, cloud sync |

**Rationale:**

- Parents have a short, intense need window (0–9 months); they won't tolerate "your subscription lapsed" during a 3am feed
- €4.99 is an impulse purchase for a worried parent — it removes all friction
- One-time purchase earns word-of-mouth trust ("I paid once, it just works")

**Annual revenue projection (conservative):**

- 500 Pro purchases/month at €4.99 = ~€2,500/month = **€30,000/year**
- 2,000 Pro purchases/month = **€120,000/year**
- App store cut: 15% (first year, apps earning under $1M) → retain 85%

---

## 5. Build Plan

### 5.1 What Is Already Done

The full application logic exists as a working web app:

- All five screens (Dashboard, Log, History, Analytics, Settings)
- The complete calculation engine (`calculations.ts`) — pure TypeScript, no dependencies, portable as-is
- Data storage layer (`store.ts`) — needs one swap (localStorage → AsyncStorage)
- All UI logic, state management, and edge-case handling


### 5.2 Technology Choice: React Native with Expo

The web app is built in React Native's sibling framework (Next.js + React). Moving to **React Native with Expo** shares the calculation engine and TypeScript types verbatim. No rewrite of business logic — only the UI layer and storage need porting.

Expo provides:

- A single codebase that compiles to both iOS and Android
- The Expo Go app for immediate testing on real devices without a Mac or Xcode
- Managed build service (EAS Build) to produce signed `.ipa` and `.aab` files for store submission — runs in the cloud, no Mac required
- Push notifications, widgets, and local storage out of the box

### 5.3 What Needs to Be Built

| Component | Effort | Notes |
|---|---|---|
| Project scaffold + navigation | Small | Expo + React Navigation tab bar |
| Port `calculations.ts` | None | Copies directly, zero changes |
| Port `store.ts` | Tiny | Swap `localStorage` → `AsyncStorage` |
| Port 5 screens to RN | Medium | Replace Tailwind divs with RN Views and StyleSheet |
| Charts | Small | `victory-native` replaces Recharts |
| Push notifications | Small | Expo Notifications — feed reminder at ideal interval |
| Home screen widget | Medium | Expo Widgets (iOS 16+, Android) — show Smoothed % |
| Household sync (Pro, v1.1) | Medium | Supabase Realtime — household join code, offline-first with background sync |

### 5.4 Build Phases

**Phase 1 — Core app (now in progress)**
Scaffold Expo project, port all five screens, wire up AsyncStorage, port charts. Target: fully functional app testable via Expo Go on any phone.

**Phase 2 — Native features**
Push notifications for feed reminders, home screen widget, quick-log shortcut.

**Phase 3 — Store submission**
EAS Build to produce signed binaries. App Store Connect + Google Play Console setup. Store listing copy (see Section 7). Submit for review.

**Phase 4 — Post-launch**
Monitor reviews, iterate weekly. Add household sync in v1.1 (Supabase, join-code pairing, offline-first).

### 5.5 What Is Needed from Koen

| Item | Required for |
|---|---|
| Apple Developer account ($99/year) | iOS App Store submission |
| Google Play Developer account ($25 one-off) | Android submission |
| App name / brand decision (MilkWise?) | Store listing, domain |
| A physical iPhone or Android device | Testing via Expo Go |
| Expo account (free) | EAS Build cloud compilation |

No Mac is required. EAS Build compiles the iOS binary in the cloud.

---

## 6. Testing Plan

### 6.1 Unit Tests

The calculation engine (`calculations.ts`) is pure functions — it will have a Jest test suite covering:

- Strict 24h boundary conditions (feed exactly at 24h cutoff)
- Smoothed credit decay at various ages
- Edge cases: no feeds, single feed, all feeds expired

### 6.2 Device Testing via Expo Go
During development, the app runs instantly on any physical device using the **Expo Go** app (free, available on App Store and Google Play). Scan a QR code from the terminal — the app loads on the device within seconds. Live reload on save.

### 6.3 Beta Testing
Before store submission: TestFlight (iOS) and Play Internal Testing (Android) allow distributing to up to 10,000 testers without App Store review. Target: 50 parents from r/FormulaFeeders.

---

## 7. Go-to-Market Strategy

### 7.1 Launch Channels

**1. Reddit communities**
Key subreddits: r/NewParents, r/beyondthebump, r/FormulaFeeders, r/babybumps. Parents actively ask for feeding tracker recommendations. An authentic post ("I built this because I needed it") performs far better than paid advertising.

**2. Facebook groups**
Large formula-feeding and new parent groups with hundreds of thousands of members. Admins often allow app recommendations if genuinely useful.

**3. Paediatrician referrals**
Position MilkWise as a clinical-grade logging tool. Create a one-page PDF for paediatric practices to hand to parents who have been given a target intake. High-trust, zero-cost channel.

**4. Parenting blogs and YouTube**
"Tools I actually used as a new parent" content is evergreen. Offer free Pro codes to reviewers.

**5. App Store Optimisation (ASO)**
Target keywords: *bottle feeding tracker*, *formula tracker app*, *baby milk intake calculator*, *feeding schedule baby*. Screenshots should lead with the Smoothed % dashboard.

**6. TikTok / Instagram Reels**
Short clips: "Is my baby eating enough?" → open app → green. Authenticity beats production value here.

### 7.2 Timing

- **Phase 1 complete + Expo Go testable:** Within days
- **Store submission:** After Phase 2 (native features)
- **Hard launch:** Coordinate with at least one parenting blog review on launch day

---

## 8. App Store Listing Copy

*Ready to use on both the Apple App Store and Google Play Store.*

---

### App Name
**MilkWise — Bottle Feeding Tracker**

### Subtitle / Short Description
*Know your baby is feeding enough — in real time*

### Full Description

**Is your baby eating enough today?**

MilkWise gives you a clear, honest answer — not a rough guess.

Most feeding trackers just count what happened in the last 24 hours. MilkWise goes further. It uses your baby's actual weight to calculate a personalised daily target, then scores every bottle against that target using a smart formula that gradually fades out older feeds. The result: a live, accurate picture of your baby's nutritional intake that updates in real time.

---

**🍼 Log a feed in 2 seconds**
Tap a quick button (60 / 90 / 120 ml), confirm the time, done. No menus, no fuss.

**📊 Two numbers that actually mean something — with warnings in both directions**

*Strict 24h* — the total your baby drank in the last 24 hours, exactly.

*Smoothed Effective* — a smarter metric based on energy balance. Your baby burns energy at a steady hourly rate. A bottle from 30 hours ago has spent some of that energy budget — MilkWise subtracts the spent portion, so older feeds fade out gradually rather than disappearing at midnight. The result is a running energy intake estimate that's always accurate.

**🎯 Your baby's target, personalised**
Enter your baby's weight and MilkWise calculates the daily target, the hourly rate, and the ideal interval between feeds — automatically updated whenever weight changes.

**⚠️ Alerts for overfeeding too**
MilkWise is the only feeding tracker that warns when your baby may be getting *too much*. A gentle yellow above 105%, a clear red above 110%. Overfeeding is a real risk — MilkWise is the only tracker that takes it seriously.

**⏰ Know when to feed next**
MilkWise tells you the ideal time for the next feed based on your baby's pace — no guessing, no watching the clock.

**📈 Analytics that make sense**
See daily totals over 7 or 30 days, average gap between feeds, feeding consistency, and totals over the last 3, 7, and 14 days. Export everything as a CSV to share with your paediatrician.

**📋 Full history, fully editable**
Every feed is logged with its credit score so you can see exactly how it contributes to the total. Edit or delete any entry and everything recalculates instantly.

**💡 Built for night feeds**
Dark interface, large text, one-tap logging. Designed to be used at 3am with one hand and no glasses.

**🔒 Your data, your choice**
No ads, ever. The free version stores everything locally on your device — no account, no server, no data leaving your phone. The Pro version adds optional household sync: enable it, get a 6-character join code, share it with your co-parent, and both phones see the same feeds in real time. Cloud sync is fully opt-in; local-only users get the complete tracking experience without creating an account.

---

*Designed for formula-fed and combination-fed babies aged 0–12 months. Consult your paediatrician for medical advice.*

---

### Keywords (App Store)
`bottle feeding tracker`, `formula tracker`, `baby milk intake`, `feeding schedule`, `newborn feeding`, `baby nutrition`, `infant feeding log`, `formula feeding app`

### Category
**Medical** (primary) / **Parenting** (secondary)

---

## 9. Success Metrics

| Metric | 3-month target | 12-month target |
|---|---|---|
| Downloads | 2,000 | 20,000 |
| Pro conversion rate | 15% | 20% |
| App Store rating | ≥ 4.5 ★ | ≥ 4.6 ★ |
| Monthly active users | 800 | 8,000 |
| Monthly revenue | €1,500 | €15,000 |

---

## 10. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| App Store rejection (Medical category) | Avoid diagnostic claims; frame as a logging tool, not a medical device |
| Low discoverability | Invest in ASO from day one; target niche keywords with low competition |
| One-time purchase limits recurring revenue | Add optional annual family plan (€7.99/year) for cloud sync in v1.1 |
| Competition from Huckleberry | Compete on focus and simplicity, not breadth; they will never prioritise the Smoothed metric |
| Privacy concerns | Local-only storage is a feature — make it prominent in all marketing |

---

*MilkWise addresses a real, daily anxiety for millions of parents. The technology is built. The market gap is clear. The path to revenue is straightforward.*
