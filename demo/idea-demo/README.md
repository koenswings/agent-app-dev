# IDEA-DEMO disk (demo content pack)

Demo lessons for IDEA, kept separate from the duration-test fixtures
(`tests/duration-tests/fixtures/kolibri*`, labelled "Duration Test …").
Only the build recipe is committed, not the media.

| File | Purpose |
|---|---|
| `MANIFEST.json` | every file: target path, title, author, publisher page, download URL, licence, `source_sha256`, how it is prepared |
| `CREDITS.txt` | path, title, author, source URL and licence for every file (copied onto the disk) |
| `fetch.sh` / `fetch.py` | downloads from the publishers, verifies checksums, trims/transcodes video, writes the disk tree |
| `static/` | `channel.json` per Kolibri channel, the IDEA-written exercises (`*.exercise.json`) and `Teacher Notes/About this disk.txt` |

Build: `demo/idea-demo/fetch.sh /tmp/idea-demo` (python3 + ffmpeg), then copy the
tree onto a FAT32 disk labelled `IDEA-DEMO`. About 220 MB, 33 files.
The channel builder turns `kolibri/<Channel>/<Topic>/` into three Kolibri channels
(Grade 5 Science, Early Reading, Maths); Worksheets and Teacher Notes appear in
Nextcloud as "USB: IDEA-DEMO". The optional seed in `app-kolibri/demo/` then
creates IDEA Demo School, class Grade 5, accounts `admin`, `teacher1`,
`learner1`–`learner3` (password `<name>911!`), one lesson per channel and the
quiz "Grade 5 Practice Quiz" (from the exercises below), assigned to Grade 5.

## Exercises (idea#294)
Written by IDEA for this demo (CC BY 4.0, IDEA), in the channel builder's
`*.exercise.json` format (app-kolibri-channel-builder README, "Exercises"). The
builder turns each into a real Kolibri exercise (Perseus), so learners get
"Check", hints and mastery, and coaches see progress in Coach > Reports.

| File | Questions | Mastery |
|---|---|---|
| `kolibri/Maths/Fractions/Fractions practice.exercise.json` | 6 (multiple choice, number, one multi-select) | 4 of the last 5 right |
| `kolibri/Maths/Times Tables/Times tables practice.exercise.json` | 6 (number + 1 multiple choice) | 4 of the last 5 right |
| `kolibri/Early Reading/Stories/Reading - Rudo and the goat.exercise.json` | 4 reading-comprehension questions on a short story | all 4 |

`tests/unit/demo-idea-demo-exercises.test.mjs` checks they are well-formed.

## Sources and licences
- African Storybook (CC BY 4.0): 7 stories, incl. Grade 5-level (Read aloud)
  Magozwe, The Honeyguide's revenge, Grandma's bananas.
- Siyavula Natural Sciences and Technology: Grade 4 and 5 EPUBs (CC BY 3.0);
  Grade 5A Learner's Book and Teacher's Guide (CC BY-ND 3.0, share unchanged only).
- Khan Academy maths videos (CC BY-NC-SA, non-commercial only), downloaded from
  Khan Academy's own CDN, never from a Kolibri channel.
- Wikimedia Commons images and clips (CC0 / CC BY / CC BY-SA / public domain).

Pictures are Zimbabwe-themed for now; a country-independent demo set is tracked
in koenswings/idea (see the issue linked from the PR).

`fetch.sh --record OUT` (maintainers only) rewrites the checksums after a
deliberate source change.
