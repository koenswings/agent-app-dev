#!/usr/bin/env python3
r"""nc-drop-zone-request.py — Prefer A Drop Zone public file request (idea#166).

Usage: nc-drop-zone-request.py BASE_URL [TOKEN] [TARGET_PATH] [MOUNT_ROOT]
  BASE_URL     e.g. http://127.0.0.1:18280
  TOKEN        custom link token (default grade5adropzone; [A-Za-z0-9] only)
  TARGET_PATH  default "/Drop Zone/inbox"  (a SUBFOLDER inside the mount)
  MOUNT_ROOT   default "/Drop Zone"        (Local external mount root)
Env: NC_DROP_USER / NC_DROP_PASS (default teacher / TeacherGrade5A!).

WHY a subfolder: uploads land in a dedicated "Drop Zone/inbox" instead of
next to the preload README/.gitkeep on the Local external mount root, and the
link carries exactly permissions=4 (file drop). (The 2026-10-05 idea01
"This directory is unavailable" page was the hyphenated token below, not the
mount root: a temporary alphanumeric-token link on "/Drop Zone" accepted a
public upload — HTTP 201.)

WHY an alphanumeric token: Nextcloud 31.0.1 apps/dav/appinfo/v2/publicremote.php
derives the public DAV base URI with preg_match('/(^files\/\w+)/i'), so a
custom token with '-' is cut at the first hyphen ("grade5a-drop-zone" →
base uri /public.php/dav/files/grade5a/) and every public DAV request —
PROPFIND (folder listing) and PUT (upload) — fails with HTTP 500
"Requested uri ... is out of base uri". OCS accepts [a-z0-9-] for custom
tokens, \w accepts [A-Za-z0-9_]; the safe intersection is [A-Za-z0-9].
A token outside that set is refused here (random token kept) with a warning.

Steps (idempotent, OCS as teacher):
 1. Delete public link shares (shareType 3) on MOUNT_ROOT, and any other link
    share already holding TOKEN on a different path (frees the token).
 2. Reuse the link share on TARGET_PATH, else create it (permissions 4,
    publicUpload). Existing link with other permissions → PUT permissions 4.
 3. PUT the custom token when it differs (core shareapi_allow_custom_tokens,
    NC31+); keep the random token if the server refuses.
Prints one JSON line; exit 1 on failure.
"""
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

argv = sys.argv[1:]
if not argv:
    print(__doc__, file=sys.stderr)
    sys.exit(2)
base_url = argv[0].rstrip("/")
want = argv[1] if len(argv) > 1 and argv[1] else "grade5adropzone"
target = argv[2] if len(argv) > 2 and argv[2] else "/Drop Zone/inbox"
mount_root = argv[3] if len(argv) > 3 and argv[3] else "/Drop Zone"
user = os.environ.get("NC_DROP_USER", "teacher")
pw = os.environ.get("NC_DROP_PASS", "TeacherGrade5A!")

base = f"{base_url}/ocs/v2.php/apps/files_sharing/api/v1/shares"
auth = "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode()
LABEL = "Grade 5A Drop Zone"
NOTE = "Upload your work for Grade 5A here (duration-tests file request)."


def call(method, url, data=None):
    body = urllib.parse.urlencode(data).encode() if data else None
    headers = {"Authorization": auth, "OCS-APIRequest": "true", "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)["ocs"]
    except urllib.error.HTTPError as e:
        try:
            return json.load(e)["ocs"]
        except Exception:
            return {"meta": {"statuscode": e.code, "message": str(e)}, "data": None}


def ok(res):
    return int((res.get("meta") or {}).get("statuscode", 0)) in (100, 200)


def is_link(s):
    return int(s.get("share_type", -1)) == 3


def norm(p):
    return "/" + (p or "").strip("/")


def fail(msg, res=None):
    print(json.dumps({"ok": False, "error": msg, "meta": (res or {}).get("meta")}))
    sys.exit(1)


# 1. Free the mount root + the wanted token.
listing = call("GET", f"{base}?format=json")
if not ok(listing):
    fail("list shares failed", listing)
deleted = []
for s in listing.get("data") or []:
    if not is_link(s):
        continue
    p = norm(s.get("path"))
    if p == norm(mount_root) or (s.get("token") == want and p != norm(target)):
        res = call("DELETE", f"{base}/{s['id']}?format=json")
        if not ok(res):
            fail(f"delete share {s['id']} on {p} failed", res)
        deleted.append({"id": str(s["id"]), "path": p, "token": s.get("token"),
                        "permissions": int(s.get("permissions", 0))})

# 2. Upload-only link on the subfolder.
q = urllib.parse.urlencode({"path": target, "reshares": "true", "format": "json"})
existing = call("GET", f"{base}?{q}")
links = [s for s in (existing.get("data") or []) if is_link(s)] if ok(existing) else []
share = next((s for s in links if s.get("token") == want), None) or (links[0] if links else None)
created = False
if share is None:
    res = call("POST", f"{base}?format=json", {
        "path": target, "shareType": 3, "permissions": 4, "publicUpload": "true",
        "label": LABEL, "note": NOTE,
    })
    share = res.get("data") if ok(res) else None
    if not share:
        fail(f"create link share on {target} failed", res)
    created = True
if int(share.get("permissions", 0)) != 4:
    res = call("PUT", f"{base}/{share['id']}?format=json", {"permissions": 4})
    if not (ok(res) and res.get("data")):
        fail(f"set permissions 4 on share {share['id']} failed", res)
    share = res["data"]

# 3. Stable custom token (only an upload-safe one, see WHY above).
token_ok = re.fullmatch(r"[A-Za-z0-9]+", want) is not None
if not token_ok:
    print(f"WARN: custom token {want!r} has chars outside [A-Za-z0-9]; NC 31.0.1 public DAV "
          "(uploads) breaks on it — keeping the server token", file=sys.stderr)
custom = share.get("token") == want and token_ok
if not custom and token_ok:
    res = call("PUT", f"{base}/{share['id']}?format=json", {"token": want})
    if ok(res) and res.get("data") and res["data"].get("token") == want:
        share, custom = res["data"], True

print(json.dumps({
    "ok": True, "id": str(share["id"]), "token": share["token"], "customToken": custom,
    "requestedToken": want, "uploadSafeToken": bool(re.fullmatch(r"[A-Za-z0-9]+", share["token"])),
    "permissions": int(share.get("permissions", 4)), "path": norm(target),
    "mountRoot": norm(mount_root), "created": created, "deleted": deleted,
}))
