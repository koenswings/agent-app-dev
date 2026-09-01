#!/usr/bin/env python3
"""
Test sheet: four visual options for indicating bottle sizes V_A and V_B
on the 24h intake diagram, using the overfeed scenario as base.
"""
import subprocess, pathlib, os
from weasyprint import HTML

DESIGN_DIR = pathlib.Path("/home/node/workspace/agents/agent-app-dev/design/milkwise")
KATEX_CSS  = pathlib.Path("/home/pi/.npm-global/lib/node_modules/katex/dist/katex.min.css")
SKILL_STYLES = pathlib.Path("/home/node/workspace/skills/md-to-pdf/assets/styles")

WEIGHT = 6.47
DAILY  = WEIGHT * 150
RATE   = DAILY / 24
MILK   = 100.0
SI     = MILK / RATE

def intake_at(t_now, feeds):
    total = 0.0
    for (tf, ml) in feeds:
        age = t_now - tf
        if age < 0: continue
        if age <= 24: total += ml
        else:
            credit = ml - RATE*(age-24)
            if credit > 0: total += credit
    return total

feeds_over = [(-38.0,MILK),(-35.5,MILK),(-33.0,MILK),(-30.5,MILK),(-28.0,MILK),
              (-22.0,MILK),(-19.5,MILK),(-17.0,MILK),(-14.5,MILK),
              (-12.0,MILK),(-9.5,MILK),(-7.0,MILK),(-4.5,MILK),
              (-2.0,MILK),(0.0,MILK)]

T_A    = SI
T_B    = None
for step in range(200000):
    t_try = step * 0.0005
    if intake_at(t_try, feeds_over) <= DAILY:
        T_B = t_try
        break

v_TA   = intake_at(T_A, feeds_over)
V_A    = (DAILY + MILK) - v_TA   # 89.6 ml milk ≈ 81 ml water
v_TB   = DAILY
V_B    = MILK                     # 100 ml (standard bottle)
v0plus = intake_at(0.001, feeds_over)

W, H = 560, 240
L, R, T_ax, B = 72, 520, 22, 178
t0_o, t1_o = -1.0, 7.0
v0_o, v1_o = 870, 1120

def mapx(t): return L + (t - t0_o)/(t1_o - t0_o)*(R - L)
def mapy(v): return T_ax + (v1_o - v)/(v1_o - v0_o)*(B - T_ax)

def base_diagram():
    """Common SVG elements: axes, curve, reference lines, T=0, T_A, T_B markers."""
    s = f'<svg width="{W}" height="{H}" xmlns="http://www.w3.org/2000/svg" style="background:#fff;border:1px solid #ccc;border-radius:4px;display:block;">\n'

    # Axes
    s += f'  <line x1="{mapx(t0_o):.1f}" y1="{T_ax-6}" x2="{mapx(t0_o):.1f}" y2="{B+2}" stroke="#222" stroke-width="1.8"/>\n'
    s += f'  <polygon points="{mapx(t0_o):.1f},{T_ax-8} {mapx(t0_o)-3:.1f},{T_ax+2} {mapx(t0_o)+3:.1f},{T_ax+2}" fill="#222"/>\n'
    s += f'  <line x1="{mapx(t0_o)-2:.1f}" y1="{B}" x2="{R+6}" y2="{B}" stroke="#222" stroke-width="1.8"/>\n'
    s += f'  <polygon points="{R+8},{B} {R},{B-3} {R},{B+3}" fill="#222"/>\n'

    # Reference lines
    def hl(v, color, dash, lbl=""):
        y = mapy(v)
        seg = f'  <line x1="{mapx(t0_o):.1f}" y1="{y:.1f}" x2="{R:.1f}" y2="{y:.1f}" stroke="{color}" stroke-width="1.2" stroke-dasharray="{dash}"/>\n'
        if lbl:
            seg += f'  <text x="{R+3:.1f}" y="{y+4:.1f}" font-size="8" fill="{color}" font-family="DejaVu Sans">{lbl}</text>\n'
        return seg
    s += hl(DAILY,      "#e07020", "8,4", f"D={DAILY:.0f}")
    s += hl(DAILY+MILK, "#2c8a50", "5,3", f"D+m&#x2080;={DAILY+MILK:.0f}")

    # Horizontal blue line at I(T_A)
    y_TA_h = mapy(v_TA)
    s += f'  <line x1="{mapx(t0_o):.1f}" y1="{y_TA_h:.1f}" x2="{mapx(T_A):.1f}" y2="{y_TA_h:.1f}" stroke="#1a5fa8" stroke-width="1" stroke-dasharray="4,3"/>\n'
    s += f'  <text x="{mapx(t0_o)-4:.1f}" y="{y_TA_h+4:.1f}" font-size="8" fill="#1a5fa8" font-family="DejaVu Sans" text-anchor="end">{v_TA:.0f}</text>\n'

    # Curve
    N = 1500
    feed_times = sorted(tf for tf, _ in feeds_over if t0_o-0.01 <= tf <= t1_o+0.01)
    segs, seg = [], []
    for i in range(N+1):
        t = t0_o + i*(t1_o-t0_o)/N
        for tf in feed_times:
            if i > 0 and (t0_o+(i-1)*(t1_o-t0_o)/N) < tf <= t:
                seg.append((mapx(tf), mapy(intake_at(tf-1e-6, feeds_over))))
                segs.append(seg)
                seg = [(mapx(tf), mapy(intake_at(tf+1e-6, feeds_over)))]
                break
        seg.append((mapx(t), mapy(intake_at(t, feeds_over))))
    if seg: segs.append(seg)
    for sg in segs:
        coords = " ".join(f"{p[0]:.1f},{p[1]:.1f}" for p in sg)
        s += f'  <polyline points="{coords}" stroke="#333" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>\n'

    # T=0 vertical
    s += f'  <line x1="{mapx(0):.1f}" y1="{T_ax}" x2="{mapx(0):.1f}" y2="{B}" stroke="#bbb" stroke-width="1.2" stroke-dasharray="3,2"/>\n'
    s += f'  <text x="{mapx(0)+3:.1f}" y="{T_ax+10:.1f}" font-size="7.5" fill="#999" font-family="DejaVu Sans">T=0</text>\n'

    # T_A vertical (blue)
    s += f'  <line x1="{mapx(T_A):.1f}" y1="{T_ax}" x2="{mapx(T_A):.1f}" y2="{B}" stroke="#1a5fa8" stroke-width="1.3" stroke-dasharray="4,3"/>\n'
    s += f'  <circle cx="{mapx(T_A):.1f}" cy="{mapy(v_TA):.1f}" r="3.5" fill="#1a5fa8" stroke="white" stroke-width="1.2"/>\n'
    s += f'  <text x="{mapx(T_A)+3:.1f}" y="{mapy(v_TA)-5:.1f}" font-size="8" fill="#1a5fa8" font-family="DejaVu Sans" font-weight="bold">T&#x2090;</text>\n'

    # T_B vertical (red)
    s += f'  <line x1="{mapx(T_B):.1f}" y1="{T_ax}" x2="{mapx(T_B):.1f}" y2="{B}" stroke="#e05050" stroke-width="1.3" stroke-dasharray="4,3"/>\n'
    s += f'  <circle cx="{mapx(T_B):.1f}" cy="{mapy(DAILY):.1f}" r="3.5" fill="#e05050" stroke="white" stroke-width="1.2"/>\n'
    s += f'  <text x="{mapx(T_B)+3:.1f}" y="{mapy(DAILY)-5:.1f}" font-size="8" fill="#e05050" font-family="DejaVu Sans" font-weight="bold">T&#x1D3D;</text>\n'

    # SI bracket
    bx1, bx2, by = mapx(0), mapx(T_A), B+14
    s += f'  <line x1="{bx1:.1f}" y1="{by}" x2="{bx2:.1f}" y2="{by}" stroke="#888" stroke-width="1.1"/>\n'
    s += f'  <line x1="{bx1:.1f}" y1="{by-3}" x2="{bx1:.1f}" y2="{by+3}" stroke="#888" stroke-width="1.1"/>\n'
    s += f'  <line x1="{bx2:.1f}" y1="{by-3}" x2="{bx2:.1f}" y2="{by+3}" stroke="#888" stroke-width="1.1"/>\n'
    s += f'  <text x="{(bx1+bx2)/2:.1f}" y="{by+11}" font-size="7.5" fill="#888" font-family="DejaVu Sans" text-anchor="middle">SI={SI*60:.0f}m</text>\n'

    # Y ticks
    for v, lbl, color in [(v0plus, f"I&#x2080;={v0plus:.0f}", "#555"),
                           (DAILY,      f"{DAILY:.0f}",       "#e07020"),
                           (DAILY+MILK, f"{DAILY+MILK:.0f}",  "#2c8a50")]:
        y = mapy(v)
        s += f'  <line x1="{mapx(t0_o)-4:.1f}" y1="{y:.1f}" x2="{mapx(t0_o)+4:.1f}" y2="{y:.1f}" stroke="{color}" stroke-width="1.1"/>\n'
        s += f'  <text x="{mapx(t0_o)-6:.1f}" y="{y+4:.1f}" font-size="8" fill="{color}" font-family="DejaVu Sans" text-anchor="end">{lbl}</text>\n'

    return s

def end_svg():
    return "</svg>\n"

# ── Option 1: coloured text labels at T_A and T_B ────────────────────────────
def option1():
    s = base_diagram()
    # V_A label above T_A dot (blue)
    s += f'  <text x="{mapx(T_A):.1f}" y="{mapy(v_TA)+18:.1f}" font-size="9" fill="#1a5fa8" font-family="DejaVu Sans" text-anchor="middle" font-weight="bold">V&#x2090;={V_A:.0f}ml</text>\n'
    # V_B label above T_B dot (red)
    s += f'  <text x="{mapx(T_B):.1f}" y="{mapy(DAILY)+18:.1f}" font-size="9" fill="#e05050" font-family="DejaVu Sans" text-anchor="middle" font-weight="bold">V&#x1D3D;={V_B:.0f}ml</text>\n'
    s += end_svg()
    return s

# ── Option 2: vertical bar with cap ends (measuring rod) ─────────────────────
def option2():
    s = base_diagram()
    BAR_W = 14

    def measuring_rod(t, v_bottom, v_top, color, label):
        x  = mapx(t) + 10
        y1 = mapy(v_bottom)
        y2 = mapy(v_top)
        seg = ""
        # Filled rect
        seg += f'  <rect x="{x-BAR_W/2:.1f}" y="{y2:.1f}" width="{BAR_W}" height="{y1-y2:.1f}" fill="{color}" fill-opacity="0.18" rx="2"/>\n'
        # Border
        seg += f'  <rect x="{x-BAR_W/2:.1f}" y="{y2:.1f}" width="{BAR_W}" height="{y1-y2:.1f}" fill="none" stroke="{color}" stroke-width="1.2" rx="2"/>\n'
        # Cap ticks
        seg += f'  <line x1="{x-BAR_W/2-3:.1f}" y1="{y1:.1f}" x2="{x+BAR_W/2+3:.1f}" y2="{y1:.1f}" stroke="{color}" stroke-width="1.5"/>\n'
        seg += f'  <line x1="{x-BAR_W/2-3:.1f}" y1="{y2:.1f}" x2="{x+BAR_W/2+3:.1f}" y2="{y2:.1f}" stroke="{color}" stroke-width="1.5"/>\n'
        # Label
        mid = (y1 + y2)/2
        seg += f'  <text x="{x+BAR_W/2+5:.1f}" y="{mid+4:.1f}" font-size="9" fill="{color}" font-family="DejaVu Sans" font-weight="bold">{label}</text>\n'
        return seg

    # V_A rod: from I(T_A) to D+m0 (the gap that needs filling)
    s += measuring_rod(T_A, v_TA, DAILY+MILK, "#1a5fa8", f"V&#x2090;={V_A:.0f}ml")
    # V_B rod: from D to D+m0 (standard bottle = 100ml)
    s += measuring_rod(T_B, DAILY, DAILY+MILK, "#e05050", f"V&#x1D3D;={V_B:.0f}ml")
    s += end_svg()
    return s

# ── Option 3: bottle silhouette ───────────────────────────────────────────────
def bottle_shape(cx, y_bottom, y_top, color, label):
    """Simple stylised bottle: body + neck + label."""
    h    = y_bottom - y_top
    bw   = 10    # body half-width
    nw   = 4     # neck half-width
    neck = max(6, h * 0.25)  # neck height

    body_top = y_top + neck
    path = (f"M {cx-nw:.1f},{y_top} "           # top of neck left
            f"L {cx-bw:.1f},{body_top:.1f} "     # shoulder left
            f"L {cx-bw:.1f},{y_bottom:.1f} "     # bottom left
            f"L {cx+bw:.1f},{y_bottom:.1f} "     # bottom right
            f"L {cx+bw:.1f},{body_top:.1f} "     # shoulder right
            f"L {cx+nw:.1f},{y_top} "            # top of neck right
            f"Z")
    seg  = f'  <path d="{path}" fill="{color}" fill-opacity="0.20" stroke="{color}" stroke-width="1.2"/>\n'
    # sucker cap line
    seg += f'  <line x1="{cx-nw-2:.1f}" y1="{y_top:.1f}" x2="{cx+nw+2:.1f}" y2="{y_top:.1f}" stroke="{color}" stroke-width="2.5" stroke-linecap="round"/>\n'
    # label next to bottle
    mid = (y_bottom + y_top)/2
    seg += f'  <text x="{cx+bw+6:.1f}" y="{mid+4:.1f}" font-size="9" fill="{color}" font-family="DejaVu Sans" font-weight="bold">{label}</text>\n'
    return seg

def option3():
    s = base_diagram()
    # V_A bottle: height proportional to V_A ml, positioned at T_A
    s += bottle_shape(mapx(T_A)+16, mapy(v_TA), mapy(DAILY+MILK), "#1a5fa8", f"V&#x2090;={V_A:.0f}ml")
    # V_B bottle at T_B
    s += bottle_shape(mapx(T_B)+16, mapy(DAILY), mapy(DAILY+MILK), "#e05050", f"V&#x1D3D;={V_B:.0f}ml")
    s += end_svg()
    return s

# ── Option 4: lollipop / dot-on-stem ─────────────────────────────────────────
def lollipop(cx, y_bottom, y_top, color, label):
    """Stem from bottom to top, circle at top = bottle sucker."""
    seg = f'  <line x1="{cx:.1f}" y1="{y_bottom:.1f}" x2="{cx:.1f}" y2="{y_top:.1f}" stroke="{color}" stroke-width="3" stroke-linecap="round"/>\n'
    seg += f'  <circle cx="{cx:.1f}" cy="{y_top:.1f}" r="7" fill="{color}" fill-opacity="0.25" stroke="{color}" stroke-width="1.5"/>\n'
    seg += f'  <text x="{cx:.1f}" y="{y_top+4:.1f}" font-size="7" fill="{color}" font-family="DejaVu Sans" text-anchor="middle" font-weight="bold">{label}</text>\n'
    return seg

def option4():
    s = base_diagram()
    # V_A lollipop at T_A
    s += lollipop(mapx(T_A)+12, mapy(v_TA), mapy(DAILY+MILK), "#1a5fa8", f"{V_A:.0f}")
    # V_B lollipop at T_B
    s += lollipop(mapx(T_B)+12, mapy(DAILY), mapy(DAILY+MILK), "#e05050", f"{V_B:.0f}")
    s += end_svg()
    return s

# ── Generate all four as an HTML preview ─────────────────────────────────────
options = [
    ("Option 1 — Coloured text label", "V_A and V_B shown as text next to the dot. Simple and unambiguous.", option1()),
    ("Option 2 — Measuring rod (fill + cap ticks)", "A bar spanning from the curve level to the equilibrium peak, with horizontal end caps. Height = volume to give.", option2()),
    ("Option 3 — Bottle silhouette", "An actual bottle shape. Height ∝ volume. Sucker cap line at the top.", option3()),
    ("Option 4 — Lollipop (dot-on-stem)", "A stem from the curve to the equilibrium peak, circle at the top. Height ∝ volume.", option4()),
]

katex_css = KATEX_CSS.read_text()
md_css    = (SKILL_STYLES / "markdown.css").read_text()
pdf_css   = (SKILL_STYLES / "markdown-pdf.css").read_text()

html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
{katex_css}
{md_css}
{pdf_css}
body {{ font-family: 'DejaVu Sans', sans-serif; font-size: 10pt; line-height: 1.6; }}
h1 {{ font-size: 14pt; margin-bottom: 4px; }}
h2 {{ font-size: 11pt; margin-top: 28px; margin-bottom: 4px; border-bottom: 1px solid #ddd; padding-bottom: 2px; }}
p  {{ margin: 5px 0 10px 0; color: #555; font-size: 9.5pt; }}
</style>
</head><body class="vscode-body">
<h1>Bottle Size Indicator — Visual Options Test</h1>
<p>All four options show the same overfeed scenario. V<sub>A</sub> (blue, at T<sub>A</sub>) = {V_A:.0f} ml milk.
V<sub>B</sub> (red, at T<sub>B</sub>) = {V_B:.0f} ml milk (standard bottle).
The height of each indicator spans from the curve level up to the equilibrium peak D+m&#x2080;.</p>
"""

for title, desc, svg in options:
    html += f"<h2>{title}</h2>\n<p>{desc}</p>\n{svg}\n"

html += "</body></html>"

out_html = DESIGN_DIR / "bottle-indicator-test.html"
out_pdf  = DESIGN_DIR / "bottle-indicator-test.pdf"
out_html.write_text(html, "utf-8")
HTML(filename=str(out_html), base_url=DESIGN_DIR.as_uri()+"/").write_pdf(str(out_pdf))
print(f"ok → {out_pdf}")
