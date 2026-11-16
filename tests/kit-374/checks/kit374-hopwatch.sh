#!/usr/bin/env bash
# idea#374: watch the temporary system-disk pre-update backup (agent-engine-dev#472, engine#469)
# during ONE major updateApp hop, then assert it is gone and the free space came back. READ-ONLY.
#
# #472: idea-app-data temp-backup-create writes <system>/.idea-temp-backups/<id>/<stamp>/
#   (stamp YYYYMMDDTHHMMSSmmmZ, root 0700) holding repo/ (Borg), SOURCE, ARCHIVE, EXCLUDE and,
#   last, COMPLETE. After the Health gate, temp-backup-delete removes <stamp> and the empty <id>.
#   A failed update keeps it (op arg tempBackupState=kept).
#
# Per hop (system-disk layout, run from the box):
#   start : ssh pi@<pi> 'sudo -n bash -s -- start  nc17 <instanceId>' < kit374-hopwatch.sh   (pre-hop snapshot, then a detached watcher)
#   (run the updateApp)
#   stop  : ssh pi@<pi> 'sudo -n bash -s -- stop   nc17' < kit374-hopwatch.sh                (stop file; assert also stops it)
#   assert: ssh pi@<pi> 'sudo -n bash -s -- assert nc17' < kit374-hopwatch.sh                (post-hop snapshot, PASS/FAIL, hop.json)
# Output: /home/pi/r374-inventory/hop-<label>/ (pre.json, timeline.tsv, state.json, post.json, hop.json, watch.log)
# compare.sh BEFORE AFTER hop-nc17 hop-kol13 reprints the hop checks.
#
# The watcher only reads: os.scandir/stat of .idea-temp-backups/<id>, statvfs of the system
# disk; the snapshots run `du -sxb` on fixed folders and `docker info`. It stops on the stop file
# or after HOPWATCH_TIMEOUT_S (default 10800). No pkill/pgrep, no rm.
#
# Env: HOPWATCH_INTERVAL_S [2]  HOPWATCH_TIMEOUT_S [10800]  HOPWATCH_TOL_MB [256]
#      HOPWATCH_SYSROOT [""=/]  HOPWATCH_OUT_BASE [/home/pi/r374-inventory]
#      HOPWATCH_ENGINE_LOG [/home/pi/.pm2/logs/engine-out.log]  HOPWATCH_JOURNALCTL [journalctl]
#      DOCKER [docker]   (tests only: HOPWATCH_FREE_FILE = file holding the free byte count)
set -euo pipefail
export LC_ALL=C
HOPWATCH_SRC=$(cat <<'PY'
import json, os, re, subprocess, sys, time
from datetime import datetime

SYS = os.environ.get("HOPWATCH_SYSROOT", "").rstrip("/")
TB = SYS + "/.idea-temp-backups"
DOCKER = os.environ.get("DOCKER", "docker")
TOL = int(os.environ.get("HOPWATCH_TOL_MB", "256")) * 1024 * 1024
RE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
RE_STAMP = re.compile(r"^[0-9]{8}T[0-9]{6,15}Z$")

def now():
    return datetime.now().astimezone().isoformat(timespec="seconds")

def run(cmd, timeout=900):
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout)
        return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return 127, "", str(e)

def free_bytes():
    ff = os.environ.get("HOPWATCH_FREE_FILE")
    if ff:
        return int(open(ff).read().strip())
    st = os.statvfs(SYS or "/")
    return st.f_bavail * st.f_frsize

def du(path):
    if not os.path.lexists(path):
        return 0
    rc, out, _ = run(["du", "-sxb", "--", path], timeout=3600)
    try:
        return int(out.split()[0])
    except (IndexError, ValueError):
        return None

def tree_bytes(path):
    """Fast in-process size of the temp backup folder (no symlinks followed)."""
    total = 0
    for r, ds, fs in os.walk(path):
        for n in fs:
            try:
                total += os.lstat(os.path.join(r, n)).st_size
            except OSError:
                pass
    return total

def docker_roots():
    rc, out, _ = run([DOCKER, "info", "--format", "{{.DockerRootDir}}"], timeout=60)
    roots = [out.strip()] if rc == 0 and out.strip() else ["/var/lib/docker"]
    if os.path.isdir(SYS + "/var/lib/containerd"):
        roots.append(SYS + "/var/lib/containerd")
    return roots

def buckets(iid):
    b = {
        "instance": SYS + "/instances/" + iid, "apps": SYS + "/apps", "services": SYS + "/services",
        "preUpdate": SYS + "/.pre-update", "quarantine": SYS + "/.idea-quarantine",
        "tempBackups": TB, "varLog": SYS + "/var/log",
    }
    for i, r in enumerate(docker_roots()):
        b["docker%d" % i] = r
    return b

def snapshot(iid):
    bk = buckets(iid)
    return {"at": now(), "epoch": time.time(), "freeBytes": free_bytes(), "paths": bk,
            "bytes": {k: du(p) for k, p in bk.items()},
            "tempDirs": temp_dirs(iid)}

def temp_dirs(iid):
    d = os.path.join(TB, iid)
    res = []
    try:
        for e in sorted(os.scandir(d), key=lambda e: e.name):
            if e.is_dir(follow_symlinks=False):
                res.append({"stamp": e.name, "stampOk": bool(RE_STAMP.match(e.name)),
                            "complete": os.path.isfile(os.path.join(e.path, "COMPLETE")),
                            "bytes": tree_bytes(e.path)})
    except (FileNotFoundError, NotADirectoryError):
        pass
    return res

def wjson(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)

def watch(out, iid):
    interval = float(os.environ.get("HOPWATCH_INTERVAL_S", "2"))
    deadline = time.time() + float(os.environ.get("HOPWATCH_TIMEOUT_S", "10800"))
    st = {"id": iid, "startedAt": now(), "samples": 0, "firstSeen": None, "lastSeen": None,
          "maxTempBytes": 0, "stamps": [], "completeSeen": False, "freeMin": None, "freeMinAt": None,
          "freeMax": None, "stoppedBy": None, "stoppedAt": None}
    with open(os.path.join(out, "timeline.tsv"), "a") as tl:
        tl.write("time\tfree_bytes\ttemp_bytes\tstamps\tcomplete\n")
        while True:
            t = now()
            fb = free_bytes()
            td = temp_dirs(iid)
            tb = sum(x["bytes"] for x in td)
            st["samples"] += 1
            if st["freeMin"] is None or fb < st["freeMin"]:
                st["freeMin"], st["freeMinAt"] = fb, t
            st["freeMax"] = max(st["freeMax"] or 0, fb)
            if td:
                st["firstSeen"] = st["firstSeen"] or t
                st["lastSeen"] = t
                st["maxTempBytes"] = max(st["maxTempBytes"], tb)
                for x in td:
                    if x["stamp"] not in st["stamps"]:
                        st["stamps"].append(x["stamp"])
                    st["completeSeen"] = st["completeSeen"] or x["complete"]
            tl.write("%s\t%d\t%d\t%s\t%s\n" % (t, fb, tb, ",".join(x["stamp"] for x in td) or "-", ",".join(str(int(x["complete"])) for x in td) or "-"))
            tl.flush()
            wjson(os.path.join(out, "state.json"), st)
            if os.path.exists(os.path.join(out, "STOP")):
                st["stoppedBy"] = "stop-file"; break
            if time.time() > deadline:
                st["stoppedBy"] = "timeout"; break
            time.sleep(interval)
    st["stoppedAt"] = now()
    wjson(os.path.join(out, "state.json"), st)

def evidence(iid, since_epoch):
    ev = {"journal": [], "engineLog": []}
    jc = os.environ.get("HOPWATCH_JOURNALCTL", "journalctl")
    since = datetime.fromtimestamp(since_epoch - 5).strftime("%Y-%m-%d %H:%M:%S")
    rc, out, _ = run([jc, "-t", "idea-app-data", "--since", since, "--no-pager", "-o", "short-iso"], timeout=120)
    if rc == 0:
        ev["journal"] = [l for l in out.splitlines() if "temp-backup" in l and ("/" + iid + "/") in l][-20:]
    else:
        ev["journalError"] = "journalctl rc=%s" % rc
    lp = os.environ.get("HOPWATCH_ENGINE_LOG", "/home/pi/.pm2/logs/engine-out.log")
    try:
        with open(lp, "rb") as f:
            f.seek(0, 2); size = f.tell(); f.seek(max(0, size - (8 << 20)))
            tail = f.read().decode("utf-8", "replace").splitlines()
        ev["engineLog"] = [l for l in tail if iid in l and "temporary pre-update backup" in l][-20:]
    except OSError as e:
        ev["engineLogError"] = str(e)
    return ev

def evaluate(h):
    """Shared by assert and compare.sh (kept identical there). Returns [(level, check, detail)]."""
    res = []
    st, pre, post, ev = h["state"], h["pre"], h["post"], h.get("evidence", {})
    tol = h.get("tolBytes", TOL)
    j = ev.get("journal", [])
    jcreate = any("temp-backup-create:" in l and "complete" in l for l in j)
    jdelete = any("temp-backup-delete: removed" in l for l in j)
    existed = bool(st.get("firstSeen")) or jcreate
    res.append(("PASS" if existed else "FAIL", "temp-backup-existed",
                "seen %s..%s, max %d bytes, stamps %s, COMPLETE seen %s, journal create-complete %s" % (
                    st.get("firstSeen"), st.get("lastSeen"), st.get("maxTempBytes", 0), ",".join(st.get("stamps", [])) or "-", st.get("completeSeen"), jcreate)))
    left = post.get("tempDirs") or []
    res.append(("PASS" if not left else "FAIL", "temp-backup-gone",
                "nothing under .idea-temp-backups/%s (journal delete %s)" % (h["id"], jdelete) if not left else
                "still there: %s" % ", ".join("%s (%d bytes, COMPLETE %s)" % (x["stamp"], x["bytes"], x["complete"]) for x in left)))
    raw = pre["freeBytes"] - post["freeBytes"]
    grow = {k: (post["bytes"].get(k) or 0) - (pre["bytes"].get(k) or 0) for k in pre["bytes"]}
    explained = sum(v for k, v in grow.items() if k != "tempBackups")
    unexplained = raw - explained - grow.get("tempBackups", 0)
    detail = "free before %d, after %d, used %+d; explained %+d (%s); unexplained %+d, tolerance %d" % (
        pre["freeBytes"], post["freeBytes"], raw, explained,
        ", ".join("%s %+d" % (k, v) for k, v in sorted(grow.items()) if v), unexplained, tol)
    res.append(("PASS" if abs(unexplained) <= tol and not left else "FAIL", "free-space-recovered", detail))
    res.append(("INFO", "free-space-min-during", "%s bytes at %s (pre-hop %d, dip %d)" % (
        st.get("freeMin"), st.get("freeMinAt"), pre["freeBytes"], pre["freeBytes"] - (st.get("freeMin") or pre["freeBytes"]))))
    res.append(("INFO", "watcher", "%s samples, stopped by %s at %s" % (st.get("samples"), st.get("stoppedBy"), st.get("stoppedAt"))))
    return res

def main(argv):
    mode = argv[0] if argv else ""
    if mode == "watch":
        return watch(argv[1], argv[2])
    if mode not in ("start", "stop", "assert") or len(argv) < 2:
        sys.exit("usage: kit374-hopwatch.sh start <label> <instanceId> | stop <label> | assert <label>")
    label = argv[1]
    if not RE_ID.match(label):
        sys.exit("bad label")
    base = os.environ.get("HOPWATCH_OUT_BASE") or ("/home/pi/r374-inventory" if os.path.isdir("/home/pi") else os.getcwd())
    out = os.path.join(base, "hop-" + label)
    stopf = os.path.join(out, "STOP")
    if mode == "start":
        iid = argv[2] if len(argv) > 2 else ""
        if not RE_ID.match(iid) or not os.path.isdir(SYS + "/instances/" + iid):
            sys.exit("ERROR: no instance %r under %s/instances" % (iid, SYS))
        if os.path.exists(os.path.join(out, "pre.json")):
            sys.exit("ERROR: %s already used; pick a new label" % out)
        os.makedirs(out, exist_ok=True)
        pre = snapshot(iid)
        pre["id"] = iid
        if pre["tempDirs"]:
            print("WARN leftover temp backups for %s before the hop: %s" % (iid, [x["stamp"] for x in pre["tempDirs"]]))
        wjson(os.path.join(out, "pre.json"), pre)
        src = os.path.join(out, "hopwatch.py")
        with open(src, "w") as f:
            f.write(os.environ["HOPWATCH_SRC"])
        log = open(os.path.join(out, "watch.log"), "a")
        p = subprocess.Popen([sys.executable, src, "watch", out, iid], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True, env=os.environ.copy())
        open(os.path.join(out, "watch.pid"), "w").write(str(p.pid) + "\n")
        print("STARTED hop-%s id=%s pid=%d free=%d instance=%s bytes out=%s" % (label, iid, p.pid, pre["freeBytes"], pre["bytes"]["instance"], out))
        return 0
    if not os.path.exists(os.path.join(out, "pre.json")):
        sys.exit("ERROR: no pre.json in %s (start first)" % out)
    open(stopf, "a").close()
    st_path = os.path.join(out, "state.json")
    for _ in range(int(float(os.environ.get("HOPWATCH_INTERVAL_S", "2")) * 5 + 20)):
        try:
            if json.load(open(st_path)).get("stoppedAt"):
                break
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    if mode == "stop":
        print("STOPPED hop-%s" % label); return 0
    pre = json.load(open(os.path.join(out, "pre.json")))
    try:
        st = json.load(open(st_path))
    except (OSError, ValueError):
        st = {}
    iid = pre["id"]
    post = snapshot(iid)
    h = {"label": label, "id": iid, "pre": pre, "post": post, "state": st, "tolBytes": TOL, "evidence": evidence(iid, pre["epoch"])}
    h["checks"] = [list(c) for c in evaluate(h)]
    wjson(os.path.join(out, "post.json"), post)
    wjson(os.path.join(out, "hop.json"), h)
    fails = 0
    for lvl, chk, det in h["checks"]:
        fails += lvl == "FAIL"
        print("%-4s %s hop-%s %s: %s" % (lvl, iid, label, chk, det))
    for l in h["evidence"].get("journal", []) + h["evidence"].get("engineLog", []):
        print("     evidence: " + l)
    print("HOP %s %s" % (label, "FAIL" if fails else "PASS"))
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]) or 0)
PY
)
export HOPWATCH_SRC
exec python3 -c "$HOPWATCH_SRC" "$@"
