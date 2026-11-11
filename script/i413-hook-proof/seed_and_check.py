#!/usr/bin/env python3
"""Seed hook activity and check idea-usage-day/1 files for idea#413.

Passwords follow the IDEA <account>911! convention and are built in memory.
They are never printed, never written to a log, and never placed in argv
(the HTTP client runs inside this process).
"""
from __future__ import annotations

import argparse
import json
import os
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
import acceptance_checks

PASSWORD_SUFFIX = "911!"
FORBIDDEN_LOG_SUBSTR = ("911!", "password=", "OC_PASS", "Authorization:")


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def log(msg: str) -> None:
    lower = msg.lower()
    for bad in FORBIDDEN_LOG_SUBSTR:
        if bad.lower() in lower:
            die("refusing to print a line that looks like it contains a secret")
    print(f"==> {msg}", file=sys.stderr)


def password_for(username: str) -> str:
    if not username or any(c in username for c in " \t\n\r"):
        die("refusing to build a password for an empty or invalid username")
    return f"{username}{PASSWORD_SUFFIX}"


def _no_verify_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


class Session:
    def __init__(self, base: str, timeout: int = 30) -> None:
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar),
            urllib.request.HTTPSHandler(context=_no_verify_ctx()),
        )
        self.csrf = ""
        self.last_status = 0

    def request(
        self,
        method: str,
        path: str,
        *,
        data: bytes | None = None,
        json_body: Any | None = None,
        headers: dict[str, str] | None = None,
        content_type: str | None = None,
        raw_url: bool = False,
        fatal: bool = True,
    ) -> tuple[int, bytes, dict[str, str]]:
        url = path if raw_url else (self.base + (path if path.startswith("/") else "/" + path))
        hdrs = dict(headers or {})
        body = data
        if json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
            hdrs.setdefault("Content-Type", "application/json")
        if content_type:
            hdrs["Content-Type"] = content_type
        if self.csrf and "X-CSRFToken" not in hdrs:
            hdrs["X-CSRFToken"] = self.csrf
        req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
        try:
            with self.opener.open(req, timeout=self.timeout) as resp:
                self.last_status = resp.status
                raw = resp.read()
                resp_headers = {k.lower(): v for k, v in resp.headers.items()}
                return resp.status, raw, resp_headers
        except urllib.error.HTTPError as e:
            self.last_status = e.code
            raw = e.read() if e.fp else b""
            resp_headers = {k.lower(): v for k, v in (e.headers.items() if e.headers else [])}
            return e.code, raw, resp_headers
        except urllib.error.URLError as e:
            if fatal:
                die(f"request to {url} failed: {e.reason}")
            raise

    def json(self, method: str, path: str, **kw: Any) -> tuple[int, Any]:
        status, raw, _ = self.request(method, path, **kw)
        if not raw:
            return status, None
        try:
            return status, json.loads(raw.decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            return status, None


# ----- Kolibri -----

def kolibri_wait(base: str, timeout: int = 300) -> None:
    start = time.time()
    while time.time() - start < timeout:
        try:
            status, raw, _ = Session(base, timeout=5).request(
                "GET", "/api/public/info/", fatal=False
            )
            if status == 200:
                log(f"Kolibri is up at {base}")
                return
        except SystemExit:
            raise
        except Exception:
            pass
        time.sleep(3)
    die(f"Kolibri at {base} did not become ready within {timeout}s")


def _kolibri_session(base: str) -> Session:
    s = Session(base)
    s.request("GET", "/")
    for c in s.jar:
        if c.name in ("csrftoken", "kolibri_csrftoken"):
            s.csrf = c.value
    return s


def kolibri_facilities(base: str) -> list:
    try:
        status, data = Session(base, timeout=10).json(
            "GET", "/api/public/v1/facility/", fatal=False
        )
    except (urllib.error.URLError, TimeoutError, OSError):
        return []
    if status == 200 and isinstance(data, list):
        return data
    return []


def _write_secret_file(dest: Path, payload: dict) -> None:
    data = json.dumps(payload).encode("utf-8")
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        return
    except PermissionError:
        pass
    tmp = Path(tempfile.mkstemp(prefix="i413-provision-", suffix=".json")[1])
    try:
        os.chmod(tmp, 0o600)
        tmp.write_bytes(data)
        rc = subprocess.run(["sudo", "cp", "-a", str(tmp), str(dest)], capture_output=True)
        if rc.returncode != 0:
            die("could not write the Kolibri provision spec (permission denied)")
        subprocess.run(["sudo", "chmod", "600", str(dest)], check=False)
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass


def _unlink_quiet(path: Path) -> None:
    try:
        path.unlink()
    except OSError:
        subprocess.run(["sudo", "rm", "-f", str(path)], capture_output=True)


def _write_bytes(dest: Path, data: bytes) -> None:
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        return
    except PermissionError:
        pass
    fd, tmpname = tempfile.mkstemp(prefix="i413-provision-", suffix=".bin")
    tmp = Path(tmpname)
    try:
        os.chmod(tmp, 0o600)
        os.write(fd, data)
        os.close(fd)
        fd = None
        rc = subprocess.run(["sudo", "cp", "-a", str(tmp), str(dest)], capture_output=True)
        if rc.returncode != 0:
            die("could not write a Kolibri provision file (permission denied)")
        subprocess.run(["sudo", "chmod", "600", str(dest)], check=False)
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
        try:
            tmp.unlink()
        except OSError:
            pass


def _sanitize_provision_output(text: str) -> str:
    # Strip anything that looks like a secret before it can reach a log.
    lowered = text
    for bad in FORBIDDEN_LOG_SUBSTR:
        if not bad:
            continue
        idx = 0
        while True:
            i = lowered.lower().find(bad.lower(), idx)
            if i < 0:
                break
            lowered = lowered[:i] + "[redacted]" + lowered[i + len(bad):]
            idx = i + len("[redacted]")
    lines = [ln for ln in lowered.splitlines() if ln.strip()]
    return chr(10).join(lines[-30:])


def _kolibri_image(inst: Path) -> str:
    proc = subprocess.run(
        ["docker", "compose", "config", "--images"],
        cwd=str(inst),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    images = [ln.strip() for ln in (proc.stdout or "").splitlines() if ln.strip()]
    if images:
        return images[0]
    die("could not determine the Kolibri image from compose config")
    return ""


def kolibri_provision_via_manage(data_dir: str) -> None:
    """Provision with a oneshot container, as app-kolibri demo does (never exec into the running server)."""
    inst = Path(data_dir)
    compose = inst / "compose.yaml"
    if not compose.exists():
        compose = inst / "compose.yml"
    if not compose.exists():
        die(f"no compose.yaml under {data_dir}")
    home = inst / "data" / "kolibri"
    settings_path = home / ".i413-facility-settings.json"
    pass_path = home / ".i413-provision.pass"
    run_path = home / ".i413-provision.sh"
    _write_secret_file(settings_path, {"learner_can_login_with_no_password": True})
    _write_bytes(pass_path, password_for("admin").encode("utf-8"))
    runner = """#!/bin/sh
set -eu
PASS=$(cat /root/.kolibri/.i413-provision.pass)
rm -f /root/.kolibri/.i413-provision.pass
B=${KOLIBRI_BIN:-}
if [ -z "$B" ]; then
  if command -v kolibri >/dev/null 2>&1; then B=kolibri
  else
    for f in ./kolibri-*; do
      [ -x "$f" ] && B=$f
    done
  fi
fi
[ -n "$B" ] || { echo "no Kolibri binary" >&2; exit 78; }
"$B" manage provisiondevice --facility "i413 Proof School" --superusername admin --superuserpassword "$PASS" --preset formal --language_id en --facility_settings /root/.kolibri/.i413-facility-settings.json --noinput
echo PROVISION_OK
"""
    _write_bytes(run_path, runner.encode("utf-8"))
    subprocess.run(["sudo", "chmod", "700", str(run_path)], check=False)
    image = _kolibri_image(inst)
    log("stopping Kolibri briefly so provisiondevice can open the database")
    stop = subprocess.run(
        ["docker", "compose", "stop", "kolibri"],
        cwd=str(inst),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=120,
    )
    if stop.returncode != 0:
        die("docker compose stop kolibri failed")
    started = False
    try:
        proc = subprocess.run(
            [
                "docker", "run", "--rm", "--network", "none",
                "-e", "KOLIBRI_RUN_MODE=docker",
                "-e", "KOLIBRI_HOME=/root/.kolibri",
                "-v", f"{home.resolve()}:/root/.kolibri",
                "--entrypoint", "sh",
                image,
                "/root/.kolibri/.i413-provision.sh",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=180,
        )
        out = (proc.stdout or b"").decode("utf-8", errors="replace")
        err = (proc.stderr or b"").decode("utf-8", errors="replace")
        combined = out + chr(10) + err
        if "PROVISION_OK" not in combined or proc.returncode != 0:
            tail = _sanitize_provision_output(combined)
            if tail:
                log("provisiondevice output (secrets redacted): " + tail.replace(chr(10), " | "))
            die(f"Kolibri provisiondevice failed (exit {proc.returncode})")
        log("Kolibri provisioned facility 'i413 Proof School' via provisiondevice (password not shown)")
    finally:
        _unlink_quiet(pass_path)
        _unlink_quiet(settings_path)
        _unlink_quiet(run_path)
        log("starting Kolibri again after provisiondevice")
        start = subprocess.run(
            ["docker", "compose", "start", "kolibri"],
            cwd=str(inst),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=120,
        )
        if start.returncode == 0:
            started = True
        else:
            die("docker compose start kolibri failed after provisiondevice")
    if not started:
        die("Kolibri was not restarted after provisiondevice")


def kolibri_provision(
    base: str, data_dir: str | None = None, *, skip_verify: bool = False
) -> None:
    kolibri_wait(base)
    existing = kolibri_facilities(base)
    if existing:
        log("Kolibri already provisioned; skipping setup wizard")
        return
    if data_dir:
        kolibri_provision_via_manage(data_dir)
        if skip_verify:
            log("provisiondevice finished; HTTP verify left to the caller after Engine startInstance")
            return
        log("waiting for Kolibri to come back after provisiondevice")
        kolibri_wait(base, timeout=180)
        start = time.time()
        while time.time() - start < 120:
            if kolibri_facilities(base):
                log("Kolibri provisioned facility 'i413 Proof School' as admin (password not shown)")
                return
            time.sleep(2)
        die("Kolibri provisiondevice finished but /api/public/v1/facility/ is still empty")
    # Pre-0.19 HTTP path (removed in 0.19; kept as a fallback).
    s = _kolibri_session(base)
    status, info = s.json("GET", "/api/device/deviceprovision/")
    if status == 200 and info:
        log("Kolibri already provisioned; skipping setup wizard")
        return
    payload = {
        "facility": {"name": "i413 Proof School"},
        "preset": "formal",
        "superuser": {"username": "admin", "password": password_for("admin")},
        "language_id": "en",
        "device_name": "i413-proof",
        "allow_guest_access": True,
        "settings": {
            "learner_can_login_with_no_password": True,
            "allow_guest_access": True,
        },
    }
    status, body = s.json("POST", "/api/device/deviceprovision/", json_body=payload)
    if status not in (200, 201):
        die(f"Kolibri provision failed (HTTP {status}); pass --data-dir to use provisiondevice")
    log("Kolibri provisioned facility 'i413 Proof School' as admin (password not shown)")


def kolibri_login(base: str, username: str, *, as_learner: bool = False) -> Session:
    s = _kolibri_session(base)
    # Kolibri 0.19 rejects facility:null with HTTP 400 once a facility exists
    # (app-kolibri demo/seed_classwork.py posts the public facility id).
    facilities = kolibri_facilities(base)
    facility_id = ""
    for row in facilities:
        if str(row.get("name") or "") == "i413 Proof School":
            facility_id = str(row.get("id") or row.get("uid") or "")
            break
    if not facility_id and facilities:
        facility_id = str(facilities[0].get("id") or facilities[0].get("uid") or "")
    body: dict[str, Any] = {
        "username": username,
        "password": password_for(username),
        # 0.19 SessionViewSet.get_session_response writes logger_usersessionlog
        # only when request.data.active is true (default is false). The Learn UI
        # sends this on login and as a later heartbeat.
        "active": True,
    }
    if facility_id:
        body["facility"] = facility_id
    status, data = s.json("POST", "/api/auth/session/", json_body=body)
    if status not in (200, 201):
        die(f"Kolibri login as {username} failed (HTTP {status})")
    for c in s.jar:
        if c.name in ("csrftoken", "kolibri_csrftoken"):
            s.csrf = c.value
    # 0.19 writes logger_usersessionlog only from get_session_response when
    # request.data.active is true (the Learn UI heartbeats this after sign-in).
    active_st, _ = s.json("PUT", "/api/auth/session/current/", json_body={"active": True})
    if active_st not in (200, 201):
        active_st, _ = s.json("PATCH", "/api/auth/session/current/", json_body={"active": True})
    if active_st not in (200, 201):
        die(f"Kolibri session heartbeat (active=true) failed (HTTP {active_st})")
    log(f"Kolibri signed in as {username} (password not shown)")
    return s, data


def _facility_id(s: Session) -> str:
    status, data = s.json("GET", "/api/facility/")
    if status != 200 or not data:
        status, data = s.json("GET", "/api/auth/facility/")
    if isinstance(data, list) and data:
        return str(data[0].get("id") or data[0].get("uid") or "")
    if isinstance(data, dict):
        results = data.get("results") or data.get("facility") or []
        if isinstance(results, list) and results:
            return str(results[0].get("id") or "")
        if data.get("id"):
            return str(data["id"])
    die("could not read Kolibri facility id")
    return ""


def kolibri_ensure_users(base: str) -> None:
    s, _ = kolibri_login(base, "admin")
    facility = _facility_id(s)
    status, users = s.json("GET", "/api/auth/facilityuser/")
    existing = set()
    if isinstance(users, list):
        existing = {u.get("username") for u in users}
    elif isinstance(users, dict):
        existing = {u.get("username") for u in users.get("results") or []}

    def create(username: str, kind: str) -> str:
        if username in existing:
            log(f"Kolibri user {username} already exists")
            # find id
            rows = users if isinstance(users, list) else (users or {}).get("results") or []
            for u in rows:
                if u.get("username") == username:
                    return str(u.get("id") or "")
        payload = {
            "username": username,
            "password": password_for(username),
            "facility": facility,
            "full_name": username,
        }
        st, body = s.json("POST", "/api/auth/facilityuser/", json_body=payload)
        if st not in (200, 201) or not isinstance(body, dict) or not body.get("id"):
            die(f"creating Kolibri user {username} failed (HTTP {st})")
        uid = str(body["id"])
        if kind in ("coach", "admin", "classroom assignable coach"):
            st2, _ = s.json(
                "POST",
                "/api/auth/role/",
                json_body={"user": uid, "collection": facility, "kind": kind},
            )
            if st2 not in (200, 201):
                die(f"assigning Kolibri role {kind} to {username} failed (HTTP {st2})")
        log(f"created Kolibri user {username} with role {kind} (password not shown)")
        return uid

    create("teacher1", "coach")
    create("learner1", "learner")


def kolibri_view_content(
    base: str,
    content_id: str,
    channel_id: str,
    kind: str = "document",
    node_id: str | None = None,
) -> None:
    s, session = kolibri_login(base, "learner1", as_learner=True)
    # Kolibri 0.19 dropped the writable contentsessionlog viewset. The client
    # starts a session with POST /api/logger/trackprogress/ (node_id required)
    # and then PUT /api/logger/trackprogress/<session_id>/ with progress/time.
    start_body = {
        "node_id": node_id or content_id,
        "content_id": content_id,
        "channel_id": channel_id,
        "kind": kind,
    }
    st, body = s.json("POST", "/api/logger/trackprogress/", json_body=start_body)
    if st not in (200, 201) or not isinstance(body, dict) or not body.get("session_id"):
        die(f"Kolibri trackprogress start failed (HTTP {st})")
    sid = str(body["session_id"])
    st2, _ = s.json(
        "PUT",
        f"/api/logger/trackprogress/{sid}/",
        json_body={"progress": 0.8, "time_spent_delta": 45},
    )
    if st2 not in (200, 201):
        die(f"Kolibri trackprogress update failed (HTTP {st2})")
    log(f"learner1 recorded a content session ({kind}) via /api/logger/trackprogress/")


def kolibri_list_leaves(base: str) -> list[dict[str, str]]:
    s, _ = kolibri_login(base, "admin")
    leaves: list[dict[str, str]] = []
    for path in (
        "/api/content/contentnode/?kind_in=video,document,audio,html5,exercise&max_results=20",
        "/api/content/contentnode_slim/?kind_in=video,document,html5,exercise&max_results=20",
    ):
        st, data = s.json("GET", path)
        rows: list[Any] = []
        if isinstance(data, list):
            rows = data
        elif isinstance(data, dict):
            rows = data.get("results") or data.get("results") or []
        for n in rows:
            nid = str(n.get("id") or "")
            cid = str(n.get("content_id") or "")
            ch = str(n.get("channel_id") or "")
            kind = str(n.get("kind") or "document")
            if cid and ch:
                leaves.append({
                    "node_id": nid or cid,
                    "content_id": cid,
                    "channel_id": ch,
                    "kind": kind,
                    "title": str(n.get("title") or ""),
                })
        if leaves:
            break
    return leaves


def cmd_kolibri_provision(args: argparse.Namespace) -> None:
    skip = bool(getattr(args, "provision_only", False))
    kolibri_provision(
        args.base,
        data_dir=(getattr(args, "data_dir", None) or None),
        skip_verify=skip,
    )
    if skip:
        log("Kolibri provisiondevice done (--provision-only)")
        return
    kolibri_ensure_users(args.base)
    # Sign-ins used for the day file (teacher + learner). Admin already signed in.
    kolibri_login(args.base, "teacher1")
    kolibri_login(args.base, "learner1", as_learner=True)
    log("Kolibri provision + teacher1/learner1 sign-ins done")


def cmd_kolibri_view(args: argparse.Namespace) -> None:
    leaves = kolibri_list_leaves(args.base)
    if not leaves:
        die("no Kolibri content leaves found; import a slice before viewing")
    # Prefer a non-exercise leaf so trackprogress does not require mastery_model.
    preferred = [x for x in leaves if x.get("kind") != "exercise"] or list(leaves)
    item = preferred[0]
    log(f"learner will view content title={item.get('title') or '(none)'} kind={item['kind']}")
    kolibri_view_content(
        args.base, item["content_id"], item["channel_id"], item["kind"], node_id=item.get("node_id")
    )
    # A second article/item if present, so distinct content is visible.
    if len(preferred) > 1:
        item2 = preferred[1]
        kolibri_view_content(
            args.base, item2["content_id"], item2["channel_id"], item2["kind"], node_id=item2.get("node_id")
        )


# ----- Nextcloud -----


def _nextcloud_extract_requesttoken(raw: bytes, headers: dict[str, str] | None = None) -> str:
    if headers:
        for key in ("requesttoken", "x-nextcloud-request-token"):
            val = headers.get(key)
            if val:
                return val
    text = raw.decode("utf-8", errors="replace")
    for marker in ('data-requesttoken="', 'name="requesttoken" value="'):
        i = text.find(marker)
        if i >= 0:
            return text[i + len(marker) :].split('"', 1)[0]
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return ""
    if isinstance(parsed, dict):
        tok = parsed.get("token") or parsed.get("requesttoken")
        if isinstance(tok, str) and tok:
            return tok
    return ""


def nextcloud_refresh_requesttoken(s: Session) -> str:
    """Load a fresh CSRF requesttoken for cookie-authenticated POSTs."""
    for path in ("/csrftoken", "/index.php/csrftoken", "/index.php/apps/files/", "/apps/files"):
        st, raw, hdrs = s.request("GET", path)
        tok = _nextcloud_extract_requesttoken(raw, hdrs)
        if tok:
            s.requesttoken = tok  # type: ignore[attr-defined]
            return tok
    return str(getattr(s, "requesttoken", "") or "")


def _wopi_token_in_payload(raw: bytes) -> bool:
    """True when the response contains a Collabora WOPI token, not a CSRF token."""
    if not raw:
        return False
    text = raw.decode("utf-8", errors="replace")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, dict):
        if parsed.get("token") or parsed.get("access_token"):
            return True
        ocs = parsed.get("ocs") if isinstance(parsed.get("ocs"), dict) else None
        if ocs:
            data = ocs.get("data") if isinstance(ocs.get("data"), dict) else {}
            return bool(data.get("token") or data.get("access_token"))
        return False
    if "Failed to open the requested file" in text:
        return False
    return "WOPISrc" in text or "urlsrc" in text or "access_token" in text or "token_ttl" in text


def _direct_edit_url(raw: bytes) -> str:
    """URL from OCS createDirect (oc_richdocuments_direct). Not itself a WOPI token."""
    try:
        parsed = json.loads(raw.decode("utf-8", errors="replace"))
    except json.JSONDecodeError:
        return ""
    if not isinstance(parsed, dict):
        return ""
    candidates: list[Any] = []
    ocs = parsed.get("ocs")
    if isinstance(ocs, dict) and isinstance(ocs.get("data"), dict):
        candidates.append(ocs["data"].get("url"))
    candidates.append(parsed.get("url"))
    for url in candidates:
        if isinstance(url, str) and "/richdocuments/" in url:
            return url
    return ""


def _path_from_absolute(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    return path


def _safe_office_hint(st: int, raw: bytes) -> str:
    """Short failure hint with no token, URL, or password."""
    hint = f"HTTP {st}"
    try:
        parsed = json.loads(raw.decode("utf-8", errors="replace"))
    except json.JSONDecodeError:
        text = raw.decode("utf-8", errors="replace")
        if "Failed to open the requested file" in text:
            return hint + " editor error page"
        if text.lstrip().startswith("<"):
            return hint + " HTML response"
        return hint + " non-JSON response"
    if not isinstance(parsed, dict):
        return hint
    ocs = parsed.get("ocs") if isinstance(parsed.get("ocs"), dict) else None
    if ocs:
        meta = ocs.get("meta") if isinstance(ocs.get("meta"), dict) else {}
        data = ocs.get("data") if isinstance(ocs.get("data"), dict) else {}
        code = meta.get("statuscode")
        msg = meta.get("message")
        keys = ",".join(sorted(str(k) for k in data.keys()))
        if code is not None:
            hint += f" ocs.statuscode={code}"
        if isinstance(msg, str) and msg:
            clean = msg.replace("\n", " ").replace("\r", " ")[:80]
            lower = clean.lower()
            if not any(bad.lower() in lower for bad in FORBIDDEN_LOG_SUBSTR):
                hint += f" ocs.message={clean!r}"
        if keys:
            hint += f" ocs.data.keys={keys}"
        return hint
    keys = ",".join(sorted(str(k) for k in parsed.keys()))
    if keys:
        hint += f" json.keys={keys}"
    return hint



def nextcloud_wait(base: str, timeout: int = 900) -> None:
    start = time.time()
    while time.time() - start < timeout:
        try:
            st, raw, _ = Session(base, timeout=5).request("GET", "/status.php")
            if st == 200 and raw:
                data = json.loads(raw.decode("utf-8", errors="replace"))
                if data.get("maintenance") is False and data.get("needsDbUpgrade") is False:
                    if data.get("installed") is True or data.get("version"):
                        log(f"Nextcloud is up at {base}")
                        return
        except Exception:
            pass
        time.sleep(5)
    die(f"Nextcloud at {base} did not become ready within {timeout}s")


def nextcloud_login(base: str, username: str) -> Session:
    s = Session(base, timeout=45)
    # Web login form: request token, then post.
    st, raw, _ = s.request("GET", "/login")
    text = raw.decode("utf-8", errors="replace")
    token = ""
    for marker in ('name="requesttoken" value="', 'data-requesttoken="'):
        i = text.find(marker)
        if i >= 0:
            token = text[i + len(marker) :].split('"', 1)[0]
            break
    body = urllib.parse.urlencode(
        {"user": username, "password": password_for(username), "requesttoken": token}
    ).encode("utf-8")
    headers = {}
    if token:
        headers["requesttoken"] = token
    st, raw, _ = s.request(
        "POST",
        "/login",
        data=body,
        content_type="application/x-www-form-urlencoded",
        headers=headers,
    )
    # Also set lastLogin via WebDAV / OCS which some setups record more reliably.
    # Basic-auth OCS as the same user, without putting the password on a command line.
    import base64

    basic = base64.b64encode(f"{username}:{password_for(username)}".encode()).decode("ascii")
    st2, raw2, _ = s.request(
        "GET",
        "/ocs/v2.php/cloud/user?format=json",
        headers={"Authorization": f"Basic {basic}", "OCS-APIRequest": "true"},
    )
    if st2 not in (200, 201) and st not in (200, 303, 302):
        die(f"Nextcloud login as {username} failed (HTTP login={st} ocs={st2})")
    # The login-page requesttoken is single-use. Refresh from the session for
    # later cookie-authenticated POSTs (richdocuments /token requires CSRF).
    if token:
        s.requesttoken = token  # type: ignore[attr-defined]
    nextcloud_refresh_requesttoken(s)
    log(f"Nextcloud signed in as {username} (password not shown)")
    s._basic = basic  # type: ignore[attr-defined]
    s._username = username  # type: ignore[attr-defined]
    return s


def nextcloud_open_office(base: str, username: str = "teacher1") -> None:
    s = nextcloud_login(base, username)
    basic = s._basic  # type: ignore[attr-defined]
    # Put a tiny Writer document via WebDAV.
    odt_name = "i413-office-proof.odt"
    # Minimal uncompressed-enough ODT? Nextcloud accepts a small plaintext
    # .odt as a file; Collabora still issues a WOPI token for the fileId.
    # Use a real (tiny) ODT zip if we have one later; a 1-byte file with
    # .odt suffix is enough for richdocuments to create a token.
    payload = (
        b"PK\x03\x04\x14\x00\x00\x00\x00\x00\x00\x00\x00\x00"
        b"mimetypeapplication/vnd.oasis.opendocument.textPK\x01\x02"
    )
    st, raw, _ = s.request(
        "PUT",
        f"/remote.php/dav/files/{urllib.parse.quote(username)}/{odt_name}",
        data=payload,
        headers={"Authorization": f"Basic {basic}"},
        content_type="application/vnd.oasis.opendocument.text",
    )
    if st not in (200, 201, 204):
        # Retry as a plain .docx so mime still maps to text.
        odt_name = "i413-office-proof.docx"
        st, raw, _ = s.request(
            "PUT",
            f"/remote.php/dav/files/{urllib.parse.quote(username)}/{odt_name}",
            data=b"PK\x03\x04",
            headers={"Authorization": f"Basic {basic}"},
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        if st not in (200, 201, 204):
            die(f"Nextcloud WebDAV upload failed (HTTP {st})")
    log(f"uploaded word-processor file {odt_name} as {username} (password not shown)")

    # Resolve fileId via PROPFIND.
    prop = (
        b'<?xml version="1.0"?>\n'
        b'<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">'
        b"<d:prop><oc:fileid/></d:prop></d:propfind>"
    )
    st, raw, _ = s.request(
        "PROPFIND",
        f"/remote.php/dav/files/{urllib.parse.quote(username)}/{odt_name}",
        data=prop,
        headers={"Authorization": f"Basic {basic}", "Depth": "0"},
        content_type="application/xml",
    )
    text = raw.decode("utf-8", errors="replace")
    file_id = ""
    for tag in ("oc:fileid", "d:fileid", "fileid"):
        open_tag = f"<{tag}>"
        if open_tag in text:
            file_id = text.split(open_tag, 1)[1].split("<", 1)[0].strip()
            break
    if not file_id:
        die("could not read Nextcloud fileId for the uploaded document")

    # The hook counts rows in oc_richdocuments_wopi (issued when the editor
    # actually opens). POST /ocs/v2.php/apps/richdocuments/api/v1/document is
    # OCS#createDirect: HTTP 200 with data.url (oc_richdocuments_direct) and
    # no WOPI token. A real token comes from POST /apps/richdocuments/token
    # (CSRF + session), GET /apps/richdocuments/index?fileId=, or GET of that
    # one-time direct URL (DirectView, PublicPage).
    got_token = False
    last_hint = "no attempt"
    deadline = time.time() + 180
    quoted = urllib.parse.quote(str(file_id))
    while time.time() < deadline and not got_token:
        reqtok = getattr(s, "requesttoken", "") or nextcloud_refresh_requesttoken(s)
        token_headers = {"Accept": "application/json"}
        if reqtok:
            token_headers["requesttoken"] = reqtok
        for payload, ctype in (
            (urllib.parse.urlencode({"fileId": file_id}).encode("utf-8"), "application/x-www-form-urlencoded"),
            (json.dumps({"fileId": file_id}).encode("utf-8"), "application/json"),
        ):
            st, body, _ = s.request(
                "POST",
                "/index.php/apps/richdocuments/token",
                data=payload,
                headers=token_headers,
                content_type=ctype,
            )
            last_hint = _safe_office_hint(st, body)
            if st in (200, 201) and _wopi_token_in_payload(body):
                got_token = True
                break
        if not got_token:
            st, body, _ = s.request("GET", f"/index.php/apps/richdocuments/index?fileId={quoted}")
            last_hint = _safe_office_hint(st, body)
            if st in (200, 201) and _wopi_token_in_payload(body):
                got_token = True
        if not got_token:
            for payload, ctype in (
                (json.dumps({"fileId": file_id}).encode("utf-8"), "application/json"),
                (urllib.parse.urlencode({"fileId": file_id}).encode("utf-8"), "application/x-www-form-urlencoded"),
            ):
                st, body, _ = s.request(
                    "POST",
                    "/ocs/v2.php/apps/richdocuments/api/v1/document?format=json",
                    data=payload,
                    headers={
                        "Authorization": f"Basic {basic}",
                        "OCS-APIRequest": "true",
                        "Accept": "application/json",
                    },
                    content_type=ctype,
                )
                last_hint = _safe_office_hint(st, body)
                if st in (200, 201) and _wopi_token_in_payload(body):
                    got_token = True
                    break
                direct = _direct_edit_url(body)
                if st in (200, 201) and direct:
                    # Host may be the LAN IP from overwrite/public URL; stay on
                    # this Session origin so we do not log or replay the token.
                    path = _path_from_absolute(direct)
                    st2, body2, _ = s.request("GET", path)
                    last_hint = _safe_office_hint(st2, body2) + " after opening direct-edit URL"
                    if st2 in (200, 201) and _wopi_token_in_payload(body2):
                        got_token = True
                        break
        if got_token:
            break
        remaining = int(deadline - time.time())
        if remaining <= 0:
            break
        log("richdocuments has not issued a WOPI token yet; waiting for Collabora/Office")
        time.sleep(min(8, remaining))
        nextcloud_refresh_requesttoken(s)
    if not got_token:
        die(
            f"richdocuments did not issue a WOPI token ({last_hint}); "
            "is Collabora reachable from nextcloud-app and is discovery cached?"
        )
    log("opened Nextcloud Office / Collabora and received a WOPI token (word processor)")


def cmd_nextcloud_seed(args: argparse.Namespace) -> None:
    nextcloud_wait(args.base)
    for user in ("admin", "teacher1", "learner1"):
        nextcloud_login(args.base, user)
    nextcloud_open_office(args.base, "teacher1")
    log("Nextcloud logins + word-processor open done")


# ----- Kiwix -----

def kiwix_wait(base: str, timeout: int = 180) -> None:
    start = time.time()
    while time.time() - start < timeout:
        try:
            st, raw, _ = Session(base, timeout=5).request("GET", "/")
            if st == 200:
                log(f"Kiwix proxy is up at {base}")
                return
        except Exception:
            pass
        time.sleep(3)
    die(f"Kiwix at {base} did not become ready within {timeout}s")


def cmd_kiwix_seed(args: argparse.Namespace) -> None:
    kiwix_wait(args.base)
    s = Session(args.base, timeout=15)
    book = args.book or "duration_wikipedia_en_grade5a_stub_2026-10"
    articles = args.articles or "Main_Page,Fraction,Numerator,Photosynthesis,Solar_System"
    titles = [a.strip() for a in articles.split(",") if a.strip()]
    ok = 0
    for title in titles:
        path = f"/content/{book}/{title}"
        st, raw, _ = s.request("GET", path)
        if st in (200, 304) and raw:
            ok += 1
            log(f"Kiwix article HTTP {st} {path}")
        else:
            log(f"Kiwix article HTTP {st} {path} (not counted)")
    if ok < 2:
        die(f"expected at least 2 Kiwix /content/ articles to return 200/304, got {ok}")
    log(f"Kiwix opened {ok} articles under /content/{book}/")


# ----- Day-file checks -----

ROLE = ("total", "beyondSeed")


def _is_role(obj: Any) -> bool:
    return isinstance(obj, dict) and all(k in obj for k in ROLE) and all(
        isinstance(obj[k], int) and obj[k] >= 0 for k in ROLE
    )


def _is_signin(obj: Any) -> bool:
    return _is_role(obj) and isinstance(obj.get("sessions"), int) and isinstance(obj.get("minutes"), int)


def check_present(body: dict[str, Any], path: str, pred, msg: str, problems: list[str]) -> None:
    cur: Any = body
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            problems.append(f"MISSING {path}: {msg}")
            return
    if not pred(cur):
        problems.append(f"FAIL {path}: {msg} (got {cur!r})")
    else:
        print(f"PASS {path}: {msg}")


def check_kolibri(body: dict[str, Any], expect_activity: bool) -> list[str]:
    problems: list[str] = []
    for path, pred, msg in [
        ("setup.learner", _is_role, "setup.learner is {total, beyondSeed}"),
        ("setup.teacher", _is_role, "setup.teacher is {total, beyondSeed}"),
        ("setup.admin", _is_role, "setup.admin is {total, beyondSeed}"),
        ("signins.learner", _is_signin, "signins.learner has total/beyondSeed/sessions/minutes"),
        ("signins.coach", _is_signin, "signins.coach has total/beyondSeed/sessions/minutes"),
        ("signins.admin", _is_signin, "signins.admin has total/beyondSeed/sessions/minutes"),
        ("content", lambda v: isinstance(v, list), "content is a list"),
        ("teaching", lambda v: isinstance(v, dict) and "lessonsCreated" in v, "teaching block present"),
        ("guest", lambda v: isinstance(v, dict) and "visits" in v and "seconds" in v, "guest block present"),
        ("flags", lambda v: isinstance(v, list), "flags is a list"),
    ]:
        check_present(body, path, pred, msg, problems)
    if expect_activity:
        check_present(body, "signins.learner.total", lambda v: isinstance(v, int) and v >= 1, "learner sign-ins non-zero", problems)
        check_present(body, "signins.coach.total", lambda v: isinstance(v, int) and v >= 1, "teacher/coach sign-ins non-zero", problems)
        check_present(body, "content", lambda v: isinstance(v, list) and len(v) >= 1, "content viewed is non-empty", problems)
        if isinstance(body.get("content"), list) and body["content"]:
            seconds = sum(int(i.get("seconds") or 0) for i in body["content"] if isinstance(i, dict))
            visits = sum(int(i.get("visits") or 0) for i in body["content"] if isinstance(i, dict))
            if visits < 1:
                problems.append("FAIL content: visits are zero after seeding")
            else:
                print(f"PASS content visits={visits} seconds={seconds}")
            if seconds < 1:
                problems.append("FAIL content: durations (seconds) are zero after seeding")
    return problems


def check_nextcloud(body: dict[str, Any], expect_activity: bool) -> list[str]:
    problems: list[str] = []
    for path, pred, msg in [
        ("setup.admin", _is_role, "setup.admin is {total, beyondSeed}"),
        ("setup.teacher", _is_role, "setup.teacher is {total, beyondSeed}"),
        ("setup.learner", _is_role, "setup.learner is {total, beyondSeed}"),
        ("setup.otherGroups", lambda v: isinstance(v, dict), "otherGroups is an object"),
        ("logins.admin", _is_role, "logins.admin is {total, beyondSeed}"),
        ("logins.teacher", _is_role, "logins.teacher is {total, beyondSeed}"),
        ("logins.learner", _is_role, "logins.learner is {total, beyondSeed}"),
        ("office.opens", lambda v: isinstance(v, int) and v >= 0, "office.opens present"),
        ("office.distinctDocuments", lambda v: isinstance(v, int) and v >= 0, "office.distinctDocuments present"),
        ("office.byGroup", lambda v: isinstance(v, dict) and all(k in v for k in ("admin", "teacher", "learner")), "office.byGroup present"),
        ("workflows", lambda v: isinstance(v, dict) and "worksheetShares" in v, "workflows block present"),
    ]:
        check_present(body, path, pred, msg, problems)
    if "appsOpened" in body:
        print("NOTE appsOpened is present (Phase 3 field; not required for this proof)")
    else:
        print("NOTE appsOpened is omitted (expected until Phase 3); word processor is office.*")
    if expect_activity:
        for role in ("admin", "teacher", "learner"):
            check_present(body, f"logins.{role}.total", lambda v: isinstance(v, int) and v >= 1, f"{role} logins non-zero", problems)
        opens = body.get("office", {}).get("opens") if isinstance(body.get("office"), dict) else None
        docs = body.get("office", {}).get("distinctDocuments") if isinstance(body.get("office"), dict) else None
        if not (isinstance(opens, int) and opens >= 1) and not (isinstance(docs, int) and docs >= 1):
            problems.append(f"FAIL office: word-processor opens/distinctDocuments not non-zero (opens={opens}, distinctDocuments={docs})")
        else:
            print(f"PASS office word-processor opens={opens} distinctDocuments={docs}")
    return problems


def check_kiwix(body: dict[str, Any], expect_activity: bool) -> list[str]:
    problems: list[str] = []
    for path, pred, msg in [
        ("pageViews", lambda v: isinstance(v, int) and v >= 0, "pageViews present"),
        ("distinctArticles", lambda v: isinstance(v, int) and v >= 0, "distinctArticles present"),
        ("sessions", lambda v: isinstance(v, int) and v >= 0, "sessions present"),
        ("topArticles", lambda v: isinstance(v, list), "topArticles is a list"),
        ("byHour", lambda v: isinstance(v, list) and len(v) == 24 and all(isinstance(x, int) for x in v), "byHour has 24 ints"),
    ]:
        check_present(body, path, pred, msg, problems)
    if expect_activity:
        check_present(body, "pageViews", lambda v: isinstance(v, int) and v >= 2, "pageViews non-zero after seeding", problems)
        check_present(body, "distinctArticles", lambda v: isinstance(v, int) and v >= 2, "distinctArticles non-zero after seeding", problems)
        check_present(body, "topArticles", lambda v: isinstance(v, list) and len(v) >= 1, "topArticles non-empty", problems)
    return problems


def cmd_check_day_file(args: argparse.Namespace) -> None:
    path = Path(args.file)
    if not path.is_file():
        die(f"day file not found: {path}")
    body = json.loads(path.read_text(encoding="utf-8"))
    if body.get("schema") != "idea-usage-day/1":
        die(f"unexpected schema {body.get('schema')!r}")
    if args.day and body.get("day") != args.day:
        die(f"day mismatch: file has {body.get('day')!r}, expected {args.day}")
    status = body.get("hookStatus")
    if not args.raw_hook and status != "ok":
        die(f"hookStatus is {status!r}, expected ok")
    app = args.app or body.get("app")
    expect = not args.structure_only
    if app == "kolibri":
        problems = check_kolibri(body, expect)
    elif app == "nextcloud":
        problems = check_nextcloud(body, expect)
    elif app == "kiwix":
        problems = check_kiwix(body, expect)
    else:
        die(f"unknown app {app!r}")
    if problems:
        for p in problems:
            print(p, file=sys.stderr)
        sys.exit(1)
    print(f"PASS {app} day file {path} meets the §2 / contract §5.3 checks")


def cmd_self_test(_args: argparse.Namespace) -> None:
    """Dry-run fixtures for the field checker (no network, no secrets)."""
    kolibri = {
        "schema": "idea-usage-day/1", "day": "2026-11-11", "app": "kolibri",
        "hookStatus": "ok",
        "setup": {
            "classes": 1, "classesDelta": 0,
            "learner": {"total": 1, "beyondSeed": 1}, "learnerDelta": 1, "learnerEnrolled": 0,
            "teacher": {"total": 1, "beyondSeed": 1}, "teachersDelta": 0,
            "admin": {"total": 1, "beyondSeed": 1},
        },
        "signins": {
            "learner": {"total": 1, "beyondSeed": 1, "sessions": 1, "minutes": 1},
            "coach": {"total": 1, "beyondSeed": 1, "sessions": 1, "minutes": 1},
            "admin": {"total": 1, "beyondSeed": 1, "sessions": 1, "minutes": 1},
        },
        "content": [{"channel": "Khan", "title": "Fractions", "kind": "video", "role": "learner",
                     "visits": 1, "seconds": 45, "completions": 0, "assigned": False}],
        "teaching": {"lessonsCreated": 0, "lessonsVisible": 0, "quizzesCreated": 0, "quizzesStarted": 0, "quizzesEnded": 0},
        "guest": {"visits": 0, "seconds": 0},
        "flags": [],
    }
    nextcloud = {
        "schema": "idea-usage-day/1", "day": "2026-11-11", "app": "nextcloud",
        "hookStatus": "ok",
        "setup": {
            "admin": {"total": 1, "beyondSeed": 0},
            "teacher": {"total": 1, "beyondSeed": 0},
            "learner": {"total": 1, "beyondSeed": 0},
            "otherGroups": {},
        },
        "logins": {
            "admin": {"total": 1, "beyondSeed": 0},
            "teacher": {"total": 1, "beyondSeed": 0},
            "learner": {"total": 1, "beyondSeed": 0},
        },
        "office": {
            "opens": 1, "distinctDocuments": 1, "read": 0, "edit": 1,
            "estimatedMinutes": 0,
            "byGroup": {"admin": 0, "teacher": 1, "learner": 0},
            "mime": {"text": 1, "sheet": 0, "slides": 0},
        },
        "workflows": {
            "worksheetShares": 0, "editShares": 0,
            "fileDropLinks": 0, "fileDropUploads": 0, "schoolFilesShares": 0,
        },
    }
    kiwix = {
        "schema": "idea-usage-day/1", "day": "2026-11-11", "app": "kiwix",
        "hookStatus": "ok",
        "pageViews": 5, "distinctArticles": 5, "sessions": 1,
        "topArticles": [{"title": "Fraction", "views": 1}],
        "byHour": [0] * 24,
    }
    kiwix["byHour"][5] = 5
    problems = check_kolibri(kolibri, True) + check_nextcloud(nextcloud, True) + check_kiwix(kiwix, True)
    if problems:
        for p in problems:
            print(p, file=sys.stderr)
        sys.exit(1)
    # createDirect returns a URL, not a WOPI token (06:30/06:45 seeding miss).
    create_direct = json.dumps({
        "ocs": {
            "meta": {"status": "ok", "statuscode": 200, "message": "OK"},
            "data": {"url": "http://10.0.0.5:1234/index.php/apps/richdocuments/direct/xyz"},
        }
    }).encode("utf-8")
    if _wopi_token_in_payload(create_direct):
        die("createDirect payload must not count as a WOPI token")
    if _path_from_absolute(_direct_edit_url(create_direct)) != "/index.php/apps/richdocuments/direct/xyz":
        die("expected to rewrite the createDirect URL to a same-origin path")
    if not _wopi_token_in_payload(json.dumps({"token": "abc", "urlSrc": "http://example.invalid"}).encode()):
        die("expected a token+urlSrc JSON body to count as a WOPI token")
    hint = _safe_office_hint(200, create_direct)
    if "ocs.data.keys=url" not in hint or "direct/" in hint:
        die(f"unsafe or incomplete office hint: {hint!r}")
    # Negative: missing content after seeding should fail.
    bad = dict(kolibri)
    bad["content"] = []
    if not check_kolibri(bad, True):
        die("expected the empty-content fixture to fail")
    acceptance_checks.self_test()
    print("PASS seed_and_check self-test")


def main() -> None:
    p = argparse.ArgumentParser(description="idea#413 seed + day-file checks (never prints passwords)")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("kolibri-provision")
    sp.add_argument("--base", required=True)
    sp.add_argument("--data-dir", default="", help="instance dir; use provisiondevice on Kolibri 0.19+")
    sp.add_argument(
        "--provision-only",
        action="store_true",
        help="run provisiondevice and return before HTTP verify / user seeding",
    )
    sp.set_defaults(func=cmd_kolibri_provision)

    sp = sub.add_parser("kolibri-view")
    sp.add_argument("--base", required=True)
    sp.set_defaults(func=cmd_kolibri_view)

    sp = sub.add_parser("nextcloud-seed")
    sp.add_argument("--base", required=True)
    sp.set_defaults(func=cmd_nextcloud_seed)

    sp = sub.add_parser("kiwix-seed")
    sp.add_argument("--base", required=True)
    sp.add_argument("--book", default="duration_wikipedia_en_grade5a_stub_2026-10")
    sp.add_argument("--articles", default="")
    sp.set_defaults(func=cmd_kiwix_seed)

    sp = sub.add_parser("check-day-file")
    sp.add_argument("--file", required=True)
    sp.add_argument("--app", choices=("kolibri", "nextcloud", "kiwix"))
    sp.add_argument("--day", default="")
    sp.add_argument("--structure-only", action="store_true")
    sp.add_argument("--raw-hook", action="store_true", help="allow hook stdout without Engine hookStatus")
    sp.set_defaults(func=cmd_check_day_file)

    sp = sub.add_parser("check-pii")
    sp.add_argument("files", nargs="+")
    sp.set_defaults(func=acceptance_checks.cmd_check_pii)

    sp = sub.add_parser("check-backup-none")
    sp.add_argument("--compose", required=True)
    sp.set_defaults(func=acceptance_checks.cmd_check_backup_none)

    sp = sub.add_parser("check-flags")
    sp.add_argument("--file", required=True)
    sp.add_argument("--expect-shared", action="store_true")
    sp.add_argument("--expect-demo", choices=("true", "false"))
    sp.set_defaults(func=acceptance_checks.cmd_check_flags)

    sp = sub.add_parser("stamp-past-day")
    sp.add_argument("--app", required=True, choices=("kolibri", "nextcloud", "kiwix"))
    sp.add_argument("--dir", required=True)
    sp.add_argument("--day", required=True)
    sp.set_defaults(func=acceptance_checks.cmd_stamp_past_day)

    sp = sub.add_parser("check-past-day")
    sp.add_argument("--app", required=True, choices=("kolibri", "nextcloud", "kiwix"))
    sp.add_argument("--file", required=True)
    sp.add_argument("--day", required=True)
    sp.set_defaults(func=acceptance_checks.cmd_check_past_day)

    sp = sub.add_parser("db-lock")
    sp.add_argument("--app", required=True, choices=("kolibri", "nextcloud"))
    sp.add_argument("--dir", required=True)
    sp.add_argument("--day", default="")
    sp.add_argument("--loops", type=int, default=6)
    sp.set_defaults(func=acceptance_checks.cmd_db_lock)

    sp = sub.add_parser("nextcloud-wopi-info")
    sp.add_argument("--dir", required=True)
    sp.add_argument("--base", default="")
    sp.set_defaults(func=acceptance_checks.cmd_nextcloud_wopi_info)

    sp = sub.add_parser("kiwix-logs")
    sp.add_argument("--dir", required=True)
    sp.add_argument("--day", default="")
    sp.set_defaults(func=acceptance_checks.cmd_kiwix_logs)

    sp = sub.add_parser("stdin-pipe")
    sp.add_argument("--dir", required=True)
    sp.add_argument("--service", required=True)
    sp.add_argument("--day", required=True)
    sp.add_argument("--hook", default="")
    sp.add_argument("--listed", default="unknown")
    sp.add_argument("--out", default="")
    sp.set_defaults(func=acceptance_checks.cmd_stdin_pipe)

    sp = sub.add_parser("kolibri-0155-fixture")
    sp.add_argument("--dir", required=True)
    sp.add_argument("--day", required=True)
    sp.set_defaults(func=acceptance_checks.cmd_kolibri_0155_fixture)

    sp = sub.add_parser("check-kolibri-0155")
    sp.add_argument("--file", required=True)
    sp.add_argument("--day", required=True)
    sp.set_defaults(func=acceptance_checks.cmd_check_kolibri_0155)

    sp = sub.add_parser("self-test")
    sp.set_defaults(func=cmd_self_test)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
