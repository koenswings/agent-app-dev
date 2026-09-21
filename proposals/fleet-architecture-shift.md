# Fleet Architecture Shift — Design Notes

**Status:** Implemented (2026-06-05)
**Author:** Koen Swings + Kit
**Scope:** Wizardly-hugle cleanup, fleet Pi access, IDEA App testing convention

---

## The Decision

Move all IDEA App testing and access from wizardly-hugle (dev server + Caddy proxy) to real IDEA engine instances running on fleet Pis. Wizardly-hugle is the agents' workspace and code store — not a place to run apps.

---

## What Changes

### Remove from wizardly-hugle
- Caddy installation + Caddyfile + TLS cert
- `baby-milk-tracker.service` (systemd service running Next.js on port 3334)
- Any other app-level dev or production server

Wizardly-hugle remains: agent workspace, code repos, data store, OpenClaw runtime.

### Add to fleet Pis
- **Tailscale** on each fleet Pi — enabled the same way a field Pi would enable it (Axle to implement, product-compliant)
  - Naming convention: `idea02.tail2d60.ts.net`, `idea03.tail2d60.ts.net`, etc. (confirm with Axle)
- **Console app** on each fleet Pi — Pixel to enable; remove any console dev server from wizardly-hugle

### Testing convention going forward
Whenever Kit builds a new IDEA App or upgrades one, and Koen wants to try it:
- Kit creates an instance on a fleet Pi via the real IDEA engine
- Access is via the fleet Pi's Tailscale address + assigned port
- No more Caddy proxies, no more dev servers

---

## Migration Plan

### Phase 1 — Fleet Pi Tailscale (Axle)
1. Axle enables Tailscale on all fleet Pis (idea02, any others) using the same enrollment flow as a field Pi
2. Confirm naming: `idea02.tail2d60.ts.net` (or whatever the convention is)
3. Verify Koen can reach idea02 milkwise at `http://idea02.<tailnet>:3333`

### Phase 2 — Console on fleet Pis (Pixel)
1. Pixel enables console app on all fleet Pis
2. Pixel removes any console dev server or production server from wizardly-hugle

### Phase 3 — Wizardly-hugle cleanup (Kit, after Phase 1 complete)
1. Update `EXPO_PUBLIC_API_URL` in milkwise RN to point to fleet Pi Tailscale address
2. Stop + disable `baby-milk-tracker.service`
3. Remove Caddy + Caddyfile
4. Archive `data/feeds.json` on wizardly-hugle (source of truth is now idea02 instance data)
5. Document that `baby-milk-tracker` repo is source only — it does not run standalone

---

## Open Questions

| Question | Owner | Notes |
|----------|-------|-------|
| Tailscale naming convention for fleet Pis? | Axle | Should match field Pi enrollment pattern |
| Which fleet Pis exist beyond idea02? | Koen | Need full list for Tailscale rollout |
| Does Expo Go dev mode need a fixed URL or can it be configured per-run? | Kit | Currently hardcoded in `.env.local` |
| Should fleet Pi ports be exposed directly or still behind a local proxy? | Koen/Axle | Direct Tailscale access + port seems cleanest |

---

## Impact on Current Setup

| Item | Today | After |
|------|-------|-------|
| Milkwise access | `https://idea.tail2d60.ts.net` (Caddy → idea02) | `http://idea02.<tailnet>:3333` |
| Console | wizardly-hugle dev server | idea02 (and other fleet Pis) |
| Expo Go dev | connects to wizardly-hugle via Tailscale | connects to idea02 via Tailscale |
| feeds.json source of truth | wizardly-hugle `/data/feeds.json` | idea02 `/instances/milkwise-idea02-001/data/feeds.json` |
| baby-milk-tracker repo | source + running service | source only |

---

## Cross-Agent Tasks to Open (when approved)

- `[From Kit] Feasibility: Tailscale on fleet Pis — product-compliant enrollment` → Axle
- `[From Kit] Feasibility: Console app on fleet Pis + remove wizardly-hugle console server` → Pixel

---

## Notes

- Do **not** remove Caddy until Tailscale is confirmed working on idea02. Removing it first cuts off Tailscale access to the current milkwise app.
- The `baby-milk-tracker` Next.js repo stays — Kit uses it as the source to build the IDEA App image. It just doesn't run as a standalone service anywhere.
- Future apps follow the same pattern: source in `varia/` or `apps/`, deployed as an IDEA App on a fleet Pi, accessed via Tailscale.
