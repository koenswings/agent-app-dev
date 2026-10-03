# Kiwix — deferred (Phase 3+4 / idea#168)

**Status:** omit from duration-tests YAML. **Steve deferral list.**

Offline Wikipedia (`open_wikipedia_as_teacher` / `open_wikipedia_as_learner`)
needs a Kiwix App Disk + ZIM. A minimal ZIM path is **not** trivial tonight:
it needs compose/META/instance redesign (and ZIMs must not be committed to
`agent-app-dev`). No redesign → **explicitly deferred**.

## When to add

- Usage walks that require Wikipedia Intents
- Cheap path later: reuse `koenswings/app-kiwix` compose + a small fleet-local
  ZIM (e.g. `phet_en_2020-08.zim`); do **not** commit multi‑GB ZIMs here

## Suggested future IDs (reserved, not shipped)

| Field | Value |
|-------|-------|
| diskId | `duration-kiwix-ideaa-001` |
| instanceId | `kiwix-ideaa-001` |
| instanceName | `kiwix` |
| placement | idea-A (shared hub) |

Walker YAML should omit Kiwix / Wikipedia states until this pack ships.
