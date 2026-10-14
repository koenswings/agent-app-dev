> Redacted copy for the repo (14 Oct 2026): Tailscale address, store id and admin account name removed. No passwords.

# wizardly-hugle demo — DONE (2026-10-12 07:37 CEST; Kiwix updated 07:47 CEST)

Host: wizardly-hugle — Tailscale <TAILSCALE-IP>, LAN 192.168.0.231. Disk: /dev/sda2 117G, 35G used, 76G free (32%).

## URLs (all checked 200 on both IPs)
| Service | Tailscale | LAN |
|---|---|---|
| Console (Engine) | http://<TAILSCALE-IP>:8081 | http://192.168.0.231:8081 |
| Kolibri | http://<TAILSCALE-IP>:54189 | http://192.168.0.231:54189 |
| Nextcloud | http://<TAILSCALE-IP>:50065 | http://192.168.0.231:50065 (also wizardly-hugle:50065) |
| Collabora (CODE, used by NC Office) | http://<TAILSCALE-IP>:9980 | http://192.168.0.231:9980 |
| Kiwix 1.0.1 | http://<TAILSCALE-IP>:61312 (Main_Page and search OK) | http://192.168.0.231:61312 |
| Milkwise (untouched) | http://<TAILSCALE-IP>:3333 | http://192.168.0.231:3333 |

## Versions
- Engine 8da5173 (origin/main, includes #176), was 033f976. Backups: dist-prev-033f976-20261012/, config.yaml.bak-20261012, store-identity.bak-20261012/. config unchanged (mdns false, httpPort 8081, store <STORE-ID>). No lockfile change, so no pnpm install.
- Nextcloud app 1.0-31.0.1 (Nextcloud 31.0.1, MariaDB 11.7.2, CODE 24.04.13.2), instance nextcloud-yj8ral61js46bphogbi on System Disk, port 50065. richdocuments 8.8.3, Text 5.0.0.
- Kolibri 0.15.5 (kolibri-1.0), Kiwix 1.0.1 (app-kiwix tag 1.0.1 = 2e7d861), instance kiwix-j4bwzandgbel53pcn9d, port 61312, ZIM wikipedia_en-simple_all_nopic_2026-09 (sha256 ee93790a… verified). The old hand-patched kiwix-1.0 (kiwix-k12o0bwobek1opnevcz, :57781) was stopped, removed from the store, and its folder moved to /home/pi/quarantine/20261012-kiwix-1.0-handpatch on wh.
- Milkwise StartedAt 2026-10-12T03:00:23Z, unchanged, 0 restarts.

## Accounts (no passwords in this file; they are kept outside the repo)
- Nextcloud admin: the admin account (name and password not in this file)
- Nextcloud: demo-teacher1 "Teacher One" (demo-Grade5A, demo-teachers), demo-teacher2 "Teacher Two" (demo-teachers), demo-learner1 "Learner One" and demo-learner2 "Learner Two" (demo-Grade5A). None are admins.
- demo-teacher1 Files root: Fractions-Worksheet-1/2/3 PDFs.
- Kolibri: facility demo-School; demo_admin, demo_teacher1, demo_learner1/2 (class demo-Grade5A), demo_learner3 (not enrolled).

## Kolibri content
- Khan Academy (English) v14: "Adding and subtracting fractions with unlike denominators" (4 videos, 3 exercises), all files 200.
- Khan Academy (English - US curriculum) c9d7f950…: Marco's node 4a5b44d4826e511b8bb2e568b9562c5c, 5th grade > Add and subtract fractions (5 subtopics, 18 videos, 10 exercises), all files 200.
