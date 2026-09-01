# agent-app-dev — Kit 🎒

Kit is the App Developer & Maintainer for the IDEA platform. This repo is Kit's workspace: identity files, memory, and outputs. Code lives in the app repos.

## Role

Four responsibilities:
1. **Service version monitoring** — detect upstream releases, create MC tasks
2. **App updates** — bump compose.yaml, rebuild images, run tests, move to review
3. **New app proposals** — evaluate new apps for offline African schools
4. **Test framework** — own and maintain `app-harness` and per-app test suites

## Workspace structure

```
agent-app-dev/
  AGENTS.md          ← how Kit operates (session startup, memory, rules)
  SOUL.md            ← Kit's personality and working style
  IDENTITY.md        ← Kit's identity card
  USER.md            ← about Koen (the CEO)
  TOOLS.md           ← local notes: API URLs, credentials refs, node IDs
  HEARTBEAT.md       ← heartbeat checklist (keep small)
  MEMORY.md          ← long-term curated memory
  README.md          ← this file
  memory/            ← daily session notes (YYYY-MM-DD.md)
  apps/              ← IDEA app repos, cloned here when actively working on them
  │  app-kolibri/    ←   e.g. git clone koenswings/app-kolibri
  │  app-milkwise/   ←   etc.
  design/            ← design docs, analysis, PDFs (per virtual-company-design convention)
  │  milkwise/       ←   MilkWise commercialisation docs
  varia/             ← non-IDEA side projects
     baby-milk-tracker/  ← Next.js web app (IDEA version, dev server on Pi port 3333)
     milkwise/           ← React Native / Expo app (commercial iOS/Android version)
```

### Folder rules

| Folder | What goes here |
|--------|---------------|
| `apps/` | Clones of IDEA App Disk repos (`app-kolibri`, `app-milkwise`, etc.) when Kit is actively working on them. Delete the clone when done; the repo on GitHub is the source of truth. |
| `design/` | Design docs, analysis documents, PDFs, proposals — anything that is a work output rather than running code. Named subfolders per project. |
| `varia/` | Non-IDEA side projects. Code that is not part of the IDEA platform. Currently: `baby-milk-tracker` and `milkwise`. |
| `memory/` | Daily notes. Created automatically. Do not commit. |

### Naming conventions

| Thing | Name |
|-------|------|
| IDEA App Disk repos | `app-<name>` (e.g. `app-kolibri`, `app-milkwise`) |
| IDEA baby milk tracker app | `baby-milk-tracker` |
| Commercial iOS/Android version | `milkwise` (repo: `koenswings/milkwise-rn`) |
| App Disk wrapper repo | `app-milkwise` |

## IDEA App Disk repos

Kit has direct push access to these:

| Repo | Description |
|------|-------------|
| `koenswings/app-kolibri` | Kolibri offline learning platform |
| `koenswings/app-nextcloud` | Nextcloud file sharing |
| `koenswings/app-kiwix` | Kiwix offline Wikipedia/content |
| `koenswings/app-kolibri-studio` | Kolibri Studio content management |
| `koenswings/app-seafile` | Seafile document collaboration |
| `koenswings/app-milkwise` | Baby milk tracker (IDEA App Disk) |
| `koenswings/app-harness` | Shared test harness (not yet created) |

## Mission Control

- **Board:** App Dev (`0176b84b-5e5c-4297-9bcd-6995ea8d5bcf`)
- **MC Agent ID:** `49bb114f-0194-462c-bb88-4433c1b5995b`
- **API:** `http://127.0.0.1:8000`

## Related repos (not Kit's — do not touch)

- `koenswings/agent-engine-dev` — Axle's engine (Kit reads the WS API, never touches the code)
- `koenswings/agent-console-dev` — Pixel's console UI
