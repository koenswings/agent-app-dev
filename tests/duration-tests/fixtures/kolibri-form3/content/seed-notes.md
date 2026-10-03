# Kolibri Form 3 seed notes (duration-tests)

## Goal

Dockable Form 3 pack (`duration-kolibri-form3-001` / `kolibri-form3-001`) with
Khan Academy EN-US **Variables & expressions** (3 videos + 3 exercises).

## Feasibility (2026-10-01)

- Channel `c9d7f950ab6b5a1199e3d6c10d7f0103` is **public** on Studio.
- **No Studio token** required for network import.
- Channel DB: `https://studio.learningequality.org/content/databases/c9d7f950ab6b5a1199e3d6c10d7f0103.sqlite3` (~115 MB).
- CDN content: `https://studio.learningequality.org/content/storage/<c0>/<c1>/<checksum>.<ext>` (HTTP 206 with Range).
- All 6 leaves + topic node: **OK** in channel DB v5; under topic nested-set.

## Import path (topic slice)

On a Running Kolibri (`koenswings/kolibri:1.0-0.15.5-dev`):

```bash
CHANNEL=c9d7f950ab6b5a1199e3d6c10d7f0103
TOPIC=0f21619fbd75505f92bd96184b07b46d   # Variables & expressions

kolibri manage importchannel network "$CHANNEL"
# Full topic (~34 MB content) OR leaves-only (~6 MB):
kolibri manage importcontent --node_ids "$TOPIC" network "$CHANNEL"
# leaves-only:
# kolibri manage importcontent --node_ids b3677df2bf9e5e5fa1f19e57a2f26b97,fcba0a76d6075c02b1f9f7742847a4c4,7f1b54804b2e5d81b7670d383cf341a8,a484d2921dd35f428d087b61a8e82416,d455f572cc3355b08c982a997d412aa8,8c88069407945913918b90523c2ac8ca network "$CHANNEL"
```

Then provision facility/class/learners/lesson (same pattern as Grade 5A
`seed-notes.md` / `CONTENT.live.json`), pointing lesson resources at
`video-form3-01` / `exercise-form3-01` contentIds in `CONTENT.seeded.json`.

## Size estimates

| Scope | Size |
|-------|------|
| Channel metadata DB | ~115 MB |
| Topic slice (all descendants) | ~34 MB |
| Leaves-only (3V+3E) | ~6 MB |
| Full Khan EN-US channel | ~68 GB — **do not import** |

## Nextcloud Form 3

Defer until Kolibri Form 3 live import + lesson verify is green.

## Live import result (2026-10-01, idea04)

`CONTENT.live.json` updated after topic-slice import + provision on
`idea168-kolibri-form3` (:18080). All 6 leaves available via
`/api/content/contentnode/`. Auth IDs mutable. See `SIDECARS.live.md`.
