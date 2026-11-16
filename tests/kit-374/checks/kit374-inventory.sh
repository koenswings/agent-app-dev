#!/usr/bin/env bash
# idea#374 kit-replica App-level inventory (Kid). READ-ONLY.
#
# Complements Atlas's scripts/inventory.sh (row counts, nc_user, nc_fc, host-side
# file sha256, Kolibri rows/users/progress, image list). This one adds what that
# does not: occ status (needsDbUpgrade / maintenance), enabled apps, Files Disk
# mounts incl. enable_sharing, shares, schema table list, HTTP login per role,
# WebDAV GET sha256 == file list, apps-open, seeded demo content, Kolibri
# identity / per-user progress digest / content files present (md5) / public
# API, Kiwix ZIM fingerprints / catalog / browse. compare.sh turns two runs into
# PASS / FAIL per check.
#
# One line, system-disk layout (default; discovers ids under /instances by x-app name):
#   ssh pi@<pi> 'sudo -n bash -s -- before' < kit374-inventory.sh
#   -> writes /home/pi/r374-inventory/kid-before/<instanceId>/summary.json (+ raw files)
# Local:     sudo -n bash kit374-inventory.sh [LABEL|OUTDIR] [INSTANCE_ID ...]
# App Disk:  IDEA_ROOT=/disks/<dev> ...      both: IDEA_ROOT=auto
#
# Only `docker ps`, `docker inspect`, `docker image inspect` and `docker exec` of
# read-only commands (occ status/list/get, mariadb SELECT, find|sha256sum) on the
# discovered instance's OWN compose project, HTTP only to 127.0.0.1:<that
# instance's port>. Never signs in to Kolibri as a learner and never records
# progress. Writes only under OUTDIR. Never prints passwords.
#
# Env knobs (defaults in brackets):
#   IDEA_ROOT [""=/instances]  HANDS_OFF_PORTS [18080,18090]  HANDS_OFF_IDS [regex, none]
#   NC_WEBDAV_MAX [0=all]  NC_EXT_HASH [1]  NC_CREDS_FILE [unset: user:password lines]
#   KOLIBRI_CONTENT_MD5 [auto: md5 == file id if total <= KOLIBRI_MD5_MAX (2 GiB), else exists+size; "1"|"0"]
#   KOLIBRI_CREDS_FILE [unset; coach/admin only, learners refused]
#   KIWIX_ZIM_SHA [auto: full sha256 if <= KIWIX_FULL_MAX (4 GiB), else head+tail fingerprint; "full"|"quick"]
#   DOCKER [docker]  KID374_BASE_URL_HOST [127.0.0.1]
set -euo pipefail
export LC_ALL=C
command -v python3 >/dev/null || { echo "ERROR: python3 needed" >&2; exit 2; }
exec python3 - "$@" <<'PY'
import hashlib, json, os, re, shlex, sqlite3, subprocess, sys, time, base64, glob
import urllib.request, urllib.error, urllib.parse, http.cookiejar
from datetime import datetime

DOCKER = os.environ.get("DOCKER", "docker")
HOST = os.environ.get("KID374_BASE_URL_HOST", "127.0.0.1")
HANDS_OFF_PORTS = {p.strip() for p in os.environ.get("HANDS_OFF_PORTS", "18080,18090").split(",") if p.strip()}
HANDS_OFF_IDS = os.environ.get("HANDS_OFF_IDS", "")
HANDS_OFF_NAMES = re.compile(r"kolibri-demo|nextcloud-files-b-001|idea166|usage-dashboard")
IS_ROOT = os.geteuid() == 0

def log(*a):
    print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True)

def run(cmd, timeout=600, ok=(0,)):
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, b"", b"timeout"
    except FileNotFoundError as e:
        return 127, b"", str(e).encode()
    return p.returncode, p.stdout, p.stderr

def read_bytes(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except PermissionError:
        rc, out, _ = run(["sudo", "-n", "cat", "--", path])
        if rc == 0:
            return out
        raise

def read_text(path, default=""):
    try:
        return read_bytes(path).decode("utf-8", "replace")
    except (FileNotFoundError, PermissionError, OSError):
        return default

def parse_env(text):
    env = {}
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def xapp(compose):
    """name/version/title under top-level x-app: (simple line parser, no yaml dep)."""
    out, inx = {}, False
    for line in compose.splitlines():
        if re.match(r"^x-app:\s*$", line):
            inx = True; continue
        if inx and re.match(r"^\S", line):
            break
        m = re.match(r"^  (name|version|title):\s*(.*?)\s*$", line) if inx else None
        if m:
            out[m.group(1)] = m.group(2).strip("'\"")
    return out

def sha256_file(path, chunk=1 << 20):
    h = hashlib.sha256()
    try:
        f = open(path, "rb")
    except PermissionError:
        rc, out, _ = run(["sudo", "-n", "sha256sum", "--", path], timeout=36000)
        return out.split()[0].decode() if rc == 0 and out else None
    with f:
        for b in iter(lambda: f.read(chunk), b""):
            h.update(b)
    return h.hexdigest()

def write_json(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, indent=2, sort_keys=True, default=str)
        f.write("\n")

# ---------------------------------------------------------------- docker (read-only)
def project_containers(iid):
    rc, out, _ = run([DOCKER, "ps", "-a", "--filter", "label=com.docker.compose.project=" + iid, "--format", "{{.Names}}"])
    names = [n for n in out.decode().split() if n]
    if not names:
        return []
    rc, out, _ = run([DOCKER, "inspect"] + names)
    try:
        data = json.loads(out.decode() or "[]")
    except ValueError:
        return []
    res = []
    for c in data:
        cfg, st = c.get("Config") or {}, c.get("State") or {}
        labels = cfg.get("Labels") or {}
        if labels.get("com.docker.compose.project") != iid:
            continue  # belt and braces: never act on another project
        env = dict(e.split("=", 1) for e in (cfg.get("Env") or []) if "=" in e)
        img_id = c.get("Image")
        rc2, out2, _ = run([DOCKER, "image", "inspect", "--format", "{{json .RepoDigests}}", img_id or ""])
        try:
            repo_digests = json.loads(out2.decode() or "null") or []
        except ValueError:
            repo_digests = []
        ports = {}
        for k, v in ((c.get("NetworkSettings") or {}).get("Ports") or {}).items():
            ports[k] = [b.get("HostPort") for b in (v or [])]
        res.append({
            "name": (c.get("Name") or "").lstrip("/"),
            "service": labels.get("com.docker.compose.service"),
            "image": cfg.get("Image"), "imageId": img_id, "repoDigests": repo_digests,
            "state": st.get("Status"), "health": (st.get("Health") or {}).get("Status"),
            "appVersionLabel": labels.get("x-app-version"),
            "networkMode": (c.get("HostConfig") or {}).get("NetworkMode"),
            "ports": ports,
            "_env": {k: env[k] for k in ("KOLIBRI_HTTP_PORT", "MORANGO_SYSTEM_ID", "KOLIBRI_HOME") if k in env},
        })
    return res

def svc(containers, name):
    for c in containers:
        if c["service"] == name and c["state"] == "running":
            return c["name"]
    return None

def dexec(container, args, user=None, timeout=900):
    cmd = [DOCKER, "exec"]
    if user:
        cmd += ["-u", user]
    return run(cmd + [container] + args, timeout=timeout)

# ---------------------------------------------------------------- HTTP (127.0.0.1:<port> only)
class Http:
    def __init__(self, port):
        self.base = "http://%s:%s" % (HOST, port)
        self.port = str(port)
    def _check(self, url):
        u = urllib.parse.urlsplit(url)
        if u.hostname != HOST or str(u.port) != self.port:
            raise RuntimeError("refusing URL outside this instance: " + url)
    def req(self, path, method="GET", auth=None, headers=None, data=None, timeout=30, sink=None, jar=None):
        url = self.base + path
        self._check(url)
        h = dict(headers or {})
        if auth:
            h["Authorization"] = "Basic " + base64.b64encode(("%s:%s" % auth).encode()).decode()
        r = urllib.request.Request(url, data=data, method=method, headers=h)
        handlers = [urllib.request.HTTPCookieProcessor(jar)] if jar is not None else []
        op = urllib.request.build_opener(*handlers)
        try:
            resp = op.open(r, timeout=timeout)
        except urllib.error.HTTPError as e:
            return e.code, e.read(65536), e.geturl()
        except Exception as e:  # connection refused, timeout
            return 0, str(e).encode()[:300], url
        with resp:
            self._check(resp.geturl())
            if sink is not None:
                for b in iter(lambda: resp.read(1 << 20), b""):
                    sink.update(b)
                return resp.status, b"", resp.geturl()
            return resp.status, resp.read(4 << 20), resp.geturl()

def jload(b):
    try:
        return json.loads(b.decode("utf-8", "replace")) if isinstance(b, (bytes, bytearray)) else json.loads(b)
    except ValueError:
        return None

def load_creds(var):
    p = os.environ.get(var)
    creds = {}
    if p and os.path.exists(p):
        for line in read_text(p).splitlines():
            if ":" in line and not line.startswith("#"):
                u, pw = line.split(":", 1)
                creds[u.strip()] = pw.rstrip("\n")
    return creds

# ---------------------------------------------------------------- Nextcloud
HASH_SH = r'''cd "$1" || exit 3
if [ "$2" = home ]; then
  find . -path './appdata_*' -prune -o -path './*/files/*' -type f \
    ! -path '*/cache/*' ! -path '*/thumbnails/*' ! -path '*/uploads/*' ! -name '*.part' -print0
else
  find . -type f ! -name '.idea-files.json' -print0
fi | xargs -0 -r sha256sum'''

def parse_sums(text):
    out, bad = {}, 0
    for line in text.splitlines():
        if not line or line.startswith("\\"):
            bad += bool(line); continue
        h, _, p = line.partition("  ")
        if len(h) == 64 and p:
            out[p[2:] if p.startswith("./") else p] = h
    return out, bad

def nextcloud(iid, inst, env, cont, odir, info):
    app, db = svc(cont, "nextcloud-app"), svc(cont, "nextcloud-db")
    info["containersRunning"] = {"app": bool(app), "db": bool(db), "code": bool(svc(cont, "code"))}
    port = env.get("port") or next((v[0] for c in cont if c["service"] == "nextcloud-app" for v in c["ports"].values() if v), None)
    info["port"] = port
    if not app:
        info["errors"].append("nextcloud-app not running"); return
    def occ(*a):
        rc, out, err = dexec(app, ["php", "/var/www/html/occ", "--no-interaction", "--no-ansi"] + list(a), user="33")
        if rc != 0:
            info["errors"].append("occ %s rc=%s %s" % (" ".join(a), rc, err.decode()[-200:]))
        return out.decode("utf-8", "replace")
    st = jload(occ("status", "--output=json")) or {}
    info["occStatus"] = {k: st.get(k) for k in ("installed", "version", "versionstring", "edition", "maintenance", "needsDbUpgrade")}
    info["users"] = jload(occ("user:list", "--output=json")) or {}
    groups = jload(occ("group:list", "--output=json")) or {}
    info["groups"] = {g: sorted(m) if isinstance(m, list) else m for g, m in groups.items()}
    apps = jload(occ("app:list", "--output=json")) or {}
    info["appsEnabled"] = apps.get("enabled", {})
    info["appsDisabled"] = apps.get("disabled", {})
    datadir = occ("config:system:get", "datadirectory").strip() or "/var/www/html/data"
    info["datadirectory"] = datadir
    mounts = []
    if "files_external" in info["appsEnabled"]:
        raw = jload(occ("files_external:list", "--all", "--output=json")) or []
        for m in raw:
            cfg = m.get("configuration") or {}
            mounts.append({
                "mount_id": m.get("mount_id"), "mount_point": m.get("mount_point"),
                "storage": m.get("storage"), "authentication_type": m.get("authentication_type"),
                "datadir": cfg.get("datadir"),  # other config keys may hold secrets: dropped
                "applicable_users": sorted(m.get("applicable_users") or []),
                "applicable_groups": sorted(m.get("applicable_groups") or []),
                "options": m.get("options") or {}, "type": m.get("type"),
            })
    info["externalMounts"] = mounts
    # DB: schema table list, shares (no tokens), server version
    if db:
        def q(sql):
            rc, out, err = dexec(db, ["sh", "-c", 'MYSQL_PWD="$MYSQL_PASSWORD" exec mariadb -u"$MYSQL_USER" -N -B "$MYSQL_DATABASE" -e "$0"', sql], timeout=300)
            if rc != 0:
                info["errors"].append("sql rc=%s %s" % (rc, err.decode()[-200:]))
            return out.decode("utf-8", "replace")
        info["mariadbVersion"] = q("SELECT VERSION()").strip()
        info["tables"] = sorted(t for t in q("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()").split("\n") if t)
        shares = []
        for line in q("SELECT share_type, COALESCE(share_with,''), uid_owner, COALESCE(uid_initiator,''), item_type, file_target, permissions FROM oc_share ORDER BY id").splitlines():
            f = line.split("\t")
            if len(f) == 7:
                shares.append(dict(zip(("share_type", "share_with", "uid_owner", "uid_initiator", "item_type", "file_target", "permissions"), f)))
        info["shares"] = shares
    # files with sha256 (inside the app container, as www-data; read-only find|sha256sum)
    rc, out, err = dexec(app, ["sh", "-c", HASH_SH, "sh", datadir, "home"], user="33", timeout=7200)
    files, bad = parse_sums(out.decode("utf-8", "surrogateescape"))
    if rc not in (0, 123):
        info["errors"].append("hash home rc=%s %s" % (rc, err.decode()[-200:]))
    ext_files = {}
    if os.environ.get("NC_EXT_HASH", "1") == "1":
        for m in mounts:
            if m["storage"] and "Local" in m["storage"] and m["datadir"]:
                rc, out, err = dexec(app, ["sh", "-c", HASH_SH, "sh", m["datadir"], "ext"], user="33", timeout=7200)
                if rc == 3:
                    info["errors"].append("mount %s datadir not reachable (undocked?)" % m["mount_point"]); continue
                fs, b2 = parse_sums(out.decode("utf-8", "surrogateescape"))
                bad += b2
                for p, h in fs.items():
                    ext_files["ext:%s/%s" % (m["mount_point"].strip("/"), p)] = h
    info["unparseablePaths"] = bad
    allfiles = dict(files); allfiles.update(ext_files)
    with open(os.path.join(odir, "files.sha256"), "w") as f:
        for p in sorted(allfiles):
            f.write("%s  %s\n" % (allfiles[p], p))
    info["files"] = allfiles
    info["fileCount"] = {"home": len(files), "external": len(ext_files)}
    # seeded demo content: any demo/content file found (by sha256) anywhere in the inventory
    demo = {}
    for d in [os.path.join(inst, "demo", "content")] + sorted(glob.glob(os.path.join(info["root"], "apps", "nextcloud-*", "demo", "content"))):
        for r, _, fs in os.walk(d):
            for n in fs:
                p = os.path.join(r, n)
                demo.setdefault(sha256_file(p), os.path.relpath(p, d))
    shaset = set(allfiles.values())
    info["seeded"] = {"demoFilesKnown": len(demo), "found": sorted(v for k, v in demo.items() if k in shaset)}
    # HTTP
    if not port:
        info["errors"].append("no port"); return
    H = Http(port)
    code, body, _ = H.req("/status.php")
    info["statusPhp"] = {"http": code, "json": jload(body)}
    code, _, _ = H.req("/login")
    info["loginPage"] = code
    creds, src = {}, {}
    admin_pw = env.get("IDEA_NC_ADMIN_PASSWORD") or "admin911!"
    creds["admin"], src["admin"] = admin_pw, ("env:IDEA_NC_ADMIN_PASSWORD" if env.get("IDEA_NC_ADMIN_PASSWORD") else "default:<user>+suffix scheme")
    suffix = env.get("IDEA_NC_PASSWORD_SUFFIX", "911!")
    for pair in env.get("IDEA_NC_SEED_USERS", "teacher1:teachers learner1:learners").split():
        u = pair.split(":")[0]
        creds.setdefault(u, u + suffix); src.setdefault(u, "default:<user>+suffix scheme")
    for u, pw in load_creds("NC_CREDS_FILE").items():
        creds[u], src[u] = pw, "NC_CREDS_FILE"
    logins = {}
    jars = {}
    for u in sorted(creds):
        if u not in info["users"]:
            continue
        jar = jars.setdefault(u, http.cookiejar.CookieJar())
        auth = (u, creds[u])
        dav, _, _ = H.req("/remote.php/dav/files/%s/" % urllib.parse.quote(u), method="PROPFIND", auth=auth, headers={"Depth": "0"}, jar=jar)
        filesapp = ocs = None  # one failed attempt per user only (brute-force throttle)
        if dav == 207:
            filesapp, _, _ = H.req("/index.php/apps/files/", auth=auth, jar=jar)
            ocs, _, _ = H.req("/ocs/v2.php/cloud/capabilities?format=json", auth=auth, headers={"OCS-APIRequest": "true"}, jar=jar)
        groups_of = sorted(g for g, m in info["groups"].items() if isinstance(m, list) and u in m)
        logins[u] = {"credSource": src[u], "groups": groups_of, "davPropfind": dav, "filesApp": filesapp, "ocsCapabilities": ocs}
    info["logins"] = logins
    # WebDAV GET == sha256 list
    limit = int(os.environ.get("NC_WEBDAV_MAX", "0") or 0)
    res = {"checked": 0, "match": 0, "mismatch": [], "skippedNoCreds": 0, "errors": []}
    def dav_get(user, rel, want):
        hsh = hashlib.sha256()
        code, _, _ = H.req("/remote.php/dav/files/%s/%s" % (urllib.parse.quote(user), urllib.parse.quote(rel)), auth=(user, creds[user]), sink=hsh, timeout=600, jar=jars.get(user))
        res["checked"] += 1
        if code == 200 and hsh.hexdigest() == want:
            res["match"] += 1
        else:
            res["mismatch"].append({"user": user, "path": rel, "http": code})
    n = 0
    for p, h in sorted(allfiles.items()):
        if limit and n >= limit:
            break
        if p.startswith("ext:"):
            mp, _, rel = p[4:].partition("/")
            if "admin" in logins and logins["admin"]["davPropfind"] == 207:
                dav_get("admin", mp + "/" + rel, h); n += 1
            else:
                res["skippedNoCreds"] += 1
            continue
        uid, _, rest = p.partition("/files/")
        if uid in logins and logins[uid]["davPropfind"] == 207:
            dav_get(uid, rest, h); n += 1
        else:
            res["skippedNoCreds"] += 1
    info["webdav"] = res

# ---------------------------------------------------------------- Kolibri
def kolibri(iid, inst, env, cont, odir, info):
    kh = os.path.join(inst, "data", "kolibri")
    src = os.path.join(kh, "db.sqlite3")
    dst = os.path.join(odir, "kolibri-db.ro-copy.sqlite3")
    code = ("import sqlite3,sys\ns=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True,timeout=30)\n"
            "d=sqlite3.connect(sys.argv[2])\ns.backup(d)\nd.close();s.close()\n")
    if os.path.exists(dst):
        info["errors"].append("db copy already exists in outdir; use a fresh OUTDIR"); return
    rc, _, err = run(([] if IS_ROOT or os.access(src, os.R_OK) else ["sudo", "-n"]) + ["python3", "-c", code, src, dst], timeout=900)
    if rc != 0:
        info["errors"].append("sqlite ro copy failed: " + err.decode()[-300:]); return
    c = sqlite3.connect("file:%s?mode=ro" % dst, uri=True)
    x = lambda s, a=(): c.execute(s, a).fetchall()
    T = {r[0] for r in x("select name from sqlite_master where type='table'")}
    info["integrity"] = x("pragma quick_check")[0][0]
    info["tables"] = sorted(T)
    info["morangoInstanceCurrent"] = [dict(zip(("id", "system_id", "node_id", "counter", "database_id"), r)) for r in x("select id, system_id, node_id, counter, database_id from morango_instanceidmodel where current=1")] if "morango_instanceidmodel" in T else []
    info["morangoDatabaseCurrent"] = [r[0] for r in x("select id from morango_databaseidmodel where current=1")] if "morango_databaseidmodel" in T else []
    info["facilities"] = [dict(zip(("id", "name", "dataset_id"), r)) for r in x("select id, name, dataset_id from kolibriauth_collection where kind='facility' order by id")]
    info["collections"] = [dict(zip(("id", "kind", "name", "parent_id"), r)) for r in x("select id, kind, name, parent_id from kolibriauth_collection where kind!='facility' order by id")]
    info["memberships"] = sorted("%s:%s" % r for r in x("select collection_id, user_id from kolibriauth_membership"))
    info["roles"] = sorted("%s:%s:%s" % r for r in x("select user_id, collection_id, kind from kolibriauth_role"))
    roles_by_user = {}
    for u, k in x("select user_id, kind from kolibriauth_role"):
        roles_by_user.setdefault(u, set()).add(k)
    info["users"] = [{"id": r[0], "username": r[1], "facility_id": r[2], "roles": sorted(roles_by_user.get(r[0], [])) or ["learner"]}
                     for r in x("select id, username, facility_id from kolibriauth_facilityuser order by id")]
    def cnt(t):
        return x('select count(*) from "%s"' % t)[0][0] if t in T else None
    info["tableCounts"] = {t: cnt(t) for t in sorted(T) if t.startswith(("logger_", "lessons_", "exams_", "kolibriauth_", "content_channelmetadata", "content_localfile", "content_contentnode", "bookmarks_", "notifications_"))}
    prog = {}
    if "logger_contentsummarylog" in T:
        for uid, n, done in x("select user_id, count(*), sum(case when progress>=1 then 1 else 0 end) from logger_contentsummarylog group by user_id"):
            prog.setdefault(str(uid), {})["summary"] = n; prog[str(uid)]["completed"] = done
        h = hashlib.sha256()
        for r in x("select user_id, content_id, round(progress, 4) from logger_contentsummarylog order by user_id, content_id"):
            h.update(("%s|%s|%s\n" % r).encode())
        info["summaryLogDigest"] = h.hexdigest()
    for t, k in (("logger_attemptlog", "attempts"), ("logger_masterylog", "mastery"), ("logger_examlog", "examlogs"), ("logger_contentsessionlog", "sessions")):
        if t in T:
            for uid, n in x('select user_id, count(*) from "%s" group by user_id' % t):
                prog.setdefault(str(uid), {})[k] = n
    info["progressByUser"] = prog
    info["lessons"] = [dict(zip(("id", "title", "collection_id", "is_active"), r)) for r in x("select id, title, collection_id, is_active from lessons_lesson order by id")] if "lessons_lesson" in T else []
    info["exams"] = [dict(zip(("id", "title", "collection_id", "active"), r)) for r in x("select id, title, collection_id, active from exams_exam order by id")] if "exams_exam" in T else []
    info["channels"] = [dict(zip(("id", "name", "version", "root_id"), r)) for r in x("select id, name, version, root_id from content_channelmetadata order by id")] if "content_channelmetadata" in T else []
    cols = {r[1] for r in x("pragma table_info(content_contentnode)")} if "content_contentnode" in T else set()
    if {"channel_id", "available"} <= cols:
        info["availableNodesByChannel"] = {str(ch): n for ch, n in x("select channel_id, count(*) from content_contentnode where available=1 group by channel_id")}
    # content files present (and md5 == localfile id)
    files = x("select id, extension, file_size from content_localfile where available=1 order by id") if "content_localfile" in T else []
    total = sum(f[2] or 0 for f in files)
    md5_env = os.environ.get("KOLIBRI_CONTENT_MD5", "auto")
    do_md5 = md5_env == "1" or (md5_env == "auto" and total <= int(os.environ.get("KOLIBRI_MD5_MAX", str(2 << 30))))
    missing, badsize, badmd5 = [], [], []
    for fid, ext, size in files:
        p = os.path.join(kh, "content", "storage", fid[0], fid[1], "%s.%s" % (fid, ext))
        try:
            st = os.stat(p)
        except FileNotFoundError:
            missing.append(fid); continue
        except PermissionError:
            rc, out, _ = run(["sudo", "-n", "stat", "-c", "%s", p])
            if rc != 0:
                missing.append(fid); continue
            st = type("S", (), {"st_size": int(out.strip() or 0)})
        if size and st.st_size != size:
            badsize.append(fid)
        if do_md5:
            try:
                h = hashlib.md5()
                with open(p, "rb") as f:
                    for b in iter(lambda: f.read(1 << 20), b""):
                        h.update(b)
                md = h.hexdigest()
            except PermissionError:
                rc, out, _ = run(["sudo", "-n", "md5sum", "--", p], timeout=3600)
                md = out.split()[0].decode() if rc == 0 else ""
            if md != fid:
                badmd5.append(fid)
    info["contentFiles"] = {"available": len(files), "bytes": total, "missing": missing, "sizeMismatch": badsize, "md5Checked": do_md5, "md5Mismatch": badmd5}
    c.close()
    # identity env + HTTP (public endpoints only; DB was copied first)
    kc = next((cc for cc in cont if cc["service"] == "kolibri"), None)
    cenv = kc["_env"] if kc else {}
    info["MORANGO_SYSTEM_ID"] = cenv.get("MORANGO_SYSTEM_ID")
    port = cenv.get("KOLIBRI_HTTP_PORT") or env.get("port")
    info["port"] = port
    info["kolibriVersionFile"] = read_text(os.path.join(kh, ".data_version")).strip() or None
    if not port:
        info["errors"].append("no port"); return
    H = Http(port)
    code, body, _ = H.req("/api/public/info/")
    pj = jload(body) or {}
    info["publicInfo"] = {"http": code, "kolibri_version": pj.get("kolibri_version"), "application": pj.get("application")}
    code, body, _ = H.req("/api/public/v1/facility/")
    fj = jload(body)
    if isinstance(fj, dict):
        fj = fj.get("results")
    info["publicFacilities"] = {"http": code, "ids": sorted(f.get("id") for f in (fj or []) if isinstance(f, dict))}
    code, _, _ = H.req("/")
    info["rootHttp"] = code
    logins = {}
    users = {u["username"]: u for u in info["users"]}
    for u, pw in load_creds("KOLIBRI_CREDS_FILE").items():
        if u not in users or users[u]["roles"] == ["learner"]:
            logins[u] = {"skipped": "unknown user or learner (learners are never signed in)"}; continue
        body = json.dumps({"username": u, "password": pw, "facility": users[u]["facility_id"]}).encode()
        code, rb, _ = H.req("/api/auth/session/", method="POST", data=body, headers={"Content-Type": "application/json"}, jar=http.cookiejar.CookieJar())
        logins[u] = {"http": code, "ok": code == 200 and (jload(rb) or {}).get("username") == u}
    info["logins"] = logins

# ---------------------------------------------------------------- Kiwix
def kiwix(iid, inst, env, cont, odir, info):
    data = os.path.join(inst, "data")
    mode = os.environ.get("KIWIX_ZIM_SHA", "auto")
    full_max = int(os.environ.get("KIWIX_FULL_MAX", str(4 << 30)))
    zims = {}
    names = []
    try:
        names = sorted(os.listdir(data))
    except PermissionError:
        rc, out, _ = run(["sudo", "-n", "ls", "-1", "--", data])
        names = sorted(out.decode().split("\n")) if rc == 0 else []
    except FileNotFoundError:
        info["errors"].append("no data dir")
    for n in names:
        if not n.endswith(".zim"):
            continue
        p = os.path.join(data, n)
        try:
            size = os.stat(p).st_size
        except PermissionError:
            rc, out, _ = run(["sudo", "-n", "stat", "-c", "%s", p]); size = int(out.strip() or 0)
        z = {"size": size, "sidecar": (read_text(p + ".sha256").split() or [None])[0]}
        full = mode == "full" or (mode == "auto" and size <= full_max)
        if full:
            z["sha256"] = sha256_file(p)
            if z["sidecar"]:
                z["sidecarMatch"] = z["sidecar"] == z["sha256"]
        else:
            h = hashlib.sha256(); h.update(str(size).encode())
            seg = 64 << 20
            try:
                with open(p, "rb") as f:
                    h.update(f.read(seg)); f.seek(max(0, size - seg)); h.update(f.read(seg))
                z["fingerprint"] = "head+tail64MiB:" + h.hexdigest()
            except PermissionError:
                info["errors"].append("cannot read %s for fingerprint (run as root)" % n)
        zims[n] = z
    info["zims"] = zims
    port = env.get("port") or next((v[0] for c in cont for v in c["ports"].values() if v), None)
    info["port"] = port
    if not port:
        info["errors"].append("no port"); return
    H = Http(port)
    code, _, _ = H.req("/")
    info["rootHttp"] = code
    code, body, _ = H.req("/catalog/v2/entries?count=-1")
    entries = []
    txt = body.decode("utf-8", "replace") if code == 200 else ""
    for e in re.findall(r"<entry>(.*?)</entry>", txt, re.S):
        g = lambda tag: (re.search(r"<%s>(.*?)</%s>" % (tag, tag), e, re.S) or [None, None])[1]
        link = re.search(r'<link[^>]*type="text/html"[^>]*href="([^"]+)"', e)
        entries.append({"id": g("id"), "name": g("name"), "title": g("title"), "href": link.group(1) if link else None})
    info["catalog"] = {"http": code, "entries": sorted(entries, key=lambda d: d["name"] or "")}
    browse = {}
    for en in entries:
        if en["href"]:
            hsh = hashlib.sha256()
            code, _, final = H.req(en["href"], sink=hsh, timeout=60)
            browse[en["name"] or en["href"]] = {"http": code, "sha256": hsh.hexdigest()}
    info["browse"] = browse

# ---------------------------------------------------------------- main
def main(argv):
    label = argv[0] if argv else "inv-" + time.strftime("%Y%m%dT%H%M%S")
    ids = argv[1:]
    if "/" in label:
        outdir = label
    else:
        outdir = os.path.join("/home/pi/r374-inventory" if os.path.isdir("/home/pi") else os.getcwd(), "kid-" + label)
    root_env = os.environ.get("IDEA_ROOT", "")
    roots = ([""] + sorted(os.path.dirname(d) for d in glob.glob("/disks/*/instances"))) if root_env == "auto" else [root_env.rstrip("/")]
    if os.path.exists(os.path.join(outdir, "run.json")):
        sys.exit("ERROR: %s already holds an inventory; pick a new label" % outdir)
    os.makedirs(outdir, exist_ok=True)
    found = []
    for r in roots:
        base = (r or "") + "/instances"
        for d in sorted(glob.glob(base + "/*/")):
            iid = os.path.basename(d.rstrip("/"))
            if ids and iid not in ids:
                continue
            xa = xapp(read_text(os.path.join(d, "compose.yaml")))
            if xa.get("name") in ("nextcloud", "kolibri", "kiwix"):
                found.append((iid, d.rstrip("/"), r or "/", xa))
    missing = sorted(set(ids) - {f[0] for f in found})
    run_meta = {"label": label, "startedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                "hostname": os.uname().nodename, "roots": roots, "requestedIds": ids, "missingIds": missing,
                "instances": [], "tool": "kit374-inventory.sh (agent-app-dev tests/kit-374/checks)"}
    rc = 0
    for iid, inst, root, xa in found:
        env = parse_env(read_text(os.path.join(inst, ".env")))
        port = env.get("port")
        if HANDS_OFF_NAMES.search(iid) or (HANDS_OFF_IDS and re.search(HANDS_OFF_IDS, iid)) or (port and port in HANDS_OFF_PORTS):
            log("REFUSED hands-off", iid, "port", port); run_meta["instances"].append({"id": iid, "refused": True}); continue
        odir = os.path.join(outdir, iid)
        os.makedirs(odir, exist_ok=True)
        log("inventory", xa.get("name"), iid, "x-app.version", xa.get("version"))
        cont = project_containers(iid)
        info = {"id": iid, "app": xa["name"], "xapp": xa, "instanceDir": inst, "root": root, "errors": [],
                "capturedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                "containers": [{k: v for k, v in c.items() if not k.startswith("_")} for c in cont]}
        t0 = time.time()
        try:
            {"nextcloud": nextcloud, "kolibri": kolibri, "kiwix": kiwix}[xa["name"]](iid, inst, env, cont, odir, info)
        except Exception as e:  # keep going with the other instances
            info["errors"].append("exception: %r" % (e,)); rc = 1
        info["seconds"] = round(time.time() - t0, 1)
        write_json(os.path.join(odir, "summary.json"), info)
        run_meta["instances"].append({"id": iid, "app": xa["name"], "version": xa.get("version"), "errors": len(info["errors"])})
        print("%-34s %-9s %-42s errors=%d  %ss" % (iid, xa["name"], xa.get("version"), len(info["errors"]), info["seconds"]))
        for e in info["errors"]:
            print("   ! " + e)
    run_meta["finishedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
    write_json(os.path.join(outdir, "run.json"), run_meta)
    if missing:
        print("MISSING ids: " + " ".join(missing)); rc = 1
    if not found:
        print("no nextcloud/kolibri/kiwix instances found under %s" % roots); rc = 1
    print("OUTDIR " + outdir)
    return rc

sys.exit(main(sys.argv[1:]))
PY
