# -*- coding: utf-8 -*-
from __future__ import print_function
import json, os, sys
from kolibri.core.auth.models import Facility, FacilityUser, Classroom, Role, Membership
from kolibri.core.auth.constants.role_kinds import COACH
from kolibri.core.content.models import ContentNode
from kolibri.core.lessons.models import Lesson, LessonAssignment

PACK = os.environ.get("PACK", "form3").lower()
PACKS = {
    "form3": {
        "class_name": "Form 3",
        "lesson_title": "Form 3 Duration Lesson",
        "channel_id": "c9d7f950ab6b5a1199e3d6c10d7f0103",
        "videos": [
            ("video-form3-01", "b3677df2bf9e5e5fa1f19e57a2f26b97", "0a2fdaad532c56b2b90f62f9204e3be8"),
            ("video-form3-02", "fcba0a76d6075c02b1f9f7742847a4c4", "30fb3fbd9d4a549f8643f610a165df5a"),
            ("video-form3-03", "7f1b54804b2e5d81b7670d383cf341a8", "3ddc455aeaab51c08e8b9484bf9a1830"),
        ],
        "exercises": [
            ("exercise-form3-01", "a484d2921dd35f428d087b61a8e82416", "ed0c23b8e517568790ae1bda74ab22ba"),
            ("exercise-form3-02", "d455f572cc3355b08c982a997d412aa8", "0c49599e01315fdb957a5bbbbdf58c5e"),
            ("exercise-form3-03", "8c88069407945913918b90523c2ac8ca", "7110cacbb8d658b0b799a3d0418e40a9"),
        ],
        "open_video": "video-form3-01",
        "open_exercise": "exercise-form3-01",
    },
    "g5a": {
        "class_name": "Grade 5A",
        "lesson_title": "Grade 5A Duration Lesson",
        "channel_id": "c9d7f950ab6b5a1199e3d6c10d7f0103",
        "videos": [
            ("video-grade5a-khan-01", "ef35763056fe5113946710a750e4e75c", "757e1a6e9ea15168b99a0bf7eeb30662"),
            ("video-grade5a-khan-02", "43d4efc489e150b19a3b7a7460e30fd9", "fc6dd800d7015d4283a01fd9079bf5ce"),
            ("video-grade5a-khan-03", "cbb99d491f405719b44f1e6d12380c3f", "6dda429c39805a819efbbdc9322662b0"),
        ],
        "exercises": [
            ("exercise-grade5a-khan-01", "0ed1af8fbbe758bbb743168938dc8a38", "2f9204d3af3758b98fa0fd86a0c03c5d"),
            ("exercise-grade5a-khan-02", "1d4c27c6d3bd59e0bd87fdb59eb68a2b", "94ab05b5f3ff506ab18de630ac9cb0cb"),
            ("exercise-grade5a-khan-03", "23e0467261d65705bd6de61adb6dbbec", "c306ffe269f352fa8417deba6f616504"),
        ],
        "open_video": "video-grade5a-khan-01",
        "open_exercise": "exercise-grade5a-khan-01",
    },
}
cfg = PACKS[PACK]
CHANNEL = cfg["channel_id"]

def dash(h):
    h = (h or "").replace("-", "")
    if len(h) != 32:
        return h
    return "%s-%s-%s-%s-%s" % (h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])

facility = Facility.objects.get(name="Duration Tests Facility")
teacher = FacilityUser.objects.get(username="teacher", facility=facility)
classroom, created = Classroom.objects.get_or_create(name=cfg["class_name"], parent=facility)
print("classroom", classroom.id, "created", created)
if not teacher.roles.filter(collection=classroom, kind=COACH).exists():
    Role.objects.create(user=teacher, collection=classroom, kind=COACH)

learners = []
for uname, dname in [("learner01", "Learner One"), ("learner02", "Learner Two"), ("learner03", "Learner Three")]:
    u, c = FacilityUser.objects.get_or_create(username=uname, facility=facility, defaults={"full_name": dname})
    if c:
        u.set_password(uname)
        u.save()
    Membership.objects.get_or_create(user=u, collection=classroom)
    learners.append({"username": u.username, "id": dash(u.id), "id_raw": u.id, "created": c})

leaf_status = []
id_by_logical = {}
for logical, node_raw, content_raw in cfg["videos"] + cfg["exercises"]:
    try:
        node = ContentNode.objects.get(id=node_raw)
    except ContentNode.DoesNotExist:
        leaf_status.append({"logicalId": logical, "nodeIdRaw": node_raw, "status": "MISSING"})
        continue
    nid = str(node.id).replace("-", "")
    cid = str(node.content_id).replace("-", "")
    leaf_status.append({
        "logicalId": logical,
        "nodeId": dash(nid),
        "nodeIdRaw": nid,
        "contentId": dash(cid),
        "contentIdRaw": cid,
        "kind": node.kind,
        "title": node.title,
        "available": bool(node.available),
        "status": "OK" if node.available else "PRESENT_UNAVAILABLE",
    })
    id_by_logical[logical] = (nid, cid)

resources = []
for logical in (cfg["open_video"], cfg["open_exercise"]):
    if logical not in id_by_logical:
        print("FATAL missing leaf for lesson:", logical)
        sys.exit(1)
    node_raw, content_raw = id_by_logical[logical]
    resources.append({"contentnode_id": node_raw, "content_id": content_raw, "channel_id": CHANNEL})

lesson, created = Lesson.objects.get_or_create(
    title=cfg["lesson_title"],
    collection=classroom,
    defaults={"created_by": teacher, "resources": resources, "is_active": True},
)
if not created:
    lesson.resources = resources
    lesson.is_active = True
    lesson.created_by = teacher
    lesson.save()
LessonAssignment.objects.get_or_create(lesson=lesson, collection=classroom, defaults={"assigned_by": teacher})

open_video_nodes = []
open_exercise_nodes = []
for _logical, _bucket in [(cfg["open_video"], open_video_nodes), (cfg["open_exercise"], open_exercise_nodes)]:
    _nr, _cr = id_by_logical[_logical]
    _nodes = list(ContentNode.objects.filter(content_id=_cr))
    if not _nodes:
        _nodes = list(ContentNode.objects.filter(content_id=dash(_cr)))
    for n in _nodes:
        _bucket.append({"id": n.id, "content_id": n.content_id, "kind": n.kind, "title": n.title, "available": n.available})

out = {
    "pack": PACK,
    "facility_id": dash(facility.id),
    "facility_id_raw": facility.id,
    "classroom_id": dash(classroom.id),
    "classroom_id_raw": classroom.id,
    "teacher_id": dash(teacher.id),
    "teacher_id_raw": teacher.id,
    "lesson_id": dash(lesson.id),
    "lesson_id_raw": lesson.id,
    "learners": learners,
    "leaves": leaf_status,
    "open_video_nodes": open_video_nodes,
    "open_exercise_nodes": open_exercise_nodes,
    "channel_id": dash(CHANNEL),
    "channel_id_raw": CHANNEL,
}
print("LIVE_IDS_JSON=" + json.dumps(out))
