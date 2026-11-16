#!/usr/bin/env bash
# Dry run of kit374-inventory.sh + compare.sh against a fake kit-replica tree on the box.
# No containers, no Pi: a fake `docker` (test/fake-docker.py) and a local mock HTTP server.
# Usage: test/dry-run.sh   (exit 0 = all assertions passed)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
CHK=$(cd "$HERE/.." && pwd)
FX=$(mktemp -d "${TMPDIR:-/tmp}/kit374-fx.XXXXXX")
export FX
python3 "$HERE/make-fixture.py" "$FX" >/dev/null
python3 "$HERE/mock-http.py" > "$FX/mock.log" 2>&1 &
MOCK=$!
trap 'kill "$MOCK" 2>/dev/null || true' EXIT
for _ in $(seq 50); do grep -q 'mock up' "$FX/mock.log" && break; sleep 0.1; done
export DOCKER="$HERE/fake-docker.py" IDEA_ROOT="$FX"
fail=0
check() { if "${@:1:$#-1}"; then echo "ok   - ${*: -1}"; else echo "FAIL - ${*: -1}"; fail=1; fi; }
has() { grep -Eq -- "$1" "$2"; }

# 1. before, via the one-line `bash -s` path Atlas uses
bash -s -- "$FX/out/before" < "$CHK/kit374-inventory.sh" > "$FX/before.txt"
check has '^nc-fx +nextcloud .*errors=0' "$FX/before.txt" "nc inventory without errors"
check has '^kol-fx +kolibri .*errors=0' "$FX/before.txt" "kolibri inventory without errors"
check has '^kiwix-fx +kiwix .*errors=0' "$FX/before.txt" "kiwix inventory without errors"
check test ! -e "$FX/out/before/other-fx" "non-IDEA x-app name skipped"
check test ! -e "$FX/out/before/handsoff-fx" "hands-off port 18080 refused"
check has 'Grade 5A Files/Class Materials/worksheet.md' "$FX/out/before/nc-fx/files.sha256" "Files Disk file hashed"
if grep -Eq 'cache/|appdata_|nextcloud.log|idea-files.json' "$FX/out/before/nc-fx/files.sha256"; then check false "caches/appdata excluded"; else check true "caches/appdata excluded"; fi
check python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); w=s["webdav"]; sys.exit(not (w["checked"]==6 and w["match"]==6))' "$FX/out/before/nc-fx/summary.json" "webdav GET sha256 matches all 6 files"
check python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); sys.exit(not all(v["davPropfind"]==207 for v in s["logins"].values()) or len(s["logins"])!=3)' "$FX/out/before/nc-fx/summary.json" "3 role logins 207"
check python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); sys.exit(len(s["seeded"]["found"])!=1)' "$FX/out/before/nc-fx/summary.json" "seeded demo file found"
if grep -rq -e 'secret-db-pass' -e 'admin911' -e 'never-copied' "$FX/out/before"; then check false "no secrets in output"; else check true "no secrets in output"; fi
if grep -q '"exec", *"-u", *"33", *"nc-fx-nextcloud-app-1", *"php", *"/var/www/html/occ", *"--no-interaction", *"--no-ansi", *"\(user:add\|maintenance:mode\|files:scan\)' "$FX/docker-calls.log"; then check false "only read-only occ"; else check true "only read-only occ"; fi
check python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); c=s["contentFiles"]; sys.exit(not (c["available"]==2 and not c["missing"] and not c["md5Mismatch"]))' "$FX/out/before/kol-fx/summary.json" "kolibri content present + md5"
if grep -q handsoff "$FX/docker-calls.log"; then check false "no docker call for hands-off id"; else check true "no docker call for hands-off id"; fi

# 2. unchanged after -> PASS
bash "$CHK/kit374-inventory.sh" "$FX/out/after-same" > /dev/null
"$CHK/compare.sh" "$FX/out/before" "$FX/out/after-same" > "$FX/cmp-same.txt" || true
check has '^RESULT PASS' "$FX/cmp-same.txt" "unchanged replica compares PASS"

# 3. simulated upgrade with damage -> exact FAILs
python3 - <<'PY'
import json, os, sqlite3
FX = os.environ["FX"]
s = json.load(open(FX + "/state.json"))
s["status"]["version"] = s["occ"]["status"]["version"] = "31.0.14.1"; s["status"]["versionstring"] = s["occ"]["status"]["versionstring"] = "31.0.14"
s["occ"]["files_external:list"][0]["options"]["enable_sharing"] = False
s["tables"].append("oc_idea_usage_daily")
s["kolibriVersion"] = "0.19.5"
json.dump(s, open(FX + "/state.json", "w"))
open(FX + "/ncdata/teacher1/files/Notes/lesson plan.md", "w").write("changed\n")
c = sqlite3.connect(FX + "/instances/kol-fx/data/kolibri/db.sqlite3")
c.execute("delete from logger_contentsummarylog where id='s2'"); c.execute("insert into logger_usersessionlog values('us2','u2')"); c.commit()
os.rename(FX + "/instances/kiwix-fx/data/simple.zim", FX + "/instances/kiwix-fx/data/simple.zim.moved")
PY
bash "$CHK/kit374-inventory.sh" "$FX/out/after-bad" > /dev/null
EXPECT_NC_VERSION_PREFIX=31.0.14 EXPECT_KOLIBRI_VERSION_PREFIX=0.19.5 "$CHK/compare.sh" "$FX/out/before" "$FX/out/after-bad" > "$FX/cmp-bad.txt" || true
check has '^RESULT FAIL' "$FX/cmp-bad.txt" "damaged replica compares FAIL"
check has '^FAIL nc-fx nextcloud files-sha256: .*Notes/lesson plan.md' "$FX/cmp-bad.txt" "changed file caught"
check has '^FAIL nc-fx nextcloud files-disk-mounts' "$FX/cmp-bad.txt" "mount option change caught"
check has '^FAIL nc-fx nextcloud files-disk-enable_sharing' "$FX/cmp-bad.txt" "enable_sharing false caught"
check has '^PASS nc-fx nextcloud webdav-get-sha256' "$FX/cmp-bad.txt" "webdav GET matches the after list"
check has '^PASS nc-fx nextcloud nextcloud-version' "$FX/cmp-bad.txt" "NC version expectation PASS"
check has '^INFO nc-fx nextcloud schema-tables-new: oc_idea_usage_daily' "$FX/cmp-bad.txt" "new table reported INFO"
check has '^FAIL kol-fx kolibri progress-per-user' "$FX/cmp-bad.txt" "lost progress caught"
check has '^FAIL kol-fx kolibri progress-digest' "$FX/cmp-bad.txt" "progress digest caught"
check has '^FAIL kol-fx kolibri logger\+auth-counts: logger_contentsummarylog 2->1' "$FX/cmp-bad.txt" "summarylog count caught"
if grep -q 'logger_usersessionlog' "$FX/cmp-bad.txt"; then check false "usersessionlog growth allowed"; else check true "usersessionlog growth allowed"; fi
check has '^PASS kol-fx kolibri kolibri-version' "$FX/cmp-bad.txt" "Kolibri version expectation PASS"
check has '^FAIL kiwix-fx kiwix zims-identical: gone=simple.zim' "$FX/cmp-bad.txt" "missing ZIM caught"
check has '^PASS kol-fx kolibri MORANGO_SYSTEM_ID' "$FX/cmp-bad.txt" "kit id unchanged PASS"

echo "--- compare output (damaged) ---"; cat "$FX/cmp-bad.txt"
echo "fixture: $FX"
if [ "$fail" = 0 ]; then echo "DRY RUN PASS"; else echo "DRY RUN FAIL"; exit 1; fi
