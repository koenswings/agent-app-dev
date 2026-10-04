# Teacher inspection packs (locked set of two)

PDFs Koen and teachers can read **without** a Kolibri image rebuild.
Marco lock: **these two only**. Do not add Science or any other Khan topic.

| PDF | Lesson | Topic | diskId | idea04 |
|-----|--------|-------|--------|--------|
| [`grade5a-add-and-subtract-fractions.pdf`](grade5a-add-and-subtract-fractions.pdf) | Grade 5A Duration Lesson | Add and subtract fractions (`4a5b44d4-826e-511b-8bb2-e568b9562c5c`, 3V+3E) | `duration-kolibri-grade5a-001` | `:18081` |
| [`form3-variables-and-expressions.pdf`](form3-variables-and-expressions.pdf) | Form 3 Duration Lesson | Variables & expressions (`0f21619f-bd75-505f-92bd-96184b07b46d`, 3V+3E) | `duration-kolibri-form3-001` | `:18080` |

HTML next to each PDF is the weasyprint source (titles and IDs copied from the pins, not new teaching text).

Pins: `fixtures/kolibri/content/CONTENT.live.json`, `CONTENT.khan-remap.json`, `fixtures/kolibri-form3/content/CONTENT.live.json`.

## What the pack covers

Content a teacher can open once the sidecar is listening: lesson title, six leaf titles, contentIds, nodeIds, coach/learn URLs. Each Duration Lesson assigns all 3 videos and all 3 exercises (same titles and IDs). The other leaves are not topic-only. `open_video` / `open_exercise` still resolve to leaf 01 as the walker entry.

`open_video` / `open_exercise` resolve from those IDs.

## What is still deferred (lesson chrome)

`keep_watching` / `next_resource` / `exit_lesson` / `finish_exercise` / `next_video` still cannot hardpass on stock `koenswings/kolibri:1.0-0.15.5-dev`. No `data-testid`s in this pass. See [`../LESSON_CHROME.md`](../LESSON_CHROME.md).

These PDFs are **not** a Console install action and do **not** replace demo-mode boot. That waits for an explicit Koen OK, then Pixel.

## Live check (2026-10-04 13:43 CEST)

Read-only. No fleet claim. No container start/stop. idea04 `100.108.39.45` answered ping. TCP connect to `:18080` and `:18081` was refused, so the 2026-10-01 sidecars are not accepting HTTP right now. IDs in the PDFs stay the imported pins.
