#!/usr/bin/env python3
"""Mock HTTP for the dry run: Nextcloud, Kolibri, Kiwix endpoints on three local ports. No containers."""
import base64, json, os, sys, threading, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FX = os.environ["FX"]
def state():
    return json.load(open(os.path.join(FX, "state.json")))
PW = {"admin": "admin911!", "teacher1": "teacher1911!", "learner1": "learner1911!"}

class NC(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def user(self):
        h = self.headers.get("Authorization", "")
        if not h.startswith("Basic "):
            return None
        u, _, p = base64.b64decode(h[6:]).decode().partition(":")
        return u if PW.get(u) == p else None
    def send(self, code, body=b"", ctype="text/plain"):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_PROPFIND(self):
        u = self.user()
        self.send(207 if u and self.path.startswith("/remote.php/dav/files/%s/" % u) else 401)
    def do_GET(self):
        s = state(); p = urllib.parse.urlsplit(self.path).path
        if p == "/status.php":
            return self.send(200, json.dumps(s["status"]).encode(), "application/json")
        if p == "/login":
            return self.send(200)
        u = self.user()
        if p.startswith("/remote.php/dav/files/"):
            rest = urllib.parse.unquote(p[len("/remote.php/dav/files/"):])
            uid, _, rel = rest.partition("/")
            if not u or u != uid:
                return self.send(401)
            mp, _, sub = rel.partition("/")
            path = os.path.join(FX, "ext", mp, sub) if mp in os.listdir(os.path.join(FX, "ext")) and uid == "admin" else os.path.join(FX, "ncdata", uid, "files", rel)
            if not os.path.isfile(path):
                return self.send(404)
            return self.send(200, open(path, "rb").read(), "application/octet-stream")
        if p in ("/index.php/apps/files/", "/ocs/v2.php/cloud/capabilities"):
            return self.send(200 if u else 401)
        self.send(404)

class KO(NC):
    def do_GET(self):
        s = state(); p = urllib.parse.urlsplit(self.path).path
        if p == "/api/public/info/":
            return self.send(200, json.dumps({"application": "kolibri", "kolibri_version": s["kolibriVersion"]}).encode(), "application/json")
        if p == "/api/public/v1/facility/":
            return self.send(200, json.dumps([{"id": s["facility"], "name": "Fx School"}]).encode(), "application/json")
        if p == "/":
            return self.send(200, b"<html>kolibri</html>")
        self.send(404)

class KW(NC):
    def do_GET(self):
        p = urllib.parse.urlsplit(self.path).path
        zims = sorted(n for n in os.listdir(os.path.join(FX, "instances", "kiwix-fx", "data")) if n.endswith(".zim"))
        if p == "/":
            return self.send(200, b"<html>library</html>")
        if p == "/catalog/v2/entries":
            ent = "".join('<entry><id>urn:uuid:%d</id><title>%s</title><name>%s</name><link rel="alternate" type="text/html" href="/content/%s"/></entry>' % (i, z, z[:-4], z[:-4]) for i, z in enumerate(zims))
            return self.send(200, ("<feed>%s</feed>" % ent).encode(), "application/atom+xml")
        if p.startswith("/content/") and p[9:] + ".zim" in zims:
            return self.send(200, b"<html>main page</html>")
        self.send(404)

ports = json.load(open(os.path.join(FX, "state.json")))["ports"]
for cls, port in ((NC, ports["nc"]), (KO, ports["kol"]), (KW, ports["kiwix"])):
    srv = ThreadingHTTPServer(("127.0.0.1", port), cls)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
print("mock up", ports, flush=True)
threading.Event().wait()
