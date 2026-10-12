# 11. Operator basics

For the school's IDEA operator, not for every teacher. Console v0.2.85 on the demo box. Everything here is **look only**: do not press Start, Stop or other action buttons unless your IDEA contact asks you to.

## O1. Operator Login
1. In the Console, click the person icon (top right). The **Operator Login** panel opens with a username and a password field (the eye icon shows/hides the password).
   ![Operator Login](../screenshots/O1-01.png)
2. Type the operator username and password, click **Log in**. The **Account** panel then shows your name, role **Operator**, **Change Password**, **Manage Operators** and **Log out**.
   ![Account panel](../screenshots/O2-00.png)
3. **On a real school deployment, change the default operator password straight away** (Account > Change Password: current password, new password twice, **Change password**). Keep the new password with the school head, not on a sticker on the box.
4. Close the panel with **✕**. Use **Log out** in the same panel when you are done.

## O2. The Network view: Engine and disks
1. After login the left side shows **NETWORK**: **ALL APPS**, then the IDEA box (Engine, here `wizardly-hugle`, with an **Online** status) and its disks.
   ![All apps](../screenshots/O2-01.png)
2. Click the Engine name to select it.
   ![Engine selected](../screenshots/O2-02.png)
3. Click a disk (here **System Disk**). Each disk shows role badges: **app**, **backup**, **files**, **empty**. The right side lists the **Apps** on that disk with a count.
   ![Disk view](../screenshots/O2-03.png)

## O3. App status
1. Each app row shows the app name and version (e.g. `kolibri-1.0`), a coloured status dot, and buttons **Start**, **Stop** and **Open ↗**.
2. Click the status dot (**Show details**) to see: STATUS (e.g. **Running**), VERSION, ENGINE, PORT, CREATED, LAST STARTED, **LAST BACKUP** (e.g. "Never"), the description, a short log, and CONTAINER METRICS (CPU, memory, network, disk).
   ![App details](../screenshots/O3-01.png)
3. Only Start or Stop an app when your IDEA contact asks you to. Never touch **MilkWise** or other non-school apps.

## O4. Command History
1. The clipboard icon (top right) lists recent Engine commands (for example `startInstance`, `installApp`) with ✓ (done) or ✗ (failed) and how long ago. Use it when you report a problem.
   ![Command History](../screenshots/O4-01.png)

## O5. Safely ejecting a disk
The **System Disk** (the box's own disk) has no Eject button. A separate USB disk shows **Eject** in its disk view (**to confirm**: not visible on the demo box, which has no extra disk). Eject lists what will stop before you confirm. Never eject or unplug during a backup.

## O6. Dangerous buttons
**Erase this disk…**, **Install App**, **Make this a Files/Backup Disk**, **Stop**: only with your IDEA contact on the phone. (Erase/Make … appear only on non-system disks: **to confirm** on a real spare disk.)

## O7. Backup and restore (later)
Placeholder for B2–B4 once tested on a dev Pi or with spare disks. The **LAST BACKUP** line in app details (O3) shows when an app was last backed up.
