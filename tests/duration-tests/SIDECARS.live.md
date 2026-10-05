# Duration-tests live Kolibri sidecars (idea#168)

Kid-owned Running sidecars for Intent resolution. **Not** Engine-docked
instances (Console Running cards still need Axle `startInstances` / dock-compose).

Never idea02. Release fleet claim when done.

## idea04 (primary — 2026-10-01 topic-slice)

| Pack | diskId | instanceId | container | port | data |
|------|--------|------------|-----------|------|------|
| Form3 Khan | `duration-kolibri-form3-001` | `kolibri-form3-001` | `idea168-kolibri-form3` | **18080** | `/home/pi/idea168-kolibri-form3` |
| G5A Khan remap | `duration-kolibri-grade5a-001` | `kolibri-grade5a-001` | `idea168-kolibri-g5a-khan` | **18081** | `/home/pi/idea168-kolibri-g5a-khan` |

URLs: `http://100.108.39.45:18080/` · `http://100.108.39.45:18081/`

Image: `koenswings/kolibri:1.0-0.15.5-dev` (host network).

### Apply path (reproducible)

```bash
# 1. Claim idle pool Pi (prefer idea04)
BOT_NAME=Kid tools/fleet/update-fleet-state.sh idea04 status testing
BOT_NAME=Kid tools/fleet/update-fleet-state.sh idea04 claim "Kid: agent-app-dev#10 …"

# 2. Start sidecars (compose under data dirs above), then:
CONTAINER=idea168-kolibri-form3 bash tests/duration-tests/scripts/import-khan-topic-slice.sh form3 topic
CONTAINER=idea168-kolibri-g5a-khan bash tests/duration-tests/scripts/import-khan-topic-slice.sh g5a topic

# 3. Provision facility/class/lesson (inside container manage shell):
#    PACK=form3|g5a execfile provision-khan-pack-lesson.py

# 4. Flip pins in CONTENT.live.json / CONTENT.khan-remap.json; push App#10.
# 5. Release claim when idle again.
```

### Proof (2026-10-01 CEST)

- Form3: 6/6 leaves available (3 video + 3 exercise) on `:18080`
- G5A Khan: 6/6 leaves available on `:18081`
- Channel `c9d7f950ab6b5a1199e3d6c10d7f0103` public — **no Studio token**

## Prior synthetic smoke (leave until Atlas confirms)

| Host | container | port | note |
|------|-----------|------|------|
| idea01 | `idea166-kolibri-live` | 18080 | synthetic channel `30b6c263…` |
| idea01 | `idea166-nextcloud-live-*` | 18280 | NC Grade 5A |
| idea03 | `idea166-kolibri-live` | 18081 | synthetic (18080=Intenso) |
| idea03 | `idea166-nextcloud-live-*` | 18280 | NC Grade 5A |

`CONTENT.seeded.json` synthetic IDs remain for smoke fallback.
`CONTENT.live.json` Intent pins **flipped** to Khan remap (see `syntheticSmokeFallback`).

## Prefer A additions (2026-10-05, not yet applied — pool busy)

| Pack | diskId | instanceId | container | port | data |
|------|--------|------------|-----------|------|------|
| Kiwix stub | `duration-kiwix-ideaa-001` | `kiwix-ideaa-001` | `idea166-kiwix-live` | **18380** | `/home/pi/idea166-kiwix-live` |

- Kiwix: `docker pull ghcr.io/kiwix/kiwix-serve:3.8.2` then
  `post-dock-restore-running.sh --mode sidecar --apps kiwix` on **idea01**.
- Nextcloud Grade 5A collab: re-run `--apps nextcloud` on the host Pixel uses
  (idea01 / idea03) → `provision_nextcloud_collab` (Text, writable Collab,
  `enable_sharing`, mounts scoped to Grade 5A). Sets `collabProvisioned: true`.

## Nextcloud Form3

Deferred until Form3 Kolibri green + Walker cost confirmed (this run: Kolibri-only).
