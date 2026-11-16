#!/usr/bin/env python3
"""Build a tiny fake kit-replica root for the dry run: /instances layout, NC data tree,
Files Disk mount, Kolibri sqlite + content storage, Kiwix ZIMs. Usage: make-fixture.py FX"""
import hashlib, json, os, socket, sqlite3, sys

FX = sys.argv[1]
def w(path, data, mode="w"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, mode) as f:
        f.write(data)
def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p
ports = {"nc": free_port(), "kol": free_port(), "kiwix": free_port()}

def compose(name, ver):
    return "x-app:\n  name: %s\n  title: %s\n  version: %s\nservices:\n  x:\n    image: x\n" % (name, name.title(), ver)
I = os.path.join(FX, "instances")
w(I + "/nc-fx/compose.yaml", compose("nextcloud", "b8ad4382b5f77c1de84cdf05ae822d4041b02b3c"))
w(I + "/nc-fx/.env", "port=%d\npass=secret-db-pass\nhostname=fx\n" % ports["nc"])
w(I + "/nc-fx/demo/content/Class/Welcome to Grade 5A.md", "# Welcome\n")
w(I + "/nc-fx/demo/content/Worksheets/Fractions practice.md", "1/2 + 1/4\n")
w(I + "/kol-fx/compose.yaml", compose("kolibri", "2cab08c"))
w(I + "/kol-fx/.env", "port=9999\nhostname=fx\n")
w(I + "/kiwix-fx/compose.yaml", compose("kiwix", "release-1.0"))
w(I + "/kiwix-fx/.env", "port=%d\n" % ports["kiwix"])
w(I + "/handsoff-fx/compose.yaml", compose("nextcloud", "x"))
w(I + "/handsoff-fx/.env", "port=18080\n")
w(I + "/other-fx/compose.yaml", compose("milkwise", "1.0"))
# Nextcloud data dir (as /var/www/html/data) and a Files Disk mount (as /mnt/idea-files/Grade 5A Files)
D = os.path.join(FX, "ncdata")
w(D + "/teacher1/files/Class/Welcome to Grade 5A.md", "# Welcome\n")
w(D + "/teacher1/files/Notes/lesson plan.md", "plan\n")
w(D + "/teacher1/files/odd name ü & #1.txt", "unicode\n")
w(D + "/learner1/files/My reading log.md", "log\n")
w(D + "/admin/files/readme.txt", "admin\n")
w(D + "/teacher1/cache/x.tmp", "cache\n")
w(D + "/appdata_oc123/preview/1.png", "png\n")
w(D + "/nextcloud.log", "log\n")
w(FX + "/ext/Grade 5A Files/Class Materials/worksheet.md", "ws\n")
w(FX + "/ext/Grade 5A Files/.idea-files.json", "{}\n")
# Kolibri
K = I + "/kol-fx/data/kolibri"
os.makedirs(K, exist_ok=True)
c = sqlite3.connect(K + "/db.sqlite3")
c.executescript("""
create table morango_instanceidmodel(id, current, system_id, node_id, counter, database_id);
create table morango_databaseidmodel(id, current);
create table kolibriauth_collection(id, kind, name, parent_id, dataset_id);
create table kolibriauth_facilityuser(id, username, facility_id, full_name);
create table kolibriauth_membership(id, collection_id, user_id);
create table kolibriauth_role(id, user_id, collection_id, kind);
create table logger_contentsummarylog(id, user_id, content_id, progress);
create table logger_attemptlog(id, user_id);
create table logger_contentsessionlog(id, user_id);
create table logger_usersessionlog(id, user_id);
create table lessons_lesson(id, title, collection_id, is_active);
create table exams_exam(id, title, collection_id, active);
create table content_channelmetadata(id, name, version, root_id);
create table content_contentnode(id, channel_id, available);
create table content_localfile(id, extension, file_size, available);
insert into morango_instanceidmodel values('inst1',1,'sys1','node1',0,'db1');
insert into morango_databaseidmodel values('db1',1);
insert into kolibriauth_collection values('fac1','facility','Fx School',null,'ds1'),('cls1','classroom','Grade 5','fac1','ds1');
insert into kolibriauth_facilityuser values('u1','admin','fac1',''),('u2','teacher1','fac1',''),('u3','learner1','fac1','');
insert into kolibriauth_membership values('m1','cls1','u3'),('m2','cls1','u2');
insert into kolibriauth_role values('r1','u1','fac1','admin'),('r2','u2','cls1','coach');
insert into logger_contentsummarylog values('s1','u3','c1',1.0),('s2','u3','c2',0.5);
insert into logger_contentsessionlog values('x1','u3'),('x2','u3');
insert into logger_usersessionlog values('us1','u3');
insert into content_channelmetadata values('ch1','Maths',2,'root1');
insert into content_contentnode values('n1','ch1',1),('n2','ch1',1),('n3','ch1',0);
""")
for body, ext in ((b"pdf-bytes", "pdf"), (b"zip-bytes", "zip")):
    md = hashlib.md5(body).hexdigest()
    w("%s/content/storage/%s/%s/%s.%s" % (K, md[0], md[1], md, ext), body, "wb")
    c.execute("insert into content_localfile values(?,?,?,1)", (md, ext, len(body)))
c.commit(); c.close()
w(K + "/.data_version", "0.15.5\n")
# Kiwix
Z = I + "/kiwix-fx/data"
for n, body in (("small.zim", b"Z" * 1000), ("simple.zim", b"S" * 3000)):
    w(Z + "/" + n, body, "wb")
    w(Z + "/" + n + ".sha256", hashlib.sha256(body).hexdigest() + "  " + n + "\n")
state = {
    "ports": ports, "kolibriVersion": "0.15.5", "facility": "fac1", "mariadb": "11.7.2-MariaDB-ubu2404",
    "images": {"nextcloud-app": "koenswings/nextcloud:1.0-31.0.1", "nextcloud-db": "koenswings/nextcloud-mariadb:1.0-11.7.2-MariaDB-ubu2404", "code": "koenswings/nextcloud-code:1.0-24.04.13.2", "kolibri": "koenswings/kolibri:1.0-0.15.5-dev", "kiwix": "ghcr.io/kiwix/kiwix-serve:3.8.2"},
    "status": {"installed": True, "maintenance": False, "needsDbUpgrade": False, "version": "31.0.1.2", "versionstring": "31.0.1"},
    "occ": {
        "status": {"installed": True, "version": "31.0.1.2", "versionstring": "31.0.1", "edition": "", "maintenance": False, "needsDbUpgrade": False},
        "user:list": {"admin": "admin", "teacher1": "teacher1", "learner1": "learner1"},
        "group:list": {"admin": ["admin"], "teachers": ["teacher1"], "learners": ["learner1"]},
        "app:list": {"enabled": {"files": "2.3.1", "files_external": "1.23.0", "richdocuments": "8.8.3"}, "disabled": {"firstrunwizard": "4.0.0"}},
        "files_external:list": [{"mount_id": 1, "mount_point": "/Grade 5A Files", "storage": "\\OC\\Files\\Storage\\Local", "authentication_type": "null::null",
                                  "configuration": {"datadir": "/mnt/idea-files/Grade 5A Files", "secret": "never-copied"}, "options": {"enable_sharing": True, "idea_files": "1"},
                                  "applicable_users": ["admin"], "applicable_groups": ["teachers"], "type": "Admin"}],
    },
    "tables": ["oc_users", "oc_share", "oc_filecache"],
    "shares": [[1, "teachers", "teacher1", "teacher1", "folder", "/Class Materials", 31]],
}
json.dump(state, open(FX + "/state.json", "w"), indent=1)
print(FX)
