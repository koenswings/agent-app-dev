# Drop Zone (File Drop / file-request target)

The teacher's public **File request** link (upload-only, `permissions=4`)
targets the subfolder **`Drop Zone/inbox`**, not the `Drop Zone` folder itself
(that folder is a Local external mount root on the sidecar). Student walker
action: **Open File Drop** → `/s/grade5adropzone` → upload lands in `inbox/`.

Keep the folder names **Drop Zone** and **inbox** stable for YAML references.
