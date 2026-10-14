#!/usr/bin/env python3
"""Build PDFs of the two lesson manuals with the IDEA house style (docs/house-style).
The sources stay where PR #10 put them: tests/duration-tests/lessons/teacher-manuals/ (with shots/ and
SCREENSHOTS.md). This script only renders them, so there is one copy of each source.
Usage: python3 build.py      Fails if a 'to confirm' marker or a screenshot placeholder is left."""
import os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, "..", "..", "tests", "duration-tests", "lessons", "teacher-manuals"))
sys.path.insert(0, os.path.join(HERE, "..", "house-style"))
import housestyle
BAD = re.compile(r"to confirm|\bTODO\b|\bTBD\b|FIXME|<!-- *screenshot", re.I)
MANUALS = [("grade5a-add-and-subtract-fractions", "Grade 5A: add and subtract fractions"),
           ("form3-variables-and-expressions", "Form 3: variables and expressions")]
for name, _ in MANUALS:
    src = open(os.path.join(SRC, name + ".md"), encoding="utf-8").read()
    title, body = re.match(r"^# (.+?)\n(.*)$", src, re.S).groups()
    bad = [f"{name}.md:{i}: {l.strip()[:90]}" for i, l in enumerate(body.split("\n"), 1) if BAD.search(l)]
    if bad: sys.exit("BUILD FAILED: markers left in source:\n" + "\n".join(bad))
    meta = {"title": title.strip(), "subtitle": "IDEA lesson manual: Kolibri",
            "audience": "For the class teacher, with Tapiwa. Version 1.0, 14 October 2026"}
    out = os.path.join(HERE, name + ".pdf")
    housestyle.build(body, meta, out, base_url=SRC, keep_html=False,
                     extra_css="figure img, p img { max-height: 95mm; width: auto; max-width: 100%; display: block; margin: 0 auto; }")
    txt = subprocess.run(["pdftotext", "-layout", out, "-"], capture_output=True, text=True, check=True).stdout
    bad = [f"p{n}: {l.strip()[:90]}" for n, pg in enumerate(txt.split("\f"), 1) for l in pg.split("\n") if BAD.search(l) or "**" in l]
    if bad: sys.exit(f"BUILD FAILED: markers in {name}.pdf:\n" + "\n".join(bad))
    print("built", name + ".pdf", "pages:", len([p for p in txt.split("\f") if p.strip()]))
