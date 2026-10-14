#!/usr/bin/env python3
"""Build the IDEA install guides with the IDEA house style (docs/house-style).
Usage: python3 build.py      (regenerates the diagrams too)
Fails if a 'to confirm' marker or a school-numbering leftover is in a source, a script or a PDF."""
import os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "house-style"))
import housestyle

BAD = re.compile(r"to confirm|\bTODO\b|\bTBD\b|FIXME|10\.N\.|school-N|tag:school|idea<N>|school number\b", re.I)
NAMES = ["manual-1-school-server", "manual-2-client-pi400"]

def fail(msg, lines):
    sys.exit("BUILD FAILED: " + msg + ":\n" + "\n".join(lines))

subprocess.run([sys.executable, os.path.join(HERE, "diagrams", "make_diagrams.py")], check=True)
for name in NAMES:
    meta, body = housestyle.split_front_matter(open(os.path.join(HERE, name + ".md"), encoding="utf-8").read())
    body = re.sub(r"@@INCLUDE (\S+)@@", lambda m: open(os.path.join(HERE, m.group(1))).read().rstrip(), body)
    bad = [f"{name}.md:{i}: {l.strip()[:90]}" for i, l in enumerate(body.split("\n"), 1) if BAD.search(l)]
    for svg in sorted(os.listdir(os.path.join(HERE, "diagrams"))):
        if svg.endswith(".svg") and BAD.search(open(os.path.join(HERE, "diagrams", svg)).read()):
            bad.append(f"diagrams/{svg}")
    if bad: fail("markers left in source", bad)
    out = os.path.join(HERE, name + ".pdf")
    housestyle.build(body, meta, out, base_url=HERE, keep_html=False)
    txt = subprocess.run(["pdftotext", "-layout", out, "-"], capture_output=True, text=True, check=True).stdout
    pages = txt.split("\f")
    bad = [f"p{n}: {l.strip()[:90]}" for n, pg in enumerate(pages, 1) for l in pg.split("\n") if BAD.search(l) or "**" in l]
    if bad: fail(f"markers in {name}.pdf", bad)
    print("built", name + ".pdf", "pages:", len([p for p in pages if p.strip()]))
