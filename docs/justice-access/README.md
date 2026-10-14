# Justice remote-access guide (wizardly-hugle over Tailscale)

| File | What |
|---|---|
| `justice-remote-access.md` | Source text (Markdown, house-style front matter) |
| `build.py` | `python3 build.py` → `Justice-remote-access-guide.pdf`; regenerates diagrams; fails on to-confirm markers, placeholders, run-together bullets or unrendered Markdown in source or PDF |
| `diagrams/make_diagrams.py` | Generates `overview.svg`, `flow.svg`, `privacy.svg`, `checks.svg` (same drawing helpers as the install guides) |

House style: `../house-style` (`docs/house-style`). No passwords in the PDF.
