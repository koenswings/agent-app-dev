#!/usr/bin/env bash
# idea#374: compare two kit374-inventory.sh runs. Prints PASS / FAIL / WARN / INFO per check.
# Usage: compare.sh BEFORE_DIR AFTER_DIR [HOP_DIR ...]
#   HOP_DIR = a kit374-hopwatch.sh output dir (hop-<label>/ with hop.json): its temp-backup
#   checks (existed, gone, free space recovered) are printed too and count as FAIL.
# Exit 0 = no FAIL, 1 = at least one FAIL, 2 = usage.
#
# Optional expectations for the after run (unset = the version is only reported):
#   EXPECT_NEXTCLOUD_APP_VERSION=1.8-31.0.14   EXPECT_NC_VERSION_PREFIX=31.0.14
#   EXPECT_KOLIBRI_APP_VERSION=1.3-0.19.5      EXPECT_KOLIBRI_VERSION_PREFIX=0.19.5
#   EXPECT_KIWIX_APP_VERSION=1.3-3.8.2
#   NC_ALLOW_APP_DROP="app1 app2"  enabled apps allowed to disappear
#   KOLIBRI_GROWING_TABLES="logger_usersessionlog"  tables allowed to grow (sign-ins add rows)
set -euo pipefail
[ $# -ge 2 ] && [ -d "$1" ] && [ -d "$2" ] || { echo "usage: compare.sh BEFORE_DIR AFTER_DIR [HOP_DIR ...]" >&2; exit 2; }
exec python3 - "$@" <<'PY'
import json, os, sys

B, A = sys.argv[1], sys.argv[2]
HOPS = sys.argv[3:]
E = os.environ
fails = 0
def out(level, iid, app, check, detail=""):
    global fails
    fails += level == "FAIL"
    print("%-4s %s %s %s%s" % (level, iid, app, check, (": " + detail) if detail else ""))

def ok(cond, iid, app, check, detail="", warn=False):
    out("PASS" if cond else ("WARN" if warn else "FAIL"), iid, app, check, "" if cond else detail)

def load(d):
    res = {}
    for n in sorted(os.listdir(d)):
        p = os.path.join(d, n, "summary.json")
        if os.path.isfile(p):
            with open(p) as f:
                res[n] = json.load(f)
    return res

def short(items, n=8):
    items = sorted(items)
    return ", ".join(map(str, items[:n])) + (" … (+%d)" % (len(items) - n) if len(items) > n else "")

def expect(iid, app, check, actual, want, prefix=False):
    if not want:
        out("INFO", iid, app, check, str(actual)); return
    good = str(actual or "").startswith(want) if prefix else actual == want
    ok(good, iid, app, check, "got %r want %s%r" % (actual, "prefix " if prefix else "", want))

def common(iid, app, b, a):
    ok(not a.get("errors"), iid, app, "inventory-errors", "; ".join(a.get("errors", []))[:400])
    run = [c["name"] for c in a.get("containers", []) if c.get("state") != "running"]
    ok(a.get("containers") and not run, iid, app, "containers-running", short(run) or "no containers found for this instance")
    unh = [c["name"] for c in a.get("containers", []) if c.get("health") not in (None, "", "healthy")]
    ok(not unh, iid, app, "containers-healthy", short(unh))
    out("INFO", iid, app, "x-app.version", "%s -> %s" % (b["xapp"].get("version"), a["xapp"].get("version")))
    out("INFO", iid, app, "images", " ".join(sorted("%s=%s" % (c["service"], c["image"]) for c in a.get("containers", []))))

def nextcloud(iid, b, a):
    app = "nextcloud"
    common(iid, app, b, a)
    expect(iid, app, "app-version", a["xapp"].get("version"), E.get("EXPECT_NEXTCLOUD_APP_VERSION"))
    st = a.get("occStatus") or {}
    ok(st.get("installed") is True, iid, app, "installed", str(st.get("installed")))
    ok(st.get("needsDbUpgrade") is False, iid, app, "needsDbUpgrade-false", str(st.get("needsDbUpgrade")))
    ok(st.get("maintenance") is False, iid, app, "maintenance-false", str(st.get("maintenance")))
    sp = (a.get("statusPhp") or {}).get("json") or {}
    ok((a.get("statusPhp") or {}).get("http") == 200 and sp.get("maintenance") is False and sp.get("needsDbUpgrade") is False,
       iid, app, "status.php", str(a.get("statusPhp")))
    expect(iid, app, "nextcloud-version", st.get("versionstring") or st.get("version"), E.get("EXPECT_NC_VERSION_PREFIX"), prefix=True)
    bu, au = b.get("users") or {}, a.get("users") or {}
    ok(bu == au, iid, app, "users", "missing=%s changed=%s new=%s" % (short(set(bu) - set(au)), short(u for u in bu if u in au and bu[u] != au[u]), short(set(au) - set(bu))))
    bg, ag = b.get("groups") or {}, a.get("groups") or {}
    ok(bg == ag, iid, app, "groups+members", "before=%s after=%s" % (bg, ag))
    be, ae = b.get("appsEnabled") or {}, a.get("appsEnabled") or {}
    allow = set(E.get("NC_ALLOW_APP_DROP", "").split())
    dropped = set(be) - set(ae) - allow
    ok(not dropped, iid, app, "apps-still-enabled", short(dropped))
    if set(ae) - set(be):
        out("INFO", iid, app, "apps-newly-enabled", short(set(ae) - set(be)))
    key = lambda m: m.get("mount_point")
    bm, am = {key(m): m for m in b.get("externalMounts") or []}, {key(m): m for m in a.get("externalMounts") or []}
    gone = set(bm) - set(am)
    chg = [mp for mp in bm if mp in am and any(bm[mp].get(k) != am[mp].get(k) for k in ("datadir", "applicable_users", "applicable_groups", "options", "storage"))]
    ok(not gone and not chg, iid, app, "files-disk-mounts", "gone=%s changed=%s" % (short(gone), "; ".join("%s %s->%s" % (mp, bm[mp].get("options"), am[mp].get("options")) for mp in chg)))
    nosh = [mp for mp, m in am.items() if str((m.get("options") or {}).get("enable_sharing")).lower() not in ("true", "1")]
    ok(not nosh, iid, app, "files-disk-enable_sharing", "enable_sharing not true on: " + short(nosh), warn=bool(set(nosh) & {mp for mp, m in bm.items() if str((m.get("options") or {}).get("enable_sharing")).lower() not in ("true", "1")}))
    bs = sorted(json.dumps(s, sort_keys=True) for s in b.get("shares") or [])
    as_ = sorted(json.dumps(s, sort_keys=True) for s in a.get("shares") or [])
    ok(bs == as_, iid, app, "shares", "missing=%d new=%d" % (len(set(bs) - set(as_)), len(set(as_) - set(bs))))
    bt, at = set(b.get("tables") or []), set(a.get("tables") or [])
    ok(bt <= at, iid, app, "schema-tables-kept", "dropped: " + short(bt - at))
    if at - bt:
        out("INFO", iid, app, "schema-tables-new", short(at - bt))
    out("INFO", iid, app, "mariadb", "%s -> %s" % (b.get("mariadbVersion"), a.get("mariadbVersion")))
    bf, af = b.get("files") or {}, a.get("files") or {}
    miss = [p for p in bf if p not in af]
    diff = [p for p in bf if p in af and bf[p] != af[p]]
    ok(not miss and not diff, iid, app, "files-sha256", "%d files: missing=%s changed=%s" % (len(bf), short(miss, 5), short(diff, 5)))
    if set(af) - set(bf):
        out("INFO", iid, app, "files-new", "%d new: %s" % (len(set(af) - set(bf)), short(set(af) - set(bf), 5)))
    ok(len(bf) > 0, iid, app, "files-present", "no user files in the before inventory", warn=True)
    bsd, asd = set((b.get("seeded") or {}).get("found") or []), set((a.get("seeded") or {}).get("found") or [])
    ok(bsd <= asd, iid, app, "seeded-content", "lost: " + short(bsd - asd))
    out("INFO", iid, app, "seeded-found", "%d of %d demo files" % (len(asd), (a.get("seeded") or {}).get("demoFilesKnown", 0)))
    bl, al = b.get("logins") or {}, a.get("logins") or {}
    for u in sorted(set(bl) | set(al)):
        x = al.get(u)
        if not x:
            out("FAIL", iid, app, "login:" + u, "no login result after"); continue
        good = x.get("davPropfind") == 207 and x.get("filesApp") == 200 and x.get("ocsCapabilities") == 200
        wasgood = (bl.get(u) or {}).get("davPropfind") == 207
        if good:
            out("PASS", iid, app, "login+apps-open:" + u, "")
        else:
            out("FAIL" if wasgood else "WARN", iid, app, "login+apps-open:" + u,
                "dav=%s files=%s ocs=%s (%s)%s" % (x.get("davPropfind"), x.get("filesApp"), x.get("ocsCapabilities"), x.get("credSource"), "" if wasgood else " — also failed before"))
    w = a.get("webdav") or {}
    ok(w.get("checked", 0) > 0 and not w.get("mismatch"), iid, app, "webdav-get-sha256",
       "checked=%s match=%s mismatch=%s" % (w.get("checked"), w.get("match"), short(("%s:%s(%s)" % (m["user"], m["path"], m["http"]) for m in w.get("mismatch") or []), 5)))
    if w.get("skippedNoCreds"):
        out("INFO", iid, app, "webdav-skipped", "%d files of users without known passwords" % w["skippedNoCreds"])

def kolibri(iid, b, a):
    app = "kolibri"
    common(iid, app, b, a)
    expect(iid, app, "app-version", a["xapp"].get("version"), E.get("EXPECT_KOLIBRI_APP_VERSION"))
    expect(iid, app, "kolibri-version", (a.get("publicInfo") or {}).get("kolibri_version"), E.get("EXPECT_KOLIBRI_VERSION_PREFIX"), prefix=True)
    ok(a.get("integrity") == "ok", iid, app, "sqlite-integrity", str(a.get("integrity")))
    ok(b.get("MORANGO_SYSTEM_ID") == a.get("MORANGO_SYSTEM_ID"), iid, app, "MORANGO_SYSTEM_ID", "%s -> %s" % (b.get("MORANGO_SYSTEM_ID"), a.get("MORANGO_SYSTEM_ID")))
    ok(b.get("facilities") == a.get("facilities"), iid, app, "facilities+dataset", "%s -> %s" % (b.get("facilities"), a.get("facilities")))
    ok(b.get("morangoDatabaseCurrent") == a.get("morangoDatabaseCurrent"), iid, app, "morango-database-id", "%s -> %s" % (b.get("morangoDatabaseCurrent"), a.get("morangoDatabaseCurrent")))
    bi = [r.get("id") for r in b.get("morangoInstanceCurrent") or []]
    ai = [r.get("id") for r in a.get("morangoInstanceCurrent") or []]
    ok(bi == ai, iid, app, "morango-instance-id", "%s -> %s (CHANGED-EXPECTED after an image change: record, not a data loss)" % (bi, ai), warn=True)
    ok(b.get("users") == a.get("users"), iid, app, "users+roles", "before %d after %d" % (len(b.get("users") or []), len(a.get("users") or [])))
    ok(b.get("collections") == a.get("collections"), iid, app, "classes+groups", "")
    ok(b.get("memberships") == a.get("memberships"), iid, app, "memberships", "")
    ok(b.get("roles") == a.get("roles"), iid, app, "role-rows", "")
    ok(b.get("lessons") == a.get("lessons") and b.get("exams") == a.get("exams"), iid, app, "lessons+quizzes", "")
    ok(b.get("progressByUser") == a.get("progressByUser"), iid, app, "progress-per-user", "before=%s after=%s" % (b.get("progressByUser"), a.get("progressByUser")))
    ok(b.get("summaryLogDigest") == a.get("summaryLogDigest"), iid, app, "progress-digest", "summary log (user, content, progress) changed")
    grow = set(E.get("KOLIBRI_GROWING_TABLES", "logger_usersessionlog").split())
    bc, ac = b.get("tableCounts") or {}, a.get("tableCounts") or {}
    bad = []
    for t, n in bc.items():
        if t.startswith(("logger_", "kolibriauth_", "lessons_", "exams_")):
            m = ac.get(t)
            if m is None or (m < n if t in grow else m != n):
                bad.append("%s %s->%s" % (t, n, m))
    ok(not bad, iid, app, "logger+auth-counts", short(bad))
    newt = [t for t in ac if t not in bc and t.startswith("logger_")]
    if newt:
        out("INFO" if all(ac[t] == 0 for t in newt) else "WARN", iid, app, "logger-tables-new", short("%s=%s" % (t, ac[t]) for t in newt))
    bch = {c["id"]: c for c in b.get("channels") or []}
    ach = {c["id"]: c for c in a.get("channels") or []}
    ok(set(bch) <= set(ach), iid, app, "channels", "lost: " + short(bch[i]["name"] for i in set(bch) - set(ach)))
    bn, an = b.get("availableNodesByChannel") or {}, a.get("availableNodesByChannel") or {}
    low = ["%s %s->%s" % ((bch.get(k) or {}).get("name", k), v, an.get(k)) for k, v in bn.items() if (an.get(k) or 0) < v]
    ok(not low, iid, app, "channel-content-available", short(low))
    cf = a.get("contentFiles") or {}
    ok(not cf.get("missing") and not cf.get("sizeMismatch") and not cf.get("md5Mismatch"), iid, app, "content-files-present",
       "available=%s missing=%d size=%d md5=%d" % (cf.get("available"), len(cf.get("missing") or []), len(cf.get("sizeMismatch") or []), len(cf.get("md5Mismatch") or [])))
    pi, pf = a.get("publicInfo") or {}, a.get("publicFacilities") or {}
    ok(pi.get("http") == 200, iid, app, "http-public-info", str(pi.get("http")))
    ok(pf.get("http") == 200 and pf.get("ids") == sorted(f["id"] for f in a.get("facilities") or []), iid, app, "http-public-facilities", str(pf))
    ok(a.get("rootHttp") == 200, iid, app, "http-root", str(a.get("rootHttp")))
    for u, x in sorted((a.get("logins") or {}).items()):
        if "skipped" in x:
            out("INFO", iid, app, "login:" + u, x["skipped"])
        else:
            ok(x.get("ok"), iid, app, "login:" + u, "HTTP %s" % x.get("http"))

def kiwix(iid, b, a):
    app = "kiwix"
    common(iid, app, b, a)
    expect(iid, app, "app-version", a["xapp"].get("version"), E.get("EXPECT_KIWIX_APP_VERSION"))
    bz, az = b.get("zims") or {}, a.get("zims") or {}
    gone = set(bz) - set(az)
    chg = [n for n in bz if n in az and any(bz[n].get(k) != az[n].get(k) for k in ("size", "sha256", "fingerprint") if k in bz[n] and k in az[n])]
    ok(not gone and not chg, iid, app, "zims-identical", "gone=%s changed=%s" % (short(gone), short(chg)))
    side = [n for n, z in az.items() if z.get("sidecarMatch") is False]
    ok(not side, iid, app, "zim-sidecar-sha256", short(side))
    modes = sorted({"sha256" if "sha256" in z else "fingerprint" for z in az.values()})
    out("INFO", iid, app, "zim-check-mode", "%d zims, %s" % (len(az), "/".join(modes)))
    ok(a.get("rootHttp") == 200, iid, app, "http-root", str(a.get("rootHttp")))
    bc = {e["name"] for e in (b.get("catalog") or {}).get("entries") or []}
    ac = {e["name"] for e in (a.get("catalog") or {}).get("entries") or []}
    ok((a.get("catalog") or {}).get("http") == 200 and bc <= ac and len(ac) > 0, iid, app, "library-catalog", "http=%s lost=%s" % ((a.get("catalog") or {}).get("http"), short(bc - ac)))
    bad = [n for n, x in (a.get("browse") or {}).items() if x.get("http") != 200]
    ok(not bad and a.get("browse"), iid, app, "browse-books", short(bad) or "no books browsed")

bi, ai = load(B), load(A)
for iid in sorted(set(bi) | set(ai)):
    b, a = bi.get(iid), ai.get(iid)
    if not a:
        out("FAIL", iid, (b or {}).get("app", "?"), "instance-present", "missing in AFTER"); continue
    if not b:
        out("INFO", iid, a.get("app"), "instance-new", "only in AFTER"); continue
    {"nextcloud": nextcloud, "kolibri": kolibri, "kiwix": kiwix}[a["app"]](iid, b, a)
for hd in HOPS:
    p = os.path.join(hd, "hop.json")
    if not os.path.isfile(p):
        out("FAIL", "-", "hop", os.path.basename(hd.rstrip("/")), "no hop.json (assert not run?)"); continue
    with open(p) as f:
        h = json.load(f)
    for lvl, chk, det in h.get("checks", []):
        out(lvl, h.get("id", "?"), "hop-" + h.get("label", "?"), chk, det)
print("RESULT %s (%d FAIL)" % ("FAIL" if fails else "PASS", fails))
sys.exit(1 if fails else 0)
PY
