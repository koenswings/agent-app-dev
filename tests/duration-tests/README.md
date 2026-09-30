# Duration-tests App fixtures (idea#166)

Versioned App Disk trees that Axle’s unified walker and Pixel’s adapters can
point at for Markov duration tests
([agent-engine-dev#144](https://github.com/koenswings/agent-engine-dev/pull/144)
`proposals/duration-tests.md`).

**Kid ownership:** App fixtures only. Class-instance Console selectors are
Pixel; walker YAML / settle / invariants are Axle; claim/teardown is Atlas.

## Design Review gates (honoured here)

| Gate | How this pack answers |
|------|------------------------|
| Versioned App fixtures (not ad-hoc) | Trees under `fixtures/{kolibri,nextcloud}/` with stable `diskId` / `instanceId` + `CONTENT.yaml` catalogues |
| Don’t equate Playwright browser watchers with idea#159 HTTP stream Ns | Documented in Kolibri `content/seed-notes.md` and `walker-ref.yaml` — #159 Ns are HTTP Range planning figures only |
| Class-instance selectors are Console/Pixel | Fixtures expose stable instance + content logical IDs only; no Console `data-testid` claims |

## Layout

```
tests/duration-tests/
  README.md                 ← this file
  walker-ref.yaml           ← illustrative YAML refs for Axle/Pixel
  fixtures/
    kolibri/                ← App Disk tree + content catalogue
    nextcloud/              ← App+Files Disk tree + preload folders
    kiwix/README.md         ← deferred (Phase 3 / optional)
```

## Pack inventory

| Pack | diskId | instanceId | What walkers get |
|------|--------|------------|------------------|
| Kolibri Grade 5A | `duration-kolibri-grade5a-001` | `kolibri-grade5a-001` | Class **Grade 5A**, learners, lesson with **Open video** + **Open exercise** logical IDs (`content/CONTENT.yaml`) |
| Nextcloud Grade 5A | `duration-nextcloud-grade5a-001` | `nextcloud-grade5a-001` | Group **Grade 5A**, view-only **Class Materials**, **Drop Zone** File Drop, **Collab/Grade5A-collab-notes.md** placeholder |
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

See [`walker-ref.yaml`](walker-ref.yaml). Minimal sketch:

```yaml
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
```

Reuse existing harness patterns: dock like `tests/app-nextcloud/fixture`,
`tests/app-erase-test/fixture`. Pack trees into `.img` later via
`script/build-app-disk-image.sh` if Atlas needs stick images.

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
