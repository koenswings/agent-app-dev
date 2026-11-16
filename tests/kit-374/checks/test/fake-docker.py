#!/usr/bin/env python3
"""Fake `docker` for the dry run: answers only the read-only calls kit374-inventory.sh makes.
State comes from $FX (fixture root) and $FX/state.json. Records every call in $FX/docker-calls.log."""
import json, os, subprocess, sys

FX = os.environ["FX"]
st = json.load(open(os.path.join(FX, "state.json")))
args = sys.argv[1:]
with open(os.path.join(FX, "docker-calls.log"), "a") as f:
    f.write(json.dumps(args) + "\n")

PROJECTS = {
    "nc-fx": ["nc-fx-nextcloud-app-1", "nc-fx-nextcloud-db-1", "nc-fx-code-1"],
    "kol-fx": ["kol-fx-kolibri-1"],
    "kiwix-fx": ["kiwix-fx-kiwix-1", "kiwix-fx-proxy-1"],
    "handsoff-fx": ["handsoff-fx-nextcloud-app-1"],
}
def container(name):
    proj = next(p for p, ns in PROJECTS.items() if name in ns)
    service = name[len(proj) + 1:-2]
    env = []
    if service == "kolibri":
        env = ["KOLIBRI_HTTP_PORT=%s" % st["ports"]["kol"], "MORANGO_SYSTEM_ID=idea-fx-%s" % st["ports"]["kol"]]
    image = st["images"].get(service, "busybox:latest")
    return {"Name": "/" + name, "Image": "sha256:" + str(abs(hash(image)))[:12], "Config": {"Image": image, "Env": env,
            "Labels": {"com.docker.compose.project": proj, "com.docker.compose.service": service, "x-app-version": st.get("appVersion", {}).get(proj, "")}},
            "State": {"Status": "running", "Health": {"Status": "healthy"}}, "HostConfig": {"NetworkMode": "default"}, "NetworkSettings": {"Ports": {}}}

if args[:1] == ["info"]:
    print(os.path.join(FX, "dockerroot"))
elif args[:1] == ["ps"]:
    proj = next(a.split("=", 2)[2] for a in args if a.startswith("label=com.docker.compose.project="))
    print("\n".join(PROJECTS.get(proj, [])))
elif args[:2] == ["image", "inspect"]:
    print('["fake/repo@sha256:%s"]' % ("0" * 64))
elif args[:1] == ["inspect"]:
    print(json.dumps([container(n) for n in args[1:]]))
elif args[:1] == ["exec"]:
    a = args[1:]
    if a[0] == "-u":
        a = a[2:]
    name, cmd = a[0], a[1:]
    if cmd[:2] == ["php", "/var/www/html/occ"]:
        occ = [c for c in cmd[2:] if not c.startswith("--no-")]
        key = occ[0]
        if key == "config:system:get":
            print("/var/www/html/data"); sys.exit(0)
        out = st["occ"].get(key)
        if out is None:
            print("unknown occ " + key, file=sys.stderr); sys.exit(1)
        print(json.dumps(out)); sys.exit(0)
    if cmd[:2] == ["sh", "-c"] and "mariadb" in cmd[2]:
        sql = cmd[3]
        if "VERSION()" in sql:
            print(st["mariadb"])
        elif "information_schema" in sql:
            print("\n".join(st["tables"]))
        elif "oc_share" in sql:
            print("\n".join("\t".join(map(str, s)) for s in st["shares"]))
        sys.exit(0)
    if cmd[:2] == ["sh", "-c"]:
        mapped = [FX + "/ncdata" if x == "/var/www/html/data" else (FX + "/ext" + x[len("/mnt/idea-files"):] if x.startswith("/mnt/idea-files") else x) for x in cmd[3:]]
        sys.exit(subprocess.run(["sh", "-c", cmd[2]] + mapped).returncode)
    print("fake docker: refused exec %r" % cmd, file=sys.stderr); sys.exit(1)
else:
    print("fake docker: refused %r" % args, file=sys.stderr); sys.exit(1)
