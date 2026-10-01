#!/usr/bin/env python3
"""Build exercise-grade5a-01.perseus (+ meta + storage mirror) from the recipe (idea#166).

Deterministic ZIP_STORED archive matching Studio Perseus layout:
  exercise.json + {assessment_id}.json for each single_select question.
"""
from __future__ import annotations

import hashlib
import io
import json
import shutil
import uuid
import zipfile
from pathlib import Path

SEED_DIR = Path(__file__).resolve().parent
CONTENT_DIR = SEED_DIR.parent
RECIPE = SEED_DIR / "exercise-grade5a-01.json"
OUT_PERSEUS = SEED_DIR / "exercise-grade5a-01.perseus"
OUT_META = SEED_DIR / "exercise-grade5a-01.meta.json"
STORAGE_ROOT = CONTENT_DIR / "storage"


def assessment_id(source_id: str) -> str:
    return uuid.uuid5(uuid.NAMESPACE_DNS, source_id).hex


def single_select_item(question: str, answers: list[dict], hints: list[str]) -> dict:
    choices = [
        {"correct": bool(a["correct"]), "content": a["answer"], "images": {}}
        for a in answers
    ]
    return {
        "question": {
            "content": question + "\n\n[[\u2603 radio 1]]",
            "images": {},
            "widgets": {
                "radio 1": {
                    "type": "radio",
                    "graded": True,
                    "options": {
                        "choices": choices,
                        "randomize": False,
                        "multipleSelect": False,
                        "displayCount": None,
                        "hasNoneOfTheAbove": False,
                        "onePerLine": True,
                        "deselectEnabled": False,
                    },
                    "version": {"major": 1, "minor": 0},
                }
            },
        },
        "answerArea": {
            "type": "multiple",
            "options": {"content": "", "images": {}, "widgets": {}},
            "calculator": False,
            "periodicTable": False,
        },
        "itemDataVersion": {"major": 0, "minor": 1},
        "hints": [
            {"widgets": {}, "images": {}, "content": h, "replace": False} for h in hints
        ],
    }


def build() -> dict:
    recipe = json.loads(RECIPE.read_text(encoding="utf-8"))
    items: dict[str, dict] = {}
    ordered_ids: list[str] = []
    mapping: dict[str, str] = {}
    qmeta = []
    for q in recipe["questions"]:
        src = f"{recipe['sourceId']}/{q['id']}"
        aid = q.get("assessmentId") or assessment_id(src)
        answers = [
            {"answer": a, "correct": (a == q["correct_answer"])}
            for a in q["all_answers"]
        ]
        items[aid] = single_select_item(q["question"], answers, q.get("hints") or [])
        ordered_ids.append(aid)
        mapping[aid] = "single_selection"
        qmeta.append({"id": q["id"], "assessment_id": aid, "type": "single_selection"})

    mastery = recipe.get("mastery") or {"model": "m_of_n", "m": 1, "n": 1}
    exercise_data = {
        "mastery_model": mastery.get("model", "m_of_n"),
        "legacy_mastery_model": mastery.get("model", "m_of_n"),
        "randomize": False,
        "n": mastery.get("n", 1),
        "m": mastery.get("m", 1),
        "all_assessment_items": ordered_ids,
        "assessment_mapping": mapping,
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:

        def writestr(name: str, data: bytes | str) -> None:
            info = zipfile.ZipInfo(name, date_time=(2013, 3, 14, 1, 59, 26))
            info.compress_type = zipfile.ZIP_STORED
            if isinstance(data, str):
                data = data.encode("utf-8")
            zf.writestr(info, data)

        writestr(
            "exercise.json", json.dumps(exercise_data, sort_keys=True, indent=4) + "\n"
        )
        for aid, item in items.items():
            writestr(f"{aid}.json", json.dumps(item, sort_keys=True, indent=2) + "\n")

    raw = buf.getvalue()
    md5 = hashlib.md5(raw).hexdigest()
    OUT_PERSEUS.write_bytes(raw)

    meta = {
        "assessment_item_ids": ordered_ids,
        "number_of_assessments": len(ordered_ids),
        "mastery_model": {
            "type": mastery.get("model", "m_of_n"),
            "m": mastery.get("m", 1),
            "n": mastery.get("n", 1),
        },
        "perseus_md5": md5,
        "perseus_size": len(raw),
        "questions": qmeta,
    }
    OUT_META.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    dest = STORAGE_ROOT / md5[0] / md5[1] / f"{md5}.perseus"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(OUT_PERSEUS, dest)

    # Stamp recipe.perseus block
    recipe["perseus"] = {
        "path": "content/seed/exercise-grade5a-01.perseus",
        "md5": md5,
        "size": len(raw),
        "assessmentItemIds": ordered_ids,
    }
    for q, qm in zip(recipe["questions"], qmeta):
        q["assessmentId"] = qm["assessment_id"]
    RECIPE.write_text(json.dumps(recipe, indent=2) + "\n", encoding="utf-8")

    print(f"wrote {OUT_PERSEUS} md5={md5} items={len(ordered_ids)}")
    print(f"storage {dest}")
    return meta


if __name__ == "__main__":
    build()
