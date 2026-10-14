# IDEA installation guides (for Justice)

| PDF | Source | Topic |
|---|---|---|
| `manual-1-school-server.pdf` | `manual-1-school-server.md` | Starlink → Cudy WR3000S (OpenWrt + Tailscale) → TL-SG105PE PoE+ switch → 2× Pi 5 IDEA Engines |
| `manual-2-client-pi400.pdf` | `manual-2-client-pi400.md` | Raspberry Pi 400 + Raspberry Pi Monitor (one PSU) + Ubuntu Desktop 26.04.1 LTS |

Build: `python3 build.py` (needs `python3-markdown`, `weasyprint`, `poppler-utils`). It uses the shared house style in
`../house-style`, regenerates `diagrams/*.svg` with `diagrams/make_diagrams.py`, and fails if a "to confirm" marker or a
school-numbering leftover (`10.N.`, `school-N`, `tag:school`) is left in a source, a diagram or a PDF.

Other files:
- `scripts/school-router-setup.sh`, `scripts/router-tailscale-zone.sh` (OpenWrt 25.12 uci; tested with the 25.12.5 x86 rootfs `uci` + `fw4 print`, not yet on a real Cudy). Included in Manual 1, Appendix A.

Addressing and naming (idea#184): every school uses the same subnets (wired `10.42.0.0/24`, Wi-Fi `10.42.1.0/24` and `10.42.2.0/24`).
Pis are named by the installer with a unique two-word sticker name; one Tailscale tag (`tag:idea`) and one fleet key for all schools.

No real passwords, auth keys or tokens: everything in `<ANGLE BRACKETS>` is a placeholder.
