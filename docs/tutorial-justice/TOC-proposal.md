# IDEA Tutorial for Teachers — TOC + scenario proposal (draft v0, Marco, 2026-10-11)

For: Justice (Zimbabwe, ~Oct 19) + field teacher training. English PDF, explore-the-capabilities, step-by-step with screenshots.
Screens from wizardly-hugle (production, read-mostly). Installation out of scope.

## Source status (read this first)
- FOUND (read-only GitHub): `agent-engine-dev/proposals/backup-disk.md` (Borg; backupApp/restoreApp; modes immediate | on-demand; scheduled deferred),
  `idea/proposals/files-disk.md` (approved 2026-09-28; Make/Add Files, Erase, share "School Files", Nextcloud mount),
  `agent-console-dev` RestorePanel.tsx + e2e/intents/backupDisk.ts, `agent-engine-dev/proposals/multi-engine-operator-markov-disk.dot` (Markov graph — not yet walked state-by-state).
- MISSING on box: `/workspace/research/mecs/agent-programme-manager/` is empty (decks, reference cards, programme.md not present); `/workspace/teacher-manuals/` G5A/Form3 walkthroughs also absent. Need Kid/Steve to re-sync, or I rebuild Kolibri/Nextcloud steps from the live UI during capture.
- Everything marked **(to confirm)** is not verified against what is deployed on wizardly-hugle.

## Table of contents
0. How to use this guide (who it is for, demo school, accounts, symbols: 👩‍🏫 teacher / 🧒 learner / 🛠 operator)
1. What IDEA is: one Pi, disks, school Wi-Fi, a browser. Apps: Kolibri, Nextcloud, Kiwix/Wikipedia. The Console.
2. Getting connected: join Wi-Fi, open Console, Network → disk → app row → **Open (only when Running)**. Never Start if Running; never type ports.
3. Kolibri for teachers (scenarios K1–K5)
4. Kolibri for learners (S1–S2)
5. Nextcloud for teachers (N1–N3)
6. Nextcloud for learners (S3–S4)
7. Kiwix / Wikipedia offline (W1, incl. learner use)
8. Bringing your own content: the Files Disk (F1–F3)
9. Keeping data safe: the Backup Disk (B1–B4)
10. Console basics for teachers/operators (C1–C4)
11. Troubleshooting + field checklist (daily/weekly) + glossary
Appendix: demo accounts/content list; trainer session plan (half-day).

## Scenarios
Legend — Writes on wizardly-hugle: **R** read-only, **W** reversible app-level write (demo data, deletable), **W!** disk/Engine-level write (risky → propose alternative).

| ID | Scenario | Demo content needed | Writes on wizardly-hugle |
|---|---|---|---|
| K1 | Create a class "Demo Grade 5A" | Kolibri facility, admin/coach account | W (new class) |
| K2 | Enroll learners | 3–5 demo learner accounts (demo_learner1..) | W (create users, enroll) |
| K3 | Create + assign lesson (3 videos + 3 exercises), make Visible | Khan EN-US slice: G5A Add & subtract fractions (already pinned) | W (lesson) |
| K4 | Create + assign a quiz | Same slice's exercises | W (quiz) |
| K5 | Read reports (lesson + quiz progress) | Needs learner activity from S1/S2 | R (after S1/S2) |
| S1 | Learner signs in, watches video, does exercise | Learner account, K3 lesson | W (progress logs) |
| S2 | Learner takes quiz | K4 quiz | W (attempt logs) |
| N1 | Teacher shares folder with class (group) | Nextcloud teacher + learner accounts, group "Grade5A", folder w/ 2–3 worksheets (PDF) | W |
| N2 | Collaborative document (teachers co-edit lesson plan) | Office/text editor in Nextcloud **(to confirm which editor is installed)** | W |
| N3 | File drop: learners hand in work via upload-only link | File-drop share **(to confirm enabled)** | W |
| S3 | Learner opens shared worksheet, edits collab doc | N1/N2 | W |
| S4 | Learner submits homework via file drop | N3 | W (upload) |
| W1 | Search/browse offline Wikipedia; use in a lesson | Kiwix ZIM loaded **(to confirm which ZIM on wizardly-hugle)** | R |
| F1 | Prepare a Files Disk: dock stick, Make this a Files Disk (or Add Files to existing disk), share "School Files" | **Spare USB stick** with internet-downloaded PDFs/images/videos | **W!** — Erase path on exFAT stick destroys stick content; createFilesDisk recreates Nextcloud. **Alternative:** pre-prepare stick as ext4 Files Disk on a dev Pi; on wizardly-hugle only dock + screenshot; or capture F1 entirely on dev Pi. Implementation status of Files Disk on prod **(to confirm — approved design, rollout idea#75 sub-issues)** |
| F2 | Files Disk → Nextcloud: "School Files" folder appears; copy into class folder, share (N1) | F1 disk | W (Nextcloud copy) — R if disk pre-made |
| F3 | Files Disk → Kolibri: make downloaded material a lesson resource | **(to confirm)** Kolibri cannot import arbitrary PDFs/videos into a channel without Kolibri Studio / ricecooker; Files Disk is not mounted into Kolibri in v1 (only opted-in apps; Nextcloud first). Proposal: show realistic path = link resource in Nextcloud + import *ready Kolibri channel* from disk via Kolibri Device → Import from local drive **(to confirm on prod)**. Needs Steve/Koen decision. | W (channel import adds content) |
| B1 | Understand backup: what is protected (App instances: Kolibri/Nextcloud data), what is not (Files Disk content — out of scope v1) | Text + diagram | R |
| B2 | Make a Backup Disk + link apps; mode on-demand vs immediate | **Spare disk** | **W!** createBackupDisk on a disk; backup stops/restarts the instance (classes lose access minutes). **Alternative:** dev Pi or spare disk on wizardly-hugle outside school hours, never reuse a disk with data |
| B3 | Run a backup now (backupApp), check "last backup" time | B2 disk | **W!** instance stop/start on prod. Alternative: do on dev Pi; on prod only screenshot the "last backup" view |
| B4 | Pi crashed: restore onto a new disk / other Pi (restoreApp → target disk) via Console RestorePanel | Backup disk with archive + **empty target disk** | **W!! HIGHEST RISK** — never restore onto a prod App Disk. **Do on dev Pi (e.g. idea01/03) with copy of demo instance**, or simulate crash by undocking a *spare* app disk. UI wording for RestorePanel **(to confirm)** |
| B5 | Safe-eject rules: never pull a disk during backup (lock file / interrupted backup resumes on re-dock) | — | R (text) |
| C1 | Read Console: Network tree, Engines, disks, badges (app/backup/files/empty), app status | — | R |
| C2 | Open an app (Running) — what to do if Stopped/Undocked (call operator; Start only by operator **(to confirm teacher policy)**) | — | R |
| C3 | Eject a disk safely | spare disk | W (eject spare only) |
| C4 | What NOT to touch: Erase this disk…, Install, Stop | — | R (screenshot of buttons) |

## Asks for Steve / Koen
1. OK to do all **W!** steps (F1, B2–B4) on a dev Pi + spare disks, keeping wizardly-hugle to R/W only? (recommended)
2. F3 decision: what "turn disk content into Kolibri material" means in v1 (to confirm feasibility).
3. Confirm deployed on wizardly-hugle: Files Disk feature, Backup Disk + RestorePanel, Nextcloud editor + file drop, Kiwix ZIM.
4. Demo accounts: who creates them on wizardly-hugle (Kid?) and naming; cleanup after capture.
5. Re-sync my decks/reference cards + teacher-manuals to box (currently missing).
