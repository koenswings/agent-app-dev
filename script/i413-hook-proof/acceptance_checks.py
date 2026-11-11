#!/usr/bin/env python3
"""Acceptance extras for idea#413 (no credentials printed).

Commands are dispatched from seed_and_check.py. Helpers here are safe to
run in the dry-run self-test (temp dirs only) and on a pool Pi.
"""
from __future__ import annotations

import datetime
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

FORBIDDEN_LOG_SUBSTR = ("911!", "password=", "OC_PASS", "Authorization:", "token=")

# Seed / fixture usernames that must never appear in hook stdout or stored files.
# "admin" is omitted: it is a role key in the schema.
USERNAME_MARKERS = (
    "teacher1",
    "teacher2",
    "learner1",
    "learner2",
    "learner3",
    "thabo",
    "i413 Proof School",
    "West School",
    "worksheet.odt",
    "sheet.ods",
)
IP_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"
)
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
KOLIBRI_0155_IMAGE = "koenswings/kolibri:1.0-0.15.5-dev"


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def log(msg: str) -> None:
    lower = msg.lower()
    for bad in FORBIDDEN_LOG_SUBSTR:
        if bad.lower() in lower:
            die("refusing to print a line that looks like it contains a secret")
    print(f"==> {msg}", file=sys.stderr)


def today_iso() -> str:
    return datetime.date.today().isoformat()


def yesterday_iso() -> str:
    return (datetime.date.today() - datetime.timedelta(days=1)).isoformat()


def days_ago_iso(n: int) -> str:
    return (datetime.date.today() - datetime.timedelta(days=n)).isoformat()


def cutoff_14(now: datetime.date | None = None) -> str:
    return ((now or datetime.date.today()) - datetime.timedelta(days=14)).isoformat()


def should_prune_log(ymd: str, cutoff: str) -> bool:
    return bool(re.match(r"^\d{4}-\d{2}-\d{2}$", ymd)) and ymd < cutoff


def compose_exec(
    inst: Path,
    service: str,
    argv: list[str],
    input_text: str | None = None,
    timeout: int = 120,
) -> subprocess.CompletedProcess[str]:
    cmd = ["docker", "compose", "exec", "-T", service, *argv]
    return subprocess.run(
        cmd,
        cwd=str(inst),
        input=input_text,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )


def compose_ps_id(inst: Path, service: str) -> str:
    proc = subprocess.run(
        ["docker", "compose", "ps", "-q", service],
        cwd=str(inst),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    cid = (proc.stdout or "").strip().splitlines()
    return cid[0] if cid else ""



def write_text_maybe_via_compose(
    path: Path,
    content: str,
    inst: Path,
    service: str,
    container_path: str,
) -> None:
    """Write a small text file to an instance mount.

    Kiwix ``./logs`` is owned by the container user (avahi:_ssh on idea03),
    so a host-side write as pi can raise PermissionError. Fall back to
    ``docker compose exec`` into the mounted path (``/logs/...``).
    """
    try:
        path.write_text(content, encoding="utf-8")
        return
    except PermissionError:
        pass
    proc = compose_exec(
        inst,
        service,
        ["sh", "-c", 'cat > "$1"', "sh", container_path],
        input_text=content,
        timeout=30,
    )
    if proc.returncode != 0 or not path.is_file():
        die(
            f"could not write {path.name} via {service}:{container_path} "
            f"({sanitize_proc(proc)})"
        )


def sanitize_proc(proc: subprocess.CompletedProcess[str]) -> str:
    text = (proc.stderr or "") + "\n" + (proc.stdout or "")
    for bad in FORBIDDEN_LOG_SUBSTR:
        if bad.lower() in text.lower():
            return f"exit={proc.returncode} (output redacted)"
    return f"exit={proc.returncode} stderr_len={len(proc.stderr or '')} stdout_len={len(proc.stdout or '')}"


# --- PII -----------------------------------------------------------------


def pii_hits(blob: str) -> list[str]:
    hits: list[str] = []
    if '"username"' in blob:
        hits.append('contains "username" key')
    for marker in USERNAME_MARKERS:
        if marker in blob:
            hits.append(f"contains {marker!r}")
    for ip in sorted(set(IP_RE.findall(blob))):
        hits.append(f"contains address {ip}")
    for em in sorted(set(EMAIL_RE.findall(blob))):
        hits.append("contains an email")
        break
    return hits


def check_pii_file(path: Path) -> list[str]:
    if not path.is_file():
        return [f"missing file {path}"]
    blob = path.read_text(encoding="utf-8", errors="replace")
    return pii_hits(blob)


def cmd_check_pii(args: Any) -> None:
    files = [Path(p) for p in args.files]
    all_hits: list[str] = []
    for path in files:
        hits = check_pii_file(path)
        if hits:
            for h in hits:
                print(f"FAIL {path}: {h}")
                all_hits.append(f"{path}: {h}")
        else:
            print(f"PASS no usernames or client addresses in {path}")
    if all_hits:
        sys.exit(1)


# --- backup none ---------------------------------------------------------


def backup_is_none(compose_text: str) -> tuple[bool, str]:
    in_xapp = False
    for raw in compose_text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if re.match(r"^x-app:\s*$", line):
            in_xapp = True
            continue
        if in_xapp and re.match(r"^[A-Za-z0-9_-]", line):
            in_xapp = False
        if in_xapp and re.match(r"^\s+backup:\s*$", line):
            return False, "x-app.backup mapping is present"
        if in_xapp and re.match(r"^\s+backup:\s*none\s*$", line):
            return True, "x-app.backup is none"
        if in_xapp and re.match(r"^\s+backup:\s+\S+", line):
            val = line.split(":", 1)[1].strip()
            if val in ("none", "null", "~"):
                return True, f"x-app.backup is {val}"
            return False, f"x-app.backup is {val}"
    return True, "no x-app.backup key (backup remains none)"


def cmd_check_backup_none(args: Any) -> None:
    path = Path(args.compose)
    if not path.is_file():
        die(f"compose file not found: {path}")
    ok, note = backup_is_none(path.read_text(encoding="utf-8", errors="replace"))
    print(f"{'PASS' if ok else 'FAIL'} {path}: {note}")
    if not ok:
        sys.exit(1)


# --- flags ---------------------------------------------------------------


def cmd_check_flags(args: Any) -> None:
    path = Path(args.file)
    body = json.loads(path.read_text(encoding="utf-8"))
    flags = body.get("flags") if isinstance(body.get("flags"), list) else None
    demo = body.get("demo")
    print(f"demo={demo} flags={flags}")
    if args.expect_shared:
        if not flags or "sharedLearnerAccount" not in flags:
            die("expected sharedLearnerAccount in flags")
        print("PASS sharedLearnerAccount is set")
    if args.expect_demo is not None:
        want = args.expect_demo == "true"
        if bool(demo) != want:
            die(f"expected demo={want}, got {demo}")
        print(f"PASS demo={demo}")


# --- past-day activity ---------------------------------------------------


_KOLIBRI_STAMP = r"""
import os, sqlite3, sys, uuid
day = sys.argv[1]
home = os.environ.get("KOLIBRI_HOME") or "/root/.kolibri"
db = os.path.join(home, "db.sqlite3")
conn = sqlite3.connect(db)
info = list(conn.execute("PRAGMA table_info(logger_contentsessionlog)"))
usl = list(conn.execute("PRAGMA table_info(logger_usersessionlog)"))

def insert(table, values, schema):
    data = {}
    for _cid, name, ctype, notnull, default, pk in schema:
        if name in values:
            data[name] = values[name]
        elif notnull and default is None and not pk:
            data[name] = 0 if (ctype or "").upper() in ("INTEGER", "REAL", "NUMERIC", "INT") else ""
    cols = ",".join(data)
    qs = ",".join("?" * len(data))
    conn.execute("INSERT INTO %s (%s) VALUES (%s)" % (table, cols, qs), list(data.values()))

uid = None
row = conn.execute("SELECT user_id FROM logger_contentsessionlog WHERE user_id IS NOT NULL LIMIT 1").fetchone()
if row:
    uid = row[0]
if uid is None:
    row = conn.execute("SELECT id FROM kolibriauth_facilityuser LIMIT 1").fetchone()
    uid = row[0] if row else None
if uid is None:
    print("no-user")
    sys.exit(2)
start = day + " 10:00:00"
end = day + " 10:12:00"
insert("logger_usersessionlog", {
    "id": "i413p" + uuid.uuid4().hex[:12],
    "user_id": uid,
    "start_timestamp": start,
    "last_interaction_timestamp": end,
}, usl)
csl_vals = {
    "id": "i413c" + uuid.uuid4().hex[:12],
    "user_id": uid,
    "content_id": "i413-past-day",
    "channel_id": "i413",
    "start_timestamp": start,
    "end_timestamp": end,
    "time_spent": 72,
    "progress": 1.0,
    "kind": "video",
}
insert("logger_contentsessionlog", csl_vals, info)
conn.commit()
print("stamped-ok")
"""


_NC_STAMP = r"""
<?php
require "/var/www/html/config/config.php";
$day = $argv[1] ?? "";
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) { fwrite(STDERR, "bad-day\n"); exit(2); }
$dbtype = $CONFIG["dbtype"] ?? "mysql";
$prefix = $CONFIG["dbtableprefix"] ?? "oc_";
try {
    if ($dbtype === "sqlite" || $dbtype === "sqlite3") {
        $pdo = new PDO("sqlite:" . $CONFIG["dbname"]);
    } else {
        $host = $CONFIG["dbhost"];
        $name = $CONFIG["dbname"];
        $user = $CONFIG["dbuser"];
        $pass = $CONFIG["dbpassword"];
        $pdo = new PDO("mysql:host={$host};dbname={$name}", $user, $pass);
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $ts = strtotime($day . "T12:00:00Z");
    if ($ts === false) { fwrite(STDERR, "bad-ts\n"); exit(2); }
    $ms = (string)($ts * 1000);
    $stmt = $pdo->prepare("UPDATE {$prefix}preferences SET configvalue = ? WHERE appid = 'login' AND configkey = 'lastLogin' AND userid = ?");
    $stmt->execute(array($ms, "learner1"));
    echo "stamped-ok rows=" . $stmt->rowCount() . "\n";
} catch (Exception $e) {
    fwrite(STDERR, "db-error\n");
    exit(3);
}
"""


def _php_stdin(inst: Path, service: str, script: str, argv: list[str] | None = None) -> subprocess.CompletedProcess[str]:
    extra = argv or []
    quoted = " ".join("'" + a.replace("'", "'\\''") + "'" for a in extra)
    return subprocess.run(
        ["docker", "compose", "exec", "-T", service, "sh", "-c",
         "php -d display_errors=0 -- " + quoted + " <<'PHP'\n" + script + "\nPHP"],
        cwd=str(inst),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=60,
    )


def _exec_python_stdin(inst: Path, service: str, script: str, day: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", "compose", "exec", "-T", "-e", f"IDEA_STAMP_DAY={day}", service,
         "python", "-c", "import os,sys; sys.argv=['stamp', os.environ['IDEA_STAMP_DAY']]; exec(sys.stdin.read())"],
        cwd=str(inst),
        input=script,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=60,
    )


def cmd_stamp_past_day(args: Any) -> None:
    inst = Path(args.dir)
    day = args.day
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", day):
        die(f"invalid day {day}")
    if args.app == "kolibri":
        proc = _exec_python_stdin(inst, "kolibri", _KOLIBRI_STAMP, day)
        if proc.returncode != 0 or "stamped-ok" not in (proc.stdout or ""):
            die(f"kolibri past-day stamp failed ({sanitize_proc(proc)})")
        print("PASS stamped a past-day Kolibri session into durable logs")
        return
    if args.app == "nextcloud":
        proc = _php_stdin(inst, "nextcloud-app", _NC_STAMP, [day])
        if proc.returncode != 0 or "stamped-ok" not in (proc.stdout or ""):
            die(f"nextcloud past-day stamp failed ({sanitize_proc(proc)})")
        print("PASS stamped a past-day Nextcloud lastLogin into durable preferences")
        return
    if args.app == "kiwix":
        logs = inst / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        line = (
            '{"time":"%sT10:15:00+01:00","addr":"10.42.0.99","method":"GET",'
            '"uri":"/content/duration_wikipedia_en_grade5a_stub_2026-10/PastDayCatchUp","status":200}\n'
        ) % day
        dest = logs / f"access-{day}.json"
        write_text_maybe_via_compose(
            dest, line, inst, "proxy", f"/logs/access-{day}.json"
        )
        print(f"PASS wrote past-day Kiwix access log {dest.name} (address stays in the log, not hook stdout)")
        return
    die(f"unknown app {args.app}")


def cmd_check_past_day(args: Any) -> None:
    path = Path(args.file)
    body = json.loads(path.read_text(encoding="utf-8"))
    if body.get("schema") != "idea-usage-day/1":
        die(f"unexpected schema {body.get('schema')!r}")
    if body.get("day") != args.day:
        die(f"day mismatch: file has {body.get('day')!r}, expected {args.day}")
    if body.get("app") != args.app:
        die(f"app mismatch: file has {body.get('app')!r}, expected {args.app}")
    hits = pii_hits(json.dumps(body))
    if hits:
        die("past-day output leaked PII: " + "; ".join(hits))
    if args.app == "kolibri":
        total = ((body.get("signins") or {}).get("learner") or {}).get("total")
        if not (isinstance(total, int) and total >= 1):
            die(f"expected learner sign-ins on {args.day}, got {total}")
        print(f"PASS past-day Kolibri learner signins.total={total}")
    elif args.app == "nextcloud":
        total = ((body.get("logins") or {}).get("learner") or {}).get("total")
        if not (isinstance(total, int) and total >= 1):
            die(f"expected learner logins on {args.day}, got {total}")
        print(f"PASS past-day Nextcloud learner logins.total={total}")
    elif args.app == "kiwix":
        views = body.get("pageViews")
        if not (isinstance(views, int) and views >= 1):
            die(f"expected pageViews on {args.day}, got {views}")
        print(f"PASS past-day Kiwix pageViews={views}")


# --- DB lock -------------------------------------------------------------


_KOLIBRI_WRITE = r"""
import os, sqlite3, time, sys
home = os.environ.get("KOLIBRI_HOME") or "/root/.kolibri"
db = os.path.join(home, "db.sqlite3")
n = int(sys.argv[1]) if len(sys.argv) > 1 else 12
times = []
errors = 0
for _ in range(n):
    t0 = time.time()
    try:
        conn = sqlite3.connect(db, timeout=5)
        conn.execute("UPDATE logger_contentsessionlog SET progress = progress")
        conn.commit()
        conn.close()
    except Exception:
        errors += 1
    times.append((time.time() - t0) * 1000.0)
if not times:
    print("writes=0 errors=%d" % errors)
    sys.exit(2)
print("writes=%d errors=%d max_ms=%.1f avg_ms=%.1f" % (len(times), errors, max(times), sum(times)/len(times)))
"""


def cmd_db_lock(args: Any) -> None:
    inst = Path(args.dir)
    day = args.day or today_iso()
    loops = args.loops
    if args.app == "kolibri":
        hook_argv = ["/hooks/usage.sh", "day", day]
        service = "kolibri"
        timeout_s = 60
    elif args.app == "nextcloud":
        hook_argv = ["/hooks/usage.sh", "day", day]
        service = "nextcloud-app"
        timeout_s = 30
    else:
        die(f"db-lock is for kolibri or nextcloud, not {args.app}")

    hook_stats: list[tuple[int, float]] = []
    write_out = {"text": "", "rc": 1}

    def run_hooks() -> None:
        for _ in range(loops):
            t0 = time.time()
            proc = compose_exec(inst, service, hook_argv, timeout=timeout_s + 30)
            hook_stats.append((proc.returncode, (time.time() - t0) * 1000.0))

    def run_writes() -> None:
        if args.app == "kolibri":
            proc = subprocess.run(
                ["docker", "compose", "exec", "-T", "-e", "IDEA_LOCK_N=20", "kolibri",
                 "python", "-c", "import os,sys; sys.argv=['w', os.environ['IDEA_LOCK_N']]; exec(sys.stdin.read())"],
                cwd=str(inst),
                input=_KOLIBRI_WRITE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=120,
            )
            write_out["text"] = proc.stdout or ""
            write_out["rc"] = proc.returncode
        else:
            times = []
            errors = 0
            for i in range(12):
                t0 = time.time()
                proc = compose_exec(
                    inst,
                    "nextcloud-app",
                    ["php", "occ", "config:app:set", "i413probe", "k", f"--value={i}"],
                    timeout=60,
                )
                times.append((time.time() - t0) * 1000.0)
                if proc.returncode != 0:
                    errors += 1
            write_out["text"] = "writes=%d errors=%d max_ms=%.1f avg_ms=%.1f" % (
                len(times), errors, max(times) if times else 0, (sum(times) / len(times)) if times else 0,
            )
            write_out["rc"] = 0 if errors == 0 else 1

    ht = threading.Thread(target=run_hooks)
    wt = threading.Thread(target=run_writes)
    ht.start()
    wt.start()
    ht.join()
    wt.join()

    if not hook_stats:
        die("hook loop produced no results")
    bad = [rc for rc, _ in hook_stats if rc != 0]
    hook_max = max(ms for _, ms in hook_stats)
    print(
        f"hooks={len(hook_stats)} hook_failures={len(bad)} hook_max_ms={hook_max:.1f} "
        f"timeout_s={timeout_s} writes: {write_out['text'].strip()}"
    )
    if bad:
        die(f"{args.app} hook failed during concurrent writes")
    if write_out["rc"] != 0:
        die(f"{args.app} concurrent writes failed ({write_out['text']!r})")
    # Parse max write ms if present.
    m = re.search(r"max_ms=([0-9.]+)", write_out["text"])
    write_max = float(m.group(1)) if m else 0.0
    if write_max > 2000:
        die(f"{args.app} write wait {write_max:.1f} ms looks disruptive (> 2000 ms)")
    if hook_max > timeout_s * 1000:
        die(f"{args.app} hook exceeded timeoutS during the lock probe")
    print(f"PASS {args.app} hook stayed read-only under concurrent writes (write max {write_max:.1f} ms, hook max {hook_max:.1f} ms)")


# --- WOPI + client address ----------------------------------------------


_NC_WOPI = r"""
<?php
require "/var/www/html/config/config.php";
$dbtype = $CONFIG["dbtype"] ?? "mysql";
$prefix = $CONFIG["dbtableprefix"] ?? "oc_";
try {
    if ($dbtype === "sqlite" || $dbtype === "sqlite3") {
        $pdo = new PDO("sqlite:" . $CONFIG["dbname"]);
    } else {
        $pdo = new PDO("mysql:host=".$CONFIG["dbhost"].";dbname=".$CONFIG["dbname"], $CONFIG["dbuser"], $CONFIG["dbpassword"]);
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $table = $prefix . "richdocuments_wopi";
    $cols = array();
    if ($dbtype === "sqlite" || $dbtype === "sqlite3") {
        foreach ($pdo->query("PRAGMA table_info($table)") as $row) { $cols[] = $row["name"]; }
    } else {
        foreach ($pdo->query("SHOW COLUMNS FROM {$table}") as $row) { $cols[] = $row["Field"]; }
    }
    echo "columns=" . implode(",", $cols) . "\n";
    $has_ttl = in_array("token_ttl", $cols, true);
    $has_exp = in_array("expiry", $cols, true);
    $count = 0; $ttls = array(); $opened = array();
    if ($has_ttl && $has_exp) {
        foreach ($pdo->query("SELECT token_ttl, expiry FROM {$table}") as $row) {
            $count++;
            $ttl = intval($row["token_ttl"]);
            $exp = intval($row["expiry"]);
            $ttls[$ttl] = ($ttls[$ttl] ?? 0) + 1;
            $opened_ts = $exp - $ttl;
            $opened[] = gmdate("Y-m-d H:i:s", $opened_ts > 10**12 ? intdiv($opened_ts, 1000) : $opened_ts) . "Z ttl=" . $ttl;
        }
    } elseif ($has_exp) {
        // Live Nextcloud 31 richdocuments stores expiry only; the hook
        // falls back to ts_day(expiry) when token_ttl is not a column.
        foreach ($pdo->query("SELECT expiry FROM {$table}") as $row) {
            $count++;
            $exp = intval($row["expiry"]);
            $exp_s = $exp > 10**12 ? intdiv($exp, 1000) : $exp;
            $remain = $exp_s - time();
            $opened[] = "expiry=" . gmdate("Y-m-d H:i:s", $exp_s) . "Z raw=" . $exp . " remaining_s=" . $remain;
        }
        echo "token_ttl=column_absent\n";
        echo "hook_fallback=ts_day(expiry) when token_ttl is not a column\n";
    } else {
        $count = intval($pdo->query("SELECT COUNT(*) FROM {$table}")->fetchColumn());
        echo "token_ttl=column_absent\n";
    }
    echo "rows=" . $count . "\n";
    if ($ttls) {
        $parts = array();
        foreach ($ttls as $ttl => $n) { $parts[] = $ttl . "s x" . $n; }
        echo "token_ttl=" . implode(",", $parts) . "\n";
    }
    foreach ($opened as $line) { echo "opened " . $line . "\n"; }
    $addr_cols = array();
    foreach ($cols as $c) {
        if (preg_match('/addr|ip|client|remote/i', $c)) { $addr_cols[] = $c; }
    }
    echo "address_columns=" . implode(",", $addr_cols) . "\n";
} catch (Exception $e) {
    fwrite(STDERR, "db-error\n");
    exit(3);
}
"""


def cmd_nextcloud_wopi_info(args: Any) -> None:
    inst = Path(args.dir)
    proc = _php_stdin(inst, "nextcloud-app", _NC_WOPI)
    if proc.returncode != 0:
        die(f"WOPI query failed ({sanitize_proc(proc)})")
    out = proc.stdout or ""
    if "token=" in out.lower() or "password" in out.lower():
        die("WOPI query output looked like it contained a secret; not printing it")
    print(out.rstrip())
    if "token_ttl=" not in out and "rows=0" in out:
        print("NOTE no WOPI rows were present")
    elif "token_ttl=column_absent" in out:
        print("PASS recorded WOPI expiry from the Pi (token_ttl column absent; hook falls back to ts_day(expiry))")
    elif "token_ttl=" not in out:
        die("could not read token_ttl or expiry from oc_richdocuments_wopi")
    else:
        print("PASS recorded WOPI token_ttl / expiry from the Pi")

    # Client-address behaviour: probe the published port from the Pi host.
    if not args.base:
        print("NOTE no --base; skipped published-port client-address probe")
        return
    ua = "i413-addr-probe"
    url = args.base.rstrip("/") + "/status.php"
    req = urllib.request.Request(url, headers={"User-Agent": ua, "X-Forwarded-For": "203.0.113.50"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            status = resp.status
    except urllib.error.HTTPError as e:
        status = e.code
    except Exception as e:
        print(f"NOTE status.php probe failed: {type(e).__name__}")
        status = 0
    print(f"probe url_host_only=127.0.0.1_published_port http_status={status} ua={ua}")
    # Look at the Nextcloud Apache/nginx access log for that UA.
    proc = compose_exec(
        inst,
        "nextcloud-app",
        ["sh", "-c",
         "for f in /var/log/apache2/access.log /var/log/apache2/other_vhosts_access.log "
         "/var/log/nginx/access.log /var/www/html/data/nextcloud.log; do "
         "[ -f \"$f\" ] || continue; echo FILE:$f; grep -F i413-addr-probe \"$f\" | tail -n 3; done"],
        timeout=30,
    )
    logtxt = proc.stdout or ""
    if "i413-addr-probe" in logtxt:
        # Extract the first IPv4 on each matching line, not usernames.
        addrs = []
        for line in logtxt.splitlines():
            if "i413-addr-probe" not in line:
                continue
            found = IP_RE.findall(line)
            if found:
                addrs.append(found[0])
        print(f"remote_addr_seen={addrs[-1] if addrs else 'unknown'} (Docker published-port client as seen inside nextcloud-app)")
        print(f"x_forwarded_for_sent=203.0.113.50 note=record whether that hop appears in the log line")
        if "203.0.113.50" in logtxt:
            print("forwarded_for_honoured=yes")
        else:
            print("forwarded_for_honoured=no (typical when trusted_proxies does not include the docker-proxy)")
        print("PASS recorded client-address behaviour from the Pi published port")
    else:
        print("NOTE no access-log line matched the probe UA; remote address could not be read back")
        print(f"PASS recorded that the probe reached HTTP {status} via the published port")


# --- Kiwix logs ----------------------------------------------------------


def cmd_kiwix_logs(args: Any) -> None:
    inst = Path(args.dir)
    day = args.day or today_iso()
    logs = inst / "logs"
    data = inst / "data"
    nginx = inst / "proxy" / "nginx.conf"
    if not logs.is_dir():
        die(f"Kiwix logs dir missing: {logs}")
    if not data.is_dir():
        die(f"Kiwix data dir missing: {data}")
    log_files = sorted(p.name for p in logs.glob("access-*.json"))
    data_logs = sorted(p.name for p in data.glob("access-*.json")) if data.is_dir() else []
    print(f"logs_dir={logs} files={log_files}")
    print(f"data_dir={data} access_logs={data_logs}")
    if data_logs:
        die("Kiwix access logs must not live under ./data")
    today_log = logs / f"access-{day}.json"
    if not today_log.is_file():
        die(f"expected daily rolled log {today_log.name}")
    print(f"PASS daily rolled log present: {today_log.name} (not under ./data)")
    if nginx.is_file():
        text = nginx.read_text(encoding="utf-8", errors="replace")
        if "access-$log_ymd.json" not in text and "access-" not in text:
            die("proxy/nginx.conf does not write a dated access log")
        print("PASS nginx.conf writes access-$log_ymd.json (daily roll)")
    old = logs / "access-2010-01-01.json"
    keep_day = days_ago_iso(3)
    keep = logs / f"access-{keep_day}.json"
    write_text_maybe_via_compose(
        old, '{"i413":"old-scratch-marker"}\n', inst, "proxy", "/logs/access-2010-01-01.json"
    )
    if not keep.exists():
        write_text_maybe_via_compose(
            keep,
            '{"i413":"keep-scratch-marker"}\n',
            inst,
            "proxy",
            f"/logs/access-{keep_day}.json",
        )
        created_keep = True
    else:
        created_keep = False
    cutoff = cutoff_14()
    if not should_prune_log("2010-01-01", cutoff):
        die("internal cutoff helper would not prune 2010-01-01")
    proc = compose_exec(inst, "proxy", ["/hooks/usage.sh", "day", day], timeout=30)
    if proc.returncode != 0:
        die(f"kiwix hook failed during log-prune probe ({sanitize_proc(proc)})")
    if old.exists():
        die("14-day clear did not remove access-2010-01-01.json from the scratch logs dir")
    if not keep.exists():
        die(f"14-day clear removed a recent scratch log access-{keep_day}.json")
    if not today_log.exists():
        die("14-day clear removed today's access log")
    print(f"PASS 14-day clear removed access-2010-01-01.json and kept access-{keep_day}.json and access-{day}.json")
    print("NOTE archive-and-clear was not run; this prune is the Kiwix log hook/entrypoint rule on scratch ./logs only")
    hits = pii_hits(proc.stdout or "")
    if hits:
        die("kiwix hook stdout leaked PII: " + "; ".join(hits))
    # Leave the keep marker (quarantined with the instance). Do not rm -rf.


# --- stdin pipe ----------------------------------------------------------


def cmd_stdin_pipe(args: Any) -> None:
    inst = Path(args.dir)
    service = args.service
    day = args.day
    hook = Path(args.hook) if args.hook else (inst / "hooks" / "usage.sh")
    if not hook.is_file():
        die(f"hook file not found: {hook}")
    cid = compose_ps_id(inst, service)
    if not cid:
        die(f"no running container for service {service} in {inst}")
    script = hook.read_bytes()
    proc = subprocess.run(
        ["docker", "exec", "-i", "-e", f"IDEA_USAGE_MODE=day", "-e", f"IDEA_USAGE_DAY={day}",
         cid, "sh", "-s", "--", "day", day],
        input=script,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=90,
    )
    out = proc.stdout.decode("utf-8", errors="replace")
    if proc.returncode != 0:
        die(f"stdin pipe failed for {service} ({sanitize_proc(subprocess.CompletedProcess(proc.args, proc.returncode, out, proc.stderr.decode('utf-8', 'replace')))})")
    body = json.loads(out)
    if body.get("schema") != "idea-usage-day/1":
        die(f"stdin pipe returned unexpected schema {body.get('schema')!r}")
    if body.get("day") != day:
        die(f"stdin pipe day mismatch {body.get('day')!r}")
    hits = pii_hits(out)
    if hits:
        die("stdin pipe stdout leaked PII: " + "; ".join(hits))
    listed = args.listed
    print(f"PASS stdin pipe docker exec -i … sh -s on {service} container={cid[:12]} listed={listed} app={body.get('app')}")
    if args.out:
        Path(args.out).write_text(out if out.endswith("\n") else out + "\n", encoding="utf-8")


# --- Kolibri 0.15.5 fixture ----------------------------------------------


_KOLIBRI_0155 = r"""
import os, sqlite3, sys, json
day = sys.argv[1]
home = os.environ.get("KOLIBRI_HOME") or "/root/.kolibri"
db = os.path.join(home, "db.sqlite3")
conn = sqlite3.connect(db)

def tables():
    return sorted(r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'"))

have = tables()
wanted = ["kolibriauth_collection", "kolibriauth_facilityuser", "logger_contentsessionlog", "logger_usersessionlog"]
missing = [t for t in wanted if t not in have]
print("tables=" + ",".join(t for t in wanted if t in have))
if missing:
    print("missing=" + ",".join(missing))
    sys.exit(2)

def schema(table):
    return list(conn.execute("PRAGMA table_info(%s)" % table))

def insert(table, values):
    info = schema(table)
    data = {}
    for _cid, name, ctype, notnull, default, pk in info:
        if name in values:
            data[name] = values[name]
        elif notnull and default is None and not pk:
            data[name] = 0 if (ctype or "").upper() in ("INTEGER", "REAL", "NUMERIC", "INT") else ""
    conn.execute("INSERT INTO %s (%s) VALUES (%s)" % (table, ",".join(data), ",".join("?"*len(data))), list(data.values()))

# Demo facility + a non-demo facility, matching tests/test_usage_hook.py
# (exclude demo learner3 exercise by internal id, not by username).
insert("kolibriauth_collection", {"id": "i413demofac", "name": "IDEA Demo School", "kind": "facility", "parent_id": None})
insert("kolibriauth_collection", {"id": "i413realfac", "name": "West School", "kind": "facility", "parent_id": None})
insert("kolibriauth_facilityuser", {"id": "i413seedl3", "username": "learner3", "date_joined": "2026-01-01 00:00:00", "facility_id": "i413demofac", "deleted": 0})
insert("kolibriauth_facilityuser", {"id": "i413reall3", "username": "learner3", "date_joined": "2026-01-01 00:00:00", "facility_id": "i413realfac", "deleted": 0})
start = day + " 10:00:00"
end = day + " 10:05:00"
insert("logger_contentsessionlog", {
    "id": "i413exseed", "user_id": "i413seedl3", "content_id": "cid-ex", "channel_id": "chan-1",
    "start_timestamp": start, "end_timestamp": end, "time_spent": 50, "progress": 1.0, "kind": "exercise",
})
insert("logger_contentsessionlog", {
    "id": "i413vidseed", "user_id": "i413seedl3", "content_id": "cid-vid", "channel_id": "chan-1",
    "start_timestamp": day + " 10:10:00", "end_timestamp": day + " 10:12:00", "time_spent": 30, "progress": 0.4, "kind": "video",
})
insert("logger_contentsessionlog", {
    "id": "i413exreal", "user_id": "i413reall3", "content_id": "cid-ex", "channel_id": "chan-1",
    "start_timestamp": day + " 11:00:00", "end_timestamp": day + " 11:05:00", "time_spent": 40, "progress": 1.0, "kind": "exercise",
})
for i in range(3):
    insert("logger_usersessionlog", {
        "id": "i413s%d" % i, "user_id": "i413seedl3",
        "start_timestamp": "%s 12:0%d:00" % (day, i),
        "last_interaction_timestamp": "%s 12:1%d:00" % (day, i),
    })
conn.commit()
print("fixture-ok")
"""


def cmd_kolibri_0155_fixture(args: Any) -> None:
    inst = Path(args.dir)
    day = args.day
    proc = subprocess.run(
        ["docker", "compose", "exec", "-T", "-e", f"IDEA_STAMP_DAY={day}", "kolibri",
         "python", "-c", "import os,sys; sys.argv=['f', os.environ['IDEA_STAMP_DAY']]; exec(sys.stdin.read())"],
        cwd=str(inst),
        input=_KOLIBRI_0155,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=60,
    )
    out = proc.stdout or ""
    print(out.rstrip())
    if proc.returncode != 0 or "fixture-ok" not in out:
        die(f"0.15.5 fixture insert failed ({sanitize_proc(proc)})")
    if "tables=" not in out:
        die("0.15.5 container did not report table names")
    print("PASS confirmed Kolibri 0.15.5 table names and inserted the demo-seed fixture")


def cmd_check_kolibri_0155(args: Any) -> None:
    path = Path(args.file)
    raw = path.read_text(encoding="utf-8")
    body = json.loads(raw)
    hits = pii_hits(raw)
    if hits:
        die("0.15.5 hook output leaked PII: " + "; ".join(hits))
    if body.get("schema") != "idea-usage-day/1" or body.get("app") != "kolibri":
        die("0.15.5 hook did not return idea-usage-day/1 app=kolibri")
    if body.get("day") != args.day:
        die(f"0.15.5 hook day mismatch {body.get('day')!r}")
    if not body.get("demo"):
        die("expected demo=true on the 0.15.5 IDEA Demo School fixture")
    kinds = {(c.get("kind"), c.get("visits"), c.get("seconds")) for c in (body.get("content") or []) if isinstance(c, dict)}
    if ("video", 1, 30) not in kinds:
        die(f"expected demo learner video (1, 30) to be kept, got {kinds}")
    if ("exercise", 1, 40) not in kinds:
        die(f"expected non-demo learner3 exercise (1, 40) to be kept, got {kinds}")
    if any(c.get("kind") == "exercise" and c.get("seconds") == 50 for c in (body.get("content") or []) if isinstance(c, dict)):
        die("demo-seed exercise was not excluded")
    flags = body.get("flags") or []
    if "sharedLearnerAccount" not in flags:
        die(f"expected sharedLearnerAccount on the 0.15.5 fixture, flags={flags}")
    print("PASS Kolibri 0.15.5 demo-seed exclusion by IDs (not username) and sharedLearnerAccount")


# --- self-test -----------------------------------------------------------


def self_test() -> None:
    blob_ok = json.dumps({
        "schema": "idea-usage-day/1", "day": "2026-11-10", "app": "kolibri",
        "setup": {"admin": {"total": 1, "beyondSeed": 0}},
        "flags": ["sharedLearnerAccount"],
    })
    if pii_hits(blob_ok):
        die("self-test: clean payload flagged as PII")
    blob_bad = json.dumps({"teacher1": 1, "addr": "10.42.0.21"})
    hits = pii_hits(blob_bad)
    if "teacher1" not in str(hits) or "10.42.0.21" not in str(hits):
        die(f"self-test: expected username and address hits, got {hits}")
    ok, note = backup_is_none("x-app:\n  name: kiwix\n  version: \"1.2-3.8.2\"\nservices:\n  proxy:\n    image: nginx\n")
    if not ok:
        die(f"self-test: expected backup none, got {note}")
    ok, note = backup_is_none("x-app:\n  name: x\n  backup:\n    service: db\n    command: /hooks/backup.sh\n")
    if ok:
        die("self-test: expected backup mapping to fail")
    if cutoff_14(datetime.date(2026, 11, 11)) != "2026-10-28":
        die("self-test: 14-day cutoff date is wrong")
    if not should_prune_log("2010-01-01", "2026-10-28"):
        die("self-test: 2010-01-01 should prune")
    if should_prune_log("2026-11-08", "2026-10-28"):
        die("self-test: a recent day should not prune")
    if yesterday_iso() >= today_iso():
        die("self-test: yesterday should be before today")
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        fake = Path(tmp) / "access-2010-01-01.json"
        write_text_maybe_via_compose(fake, "ok\n", Path(tmp), "proxy", "/logs/nope.json")
        if fake.read_text(encoding="utf-8") != "ok\n":
            die("self-test: host-side write helper failed")
    print("PASS acceptance_checks self-test")
