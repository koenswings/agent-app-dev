# -*- coding: utf-8 -*-
"""Patch Grade 5A exercise with real Perseus assessment items (idea#166).

Keeps pinned contentId/nodeId/channelId. Updates AssessmentMetaData +
adds exercise .perseus LocalFile/File in the channel DB and (if present)
the imported content tables. Safe to re-run.
"""
from __future__ import print_function
import hashlib
import json
import os
import shutil
import sqlite3
import uuid

CHANNEL_ID = "30b6c2634b965a6293bddcf9a5cad7ca"
EXERCISE_NODE = "94a47ec7f30d5cd193f8ad08c42b6c2a"
EXERCISE_CONTENT = "7eb9de4696eb53d0bcc12fb270b96f03"
AM_ID = "29d2e079d589546bb44925db4bbdb734"  # existing stub row

PERSEUS_SRC = os.environ.get(
    "PERSEUS_SRC", "/seed/exercise-grade5a-01.perseus"
)
META_SRC = os.environ.get(
    "PERSEUS_META", "/seed/exercise-grade5a-01.meta.json"
)
KOLIBRI_HOME = os.environ.get("KOLIBRI_HOME", "/root/.kolibri")


def md5_file(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def storage_path(checksum, ext):
    return os.path.join(
        KOLIBRI_HOME, "content", "storage", checksum[0], checksum[1], "%s.%s" % (checksum, ext)
    )


def ensure_blob(src, checksum, ext):
    dest = storage_path(checksum, ext)
    parent = os.path.dirname(dest)
    if not os.path.isdir(parent):
        os.makedirs(parent)
    if (not os.path.exists(dest)) or os.path.getsize(dest) != os.path.getsize(src):
        shutil.copy2(src, dest)
    print("blob", dest, "size", os.path.getsize(dest))
    return dest


def patch_db(db_path, perseus_md5, perseus_size, assessment_ids, mastery_model):
    print("patching", db_path)
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    tables = [r[0] for r in c.execute("select name from sqlite_master where type='table'")]
    has_am = "content_assessmentmetadata" in tables
    has_lf = "content_localfile" in tables
    has_f = "content_file" in tables
    if not (has_am and has_lf and has_f):
        raise SystemExit("unexpected schema in %s: %s" % (db_path, tables))

    ids_json = json.dumps(assessment_ids)
    mastery_json = json.dumps(mastery_model)
    # Update AssessmentMetaData
    row = c.execute(
        "select id from content_assessmentmetadata where contentnode_id=?",
        (EXERCISE_NODE,),
    ).fetchone()
    if row:
        c.execute(
            "update content_assessmentmetadata set assessment_item_ids=?, number_of_assessments=?, mastery_model=?, randomize=0, is_manipulable=1 where contentnode_id=?",
            (ids_json, len(assessment_ids), mastery_json, EXERCISE_NODE),
        )
        print("updated assessmentmetadata", row[0], "->", len(assessment_ids), "items")
    else:
        am_id = AM_ID
        c.execute(
            "insert into content_assessmentmetadata (id, assessment_item_ids, number_of_assessments, mastery_model, randomize, is_manipulable, contentnode_id) values (?,?,?,?,0,1,?)",
            (am_id, ids_json, len(assessment_ids), mastery_json, EXERCISE_NODE),
        )
        print("inserted assessmentmetadata", am_id)

    # LocalFile for perseus
    lf = c.execute("select id, available from content_localfile where id=?", (perseus_md5,)).fetchone()
    if lf:
        c.execute(
            "update content_localfile set available=1, file_size=?, extension=? where id=?",
            (perseus_size, "perseus", perseus_md5),
        )
        print("updated localfile", perseus_md5)
    else:
        c.execute(
            "insert into content_localfile (id, available, file_size, extension) values (?,1,?,?)",
            (perseus_md5, perseus_size, "perseus"),
        )
        print("inserted localfile", perseus_md5)

    # File linking exercise node -> perseus
    file_id = uuid.uuid5(uuid.NAMESPACE_URL, "idea166/exercise-perseus/" + perseus_md5).hex
    # Remove any prior exercise-preset files for this node
    old = c.execute(
        "select id, local_file_id from content_file where contentnode_id=? and preset=?",
        (EXERCISE_NODE, "exercise"),
    ).fetchall()
    for oid, olf in old:
        c.execute("delete from content_file where id=?", (oid,))
        print("removed old exercise file", oid, olf)
    c.execute(
        "insert into content_file (id, supplementary, thumbnail, priority, contentnode_id, lang_id, local_file_id, preset) values (?,0,0,NULL,?,NULL,?,?)",
        (file_id, EXERCISE_NODE, perseus_md5, "exercise"),
    )
    print("inserted file", file_id, "preset=exercise")

    # Ensure exercise node available
    c.execute(
        "update content_contentnode set available=1, on_device_resources=1 where id=?",
        (EXERCISE_NODE,),
    )

    # Bump channel published_size if column exists
    try:
        c.execute(
            "update content_channelmetadata set published_size = COALESCE(published_size,0) + ? where id=?",
            (perseus_size, CHANNEL_ID),
        )
    except Exception as e:
        print("published_size skip:", e)

    conn.commit()
    conn.close()


def main():
    meta = json.load(open(META_SRC))
    # Prefer hashing the actual file we ship
    perseus_md5 = md5_file(PERSEUS_SRC)
    perseus_size = os.path.getsize(PERSEUS_SRC)
    if perseus_md5 != meta.get("perseus_md5"):
        print("WARNING: meta md5", meta.get("perseus_md5"), "!= file", perseus_md5)
    assessment_ids = meta["assessment_item_ids"]
    mastery_model = meta["mastery_model"]

    ensure_blob(PERSEUS_SRC, perseus_md5, "perseus")

    channel_db = os.path.join(
        KOLIBRI_HOME, "content", "databases", "%s.sqlite3" % CHANNEL_ID
    )
    main_db = os.path.join(KOLIBRI_HOME, "db.sqlite3")
    if not os.path.exists(channel_db):
        raise SystemExit("missing channel db: " + channel_db)

    patch_db(channel_db, perseus_md5, perseus_size, assessment_ids, mastery_model)
    if os.path.exists(main_db):
        # Imported content lives in main db too (same table names for content_*)
        # Only patch if content tables present with our exercise node
        conn = sqlite3.connect(main_db)
        tables = [r[0] for r in conn.execute("select name from sqlite_master where type='table'")]
        conn.close()
        if "content_contentnode" in tables:
            row_check = sqlite3.connect(main_db)
            exists = row_check.execute(
                "select id from content_contentnode where id=?", (EXERCISE_NODE,)
            ).fetchone()
            row_check.close()
            if exists:
                patch_db(main_db, perseus_md5, perseus_size, assessment_ids, mastery_model)
            else:
                print("main db has content tables but not our node; skip (re-import needed)")
        else:
            print("main db has no content_* tables (expected for some layouts); channel db only")

    print("DONE contentId=%s assessments=%s perseus=%s" % (EXERCISE_CONTENT, assessment_ids, perseus_md5))


if __name__ == "__main__":
    main()
