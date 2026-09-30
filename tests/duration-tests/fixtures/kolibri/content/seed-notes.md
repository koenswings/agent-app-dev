# Kolibri seed notes (duration-tests)

## Goal

After the App Disk is docked and the instance is Running, ensure:

1. Facility + coach user `teacher`
2. Class **Grade 5A** with learners `learner01`…`learner03`
3. Lesson **Grade 5A Duration Lesson** containing ≥1 video + ≥1 exercise

Logical IDs in `CONTENT.yaml` must remain stable; write live Kolibri UUIDs to
`CONTENT.seeded.json` (gitignored locally / optional CI artefact) so Pixel /
Axle adapters can resolve `logical:*` → real content IDs.

## Cheap path tonight

- Reuse `koenswings/app-kolibri` image `koenswings/kolibri:1.0-0.15.5-dev`.
- Optional: unpack `app-kolibri/init_data.tar.gz` into `instances/.../data/kolibri`
  if that tarball grows past the empty stub; current upstream stub is empty.
- Manual / scripted seed via Kolibri coach UI or `kolibri manage` once Running
  (Pi claim required). Box-built fixtures ship the tree + catalogue without a
  live dock.

## Walker references

```yaml
# illustrative — Axle owns real scenario schema
fixtures:
  kolibri:
    path: tests/duration-tests/fixtures/kolibri
    diskId: duration-kolibri-grade5a-001
    instanceId: kolibri-grade5a-001
    content: fixtures/kolibri/content/CONTENT.yaml
actions:
  Open video: { contentLogicalId: video-grade5a-01 }
  Open exercise: { contentLogicalId: exercise-grade5a-01 }
```

## idea#159 note

HTTP Range load-test Ns from idea#159 are **not** Playwright browser-watcher
caps. Duration usage walks that open video in a real browser must size
concurrency separately from those planning figures.
