#!/usr/bin/env python3
"""Build IDEA-teacher-tutorial.pdf with the shared IDEA house style (../house-style).
Fails if any 'to confirm' marker is left in the text."""
import os, re, sys, glob
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "house-style")); import housestyle
RF = os.path.join(HERE, "RETAKE.txt")
RETAKE = {l.split()[0] for l in open(RF) if l.strip() and not l.startswith("#")} if os.path.exists(RF) else set()
PARTS = {1: ("Part A", "For teachers"), 10: ("Part B", "For the school operator")}
parts, bad = [], []
files = sorted(glob.glob(os.path.join(HERE, "chapters", "*.md"))) + [os.path.join(HERE, "appendix-demo-accounts.md")]
for f in files:
    t = open(f, encoding="utf-8").read().replace("\\n", "\n")
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
    for i, line in enumerate(t.split("\n"), 1):
        if re.search(r"to confirm", line.replace("TYPE (disk name) TO CONFIRM",""), re.I): bad.append(f"{os.path.basename(f)}:{i}: {line.strip()[:90]}")
    num = re.match(r"(\d+)-", os.path.basename(f))
    if num and int(num.group(1)) in PARTS:
        a, b = PARTS[int(num.group(1))]
        parts.append(f'<div class="part"><h1 class="parttitle" id="part-{a[-1].lower()}">{a}: {b}</h1></div>')
    t = t.replace("](../screenshots/", "](screenshots/")
    t = re.sub(r"!\[([^\]]*)\]\(screenshots/([^)]+)\)", lambda m: (f'<div class="confirm"><b>Screenshot pending retake:</b> {m.group(1)}.</div>' if m.group(2) in RETAKE else m.group(0)), t)
    parts.append(t.strip())
if bad:
    sys.exit("BUILD FAILED: 'to confirm' markers left:\n" + "\n".join(bad))
meta = {"title": "IDEA for Teachers: Tutorial", "subtitle": "Kolibri, Nextcloud, Wikipedia offline, Files Disk and Backup Disk",
        "audience": "For Justice and the teachers he trains. Version 1.0, 13 October 2026"}
extra = """figure img { max-height: 92mm; width: auto; max-width: 100%; display: block; margin: 0 auto; }
figure { page-break-inside: avoid; }
li { page-break-inside: avoid; }
h2 + p, h2 + ol, h2 + ul { page-break-before: avoid; }
.part h1 { margin-top: 0; }
.part { page-break-before: always; page-break-after: always; padding-top: 80mm; }
.part .partno { font-size: 13pt; color: #1f4e79; letter-spacing: 1px; }
h1.parttitle { page-break-before: avoid; border: none; font-size: 24pt; }"""
out = housestyle.build("\n\n".join(parts), meta, os.path.join(HERE, "IDEA-teacher-tutorial.pdf"), base_url=HERE, extra_css=extra, keep_html=False,
    note="IDEA - offline school computing.<br>No real passwords are included. Demo passwords come from your IDEA contact.")
print("built", out)
