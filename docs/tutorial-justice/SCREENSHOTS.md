# SCREENSHOTS spec — IDEA tutorial (Playwright, not yet captured)

Runner: Playwright on Koen's Mac (machineId 70ba4857-24c8-4d2d-9b29-ca368167ced2), temp dir `~/idea-tutorial`. Target wizardly-hugle via Tailscale **100.115.60.6**. Never run on wizardly-hugle or bot computers.
Viewport: desktop 1280x800 (default); learner shots also 390x844 mobile where marked *m*. Device scale 2.
Navigation rule: Console base URL `http://100.115.60.6:<console-port>/` (**port to confirm**, Atlas). Apps are reached ONLY by clicking Network → disk → app row → Open (Running); script follows the popup URL. No hardcoded app ports. Paths below after the app host are relative to the opened app.
Writes: only R/W scenarios with demo- objects. No W! (F1, B2–B4). Mask passwords; no real learner names.

| ID | Chapter | URL path / navigation | Login | Viewport | Must be visible |
|---|---|---|---|---|---|
| CON-01 | 02-getting-connected.md | Console / | none (Console, no login) | 1280x800 | Console home |
| CON-02 | 02-getting-connected.md | Console / | none (Console, no login) | 1280x800 | Network selected in left nav |
| CON-03 | 02-getting-connected.md | Console / | none (Console, no login) | 1280x800 | disk row selected, apps listed |
| CON-04 | 02-getting-connected.md | Console / | none (Console, no login) | 1280x800 | app row selected, subtitle |
| CON-05 | 02-getting-connected.md | Console / | none (Console, no login) | 1280x800 | Status Running + Open button highlighted |
| K1-01 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | Kolibri sign-in form |
| K1-02 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | Classes list |
| K1-03 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | New class dialog with demo-Grade5A |
| K2-01 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | Learners tab + Enroll learners |
| K2-02 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | demo-learner3 ticked, Confirm |
| K3-01 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | New lesson dialog |
| K3-02 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | Manage resources button |
| K3-03 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | topic tree to Add and subtract fractions |
| K3-04 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | 3V+3E ticked, counter 6 |
| K3-05 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | Recipients = demo-Grade5A |
| K3-06 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | Visible toggle on |
| K4-01 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | Quizzes tab + New quiz |
| K4-02 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | exercise selection, question count |
| K4-03 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | quiz Active/Start toggle |
| K5-01 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | class report overview |
| K5-02 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | lesson progress per learner (learner1 done, learner2 partial) |
| K5-03 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | quiz scores + hard question |
| K5-04 | 03-kolibri-teachers.md | Kolibri /coach (or /facility for classes, to confirm) | demo-teacher1 (Kolibri) | 1280x800 | single learner view |
| S1-01 | 04-kolibri-learners.md | Kolibri /learn | demo-learner1 (Kolibri) | 1280x800 + 390x844 m | sign-in as learner |
| S1-02 | 04-kolibri-learners.md | Kolibri /learn | demo-learner1 (Kolibri) | 1280x800 + 390x844 m | learner class view |
| S1-03 | 04-kolibri-learners.md | Kolibri /learn | demo-learner1 (Kolibri) | 1280x800 + 390x844 m | lesson with 6 items |
| S1-04 | 04-kolibri-learners.md | Kolibri /learn | demo-learner1 (Kolibri) | 1280x800 + 390x844 m | video playing |
| S1-05 | 04-kolibri-learners.md | Kolibri /learn | demo-learner1 (Kolibri) | 1280x800 + 390x844 m | exercise with Check + completion |
| S2-01 | 04-kolibri-learners.md | Kolibri /learn | demo-learner1 (Kolibri) | 1280x800 + 390x844 m | learner Quizzes list |
| S2-02 | 04-kolibri-learners.md | Kolibri /learn | demo-learner1 (Kolibri) | 1280x800 + 390x844 m | quiz question |
| S2-03 | 04-kolibri-learners.md | Kolibri /learn | demo-learner1 (Kolibri) | 1280x800 + 390x844 m | after Submit |
| N0-01 | 05-nextcloud-teachers.md | Nextcloud /apps/files | demo-teacher1 (Nextcloud) | 1280x800 | Files app overview |
| N1-01 | 05-nextcloud-teachers.md | Nextcloud /apps/files | demo-teacher1 (Nextcloud) | 1280x800 | Share icon on demo-Worksheets |
| N1-02 | 05-nextcloud-teachers.md | Nextcloud /apps/files | demo-teacher1 (Nextcloud) | 1280x800 | Internal shares with demo-Grade5A |
| N1-03 | 05-nextcloud-teachers.md | Nextcloud /apps/files | demo-teacher1 (Nextcloud) | 1280x800 | View only permission |
| N2-01 | 05-nextcloud-teachers.md | Nextcloud /apps/files | demo-teacher1 (+demo-teacher2 for N2-04) | 1280x800 | +New > New document |
| N2-02 | 05-nextcloud-teachers.md | Nextcloud /apps/files | demo-teacher1 (+demo-teacher2 for N2-04) | 1280x800 | template picker |
| N2-03 | 05-nextcloud-teachers.md | Nextcloud /apps/files | demo-teacher1 (+demo-teacher2 for N2-04) | 1280x800 | share with Allow editing |
| N2-04 | 05-nextcloud-teachers.md | Nextcloud /apps/files | demo-teacher1 (+demo-teacher2 for N2-04) | 1280x800 | two avatars top right |
| N3-01 | 05-nextcloud-teachers.md | Nextcloud /apps/files | demo-teacher1 (Nextcloud) | 1280x800 | File request option |
| N3-02 | 05-nextcloud-teachers.md | Nextcloud /apps/files | demo-teacher1 (Nextcloud) | 1280x800 | clipboard copy icon |
| N3-03 | 05-nextcloud-teachers.md | Nextcloud /apps/files | demo-teacher1 (Nextcloud) | 1280x800 | uploaded file in demo-Drop Zone |
| S3-01 | 06-nextcloud-learners.md | Nextcloud /apps/files | demo-learner1 (Nextcloud) | 1280x800 + 390x844 m | learner sign-in |
| S3-02 | 06-nextcloud-learners.md | Nextcloud /apps/files | demo-learner1 (Nextcloud) | 1280x800 + 390x844 m | view-only worksheet, no delete |
| S3-03 | 06-nextcloud-learners.md | Nextcloud /apps/files | demo-learner1 (Nextcloud) | 1280x800 + 390x844 m | learner text in shared doc |
| S4-01 | 06-nextcloud-learners.md | Nextcloud /s/<file-request-token> | anonymous (file-request link) | 1280x800 + 390x844 m | drop page |
| S4-02 | 06-nextcloud-learners.md | Nextcloud /s/<file-request-token> | anonymous (file-request link) | 1280x800 + 390x844 m | upload in progress/done |
| S4-03 | 06-nextcloud-learners.md | Nextcloud /s/<file-request-token> | anonymous (file-request link) | 1280x800 + 390x844 m | empty list for learner |
| W1-01 | 07-wikipedia-offline.md | Kiwix / | none (Kiwix) | 1280x800 | Kiwix library |
| W1-02 | 07-wikipedia-offline.md | Kiwix / | none (Kiwix) | 1280x800 | Wikipedia card |
| W1-03 | 07-wikipedia-offline.md | Kiwix / | none (Kiwix) | 1280x800 | search Fraction, article |
| W1-04 | 07-wikipedia-offline.md | Kiwix / | none (Kiwix) | 1280x800 | linked article |
| F2-01 | 08-files-disk.md | Console disk / Nextcloud /apps/files | demo-teacher1 (Nextcloud); F2-01 Console | 1280x800 | Files Disk view "Available in: Nextcloud" (only if a Files Disk exists on prod — to confirm) |
| F2-02 | 08-files-disk.md | Console disk / Nextcloud /apps/files | demo-teacher1 (Nextcloud); F2-01 Console | 1280x800 | School Files folder in Nextcloud |
| F2-03 | 08-files-disk.md | Console disk / Nextcloud /apps/files | demo-teacher1 (Nextcloud); F2-01 Console | 1280x800 | copy dialog |
| C1-01 | 10-console-basics.md | Console / → Network | none (Console) | 1280x800 | Network tree with Engine + disks |
| C1-02 | 10-console-basics.md | Console / → Network | none (Console) | 1280x800 | disk role badges |
| C1-03 | 10-console-basics.md | Console / → Network | none (Console) | 1280x800 | app status labels |
| C3-01 | 10-console-basics.md | Console disk view | none (Console) | 1280x800 | Eject button (do NOT click on prod) |
| C4-01 | 10-console-basics.md | Console disk view | none (Console) | 1280x800 | Erase/Install/Stop buttons (do NOT click) |
