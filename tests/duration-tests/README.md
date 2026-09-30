# Duration-tests App fixtures (idea#166)

Versioned App Disk trees that Axle’s unified walker and Pixel’s adapters can
point at for Markov duration tests
([agent-engine-dev#144](https://github.com/koenswings/agent-engine-dev/pull/144)
`proposals/duration-tests.md`).

**Kid ownership:** App fixtures only. Class-instance Console selectors are
Pixel; walker YAML / settle / invariants are Axle; claim/teardown is Atlas
([idea#167](https://github.com/koenswings/idea/pull/167) Ops hooks).

## Design Review gates (honoured here)

| Gate | How this pack answers |
|------|------------------------|
| Versioned App fixtures (not ad-hoc) | Trees under `fixtures/{kolibri,nextcloud}/` with stable `diskId` / `instanceId` + `CONTENT.yaml` catalogues |
| Don’t equate Playwright browser watchers with idea#159 HTTP stream Ns | Documented in Kolibri `content/seed-notes.md` and `walker-ref.yaml` — #159 Ns are HTTP Range planning figures only |
| Class-instance selectors are Console/Pixel | Fixtures expose stable instance + content logical IDs only; no Console `data-testid` claims |

## Phase 1–2 scope

Phase 1–2 fixtures are **dockable App Disk trees** plus docs that map content
to **future** deeper Intents. The walker YAML Axle locked for Phase 1–2 uses
these **exact** action keys (do not invent aliases):

### Hub

| Action key |
|------------|
| `open_console_as_teacher` |
| `open_console_as_learner` |
| `open_console_as_operator` |
| `enter_infra_fleet_walk` |
| `return_to_start` |

### Minimal usage

| Action key |
|------------|
| `stay_on_teacher_overview` |
| `stay_on_learner_overview` |

### Infra (fixture dock targets)

| Action key | Fixture role |
|------------|--------------|
| `infra_undock_fixtures` | Undock these disks |
| `infra_dock_fixture` | Dock `duration-kolibri-grade5a-001` and/or `duration-nextcloud-grade5a-001` |
| `infra_move_disk` | Move a docked fixture disk across pool Engines |
| `infra_reboot_engine` | Reboot a **pool** Engine (never golden idea02) |

Deeper Kolibri / Nextcloud Intents (when Phase 3+ adds them) stay **proposal
snake_case** — see [Future deeper Intents](#future-deeper-intents-snake_case).
CONTENT catalogues below already use those snake_case names so later YAML can
plug in without renaming fixture docs.

## Layout

```
tests/duration-tests/
  README.md                 ← this file
  walker-ref.yaml           ← fixture diskIds + Phase 1–2 / future Intent map
  fixtures/
    kolibri/                ← App Disk tree + content catalogue
    nextcloud/              ← App+Files Disk tree + preload folders
    kiwix/README.md         ← deferred (Phase 3 / optional)
```

## Pack inventory

| Pack | diskId | instanceId | What walkers get |
|------|--------|------------|------------------|
| Kolibri Grade 5A | `duration-kolibri-grade5a-001` | `kolibri-grade5a-001` | Dockable tree for `infra_dock_fixture`; content catalogue for future `open_video` / `open_exercise` |
| Nextcloud Grade 5A | `duration-nextcloud-grade5a-001` | `nextcloud-grade5a-001` | Dockable App+Files tree; folders for future `share_to_class` / `open_file_drop` / `open_collab_doc` |
| Kiwix | — | — | **Not included** — omit from Phase 1–2 YAML |

### Kolibri content notes

- Catalogue: [`fixtures/kolibri/content/CONTENT.yaml`](fixtures/kolibri/content/CONTENT.yaml)
- Seed: [`fixtures/kolibri/content/seed-notes.md`](fixtures/kolibri/content/seed-notes.md)
- Image: `koenswings/kolibri:1.0-0.15.5-dev` (host network; walker HTTP often `:18080`)
- Logical IDs: `class-grade5a`, `video-grade5a-01`, `exercise-grade5a-01`
- Live Kolibri UUIDs filled after seed → optional `CONTENT.seeded.json`

### Nextcloud content notes

- Catalogue: [`fixtures/nextcloud/CONTENT.yaml`](fixtures/nextcloud/CONTENT.yaml)
- `x-app.filesMount` on; `FILES.yaml` share name **Grade 5A Files**
- Preload dirs under `fixtures/nextcloud/files/`:
  - `Class Materials/` — view-only share to group Grade 5A
  - `Drop Zone/` — File Drop / file-request target
  - `Collab/Grade5A-collab-notes.md` — **placeholder** (Collabora/`code` service omitted tonight)
- Port in fixture `.env`: `18280` (password via `${pass}`, not hardcoded in compose)

### Kiwix

See [`fixtures/kiwix/README.md`](fixtures/kiwix/README.md). Phase 3 / optional.

## How walker YAML should reference these

See [`walker-ref.yaml`](walker-ref.yaml). Phase 1–2 sketch:

```yaml
# Axle scenario — action keys must match the locked set above
fixtures:
  kolibri:
    path: tests/duration-tests/fixtures/kolibri
    diskId: duration-kolibri-grade5a-001
    instanceId: kolibri-grade5a-001
  nextcloud:
    path: tests/duration-tests/fixtures/nextcloud
    diskId: duration-nextcloud-grade5a-001
    instanceId: nextcloud-grade5a-001
# kiwix: omit for Phase 1–2

# illustrative infra edges
# infra_dock_fixture → diskId: duration-kolibri-grade5a-001
# infra_undock_fixtures / infra_move_disk / infra_reboot_engine
# hub: open_console_as_* / enter_infra_fleet_walk / return_to_start
# minimal usage: stay_on_teacher_overview / stay_on_learner_overview
```

Reuse existing harness patterns: dock like `tests/app-nextcloud/fixture`,
`tests/app-erase-test/fixture`. Pack trees into `.img` later via
`script/build-app-disk-image.sh` if Atlas needs stick images (idea#167 hooks).

## Future deeper Intents (snake_case)

Not Phase 1–2 walker actions — catalogue mapping only so later YAML can adopt
without renaming fixture docs:

| Future action key | Content logical ID | Pack |
|-------------------|--------------------|------|
| `open_video` | `video-grade5a-01` | kolibri |
| `open_exercise` | `exercise-grade5a-01` | kolibri |
| `browse_classes` | `class-grade5a` | kolibri |
| `share_to_class` | `folder-materials-grade5a` (group Grade 5A, view-only) | nextcloud |
| `open_file_drop` | `folder-drop-grade5a` | nextcloud |
| `open_collab_doc` | `collab-grade5a-01` (placeholder doc) | nextcloud |

## Validation (no manual steps)

```bash
npm run test:unit
# includes tests/unit/duration-tests-fixtures.test.mjs
```

Structure checks only (required META / compose / CONTENT / preload files).
Does **not** require a Pi, Tailscale, or running Kolibri/Nextcloud.

## Out of scope tonight

- Live dock smoke on fleet (Tailscale may be down) — box-built trees only
- Collabora live editing
- Committing ZIM files / Kolibri video blobs
- Merging this PR (Koen explicit merge only)
