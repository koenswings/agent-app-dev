# Kiwix — offline Wikipedia stub (idea#166 Prefer A)

**Status:** fixture shipped, verified on box with kiwix-serve 3.8.2. **Live apply
on idea01 still pending** (pool busy; `CONTENT.live.json` `liveStatus:
pending_apply_idea01`). Replaces the earlier "deferred" note.

Unblocks `open_wikipedia_as_teacher` / `open_wikipedia_as_learner` /
`search_browse_wikipedia` / `leave_wikipedia_as_*` with a real Kiwix UI
(library page, viewer with search box, full-text search, internal links)
without fetching a multi-GB Wikipedia ZIM.

| Field | Value |
|-------|-------|
| pack | `duration-kiwix-ideaa` |
| diskId | `duration-kiwix-ideaa-001` |
| instanceId | `kiwix-ideaa-001` |
| instanceName | `kiwix` |
| placement | idea-A role → Prefer A pool host **idea01** |
| image | `ghcr.io/kiwix/kiwix-serve:3.8.2` (official, multi-arch incl. arm64, ~10 MB) |
| port | **18380** (instance `.env`; sidecar default) |
| ZIM | `instances/kiwix-ideaa-001/data/duration_wikipedia_en_grade5a_stub_2026-10.zim` (62 545 B) |
| book name (URL) | `duration_wikipedia_en_grade5a_stub_2026-10` |
| licence | CC0-1.0 — original fixture text, **not** Wikipedia content |

Catalogue + Intent map: [`content/CONTENT.yaml`](content/CONTENT.yaml).
Live pins for Pixel: [`content/CONTENT.live.json`](content/CONTENT.live.json).
Builder: [`content/seed/build_stub_zim.py`](content/seed/build_stub_zim.py)
(python `libzim>=3.4,<4`). Box screenshots: [`shots/`](shots/).

## Articles (stable paths)

`Main_Page` (title "Grade 5A Offline Wikipedia"), `Fraction`, `Numerator`,
`Denominator`, `Photosynthesis`, `Water_cycle`, `Solar_System`.
Search `fraction` → 4 results (Fraction first); search `planet` → Solar System.

## URL shapes (verified 2026-10-05 on box)

```
library        http://<host>:18380/
viewer home    http://<host>:18380/viewer#duration_wikipedia_en_grade5a_stub_2026-10/Main_Page
viewer article http://<host>:18380/viewer#duration_wikipedia_en_grade5a_stub_2026-10/Fraction
viewer search  http://<host>:18380/viewer#search?books.name=duration_wikipedia_en_grade5a_stub_2026-10&pattern=fraction
raw article    http://<host>:18380/content/duration_wikipedia_en_grade5a_stub_2026-10/Fraction
raw search     http://<host>:18380/search?books.name=duration_wikipedia_en_grade5a_stub_2026-10&pattern=fraction
```

Viewer DOM: search box `#kiwixsearchbox` (top bar), article in
`iframe#content_iframe`, heading `h1#firstHeading`. Library page book filter is
`#searchFilter` (not article search). No login.

## Apply on the pool (Atlas/Kid, when idea01 is free — not done in this PR)

```bash
# idea01 (Prefer A). Never idea02.
docker pull ghcr.io/kiwix/kiwix-serve:3.8.2
cd /home/pi/idea/agents/agent-app-dev        # this PR synced
bash tests/duration-tests/scripts/post-dock-restore-running.sh --mode sidecar --apps kiwix
# → container idea166-kiwix-live on :18380, rewrites content/CONTENT.live.json host/hosts
```

Console **Running** card (Open clickable) needs the Engine-docked tree with
`instances/` kept (`startInstances`), same as Kolibri/Nextcloud Path A. The
image must be pre-pulled because compose uses `pull_policy: never`.

## Bigger content later (optional)

Swap in a real ZIM from download.kiwix.org (e.g. a `wikipedia_en_100_mini_*`
build, a few MB, CC BY-SA) by dropping it next to the stub on the host and
changing `command:` — Atlas fetches onto the host; **do not commit** it here.
