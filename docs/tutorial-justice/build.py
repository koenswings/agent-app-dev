#!/usr/bin/env python3
"""Build IDEA-teacher-tutorial.pdf with the shared IDEA house style (../house-style)."""
import os, re, sys, glob
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "house-style")); import housestyle
# screenshots that still show error messages: replaced by a placeholder until retaken
RETAKE = set(l.split()[0] for l in open(os.path.join(HERE, "RETAKE.txt")) if l.strip() and not l.startswith("#")) if os.path.exists(os.path.join(HERE, "RETAKE.txt")) else set()
parts = []
for f in sorted(glob.glob(os.path.join(HERE, "chapters", "*.md"))) + [os.path.join(HERE, "demo-accounts.md")]:
    t = open(f, encoding="utf-8").read().replace("\\n", "\n")
    if f.endswith("demo-accounts.md"): t = re.sub(r"^# .+$", "# Appendix: demo accounts", t, count=1, flags=re.M)
    t = t.replace("](../screenshots/", "](screenshots/")
    t = re.sub(r"!\[([^\]]*)\]\(screenshots/([^)]+)\)", lambda m: (f'<div class="confirm"><b>Screenshot {m.group(2)} pending retake</b> ({m.group(1)}).</div>' if m.group(2) in RETAKE else m.group(0)), t)
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
    parts.append(t.strip())
meta = {"title": "IDEA for teachers", "subtitle": "Tutorial for Justice: Kolibri, Nextcloud, Wikipedia offline, Files Disk, Backup, Console", "audience": "For Justice and the teachers he trains. Draft, October 2026"}
extra = "figure img { max-height: 112mm; width: auto; max-width: 100%; display: block; margin: 0 auto; }"
out = housestyle.build("\n\n".join(parts), meta, os.path.join(HERE, "IDEA-teacher-tutorial.pdf"), base_url=HERE, extra_css=extra, keep_html=False,
    note="IDEA - offline school computing. Prepared for Koen Swings's team.<br>Screenshots from the IDEA demo box with demo accounts. No passwords are shown.")
print("built", out)
