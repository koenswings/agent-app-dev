#!/bin/sh
# Fake journalctl for the hop dry run: prints $FX/journal.txt (if any).
[ -f "$FX/journal.txt" ] && cat "$FX/journal.txt"
exit 0
