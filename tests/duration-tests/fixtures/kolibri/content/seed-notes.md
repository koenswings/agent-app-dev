# Kolibri seed notes (duration-tests)

## Goal

After the App Disk is docked and the instance is Running, ensure:

1. Facility + coach user `teacher`
2. Class **Grade 5A** with learners `learner01`…`learner03`
3. Lesson **Grade 5A Duration Lesson** containing ≥1 video + ≥1 exercise

Logical IDs in `CONTENT.yaml` must remain stable. Adapters resolve
`logical:*` → real content IDs via **`CONTENT.seeded.json`** (committed seed
artifact in this pack).

## Seed artifact (box-local, regenerable)

| File | Role |
|------|------|
| [`CONTENT.seeded.json`](CONTENT.seeded.json) | Pinned `contentId` / `nodeId` / `channelId` for `open_video` + `open_exercise` + storage md5 path |
| [`media/video-grade5a-01.mp4`](media/video-grade5a-01.mp4) | 3s stub video (also mirrored under `storage/<md5[0]>/<md5[1]>/<md5>.mp4`) |
| [`seed/exercise-grade5a-01.json`](seed/exercise-grade5a-01.json) | Exercise question recipe |
| [`seed/build_content_seeded.py`](seed/build_content_seeded.py) | Regenerates `CONTENT.seeded.json` + storage mirror |
| [`seed/apply-live.sh`](seed/apply-live.sh) | Copies storage blobs into a Running Kolibri data dir |

### Regenerate (no Pi / Docker required)

```bash
# optional but preferred — Studio/Kolibri-matching IDs via ricecooker
python3 -m venv .venv-seed && .venv-seed/bin/pip install ricecooker
.venv-seed/bin/python \
  tests/duration-tests/fixtures/kolibri/content/seed/build_content_seeded.py

# or plain python3 (uuid5 fallback IDs if ricecooker missing)
python3 tests/duration-tests/fixtures/kolibri/content/seed/build_content_seeded.py
```

Pinned Intent resolution (current artifact):

| Intent | contentLogicalId | contentId |
|--------|------------------|-----------|
| `open_video` | `video-grade5a-01` | see `CONTENT.seeded.json` → `intentResolution.open_video` |
| `open_exercise` | `exercise-grade5a-01` | see `CONTENT.seeded.json` → `intentResolution.open_exercise` |

### Stable vs mutable IDs (Pixel / Axle — read this)

| Kind | Examples | Stability |
|------|----------|-----------|
| **Stable** | `diskId`, `instanceId`, `channelId`, `contentId` / `nodeId` for `open_video` + `open_exercise`, Perseus assessment item IDs, storage md5 paths | Prefer these pins; ricecooker-derived; survive re-provision |
| **Mutable on re-provision** | `facility.id`, `class.id`, `lesson.id`, coach/learner user Morango IDs | Change if `provisiondevice` / ORM class seed is re-run on idea01; refresh `CONTENT.live.json` + Pixel `DURATION_FIXTURES.kolibri.live` |

Current live auth IDs (mutable) live in [`CONTENT.live.json`](CONTENT.live.json)
(`liveImportStatus: imported_on_idea01_temp`). Content pins match
`CONTENT.seeded.json` / Console #134. Medium-confidence prior: idea01 live
auth IDs **still change on re-provision** — do not treat them as forever-stable.

### Post-dock Running restore (Atlas — after infra_dock_fixture)

Dock strips `instances/`. Overnight Engine will **not** restore Running-in-dock.
Use the sidecar one-shot (idea01 `:18080`, data under `/home/pi/idea166-kolibri-live`):

```bash
bash tests/duration-tests/scripts/post-dock-restore-running.sh --mode sidecar
```

See pack `README.md` § Post-dock Running restore. `apply-live.sh` below is storage-only.

### Live apply (free Pi only — never interrupt Atlas dock)

```bash
# Prefer idea04 when idle. Do NOT run on idea01/idea03 while
# claim == "Atlas Ops: duration-walk walk-2026-10-01-dock idea#166".
KOLIBRI_DATA=/path/to/instances/kolibri-grade5a-001/data/kolibri \
  bash tests/duration-tests/fixtures/kolibri/content/seed/apply-live.sh
```

Then import the Grade 5A channel (Studio upload from the ricecooker tree, or
`kolibri manage importchannel` from a peer export), provision facility/class/
users/lesson, and optionally rewrite placeholder facility IDs in
`CONTENT.seeded.json`.

## Phase 1–2 vs Phase 3 Intents

Phase 1–2 walker actions that touch this disk are infra only
(`infra_dock_fixture`, `infra_undock_fixtures`, `infra_move_disk`). Hub /
minimal-usage keys (`open_console_as_*`, `stay_on_*_overview`,
`return_to_start`, …) do not open Kolibri content yet.

Phase 3+4 (idea#168) deeper usage / coaching Intents are App-documented in
`walker-ref.yaml` `phase_3_intents` and `CONTENT.yaml` `phase_3_intent_map`
(snake_case matching the proposal + Axle `UI_STUB_ACTIONS` /
`school-day.yaml`). Playwright / Console `data-testid` binding remains
**Pixel Phase 3**. `open_video` / `open_exercise` resolve through
`CONTENT.seeded.json` once Console adapters exist (Pixel may still skip
`keep_watching` / `exit_lesson` for now).

## Cheap path tonight

- Reuse `koenswings/app-kolibri` image `koenswings/kolibri:1.0-0.15.5-dev`.
- Box-built: `CONTENT.seeded.json` + stub video + exercise recipe (this pack).
- Optional: unpack `app-kolibri/init_data.tar.gz` into `instances/.../data/kolibri`
  if that tarball grows past the empty stub; current upstream stub is empty.
- Live channel import + facility provision on a **free** pool Pi when Atlas
  dock smoke is done (or idea04 if idle).

## Walker references

```yaml
# Phase 1–2 — Axle locked infra keys
fixtures:
  kolibri:
    path: tests/duration-tests/fixtures/kolibri
    diskId: duration-kolibri-grade5a-001
    instanceId: kolibri-grade5a-001
# infra_dock_fixture → diskId duration-kolibri-grade5a-001

# Phase 3 App bindings (see walker-ref.yaml phase_3_intents)
# open_kolibri_as_teacher / open_kolibri_as_learner
# open_video:    { contentLogicalId: video-grade5a-01 } → CONTENT.seeded.json
# open_exercise: { contentLogicalId: exercise-grade5a-01 } → CONTENT.seeded.json
# browse_classes / keep_watching / next_resource / exit_lesson / …
```

## idea#159 note

HTTP Range load-test Ns from idea#159 are **not** Playwright browser-watcher
caps. Duration usage walks that open video in a real browser must size
concurrency separately from those planning figures. The stub video here is
for Intent wiring only (3s); capacity planning still uses #159 encodes.

## Live import result (2026-10-01, idea01)

**Auth IDs below are mutable on re-provision.** Content/channel IDs are stable.

`CONTENT.live.json` records Morango facility/class/learner/lesson IDs from a temp
Kolibri container (`koenswings/kolibri:1.0-0.15.5-dev` on port 18080) after:

1. `apply-live.sh` storage copy
2. `kolibri manage provisiondevice` + Classroom/learners via Django ORM
3. Local channel sqlite (schema v5) with pinned ricecooker IDs → `import_channel_from_local_db`
4. Lesson **Grade 5A Duration Lesson** with video + exercise nodes
5. **In-place Perseus patch** (`seed/update_exercise_assessments.py`) — same pinned
   `contentId` `7eb9de46-96eb-53d0-bcc1-2fb270b96f03`; AssessmentMetaData now lists
   2 `single_selection` item IDs; `.perseus` blob under
   `content/storage/2/0/202c3336b37b013ff7d67267df8d7045.perseus`

`open_video` / `open_exercise` verified via
`/api/content/contentnode/?content_id=<raw32hex>`. No Studio token used.
`assessment_item_ids` length **2** (non-empty).

### Regenerate Perseus archive (box-local)

```bash
python3 tests/duration-tests/fixtures/kolibri/content/seed/build_perseus_exercise.py
```

Writes `exercise-grade5a-01.perseus` + `.meta.json` + storage mirror from the
recipe JSON. To re-apply on a Running data dir (idea01 live path example):

```bash
# inside kolibri container (root), after docker cp of perseus+meta+script:
PERSEUS_SRC=/tmp/exercise-grade5a-01.perseus \
PERSEUS_META=/tmp/exercise-grade5a-01.meta.json \
KOLIBRI_HOME=/root/.kolibri \
  python3 /tmp/update_exercise_assessments.py
```
