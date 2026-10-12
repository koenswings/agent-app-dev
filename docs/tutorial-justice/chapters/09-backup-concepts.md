# 9. Keeping data safe: the Backup Disk (concepts)

Making and restoring backups is done by the operator and practised on a test Pi. Teachers should know:
- A **Backup Disk** is a separate disk with the **backup** badge in the Console.
- It saves the **apps' data**: Kolibri (classes, learners, progress) and Nextcloud (accounts, files inside Nextcloud).
- It does **not** save Files Disk content (version 1).
- During a backup, the app stops for a short time and then starts again. Plan backups outside lesson time.
- If a Pi breaks, the operator restores the latest backup onto a new disk. You lose only what was done after the last backup.
- Never unplug a disk while a backup is running. If it happens, the backup restarts next time the disk is connected.
How often the school backs up (each time the disk is plugged in, or on request): **to confirm** per school.

## Hands-on (operator, captured on the demo box 2026-10-12; screenshots to be added)

### B2. Make a Backup Disk
1. Plug in a spare disk. If it is new, it first has to become an empty **IDEA Disk** (chapter 8, Erase).
2. Select the **IDEA Disk** marked **empty** and click **Make this a Backup Disk** ("Link instances and choose a backup schedule"). <!-- screenshot:B2-11 -->
3. Choose when backups run:
   - **On demand**: "Backup only when you press the Back up button manually." (used in the demo)
   - **Immediate**: "Backup runs as soon as the disk is docked."
   - **Scheduled**: "Backup runs on a schedule configured on the disk."
4. Under **LINK TO INSTANCES**, tick only the school apps to protect (demo: **kolibri-1.0** and **nextcloud-1.0-31.0.1**). Do not tick apps that are not yours. <!-- screenshot:B2-12 -->
5. Click **Configure Backup Disk**. The disk now has the **backup** badge and a **Backups** list: each linked app with "Never backed up" and a **Restore** button. <!-- screenshot:B2-13 -->

### B3. Run a backup
1. In **ALL APPS** (or the app's disk), each linked app row has a **Back up** button next to Start / Stop / Open. Click it. <!-- screenshot:B3-00a -->
2. The app stops for a short time while it is copied, then starts again. Do this outside lesson time.
3. Open the app's details (status dot): **LAST BACKUP** shows the date and time (**to confirm**: final screenshot pending). <!-- screenshot:B3-02 -->

### B4. Restore after a crash
1. On the Backup Disk, each app in the **Backups** list has a **Restore** button.
2. Restore needs a **target disk**: a spare disk to put the app on. On the demo box the list said **"No available target disks."**, because the only other disks were the Files Disk and the System Disk. The Console does not offer the System Disk as a target.
3. With a spare empty IDEA Disk plugged in, choose it as the target and confirm (**to confirm**: not yet tried; per the design, the latest backup is unpacked onto the target disk and the app starts there).
Never restore onto a disk that holds other apps you need.
