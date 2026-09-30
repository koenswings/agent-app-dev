# Kiwix — deferred for Phase 1–2

**Status:** omit from Phase 1–2 duration-tests YAML.

Offline Wikipedia (Kiwix on idea-A) is a Phase 3 / optional usage path
(`wiki_browse` / **Search / browse Wikipedia**). Shipping a ZIM + App Disk
tree tonight is not required for Axle’s infra walker or Pixel’s minimal
operator/usage adapters.

## When to add

- Phase 3 usage walks that include `Open Wikipedia as learner/teacher`
- Cheap path: reuse `koenswings/app-kiwix` compose + a small ZIM already on
  fleet data disks (e.g. `phet_en_2020-08.zim`); do **not** commit multi‑GB
  ZIMs into `agent-app-dev`

## Suggested future IDs (reserved, not shipped)

| Field | Value |
|-------|-------|
| diskId | `duration-kiwix-ideaa-001` |
| instanceId | `kiwix-ideaa-001` |
| instanceName | `kiwix` |
| placement | idea-A (shared hub) |

Walker YAML for Phase 1–2 should simply omit Kiwix / Wikipedia states.
