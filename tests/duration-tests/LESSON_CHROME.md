# Lesson chrome Intents — Kid answer for Pixel (idea#168)

## Can `keep_watching` / `next_resource` / `exit_lesson` / `finish_exercise` / `next_video` hardpass against live Kolibri?

**No — still impossible without App-side (or Kolibri-fork) testids / stable selectors.**

| Intent | CONTENT pins help? | Hardpass live today? |
|--------|--------------------|----------------------|
| `open_video` / `open_exercise` | Yes — stable contentIds / nodeIds in `CONTENT.live.json` + Learn URL nav | Possible via Pixel URL/hash nav (already in `openKolibriContent.ts`) once Kolibri tab is open |
| `keep_watching` | No — dwell on player chrome | **Still deferred** |
| `next_resource` | Lesson resource list ids only | **Still deferred** |
| `exit_lesson` | No | **Still deferred** |
| `finish_exercise` | assessmentItemIds pinned | **Still deferred** (Perseus chrome) |
| `next_video` | No | **Still deferred** |

### Why CONTENT pins are not enough

Pins identify *which* resource to open. Lesson-chrome Intents need *player / lesson UI controls* (next, exit, finish). Upstream Kolibri Vue UI does **not** expose durable `data-testid`s for those controls in `koenswings/kolibri:1.0-0.15.5-dev`. Fragile CSS/text selectors are not acceptable for hardpass.

### What Kid can / cannot add

- **Can:** pin contentIds, nodeIds, assessmentItemIds, lesson/facility auth ids (`CONTENT.live.json`); document ports/URLs; keep sidecar Running.
- **Cannot (this pack):** inject `data-testid` into Kolibri upstream player chrome without a custom image rebuild / patch layer. No App-owned HTML shell wraps the Kolibri player.

### If / when App testids land

Preferred names (for a future Kid kolibri image revision — **not in this PR**):

- `data-testid="kolibri-player"`
- `data-testid="kolibri-next-resource"`
- `data-testid="kolibri-exit-lesson"`
- `data-testid="kolibri-finish-exercise"`
- `data-testid="kolibri-keep-watching"` (or dwell = no click + player visible)

Until that image exists, Pixel should keep these Intents **unregistered / deferred** (current Console registry behaviour is correct).

### Console Open cards (separate from lesson chrome)

See README § Post-dock Running restore. Open clickable requires Engine `instanceDB.status=Running` via **startInstances dock auto-start** (Path A), not sidecar alone.

### Teacher content packs vs chrome (2026-10-04)

Inspection PDFs (content only, no image rebuild) live in [`lessons/`](lessons/README.md):

- Grade 5A Add and subtract fractions — `lessons/grade5a-add-and-subtract-fractions.pdf`
- Form 3 Variables & expressions — `lessons/form3-variables-and-expressions.pdf`

Marco lock: those two topics only. Science stays deferred. The PDFs list pinned titles, contentIds, nodeIds, and existing Learn/Coach URLs. They do **not** land the testids above. Chrome Intents in the table stay deferred. A Console action that installs the lesson apps (replacing demo-mode boot) is not this pass.
