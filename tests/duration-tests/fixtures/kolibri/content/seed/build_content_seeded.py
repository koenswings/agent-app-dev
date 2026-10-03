#!/usr/bin/env python3
"""
Build CONTENT.seeded.json for the duration-tests Kolibri Grade 5A pack (idea#166).

Offline / box-local: derives stable ricecooker content/node IDs from fixed
source_ids + places the video stub under content/storage/<md5[0]>/<md5[1]>/<md5>.mp4.
Does NOT require a running Kolibri or Studio token.

Live import (later, free Pi): see seed-notes.md / apply-live.sh — import this
channel (or map live UUIDs) then re-run with --from-live if adapters need the
post-import facility/class/lesson row IDs.

Usage (from repo root or this directory):
  python3 tests/duration-tests/fixtures/kolibri/content/seed/build_content_seeded.py

Optional deps: ricecooker + le-utils (for ID derivation matching Studio/Kolibri).
Falls back to uuid5(NAMESPACE_URL, source_domain+source_id) if ricecooker missing.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

CONTENT_DIR = Path(__file__).resolve().parents[1]
MEDIA = CONTENT_DIR / "media" / "video-grade5a-01.mp4"
OUT = CONTENT_DIR / "CONTENT.seeded.json"
STORAGE_ROOT = CONTENT_DIR / "storage"

SOURCE_DOMAIN = "idea.koenswings.local"
CHANNEL_SOURCE_ID = "duration-kolibri-grade5a"
TOPIC_SOURCE_ID = "topic-grade5a"
VIDEO_SOURCE_ID = "video-grade5a-01"
EXERCISE_SOURCE_ID = "exercise-grade5a-01"

# Facility / class / users / lesson are App-logical; pin via uuid5 so Pixel can
# code against stable placeholders until live provision rewrites them.
FACILITY_NS = uuid.uuid5(uuid.NAMESPACE_URL, "https://idea.local/duration-tests/kolibri-grade5a")


def logical_uuid(logical_id: str) -> str:
    return str(uuid.uuid5(FACILITY_NS, logical_id))


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def derive_ids_with_ricecooker(video_path: Path) -> dict:
    from ricecooker.classes.files import VideoFile
    from ricecooker.classes.nodes import ChannelNode, ExerciseNode, TopicNode, VideoNode
    from ricecooker.classes.questions import SingleSelectQuestion
    from le_utils.constants import licenses

    # Keep ricecooker storage under seed/.work so it never dirties repo root.
    import os
    import ricecooker.config as rc_config

    work = Path(__file__).resolve().parent / ".work"
    work.mkdir(parents=True, exist_ok=True)
    storage = work / "storage"
    storage.mkdir(parents=True, exist_ok=True)
    # ricecooker writes into config.STORAGE_DIRECTORY (cwd-relative by default)
    rc_config.STORAGE_DIRECTORY = str(storage)
    if hasattr(rc_config, "SUSHI_BAR_HTTP"):
        pass
    prev_cwd = Path.cwd()
    try:
        os.chdir(work)
        channel = ChannelNode(
            source_id=CHANNEL_SOURCE_ID,
            source_domain=SOURCE_DOMAIN,
            title="Duration Tests — Kolibri Grade 5A",
            description="Minimal channel for idea#166 open_video / open_exercise",
        )
        topic = TopicNode(source_id=TOPIC_SOURCE_ID, title="Grade 5A Duration")
        channel.add_child(topic)

        video = VideoNode(
            source_id=VIDEO_SOURCE_ID,
            title="Open video target",
            license=licenses.CC_BY,
            description="Duration-tests open_video Intent target",
        )
        video.add_file(VideoFile(str(video_path)))
        topic.add_child(video)

        exercise = ExerciseNode(
            source_id=EXERCISE_SOURCE_ID,
            title="Open exercise target",
            license=licenses.CC_BY,
            description="Duration-tests open_exercise Intent target",
            exercise_data={"mastery_model": "m_of_n", "m": 1, "n": 1},
            questions=[
                SingleSelectQuestion(
                    id="q1",
                    question="What is 2 + 2?",
                    correct_answer="4",
                    all_answers=["3", "4", "5"],
                    hints=["Count on your fingers"],
                )
            ],
        )
        topic.add_child(exercise)

        return {
            "channelId": str(channel.get_content_id()),
            "topic": {
                "contentId": str(topic.get_content_id()),
                "nodeId": str(topic.get_node_id()),
            },
            "video": {
                "contentId": str(video.get_content_id()),
                "nodeId": str(video.get_node_id()),
                "checksum": video.files[0].checksum,
            },
            "exercise": {
                "contentId": str(exercise.get_content_id()),
                "nodeId": str(exercise.get_node_id()),
            },
            "idSource": "ricecooker",
        }
    finally:
        os.chdir(prev_cwd)


def derive_ids_fallback(video_md5: str) -> dict:
    """uuid5 fallback matching LE-style domain+source_id hashing when ricecooker absent."""

    def cid(source_id: str) -> str:
        return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{SOURCE_DOMAIN}/{source_id}"))

    channel_id = cid(CHANNEL_SOURCE_ID)
    topic_cid = cid(TOPIC_SOURCE_ID)
    topic_nid = str(uuid.uuid5(uuid.UUID(channel_id), topic_cid))
    video_cid = cid(VIDEO_SOURCE_ID)
    video_nid = str(uuid.uuid5(uuid.UUID(topic_nid), video_cid))
    exercise_cid = cid(EXERCISE_SOURCE_ID)
    exercise_nid = str(uuid.uuid5(uuid.UUID(topic_nid), exercise_cid))
    return {
        "channelId": channel_id,
        "topic": {"contentId": topic_cid, "nodeId": topic_nid},
        "video": {"contentId": video_cid, "nodeId": video_nid, "checksum": video_md5},
        "exercise": {"contentId": exercise_cid, "nodeId": exercise_nid},
        "idSource": "uuid5-fallback",
    }


def ensure_storage_copy(video_path: Path, md5: str) -> str:
    dest = STORAGE_ROOT / md5[0] / md5[1] / f"{md5}.mp4"
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists() or dest.stat().st_size != video_path.stat().st_size:
        shutil.copy2(video_path, dest)
    return f"content/storage/{md5[0]}/{md5[1]}/{md5}.mp4"


def build() -> dict:
    if not MEDIA.is_file():
        raise SystemExit(f"missing media stub: {MEDIA}")

    video_md5 = md5_file(MEDIA)
    storage_path = ensure_storage_copy(MEDIA, video_md5)

    try:
        ids = derive_ids_with_ricecooker(MEDIA)
        # Prefer file md5 for storage path; ricecooker checksum should match.
        if ids["video"].get("checksum") and ids["video"]["checksum"] != video_md5:
            print(
                f"WARNING: ricecooker checksum {ids['video']['checksum']} != file md5 {video_md5}",
                file=sys.stderr,
            )
        ids["video"]["checksum"] = video_md5
    except Exception as exc:  # noqa: BLE001 — offline fallback is intentional
        print(f"ricecooker unavailable ({exc!r}); using uuid5 fallback", file=sys.stderr)
        ids = derive_ids_fallback(video_md5)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    seeded = {
        "pack": "duration-kolibri-grade5a",
        "version": "1.0",
        "diskId": "duration-kolibri-grade5a-001",
        "instanceId": "kolibri-grade5a-001",
        "instanceName": "kolibri",
        "generatedAt": now,
        "generator": "content/seed/build_content_seeded.py",
        "idSource": ids["idSource"],
        "seedStatus": "ids_pinned_box_local",
        "liveImportStatus": "pending",
        "note": (
            "Stable content/node IDs for open_video / open_exercise. "
            "Facility/class/learner/lesson UUIDs are uuid5 placeholders until "
            "apply-live.sh provisions a Running instance. Video blob is the "
            "3s stub under content/media/ (Kolibri storage layout mirrored)."
        ),
        "channel": {
            "sourceDomain": SOURCE_DOMAIN,
            "sourceId": CHANNEL_SOURCE_ID,
            "channelId": ids["channelId"],
            "title": "Duration Tests — Kolibri Grade 5A",
            "topic": {
                "sourceId": TOPIC_SOURCE_ID,
                "title": "Grade 5A Duration",
                **ids["topic"],
            },
        },
        "facility": {
            "logicalId": "facility-duration-grade5a",
            "name": "Duration Tests Facility",
            "id": logical_uuid("facility-duration-grade5a"),
            "liveStatus": "placeholder_until_provision",
        },
        "class": {
            "logicalId": "class-grade5a",
            "name": "Grade 5A",
            "id": logical_uuid("class-grade5a"),
            "liveStatus": "placeholder_until_provision",
        },
        "coach": {
            "logicalId": "coach-grade5a",
            "username": "teacher",
            "displayName": "Grade 5A Teacher",
            "id": logical_uuid("coach-grade5a"),
            "liveStatus": "placeholder_until_provision",
        },
        "learners": [
            {
                "logicalId": f"learner-grade5a-0{i}",
                "username": f"learner0{i}",
                "displayName": f"Learner {['One','Two','Three'][i-1]}",
                "id": logical_uuid(f"learner-grade5a-0{i}"),
                "liveStatus": "placeholder_until_provision",
            }
            for i in (1, 2, 3)
        ],
        "lesson": {
            "logicalId": "lesson-grade5a-video-exercise",
            "title": "Grade 5A Duration Lesson",
            "id": logical_uuid("lesson-grade5a-video-exercise"),
            "resourceLogicalIds": ["video-grade5a-01", "exercise-grade5a-01"],
            "liveStatus": "placeholder_until_provision",
        },
        "resources": {
            "video-grade5a-01": {
                "kind": "video",
                "logicalId": "video-grade5a-01",
                "sourceId": VIDEO_SOURCE_ID,
                "title": "Open video target",
                "walkerAction": "open_video",
                "contentId": ids["video"]["contentId"],
                "nodeId": ids["video"]["nodeId"],
                "channelId": ids["channelId"],
                "md5": video_md5,
                "storagePath": storage_path,
                "mediaPath": "content/media/video-grade5a-01.mp4",
                "durationHintSec": 3,
            },
            "exercise-grade5a-01": {
                "kind": "exercise",
                "logicalId": "exercise-grade5a-01",
                "sourceId": EXERCISE_SOURCE_ID,
                "title": "Open exercise target",
                "walkerAction": "open_exercise",
                "contentId": ids["exercise"]["contentId"],
                "nodeId": ids["exercise"]["nodeId"],
                "channelId": ids["channelId"],
                "recipePath": "content/seed/exercise-grade5a-01.json",
                "mastery": {"model": "m_of_n", "m": 1, "n": 1},
            },
        },
        "intentResolution": {
            "open_video": {
                "contentLogicalId": "video-grade5a-01",
                "contentId": ids["video"]["contentId"],
                "nodeId": ids["video"]["nodeId"],
                "channelId": ids["channelId"],
                "storagePath": storage_path,
                "md5": video_md5,
            },
            "open_exercise": {
                "contentLogicalId": "exercise-grade5a-01",
                "contentId": ids["exercise"]["contentId"],
                "nodeId": ids["exercise"]["nodeId"],
                "channelId": ids["channelId"],
            },
        },
        "regenerate": {
            "command": "python3 tests/duration-tests/fixtures/kolibri/content/seed/build_content_seeded.py",
            "requires": ["python3", "optional: ricecooker+le-utils for Studio-matching IDs"],
            "media": "content/media/video-grade5a-01.mp4",
            "see": "content/seed-notes.md",
        },
    }
    return seeded


def main() -> None:
    seeded = build()
    OUT.write_text(json.dumps(seeded, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
    print(
        "open_video contentId=",
        seeded["intentResolution"]["open_video"]["contentId"],
        "open_exercise contentId=",
        seeded["intentResolution"]["open_exercise"]["contentId"],
    )


if __name__ == "__main__":
    main()
