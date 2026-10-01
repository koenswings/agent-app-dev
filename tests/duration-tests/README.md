# Duration-tests App fixtures (idea#166 / #168)

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

Phase 3 deeper Intents are documented under
[Phase 3 deeper Intents](#phase-3-deeper-intents-app-owned) and
`walker-ref.yaml` `phase_3_intents`. CONTENT catalogues keep the same
snake_case `walkerAction` names. Phase 1–2 locked keys above stay intact.

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
| Kolibri Grade 5A | `duration-kolibri-grade5a-001` | `kolibri-grade5a-001` | Dockable tree for `infra_dock_fixture`; Phase 3 Intent bindings for `open_kolibri_as_*` / `open_video` / coaching |
| Nextcloud Grade 5A | `duration-nextcloud-grade5a-001` | `nextcloud-grade5a-001` | Dockable App+Files tree; Phase 3 bindings for `open_nextcloud_as_*` / share / File Drop / collab stub |
| Kiwix | — | — | **Not included** — Wikipedia Intents blocked |

### Kolibri content notes

- Catalogue: [`fixtures/kolibri/content/CONTENT.yaml`](fixtures/kolibri/content/CONTENT.yaml)
- Seed artifact: [`fixtures/kolibri/content/CONTENT.seeded.json`](fixtures/kolibri/content/CONTENT.seeded.json)
- Live pins: [`fixtures/kolibri/content/CONTENT.live.json`](fixtures/kolibri/content/CONTENT.live.json) (idea01 import)
- Seed docs / regenerate: [`fixtures/kolibri/content/seed-notes.md`](fixtures/kolibri/content/seed-notes.md)
- Image: `koenswings/kolibri:1.0-0.15.5-dev` (host network; walker HTTP often `:18080`)
- Logical IDs: `class-grade5a`, `video-grade5a-01`, `exercise-grade5a-01`
- **Stable pins:** `open_video` `e60662de-…f8fd`, `open_exercise` `7eb9de46-…6f03` (+ 2 Perseus items), channel `30b6c263-…d7ca`, disk/instance IDs
- **Mutable on re-provision:** facility / class / lesson / user Morango IDs in `CONTENT.live.json` (refresh after re-seed)

### Nextcloud content notes

- Catalogue: [`fixtures/nextcloud/CONTENT.yaml`](fixtures/nextcloud/CONTENT.yaml)
- `x-app.filesMount` on; `FILES.yaml` share name **Grade 5A Files**
- Preload dirs under `fixtures/nextcloud/files/`:
  - `Class Materials/` — view-only share to group Grade 5A
  - `Drop Zone/` — File Drop / file-request target
  - `Collab/Grade5A-collab-notes.md` — **placeholder** (Collabora/`code` service omitted tonight)
- Port in fixture `.env`: `18280` (password via `${pass}`, not hardcoded in compose)

### Kiwix

See [`fixtures/kiwix/README.md`](fixtures/kiwix/README.md). **Deferred Phase 3+4** (no minimal ZIM without App Disk redesign) — Steve deferral list.

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

## Phase 3 deeper Intents (App-owned)

Phase 3 wires usage + operator UI Interactions into Axle’s walker
([agent-engine-dev#145](https://github.com/koenswings/agent-engine-dev/pull/145)
`school-day.yaml` already samples several as stubs;
[ACTIONS.md](https://github.com/koenswings/agent-engine-dev/blob/feat/duration-tests-phase1-2/test/duration/ACTIONS.md)
`UI_STUB_ACTIONS`). **App owns** Intents depth that fixtures can define:
routes, expected `instanceId` / `diskId`, fixture roles, content logical IDs,
and app-login usernames. **Pixel owns** Console `data-testid` binding and
Playwright adapters ([agent-console-dev#134](https://github.com/koenswings/agent-console-dev/pull/134)
Phase 3 follow-up). Do not invent Console selectors in this pack.

Full App-side Intent map: [`walker-ref.yaml`](walker-ref.yaml) → `phase_3_intents`.

### Hub → app entry (Axle school-day keys)

| Action key | Pack | instanceId | App route / landing |
|------------|------|------------|---------------------|
| `open_kolibri_as_teacher` | kolibri | `kolibri-grade5a-001` | `:18080/coach/#/classes` (user `teacher`) |
| `open_kolibri_as_learner` | kolibri | `kolibri-grade5a-001` | `:18080/learn/#/topics` (user `learner01`…) |
| `open_nextcloud_as_teacher` | nextcloud | `nextcloud-grade5a-001` | `:18280/apps/files/` (user `teacher`) |
| `open_nextcloud_as_learner` | nextcloud | `nextcloud-grade5a-001` | `:18280/apps/files/` (user `student01`…) |
| `open_wikipedia_as_*` | — | — | **Blocked** — Kiwix fixture deferred |

### Kolibri deeper usage / coaching

| Action key | Content / class logical ID |
|------------|----------------------------|
| `browse_classes` | `class-grade5a` |
| `open_video` | `video-grade5a-01` (lesson `lesson-grade5a-video-exercise`) |
| `open_exercise` | `exercise-grade5a-01` |
| `keep_watching` / `next_resource` / `exit_lesson` | same lesson resources (Axle school-day already samples) |
| `finish_exercise` / `next_video` | exercise ↔ video in same lesson |
| `create_class` / `enroll_learners` / `build_lesson` | Grade 5A + learners + video+exercise lesson (usually preload) |
| `create_quiz` / `read_reports` / `preview_as_learner` | coach UI; quiz not pre-seeded in CONTENT |
| `back_to_console` / `leave_kolibri` | leave app → Console (Pixel nav) |

### Nextcloud deeper usage

| Action key | Content logical ID | Notes |
|------------|--------------------|-------|
| `browse_folders` | materials / drop / collab folders | |
| `share_to_class` | `folder-materials-grade5a` → group Grade 5A, view-only | |
| `done_sharing` | — | close share dialog |
| `open_file_drop` | `folder-drop-grade5a` | |
| `after_upload` / `leave_file_drop` | — | |
| `open_collab_doc` | `collab-grade5a-01` | **placeholder-doc** (no Collabora) |
| `close_doc` | — | |
| `keep_editing` | — | **Blocked** until `nextcloud-code` pack |
| `leave_nextcloud_as_*` | — | Pixel Console nav |

### Operator fixture refs (Console = Pixel)

`open_disk_inventory` / `open_instance_controls` / `eject_disk` / `stay_on_overview`
reference locked diskIds / instanceIds above. Console testids already sketched
in Pixel #134 (`disk-<id>`, `instance-<id>`, `eject-<diskId>`). Never eject the
idea03 Intenso hardware Files Disk.

### Blockers (documented in walker-ref)

| Blocker | Blocks | Owner |
|---------|--------|-------|
| Kiwix fixture absent | `open_wikipedia_as_*` | Kid (deferred) |
| Collabora omitted | `keep_editing` | Kid (deferred) |
| Pixel Playwright Phase 3 | all usage Playwright adapters | Pixel |
| Kolibri re-provision | facility/class/lesson/user Morango IDs mutate (`CONTENT.live.json` refresh) | Kid (Pixel re-pin live) |

## Future deeper Intents (snake_case) — back-compat table

Same keys as Phase 3 above; kept so older notes still resolve:

| Future action key | Content logical ID | Pack |
|-------------------|--------------------|------|
| `open_video` | `video-grade5a-01` | kolibri |
| `open_exercise` | `exercise-grade5a-01` | kolibri |
| `browse_classes` | `class-grade5a` | kolibri |
| `share_to_class` | `folder-materials-grade5a` (group Grade 5A, view-only) | nextcloud |
| `open_file_drop` | `folder-drop-grade5a` | nextcloud |
| `open_collab_doc` | `collab-grade5a-01` (placeholder doc) | nextcloud |

## Stable vs mutable IDs (for Steve / Pixel / Axle)

| Stable (prefer) | Mutable on Kolibri re-provision |
|-----------------|----------------------------------|
| `duration-kolibri-grade5a-001` / `kolibri-grade5a-001` | facility `f0e1353e…d03f` |
| `duration-nextcloud-grade5a-001` / `nextcloud-grade5a-001` | class `a12df540…48f6` |
| channel `30b6c263-4b96-5a62-93bd-dcf9a5cad7ca` | lesson `2a955770…3fdf` |
| `open_video` contentId `e60662de-b15c-52f9-b003-359f7d91f8fd` | coach/learner user IDs |
| `open_exercise` contentId `7eb9de46-96eb-53d0-bcc1-2fb270b96f03` (+ 2 Perseus assessments) | (usernames `teacher` / `learner01`… stay) |
| Nextcloud folder logicalIds + share **Grade 5A Files** | — |

Source of truth for live auth: `CONTENT.live.json`. Medium-confidence prior: these auth IDs still change if idea01 is re-provisioned.

## Validation (no manual steps)

```bash
npm run test:unit
# includes tests/unit/duration-tests-fixtures.test.mjs
```

Structure checks only (required META / compose / CONTENT / preload files).
Does **not** require a Pi, Tailscale, or running Kolibri/Nextcloud.

## Out of scope / still deferred

- Collabora live editing (`keep_editing`)
- Kiwix / Wikipedia fixture + ZIM blobs (**deferred Phase 3+4** — not trivial without redesign)
- Full-length classroom videos (pack ships a 3s stub; #159 encodes stay separate)
- Re-running live channel import / facility provision (already done once on idea01; auth IDs mutable)
- Playwright Console selectors (Pixel Phase 3)
- Merging this PR (Koen explicit merge only)
