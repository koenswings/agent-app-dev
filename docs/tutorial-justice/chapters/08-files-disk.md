# 8. Bringing your own content (Files Disk)

An operator prepares a Files Disk in the Console (F1); teachers then use it in Nextcloud (F2).

## What a Files Disk is
- A USB stick or disk that the operator turns into a shared file store in the Console. It shows the **files** badge.
- Its folder (for example **School Files**) appears inside **Nextcloud**. In version 1 it is available **only in Nextcloud**, not in Kolibri.
- **Backups do not cover Files Disk content** in version 1. Keep your own copy of important files.

## F3. Can I put my own files into Kolibri?
Not directly. Kolibri only imports ready-made **Kolibri channels** (from Kolibri Studio online, another Kolibri server, or a drive with a channel exported from another Kolibri). Your own videos/PDFs must first be built into a channel on Kolibri Studio, which needs internet and an account.
On our IDEA setup, Kolibri does not see USB disks or the Files Disk, so "Import from attached drive" is not available today. Use Nextcloud for your own files, and Kolibri for the prepared lessons.

Note (not yet tested on IDEA): Kolibri can also copy channels from **another Kolibri server on the same local network**, without internet (Device > Channels > Import > "Local network or internet", enter the other server's address). Both servers need Kolibri 0.11 or later. This only moves ready-made Kolibri channels, not your own files. Source: Kolibri docs, "Import from a local network or internet".

## F1. Making a Files Disk (operator, captured 2026-10-12, run did not finish)
1. Select the new disk (UNFORMATTED badge), click **Make this a Files Disk**. The panel **MAKE THIS A FILES DISK** asks for a **SHARE NAME** and offers **Erase the disk first** ("Removes everything on it, then makes it a Files Disk").
2. The confirmation **Erase <disk>?** shows model, size and contents. Type the disk name exactly, then click **Erase and make a Files Disk**.
   ![Erase confirmation](../screenshots/F1-03.png)
   ![Name typed](../screenshots/F1-04.png)
3. **Known issue (being fixed):** in Console v0.2.85 the erase can finish correctly while the Console says "Erase finished but the disk did not come back as empty" and the disk disappears from the list. The erase did work; an Engine bug hides the disk afterwards, and it reappears as an empty **IDEA Disk** once the IDEA team has restarted detection. If you see this message: do **not** erase again and do not unplug the disk. Call your IDEA contact.
   ![Erase result](../screenshots/F1-05-0.png)

### F1 on a disk that is already an empty IDEA Disk (captured 2026-10-12, completed)
1. Select the **IDEA Disk** marked **empty**. The view asks "What would you like to do with this disk?": **Make this a Files Disk**, **Make this a Backup Disk**, **Install App**, and **Erase this disk…** at the bottom.
   ![Empty IDEA Disk](../screenshots/F1-11.png)
2. Click **Make this a Files Disk**. The panel explains "Nothing on the disk is erased", with **SHARE NAME** pre-filled as **School Files**. Click **Make this a Files Disk**. (The red **Erase the disk first** is only for disks with other content.)
   ![Make this a Files Disk](../screenshots/F1-12.png)
3. After a short wait the disk shows the **files** badge, "Share name: School Files", free space (here 119.0 GB free of 125.4 GB), an **Eject** button and **Erase this disk…**.
   ![Files Disk](../screenshots/F1-14.png)

### F2. Using the Files Disk in Nextcloud (captured 2026-10-13)
1. In the Console, the Files Disk view now says **"Available in: Nextcloud (…)"**, with the share name, free space, **Eject** and **Erase this disk…**.
   ![Files Disk available in Nextcloud](../screenshots/F2-01.png)
2. In Nextcloud (as a teacher), **Files** shows a folder **School Files** (marked as External storage in the left menu).
   ![School Files in Nextcloud](../screenshots/F2-02.png)
3. Open **School Files** to see what is on the disk. Files copied onto the disk (here `demo-Fractions-Worksheet-1.pdf`) appear here.
   ![School Files content](../screenshots/F2-03.png)
4. To share a file with a class: on the file's row click **⋯** (Actions) > **Show sharing options** (or the share icon). In **Internal shares**, type the class group name (here `demo-Grade5A`), choose it from the list, keep **View only** and save. The group then appears under Internal shares and the row shows "Shared with group demo-Grade5A".
   ![File in School Files shared with demo-Grade5A](../screenshots/F2-06.png)
5. A learner in that group (here `demo-learner1`) signs in and finds the file in **All files** (and under *Recently shared*).
   ![Learner sees the shared file](../screenshots/F2-07.png)
   Only teachers see the **School Files** folder; learners get only the files that are shared with them.

Reminder: in version 1 a Files Disk is for **Nextcloud only** (not Kolibri), and **backups do not cover Files Disk content** (the Backup Disk links app instances only). Keep your own copy of important files.
