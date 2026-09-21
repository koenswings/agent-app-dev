# MilkWise Mobile — Data Storage & Sync Analysis

**Prepared by:** Kit
**Date:** June 2026

---

## The Question

How should the MilkWise mobile app store and sync data? Three user needs must be balanced:

1. **New phone continuity** — a parent upgrades their phone and doesn't lose feed history
2. **Co-parent sync** — two parents in the same house see the same data in real time
3. **Cost** — preferably free, or a natural upgrade upsell

---

## Option A — Device-Only (Local Storage)

**How it works:** All data lives in AsyncStorage on the phone. Nothing leaves the device.

| | |
|---|---|
| **Cost** | Free forever |
| **New phone** | ❌ Data lost unless manually exported (CSV) and re-imported |
| **Co-parent sync** | ❌ Not possible |
| **Privacy** | ✅ Best — data never leaves the device |
| **Complexity** | ✅ Zero — already built |

**Verdict:** Fine for solo use, but losing data on a new phone is a dealbreaker for most parents. Not viable as the only option.

---

## Option B — iCloud / Google Drive (Native Platform Sync)

**How it works:** Use `expo-file-system` + iCloud Documents (iOS) or Google Drive App Data (Android) to sync the JSON data file automatically.

| | |
|---|---|
| **Cost** | Free — uses the user's own iCloud/Google storage quota |
| **New phone** | ✅ Seamless — restores automatically on new device |
| **Co-parent sync** | ⚠️ Limited — iCloud syncs between the same Apple ID's devices; different accounts (two iPhones) won't share data |
| **Privacy** | ✅ Good — stored in user's own cloud account |
| **Complexity** | Medium — platform-specific implementation; iOS and Android behave differently |

**Verdict:** Excellent for single-user continuity across devices. Co-parent sync only works if both parents use the same Apple ID — unusual and impractical. Not a full solution.

---

## Option C — Supabase (Free Tier)

**How it works:** Supabase is an open-source Firebase alternative with a generous free tier. Each user gets an account; feeds are stored in a Postgres database in the cloud. Co-parents join the same "household" via a short join code and see shared data in real time.

| | |
|---|---|
| **Cost** | Free up to 500MB DB, 50,000 monthly active users. Paid from $25/month for larger scale |
| **New phone** | ✅ Seamless — log in on new device, data appears |
| **Co-parent sync** | ✅ Full — any device in the same household sees the same data in real time |
| **Privacy** | ⚠️ Data on Supabase servers (EU region available) |
| **Complexity** | Medium — requires auth flow (email/password or magic link), household concept |
| **Free tier ceiling** | 50,000 MAU is very generous — MilkWise could run free for years at typical growth |

**Verdict:** Best overall option for co-parent sync. The free tier is large enough to run the entire app for free at early scale. Risk: if Supabase changes pricing, costs could emerge — but data can be self-hosted on a VPS if needed.

### Household design (Supabase)

**Data model:**

```sql
Household
  id          uuid  PRIMARY KEY
  join_code   text  UNIQUE   -- e.g. "MW-4X9K", shown in Settings
  created_at  timestamptz

Profile
  id            uuid  PRIMARY KEY  -- Supabase Auth user id
  household_id  uuid  REFERENCES household(id)
  display_name  text

Feed
  id            uuid  PRIMARY KEY  -- generated on device
  household_id  uuid  REFERENCES household(id)
  timestamp     bigint             -- Unix ms
  volume        numeric
  updated_at    timestamptz        -- for conflict resolution
  deleted_at    timestamptz        -- soft delete; NULL = active
```

**Join flow (designed for exhausted parents):**
1. First parent taps "Enable sync" in Settings → account created (email + password or magic link) → household auto-created → 6-character join code shown (e.g. `MW-4X9K`)
2. Second parent installs app → taps "Join household" → enters code → instantly linked
3. Both see the same feeds in real time via **Supabase Realtime** (WebSocket subscription on `feed` table filtered by `household_id`)

**Offline behaviour:**
- Feeds always log to AsyncStorage first (instant, no network required)
- Background sync to Supabase when connection is available
- Conflict resolution: last-write-wins per feed UUID (safe — feeds are mostly append-only; edits and deletes propagate via `updated_at` / `deleted_at`)
- On reconnect: client pushes any locally-queued writes, then pulls any remote changes since last sync timestamp

**What Pro gates:**
- Free: local-only + iCloud/Google Drive backup (no account, no friction)
- Pro: Supabase sync enabled, join code available, co-parent invite flow

**Upsell message:**
> *"Two parents, one view. Enable household sync and anyone at home can log feeds and see the same data — in real time, on any phone."*

---

## Option D — Self-Hosted API (The IDEA Pi approach)

**How it works:** The web app's API (already built, running on the Pi) is extended to accept mobile connections. Data stored on the Pi. This is essentially what the web app already does.

| | |
|---|---|
| **Cost** | Free — uses the Pi the user already has |
| **New phone** | ✅ Seamless |
| **Co-parent sync** | ✅ Full |
| **Privacy** | ✅ Best — on-premises |
| **Complexity** | High — requires the user to have the web app running and reachable (Tailscale or port forwarding) |

**Verdict:** Perfect for IDEA-internal use and power users. Not viable as the default for a public app — too much setup required.

---

## Option E — Firebase (Google)

**How it works:** Same concept as Supabase but Google's product. Firestore for real-time sync.

| | |
|---|---|
| **Cost** | Free tier: 1GB storage, 50,000 reads/day, 20,000 writes/day. Generous for feeding data (small payloads) |
| **New phone** | ✅ |
| **Co-parent sync** | ✅ Real-time via Firestore listeners |
| **Privacy** | ⚠️ Google |
| **Complexity** | Medium |

**Verdict:** Functionally equivalent to Supabase. Firebase has better React Native SDKs but locks data into Google infrastructure. Supabase is preferred for independence.

---

## Recommendation

### Tier 1 — Free (Default)
**Local storage + iCloud/Google Drive backup**

- Data stored on device
- Auto-backup to the user's own cloud account (iCloud for iPhone, Google Drive for Android)
- Restores on new phone automatically
- Zero cost to you, zero cost to user
- No account required

### Tier 2 — Pro (€4.99 one-time or included with Pro)
**Supabase household sync**

- Requires creating a MilkWise account (email + password)
- Creates a "household" — share a code with co-parent to join
- Real-time sync: both parents see feeds, both can log
- Works across any device, any platform
- Supabase free tier covers this indefinitely at early scale

**Cost to you:**
- Supabase free tier: $0/month up to 50,000 MAU
- If MilkWise ever reaches 50,000 active households syncing: $25/month — at which point revenue from Pro upgrades would far exceed this

**Upsell message for users:**
> *"Two parents, one view. Enable household sync and any parent at home can log feeds and see the same data — in real time, on any phone."*

---

## Summary Table

| Option | New phone | Co-parent sync | Cost to you | Cost to user |
|---|---|---|---|---|
| A — Local only | ❌ | ❌ | $0 | $0 |
| B — iCloud/GDrive | ✅ | ⚠️ Same account only | $0 | $0 |
| C — Supabase | ✅ | ✅ | $0 (free tier) → $25/mo at scale | $0 (included in Pro) |
| D — Self-hosted | ✅ | ✅ | $0 (Pi) | Setup effort |
| E — Firebase | ✅ | ✅ | $0 (free tier) | $0 |

**Proposed architecture:**
- **Free tier:** Local + iCloud/Google Drive (no account, no friction)
- **Pro tier:** Supabase household sync (account required, upsell opportunity)
