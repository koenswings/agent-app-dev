# Kolibri seed notes (duration-tests)

## Goal

After the App Disk is docked and the instance is Running, ensure:

1. Facility + coach user `teacher`
2. Class **Grade 5A** with learners `learner01`…`learner03`
3. Lesson **Grade 5A Duration Lesson** containing ≥1 video + ≥1 exercise

Logical IDs in `CONTENT.yaml` must remain stable; write live Kolibri UUIDs to
`CONTENT.seeded.json` (gitignored locally / optional CI artefact) so Pixel /
Axle adapters can resolve `logical:*` → real content IDs.

## Phase 1–2 vs Phase 3 Intents

Phase 1–2 walker actions that touch this disk are infra only
(`infra_dock_fixture`, `infra_undock_fixtures`, `infra_move_disk`). Hub /
minimal-usage keys (`open_console_as_*`, `stay_on_*_overview`,
`return_to_start`, …) do not open Kolibri content yet.

Phase 3 deeper usage / coaching Intents are App-documented in
`walker-ref.yaml` `phase_3_intents` and `CONTENT.yaml` `phase_3_intent_map`
(snake_case matching the proposal + Axle `UI_STUB_ACTIONS` /
`school-day.yaml`). Playwright / Console `data-testid` binding remains
**Pixel Phase 3**. Live `open_video` / `open_exercise` need this seed
(`CONTENT.seeded.json`) once the instance has run.

## Cheap path tonight

- Reuse `koenswings/app-kolibri` image `koenswings/kolibri:1.0-0.15.5-dev`.
- Optional: unpack `app-kolibri/init_data.tar.gz` into `instances/.../data/kolibri`
  if that tarball grows past the empty stub; current upstream stub is empty.
- Manual / scripted seed via Kolibri coach UI or `kolibri manage` once Running
  (Pi claim required). Box-built fixtures ship the tree + catalogue without a
  live dock.

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
# open_video:    { contentLogicalId: video-grade5a-01 }
# open_exercise: { contentLogicalId: exercise-grade5a-01 }
# browse_classes / keep_watching / next_resource / exit_lesson / …
```

## idea#159 note

HTTP Range load-test Ns from idea#159 are **not** Playwright browser-watcher
caps. Duration usage walks that open video in a real browser must size
concurrency separately from those planning figures.
