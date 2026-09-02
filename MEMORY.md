# MEMORY.md - Kit 🎒 Long-Term Memory

_Curated. Not a log - a distilled model of what matters._

---

## Who I am

- **Name:** Kit 🎒
- **Role:** App Developer & Maintainer, IDEA platform
- **Agent ID:** `app-dev`
- **MC Agent ID:** `49bb114f-0194-462c-bb88-4433c1b5995b`
- **Board:** App Dev (ID: `0176b84b-5e5c-4297-9bcd-6995ea8d5bcf`)
- **Telegram group:** IDEA - Kit (chat ID: `-5296497974`)
- **Runtime:** Native on Pi (`wizardly-hugle`, Tailscale IP `100.115.60.6`)
- **Workspace:** `/home/node/workspace/agents/agent-app-dev`

---

## Who I'm helping

- **Koen Swings** - founder/CEO of IDEA
- **Standing principle:** No temporary solutions. Every fix must be reboot-safe and reinstall-safe.

---

## My four responsibilities

1. **Service version monitoring** - detect new upstream releases; create MC tasks
2. **App updates** - update compose.yaml, rebuild images, test, move to review
3. **New app proposals** - identify and evaluate apps for offline African schools (Marco-initiated primarily; Kit-initiated max once per quarter)
4. **Test framework** - own and maintain the app-level compatibility test harness (`app-harness`)

---

## My repos (direct push access)

- `koenswings/agent-app-dev` - workspace (identity, memory, outputs)
- `koenswings/app-harness` - shared test harness _(not yet created)_
- `koenswings/app-kolibri`
- `koenswings/app-nextcloud`
- `koenswings/app-kiwix`
- `koenswings/app-kolibri-studio`
- `koenswings/app-seafile`
- `koenswings/app-milkwise` - IDEA App Disk wrapper for the baby milk tracker

---

## Workspace folder structure

```
agent-app-dev/
  AGENTS.md, SOUL.md, IDENTITY.md, USER.md, TOOLS.md, HEARTBEAT.md
  MEMORY.md
  memory/            ← daily notes
  apps/              ← clones of IDEA app repos when working on them
                        e.g. apps/app-kolibri/, apps/app-milkwise/
  design/            ← design docs, analysis, PDFs (per virtual-company-design convention)
    milkwise/        ← MilkWise commercialisation docs
    kit-app-dev-agent-full.pdf
  varia/             ← non-IDEA side projects
    baby-milk-tracker/   ← Next.js web app (IDEA version, local dev server)
    milkwise/            ← React Native app (commercial iOS/Android version)
```

### Naming conventions
- IDEA App Disk repos: `app-<name>` (e.g. `app-kolibri`, `app-milkwise`)
- The IDEA baby milk tracker app: **`baby-milk-tracker`** (GitHub: `koenswings/baby-milk-tracker`, local: `varia/baby-milk-tracker/`)
- The commercial iOS/Android version: **`milkwise`** (GitHub: `koenswings/milkwise-rn`, local: `varia/milkwise/`)
- App repos cloned for IDEA work go in `apps/` - **not** `varia/`
- Design docs, analysis, proposals go in `design/` - **never** in `varia/` or `apps/`

---

## Platform context

### The IDEA platform

Agents running on a Raspberry Pi 500+:
- **Atlas** - operations manager (MC agent: `ac172302-3c45-4a51-bdb3-dc233a0f65e8`)
- **Axle** - engine/backend dev (MC agent: `8a0b3f32-8ebd-4b9b-93ff-1aad53269be3`)
- **Pixel** - console/frontend dev (MC agent: `bd2b264f-4727-4799-8522-66114cc59a1c`)
- **Marco** - programme manager (MC agent: `c1aeb3f8-a258-448f-afcb-f518bdc47bca`)
- **Beacon** - site dev (MC agent: `70404eba-4e1c-4d2d-bcb5-f34bfd32ad7b`)
- **Kit** (me) - app developer (MC agent: `49bb114f-0194-462c-bb88-4433c1b5995b`)

**Stack:**
- OpenClaw: native systemd user service (`pi` user)
- MC API: `http://127.0.0.1:8000` (from host/agents)
- MC UI: `https://idea.tail2d60.ts.net:4000`
- Tailscale hostname: `idea` (IP `100.115.60.6`)

---

## App architecture

### Terminology
- **App** - a `compose.yaml` defining one or more Services; the unit on an App Disk
- **Service** - a single Docker container within an App
- **app.yaml** - per-app manifest (build approach + monitoring + compatibility)
- **App Disk** - physical USB disk containing one App plus one data variant

### Service build approaches
| `build` | Meaning |
|---------|---------|
| `custom` | Kit maintains a Dockerfile; builds image on Pi from external resources |
| `retag` | Kit pulls a public DockerHub image and re-tags it under `koenswings/` |
| `direct` | compose.yaml references an upstream image directly (discouraged) |

### DockerHub namespace
`koenswings/` (personal account). Migrate to dedicated org when GitHub org name decided.

### Image builds
All image builds run on the Pi by Kit directly. No GitHub Actions. ARM images built on ARM hardware.

---

## Test harness design (Addendum A - approved)

Kit starts a **real engine process** on a secondary port (18800), talks to it over the WebSocket API, tears it down after each test run.

```
IDEA_ENGINE_PORT=18800
IDEA_STORE_DIR=/tmp/kit-test-store-$$
IDEA_TEST_MODE=true
IDEA_SYSTEM_DISK_SKIP=true
```

**Test types:** smoke (HTTP health), UI (Playwright), data migration, offline (no outbound network)

---

## Cross-agent task convention

**Title format:** `[From <Sender>] <Type>: <short description>`
**Types:** `Feasibility` | `Review` | `Opinion` | `Done` | `FYI`
**Rules:** tag `cross-agent`, one ask per task, depth-1 only, reply by comment.

---

## Work cycle

- MC task = unit of work. Nothing starts until CEO moves task to `in_progress`.
- Work on a `feature/<short-description>` branch; post branch name as task comment immediately.
- Test results go in task comment verbatim.
- When done: open a GitHub PR (no auto-merge), post PR URL as MC task comment, move task to `review`.
- CEO reviews via MC task thread + GitHub PR diff; CEO merges the PR on GitHub.
- CEO moves MC task to `done` and messages Kit in Telegram to continue.
- Kit posts merge confirmation as MC task comment.
- **No agent self-merge** - only CEO merges to main.

---

## Fleet Pi infrastructure (settled 2026-06-05)

| Pi | Tailscale hostname | Tailscale IP |
|----|-------------------|-------------|
| idea02 | idea02.tail2d60.ts.net | 100.85.108.118 |
| idea03 | idea03.tail2d60.ts.net | 100.126.117.80 |

### Wizardly-hugle is workspace only
- No app servers, no Caddy, no dev servers run on wizardly-hugle
- Caddy removed 2026-06-05
- baby-milk-tracker.service stopped and disabled 2026-06-05
- `data/feeds.json` archived as `feeds.json.archived-2026-06-05` - source of truth is now idea02 instance data

### Fleet Pi = playground rule
- Whenever Kit builds or upgrades an IDEA App and Koen wants to try it → create an instance on a fleet Pi via the real IDEA engine
- Access via fleet Pi Tailscale address + assigned port (no proxies)
- baby-milk-tracker repo stays as build source only - does not run standalone

### Expo Go dev mode
- `EXPO_PUBLIC_API_URL=http://100.85.108.118:3333` (idea02)
- Set in `.env.local` (gitignored), documented in milkwise README

### Completed (2026-06-05)
- Pixel: Console app enabled on fleet Pis, wizardly-hugle console server removed ✅
- Tailscale tags (school-pi) not applied - not needed for current lab setup, revisit for production field Pi policy

---

## MilkWise / Baby Milk Tracker - codebase rules (decided 2026-06-03)

### Naming
- **`baby-milk-tracker`** - the IDEA App version (Next.js web app, served on Pi at port 3333)
- **`milkwise`** - the commercial iOS/Android version (React Native / Expo)
- **`app-milkwise`** - the IDEA App Disk wrapper repo

### Shared core sync rule
These two files are shared core between `baby-milk-tracker` and `milkwise`:
- `src/types/index.ts`
- `src/lib/calculations.ts`

**Any change to either file must be applied to both repos in the same work session.** Store and UI files are intentionally separate.

### UI mirror rule
**Whenever a UI change is applied to `baby-milk-tracker`, always propose applying the equivalent change to `milkwise` as well.** Do not wait to be asked. Raise it proactively at the end of each web UI change.

### Architecture decision
Keep the two repos separate (no monorepo for now). Revisit if MilkWise goes to the App Store and active feature development picks up.

---

## IDEA App compose.yaml conventions

### network_mode: host - when NOT to use it
`network_mode: "host"` is only justified when an app uses **unknown or dynamic port numbers that cannot be configured** (e.g. Kolibri's peer discovery, content server ports). Do not use it as a shortcut.

**Correct approach for all standard apps:**
```yaml
ports:
  - "${port:-<default>}:<internal_port>"
environment:
  - PORT=<internal_port>   # fixed inside the container
```
The engine assigns the external `${port}` via `.env`. The internal port is fixed. `ports:` mapping handles the rest.

**app-milkwise** was corrected on 2026-06-05 from `network_mode: host` to `ports: ["${port:-3333}:3333"]`. Internal port is always 3333 (baked into image). This was also fixed in the app-harness fixture.

---

## Key architectural decisions (inherited from design docs)

| Decision | Outcome |
|----------|---------|
| Test harness approach | Subprocess + WebSocket API (not direct import of engine internals) |
| CI | None - all builds on Pi |
| CEO approval mechanism | MC task moves to `done` (not GitHub merge) |
| No BACKLOG.md | MC board is the task queue |

---

## Bootstrap tasks (Kit's first IDEA work once activated)

1. Write harness: subprocess engine + WebSocket bootstrap/teardown
2. Write smoke + UI tests for each of the 5 apps
3. Write `app.yaml` for each of the 5 apps
4. Audit each of the 5 app repos (current state, CI, structure)
5. Open MC task per app repo for bootstrap work

---

## Significant events

| Date | Event |
|------|-------|
| 2026-06-02 | Kit onboarded by Atlas - OpenClaw config, MC board (App Dev), identity files, Telegram binding set up |
| 2026-06-02 | Built `baby-milk-tracker` (Next.js web app) and `milkwise` (React Native) as side projects |
| 2026-06-03 | Corrected workspace structure per design doc; `varia/` for non-IDEA projects, `apps/` for IDEA app repos |

---

## iOS / TestFlight setup (completed 2026-09-01)

- Apple Developer account: `koen.swings@me.com`
- Bundle ID: `com.koenswings.milkwise`, ASC App ID: `6796410350`
- `.p8` key: ID `HYRJUKYMTB`, Issuer `a0b17ef9-b9bc-4c4d-9b27-074fe6587570`, file: `varia/milkwise/AuthKey_HYRJUKYMTB.p8`
- EAS credentials managed by EAS (dist cert + provisioning profile, valid to Jul 2027)
- `eas.json` submit block configured with Apple API key
- Build 3 in TestFlight (build number 3, v1.0.0, preview profile)
- **TestFlight email invite issue:** Koen not receiving invite emails. Workaround: public link via External Testing group, or Apple Configurator 2 sideload.
- To re-run EAS build: `EXPO_TOKEN=gDC-sqF9kLgF-k4jfuPzWdQRE-AuUoyBWpFqwItQ EXPO_APPLE_ID=koen.swings@me.com eas build --platform ios --profile preview --non-interactive`
- To submit: use Transporter on Mac (EAS submit had outage issues)

---

## agent-app-dev git repo (set up 2026-09-01)

Workspace is now a proper git repo pointing to `koenswings/agent-app-dev`.
- All design docs, identity files, memory tracked there
- The `idea` monorepo gitignores `agents/` — agent workspaces need their own repos
- Push after any significant session: `cd /home/pi/idea/agents/agent-app-dev && git add -A && git commit -m "..." && git push origin main`

---

## Ghost marker correctness rule (2026-09-01, hard-won)

Ghost markers on the feeding timeline must:
1. Use `lastFeed.timestamp` as reference (NOT `now`)
2. Threshold: `D × 1.005 - milkMl - 0.1` (NOT `D - milkMl`) — Math.round boundary
3. Return `Math.ceil(hi / 60_000) * 60_000` — ceil to full minute, not midpoint

All three are required. Missing any one causes the displayed time to show 101% instead of 100%.

---

## iOS dashboard rewrite (v1.1.0, build 4, 2026-09-02)

- Full DashboardScreen.tsx rewrite matching web app layout
- StatusCard: combined intake + stomach, frozen at lastFeed.timestamp
- FeedingTimeline: react-native-svg scrollable SVG with ghost/advised/future markers
- store.ts: `USE_API = API_URL.length > 0` (production builds use Pi API)
- WHO weight model NOT ported to RN — uses `weightKg × mlPerKgPerDay` directly
- app.json: version 1.1.0, buildNumber 4

---

## Version bump rule (non-negotiable, 2026-06-18)

Every deploy MUST bump the version in TWO places:
1. `src/app/page.tsx` - the `v1.0.XX` span in the dashboard header
2. `src/app/settings/page.tsx` - `const APP_VERSION = "1.0.XX"`

Never commit without updating both. This is how Koen verifies the deploy worked.

## MilkWise build procedure (cache-safe, corrected 2026-07-07)

The Next.js source is in `varia/baby-milk-tracker/`.
The Dockerfile is in `apps/app-milkwise/app/` and copies `.next/standalone` from its own context.
These are TWO SEPARATE directories — the build output must be COPIED across before Docker build.

**ALWAYS follow this exact order:**

```bash
# 1. Build Next.js (source of truth)
cd varia/baby-milk-tracker && npm run build

# 2. Copy build output into Docker context (CRITICAL — do not skip)
cp -r varia/baby-milk-tracker/.next/standalone/. apps/app-milkwise/app/.next/standalone/
cp -r varia/baby-milk-tracker/.next/static/. apps/app-milkwise/app/.next/static/
cp -r varia/baby-milk-tracker/public/. apps/app-milkwise/app/public/ 2>/dev/null || true

# 3. Verify server.js is present
ls apps/app-milkwise/app/.next/standalone/server.js

# 4. Build Docker image with --no-cache (prevents stale layer reuse)
cd apps/app-milkwise && docker build --no-cache -t koenswings/milkwise:1.0.XX -t koenswings/milkwise:latest ./app

# 5. Push both tags
docker push koenswings/milkwise:1.0.XX && docker push koenswings/milkwise:latest

# 6. Deploy on idea02
ssh pi@idea02.tail2d60.ts.net "docker rmi koenswings/milkwise:latest 2>/dev/null || true && docker pull koenswings/milkwise:1.0.XX && sudo sed -i 's/milkwise:1\.0\.[0-9]*/milkwise:1.0.XX/' /instances/milkwise-idea02-001/compose.yaml && cd /instances/milkwise-idea02-001 && docker compose up -d --no-build"
```

**Why step 2 is critical:** Docker builds from `apps/app-milkwise/app/` as context. If you don't copy
the fresh `.next/standalone` there first, Docker packages the old/empty standalone — even with `--no-cache`.
This was the root cause of builds appearing to succeed but the app never updating on idea02.

`next.config.ts` sets `Cache-Control: no-cache, no-store, must-revalidate` on all HTML routes.
Never remove this — it's what makes browser updates work instantly.

## AUTH_TOKEN issue (2026-06-17)

The `AUTH_TOKEN` in `.env` returns 401 Unauthorized on the heartbeat endpoint.
Use `MC_PLATFORM_TOKEN` as fallback for all MC API calls until token is refreshed.
Heartbeat: `POST /api/v1/agents/{AGENT_ID}/heartbeat` with `MC_PLATFORM_TOKEN` + body `{}`.

---

## §3.5 + §3.6 feature - shipped (2026-06-19)

All features shipped across 13 versions (1.0.65 → 1.0.78). See memory/2026-06-19.md for full version history.
Latest deployed: **1.0.78** (centripetal Catmull-Rom spline on trend graph).
milkwise RN (`varia/milkwise/`) has NOT been updated with these changes - UI mirror rule applies, raise with Koen.

## Predictor design v3 - major redesign (2026-06-27 to 2026-06-29)

Full clean-sheet rewrite. Key model changes from v2:
- **24h rolling intake** `I(T)` replaces all-time balance
- **Equilibrium corrected:** `I` oscillates between `D` and `D+m0` (not `D-m0` to `D`)
- **Predictor A:** `V_A = (D + m0) - I(T_A)` - restore to equilibrium peak
- **Predictor B:** `I(T_B) = D` - feed when intake decays back to daily target
- Stomach cap: `Δt_min = max(0, (m_last + m0 - m_cap) / λ)`
- No "late feed" framing - talk about underfeed/overfeed states only

**Files:**
- Source: `design/milkwise/next-session-predictor-design-v3.md`
- Rebuild PDF: `python3 design/milkwise/gen-v3-pdf.py` (KaTeX + WeasyPrint)
- Diagrams: `python3 design/milkwise/gen-diagrams.py` + `gen-diagrams-v2.py`

**Toolchain:** KaTeX CLI (global) + WeasyPrint. SVGs embedded via local `base_url`.

**Approved:** Option 3 diagram style, KaTeX formulas, show exact ml to parent.

**Open questions (§12):** surplus display, multi-bottle deficit recovery, minimum bottle floor, gauge anchoring clarity.

**Also:** `weight-compensation-design.md` reviewed - Jenss-Bayley growth model, not yet implemented.



---

## WHO weight prediction short-circuit (added 2026-07-25)

If the latest measured weight is ≤ 7 days old, the app uses it directly as `effectiveWeightKg`
and skips the WHO growth model projection entirely (weightSource = 'manual').

The WHO projection only runs when there is no weigh-in in the last 7 days.

**Why:** The WHO model averages all historical z-scores. If older measurements put the baby at a
higher z than the latest one, the projection overshoots the real weight (e.g. 7.62 kg when 7.5 kg
was just measured). The fix: when you have a fresh measurement, trust it.

Shipped in v1.1.37 (`page.tsx`, `settings/page.tsx`).

---

## milkwise display principle (non-negotiable, decided 2026-06-08)

All status calculations are frozen at `lastFeed.timestamp`. The app shows the energy state at the moment of the last feed - not now.

- `smoothedAt = lastFeed.timestamp` always
- Smoothed %, strict %, bottle counts, next feed times: only update when a new feed is logged or settings change
- `now` is only used for relative time labels ("in 2h 15m") - updated via a 60s clock tick that does NOT reload feeds
- The 60s `setInterval(() => load(), 60000)` was wrong and has been removed
- A parent can wait a day before logging. The app still shows the correct status at that last feed.
