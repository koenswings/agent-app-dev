# idea#413 usage-hook proof

End-to-end proof that the Kolibri, Nextcloud and Kiwix `x-app.usage` hooks run
under the idea-usage runner on a pool Pi, that the day files contain the §2 /
USAGE-CONTRACT §5.3 fields, that hooks stay within their timeouts, and that
nothing runs when `usageMonitoring` is off.

See [CHECKLIST.md](CHECKLIST.md) for the operator steps, the exact run command,
the on-demand trigger, timeouts, and release rules.

```bash
# Dry-run (any host)
bash script/i413-hook-proof/prove-hooks.sh --dry-run
bash script/i413-hook-proof/prove-hooks.sh --dry-run --acceptance

# On a claimed idea03 or idea04, as pi
bash /home/pi/kid-i413-hook-proof/prove-hooks.sh

# Same run plus the remaining idea#413 Acceptance tests
bash /home/pi/kid-i413-hook-proof/prove-hooks.sh --acceptance
```
