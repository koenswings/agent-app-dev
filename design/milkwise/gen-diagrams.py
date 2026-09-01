#!/usr/bin/env python3
"""
Generate all MilkWise predictor design diagrams as SVG strings.
Outputs: milkwise-diagrams.html (test preview) and individual .svg files.

Physics:
  WEIGHT = 6.9 kg
  DAILY  = 1035 ml  (6.9 × 150)
  RATE   = 43.125 ml/h
  MILK   = 100 ml   (90ml water → 100ml prepared milk)
  SI     = 100 / 43.125 = 2.3188h  (≈ 2h 19m)

Equilibrium in 24h model (corrected):
  After each feed:     intake = DAILY + MILK = 1135 ml
  Just before feed:    intake = DAILY = 1035 ml
  Predictor B target:  intake(T_B) = DAILY  → give MILK → intake = 1135
  Predictor A formula: volumeA = (DAILY + MILK) − intake(T_A)
"""

import math, os

WEIGHT = 6.9
DAILY  = 1035.0
RATE   = 43.125
MILK   = 100.0
SI     = MILK / RATE  # 2.3188h

OUT_DIR = os.path.dirname(os.path.abspath(__file__))


# ─────────────────────────────────────────────────────────────────────────────
# SVG primitives
# ─────────────────────────────────────────────────────────────────────────────

W, H = 580, 240
L, R, T, B = 68, 558, 22, 178   # plot area corners

def fmt(v): return f"{v:.1f}"

def mapx(t, t0, t1): return L + (t - t0) / (t1 - t0) * (R - L)
def mapy(v, v0, v1): return T + (v1 - v) / (v1 - v0) * (B - T)

def pt(t, v, t0, t1, v0, v1):
    return f"{mapx(t,t0,t1):.1f},{mapy(v,v0,v1):.1f}"

def svg_start(title=""):
    return (
        f'<svg width="{W}" height="{H}" xmlns="http://www.w3.org/2000/svg" '
        f'style="background:#ffffff;border:1px solid #ccc;border-radius:4px;display:block;margin:12px 0;">\n'
        f'  <!-- {title} -->\n'
    )

def svg_end(): return "</svg>\n"

def axes(t0, t1, v0, v1, ylabel="", xlabel="time"):
    mx = lambda t: mapx(t, t0, t1)
    my = lambda v: mapy(v, v0, v1)
    s = ""
    # y-axis
    s += f'  <line x1="{mx(t0):.1f}" y1="{T-6}" x2="{mx(t0):.1f}" y2="{B+2}" stroke="#222" stroke-width="2" stroke-linecap="round"/>\n'
    s += f'  <polygon points="{mx(t0):.1f},{T-8} {mx(t0)-4:.1f},{T+4} {mx(t0)+4:.1f},{T+4}" fill="#222"/>\n'
    # x-axis
    s += f'  <line x1="{mx(t0)-2:.1f}" y1="{B}" x2="{R+6}" y2="{B}" stroke="#222" stroke-width="2" stroke-linecap="round"/>\n'
    s += f'  <polygon points="{R+8},{B} {R-2},{B-4} {R-2},{B+4}" fill="#222"/>\n'
    # ylabel
    if ylabel:
        mid_y = (T + B) / 2
        s += f'  <text x="12" y="{mid_y:.0f}" font-size="10" fill="#555" font-family="DejaVu Sans" transform="rotate(-90,12,{mid_y:.0f})" text-anchor="middle">{ylabel}</text>\n'
    # xlabel
    s += f'  <text x="{R+10}" y="{B+4}" font-size="9" fill="#666" font-family="DejaVu Sans">{xlabel}</text>\n'
    return s

def hline(v, t0, t1, v0, v1, color="#e07020", dash="8,4", label="", label_x_frac=0.97):
    mx = lambda t: mapx(t, t0, t1)
    my = lambda x: mapy(x, v0, v1)
    y = my(v)
    s = f'  <line x1="{mx(t0):.1f}" y1="{y:.1f}" x2="{mx(t1):.1f}" y2="{y:.1f}" stroke="{color}" stroke-width="1.3" stroke-dasharray="{dash}"/>\n'
    if label:
        lx = mx(t0 + label_x_frac * (t1 - t0))
        s += f'  <text x="{lx:.1f}" y="{y-3:.1f}" font-size="9" fill="{color}" font-family="DejaVu Sans" text-anchor="end">{label}</text>\n'
    return s

def vline_dashed(t, t0, t1, v0, v1, color="#aaa", label="", label_side="bottom"):
    mx = lambda x: mapx(x, t0, t1)
    x = mx(t)
    s = f'  <line x1="{x:.1f}" y1="{T}" x2="{x:.1f}" y2="{B}" stroke="{color}" stroke-width="1" stroke-dasharray="4,3"/>\n'
    if label:
        if label_side == "bottom":
            s += f'  <text x="{x:.1f}" y="{B+14:.1f}" font-size="9" fill="{color}" font-family="DejaVu Sans" text-anchor="middle">{label}</text>\n'
        else:
            s += f'  <text x="{x:.1f}" y="{T-5:.1f}" font-size="9" fill="{color}" font-family="DejaVu Sans" text-anchor="middle">{label}</text>\n'
    return s

def ytick(v, t0, t1, v0, v1, label=None, color="#555"):
    mx = lambda t: mapx(t, t0, t1)
    my = lambda x: mapy(x, v0, v1)
    y = my(v)
    x0 = mx(t0)
    s = f'  <line x1="{x0-4:.1f}" y1="{y:.1f}" x2="{x0+4:.1f}" y2="{y:.1f}" stroke="{color}" stroke-width="1"/>\n'
    lbl = label if label is not None else fmt(v)
    s += f'  <text x="{x0-6:.1f}" y="{y+4:.1f}" font-size="9" fill="{color}" font-family="DejaVu Sans" text-anchor="end">{lbl}</text>\n'
    return s

def feed_dot(t, v, t0, t1, v0, v1, color="#2c8a50"):
    x = mapx(t, t0, t1)
    y = mapy(v, v0, v1)
    return f'  <circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="{color}" stroke="white" stroke-width="1.2"/>\n'

def feed_label(t, label, t0, t1, v0, v1, color="#333", dy=14):
    x = mapx(t, t0, t1)
    return f'  <text x="{x:.1f}" y="{B+dy:.1f}" font-size="9.5" fill="{color}" font-family="DejaVu Sans" text-anchor="middle">{label}</text>\n'

def annotate(x_t, y_v, t0, t1, v0, v1, text, dx=8, dy=-8, color="#1a5fa8", lines=None):
    """Small annotation label, optionally with a dashed leader line."""
    x = mapx(x_t, t0, t1) + dx
    y = mapy(y_v, v0, v1) + dy
    s = ""
    if lines:
        ax, ay = mapx(x_t, t0, t1), mapy(y_v, v0, v1)
        s += f'  <line x1="{ax:.1f}" y1="{ay:.1f}" x2="{x:.1f}" y2="{y:.1f}" stroke="{color}" stroke-width="0.9" stroke-dasharray="3,2"/>\n'
    for i, line in enumerate(text.split("\n")):
        s += f'  <text x="{x:.1f}" y="{y + i*11:.1f}" font-size="8.5" fill="{color}" font-family="DejaVu Sans">{line}</text>\n'
    return s

def bracket(t_a, t_b, y_b, t0, t1, v0, v1, label, color="#9a7a40"):
    x1 = mapx(t_a, t0, t1)
    x2 = mapx(t_b, t0, t1)
    y  = mapy(y_b, v0, v1) + 16
    s  = f'  <line x1="{x1:.1f}" y1="{y:.1f}" x2="{x2:.1f}" y2="{y:.1f}" stroke="{color}" stroke-width="1.2"/>\n'
    s += f'  <line x1="{x1:.1f}" y1="{y-3:.1f}" x2="{x1:.1f}" y2="{y+3:.1f}" stroke="{color}" stroke-width="1.2"/>\n'
    s += f'  <line x1="{x2:.1f}" y1="{y-3:.1f}" x2="{x2:.1f}" y2="{y+3:.1f}" stroke="{color}" stroke-width="1.2"/>\n'
    s += f'  <text x="{(x1+x2)/2:.1f}" y="{y+11:.1f}" font-size="8.5" fill="{color}" font-family="DejaVu Sans" text-anchor="middle">{label}</text>\n'
    return s

def polyline(pts, color="#2c8a50", width=2.2, dash=""):
    coords = " ".join(f"{p[0]:.1f},{p[1]:.1f}" for p in pts)
    da = f' stroke-dasharray="{dash}"' if dash else ""
    return f'  <polyline points="{coords}" stroke="{color}" stroke-width="{width}" fill="none" stroke-linecap="round" stroke-linejoin="round"{da}/>\n'

def title_text(text, color="#444"):
    return f'  <text x="{(L+R)/2:.0f}" y="14" font-size="9.5" fill="{color}" font-family="DejaVu Sans" text-anchor="middle" font-style="italic">{text}</text>\n'


# ─────────────────────────────────────────────────────────────────────────────
# All-time balance helper
# ─────────────────────────────────────────────────────────────────────────────

def balance_at(t, feeds):
    """All-time balance: sum of milk given minus total drain since first feed."""
    if not feeds: return 0.0
    t0 = feeds[0][0]
    total_milk = sum(ml for (tf, ml) in feeds if tf <= t)
    return total_milk - RATE * (t - t0)


# ─────────────────────────────────────────────────────────────────────────────
# Diagram 1: All-time balance, perfect rhythm
# ─────────────────────────────────────────────────────────────────────────────

def diagram_atb_perfect():
    feeds = [(0, MILK), (SI, MILK), (2*SI, MILK), (3*SI, MILK)]
    t0, t1 = -0.2, 3*SI + 0.5
    v0, v1 = -20, 120

    s = svg_start("All-time balance — perfect rhythm")
    s += title_text("All-time balance — perfect rhythm (6.9 kg, 90 ml water / 100 ml milk)")
    s += axes(t0, t1, v0, v1, ylabel="balance (ml)")
    s += hline(0, t0, t1, v0, v1, color="#888", dash="4,3", label="balance = 0")

    # Draw saw-tooth
    pts = []
    pts.append((mapx(t0, t0, t1), mapy(0, v0, v1)))  # start at 0
    for i, (tf, ml) in enumerate(feeds):
        b_before = balance_at(tf - 1e-9, feeds[:i])
        b_after  = balance_at(tf + 1e-9, feeds[:i+1])
        pts.append((mapx(tf, t0, t1), mapy(b_before, v0, v1)))
        pts.append((mapx(tf, t0, t1), mapy(b_after,  v0, v1)))
    # decay after last feed
    tend = 3*SI + 0.5
    pts.append((mapx(tend, t0, t1), mapy(balance_at(tend, feeds), v0, v1)))
    s += polyline(pts)

    # Feed dots and labels
    for i, (tf, _) in enumerate(feeds):
        s += feed_dot(tf, balance_at(tf+1e-9, feeds[:i+1]), t0, t1, v0, v1)
        s += feed_label(tf, f"F{i+1}", t0, t1, v0, v1)

    # Y-ticks
    s += ytick(0,    t0, t1, v0, v1, "0")
    s += ytick(MILK, t0, t1, v0, v1, "+100")

    # SI bracket
    s += bracket(0, SI, 0, t0, t1, v0, v1, f"SI = 2h 19m")

    s += svg_end()
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Diagram 2: All-time balance, late feed
# ─────────────────────────────────────────────────────────────────────────────

def diagram_atb_late():
    T_late = SI + 1.0  # F2 is 1h late
    feeds = [(0, MILK), (T_late, MILK)]
    t0, t1 = -0.2, T_late + 1.2
    v0, v1 = -55, 120

    s = svg_start("All-time balance — late feed")
    s += title_text("All-time balance — F2 given 1 hour late")
    s += axes(t0, t1, v0, v1, ylabel="balance (ml)")
    s += hline(0, t0, t1, v0, v1, color="#888", dash="4,3")

    # SI marker
    s += vline_dashed(SI, t0, t1, v0, v1, color="#bbb", label="SI", label_side="bottom")

    # Draw balance
    pts = []
    pts.append((mapx(t0, t0, t1), mapy(0, v0, v1)))
    # F1 spike
    pts.append((mapx(0, t0, t1), mapy(0, v0, v1)))
    pts.append((mapx(0, t0, t1), mapy(MILK, v0, v1)))
    # decay to T_late
    pts.append((mapx(T_late, t0, t1), mapy(balance_at(T_late-1e-9, feeds[:1]), v0, v1)))
    # F2 spike
    b_f2 = balance_at(T_late - 1e-9, feeds[:1])
    b_f2_after = balance_at(T_late + 1e-9, feeds)
    pts.append((mapx(T_late, t0, t1), mapy(b_f2_after, v0, v1)))
    # continue decaying
    tend = T_late + 1.2
    pts.append((mapx(tend, t0, t1), mapy(balance_at(tend, feeds), v0, v1)))
    s += polyline(pts)

    # Highlight late portion (F1 decay past SI)
    p2 = [(mapx(SI, t0, t1), mapy(balance_at(SI, feeds[:1]), v0, v1)),
           (mapx(T_late, t0, t1), mapy(b_f2, v0, v1))]
    s += polyline(p2, color="#e05050", width=2.2, dash="6,3")

    # Dots
    s += feed_dot(0,      MILK,      t0, t1, v0, v1)
    s += feed_dot(T_late, b_f2_after, t0, t1, v0, v1, color="#e05050")
    s += feed_label(0,      "F1",         t0, t1, v0, v1)
    s += feed_label(T_late, "F2 (late)",  t0, t1, v0, v1, color="#c04040")

    # Annotations
    b_f2_val = round(b_f2)
    b_f2a_val = round(b_f2_after)
    s += annotate(T_late, b_f2, t0, t1, v0, v1,
                  f"balance = {b_f2_val} ml\nwhen F2 given",
                  dx=-65, dy=-6, color="#c04040")
    s += annotate(T_late, b_f2_after, t0, t1, v0, v1,
                  f"+100 ml → {b_f2a_val} ml\n(not back to +100)",
                  dx=10, dy=-6, color="#1a5fa8")

    s += ytick(0,    t0, t1, v0, v1, "0")
    s += ytick(MILK, t0, t1, v0, v1, "+100")
    s += ytick(b_f2_val, t0, t1, v0, v1, str(b_f2_val), color="#c04040")

    s += bracket(0, SI, 0, t0, t1, v0, v1, "SI")
    s += bracket(SI, T_late, 0, t0, t1, v0, v1, "+1h late")

    s += svg_end()
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Diagram 3: All-time balance, Predictor A
# ─────────────────────────────────────────────────────────────────────────────

def diagram_atb_predA():
    T_late = SI + 1.0
    T_A    = T_late + SI        # standard time = SI after F2
    b_at_TA = balance_at(T_A - 1e-9, [(0, MILK), (T_late, MILK)])
    # volumeA restores to MILK: need balance to go to +MILK after feeding
    # all-time: volumeA = (b_target_after) - b_at_TA = MILK - b_at_TA
    volumeA  = MILK - b_at_TA  # = 143 ml
    feeds_all = [(0, MILK), (T_late, MILK), (T_A, volumeA)]

    t0, t1 = T_late - 0.3, T_A + 1.0
    v0, v1 = -55, 125

    s = svg_start("All-time balance — Predictor A")
    s += title_text(f"Predictor A: give {volumeA:.0f} ml milk (≈ {round(volumeA/1.111):.0f} ml water) at standard time")
    s += axes(t0, t1, v0, v1, ylabel="balance (ml)")
    s += hline(0,    t0, t1, v0, v1, color="#888", dash="4,3")
    s += hline(MILK, t0, t1, v0, v1, color="#2c8a50", dash="5,3", label="+100 (equilibrium)")

    # balance curve from T_late onward
    b_f2 = balance_at(T_late - 1e-9, [(0, MILK)])
    b_f2_after = balance_at(T_late + 1e-9, [(0, MILK), (T_late, MILK)])

    pts = []
    pts.append((mapx(T_late, t0, t1), mapy(b_f2_after, v0, v1)))
    pts.append((mapx(T_A, t0, t1), mapy(b_at_TA, v0, v1)))
    # spike at T_A
    pts.append((mapx(T_A, t0, t1), mapy(MILK, v0, v1)))
    tend = T_A + 0.9
    pts.append((mapx(tend, t0, t1), mapy(balance_at(tend, feeds_all), v0, v1)))
    s += polyline(pts)

    # dots
    s += feed_dot(T_late, b_f2_after, t0, t1, v0, v1, color="#e05050")
    s += feed_dot(T_A,    MILK,        t0, t1, v0, v1)
    s += feed_label(T_late, "F2 (late)", t0, t1, v0, v1, color="#c04040")
    s += feed_label(T_A,   "F3 (Pred A)", t0, t1, v0, v1)

    # Annotation on spike
    s += annotate(T_A, b_at_TA, t0, t1, v0, v1,
                  f"balance = {b_at_TA:.0f} ml",
                  dx=-60, dy=10, color="#c04040")
    s += annotate(T_A, MILK, t0, t1, v0, v1,
                  f"give {volumeA:.0f} ml → balance = +100",
                  dx=8, dy=-4, color="#2c8a50")

    # vertical "give" arrow
    xa = mapx(T_A, t0, t1)
    ya1 = mapy(b_at_TA, v0, v1)
    ya2 = mapy(MILK, v0, v1)
    s += f'  <line x1="{xa+3:.1f}" y1="{ya1:.1f}" x2="{xa+3:.1f}" y2="{ya2:.1f}" stroke="#2c8a50" stroke-width="1.5" stroke-dasharray="3,2"/>\n'
    s += f'  <polygon points="{xa+3:.1f},{ya2:.1f} {xa:.1f},{ya2+7:.1f} {xa+6:.1f},{ya2+7:.1f}" fill="#2c8a50"/>\n'

    s += ytick(0,    t0, t1, v0, v1, "0")
    s += ytick(MILK, t0, t1, v0, v1, "+100")
    s += ytick(b_at_TA, t0, t1, v0, v1, f"{b_at_TA:.0f}", color="#c04040")
    s += bracket(T_late, T_A, 0, t0, t1, v0, v1, "SI = 2h 19m")

    s += svg_end()
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Diagram 4: All-time balance, Predictor B
# ─────────────────────────────────────────────────────────────────────────────

def diagram_atb_predB():
    T_late   = SI + 1.0
    b_f2_after = balance_at(T_late + 1e-9, [(0, MILK), (T_late, MILK)])
    # Find T_B: balance = -MILK (so +MILK brings it to 0)
    # b_f2_after - RATE*(T_B - T_late) = -MILK
    T_B = T_late + (b_f2_after + MILK) / RATE
    feeds_all = [(0, MILK), (T_late, MILK), (T_B, MILK)]

    t0, t1 = T_late - 0.3, T_B + 1.0
    v0, v1 = -115, 80

    s = svg_start("All-time balance — Predictor B")
    s += title_text(f"Predictor B: standard 100 ml at T_B = {(T_B-T_late)*60:.0f} min after F2")
    s += axes(t0, t1, v0, v1, ylabel="balance (ml)")
    s += hline(0,    t0, t1, v0, v1, color="#888",   dash="4,3")
    s += hline(-MILK, t0, t1, v0, v1, color="#1a5fa8", dash="5,3", label="−100 (trigger point)")

    # balance curve
    pts = []
    pts.append((mapx(T_late, t0, t1), mapy(b_f2_after, v0, v1)))
    pts.append((mapx(T_B,    t0, t1), mapy(-MILK,       v0, v1)))
    pts.append((mapx(T_B,    t0, t1), mapy(0,            v0, v1)))
    tend = T_B + 0.9
    pts.append((mapx(tend,   t0, t1), mapy(balance_at(tend, feeds_all), v0, v1)))
    s += polyline(pts)

    # dots
    s += feed_dot(T_late, b_f2_after, t0, t1, v0, v1, color="#e05050")
    s += feed_dot(T_B,    0,           t0, t1, v0, v1)
    s += feed_label(T_late, "F2 (late)", t0, t1, v0, v1, color="#c04040")
    s += feed_label(T_B,   f"F3 (T_B)", t0, t1, v0, v1)

    s += annotate(T_late, b_f2_after, t0, t1, v0, v1,
                  f"balance after F2 = +{b_f2_after:.0f} ml",
                  dx=8, dy=-4, color="#555")
    s += annotate(T_B, -MILK, t0, t1, v0, v1,
                  f"balance = −100 ml\ngive 100 ml → 0",
                  dx=8, dy=-4, color="#1a5fa8")

    s += ytick(0,    t0, t1, v0, v1, "0")
    s += ytick(b_f2_after, t0, t1, v0, v1, f"+{b_f2_after:.0f}", color="#2c8a50")
    s += ytick(-MILK, t0, t1, v0, v1, "−100", color="#1a5fa8")

    s += bracket(T_late, T_B, -MILK, t0, t1, v0, v1, f"{(T_B-T_late)*60:.0f} min after F2")

    s += svg_end()
    return s


# ─────────────────────────────────────────────────────────────────────────────
# 24h intake helper (steady-state approximation using linear decay model)
# ─────────────────────────────────────────────────────────────────────────────

def intake_ss(t, feeds):
    """
    Approximate steady-state 24h smoothed intake.
    Uses the analytical result: in steady state, between feeds the intake
    decays linearly at RATE from (DAILY+MILK) after each feed to DAILY before next.
    For diagrams, we compute this directly using the bottleCredit formula
    with a long prior history of steady-state feeds.
    """
    # Build history: 20 feeds before the earliest feed in `feeds`
    if feeds:
        t_first = min(tf for tf, ml in feeds)
    else:
        t_first = t
    history = [(t_first - (i+1)*SI, MILK) for i in range(20)]
    all_feeds = history + [(tf, ml) for tf, ml in feeds if tf <= t]
    total = 0.0
    for (tf, ml) in all_feeds:
        age = t - tf
        if age < 0:
            continue
        if age <= 24:
            total += ml
        else:
            credit = ml - RATE * (age - 24)
            if credit > 0:
                total += credit
    return total


# ─────────────────────────────────────────────────────────────────────────────
# Diagram 5: 24h intake, perfect rhythm
# ─────────────────────────────────────────────────────────────────────────────

def diagram_24h_perfect():
    feeds = [(0, MILK), (SI, MILK), (2*SI, MILK)]
    t0, t1 = -0.3, 2*SI + 0.5
    v0, v1 = 900, 1165

    s = svg_start("24h intake — perfect rhythm (steady state)")
    s += title_text("24h intake — perfect rhythm (steady state, 6.9 kg, 90 ml water)")
    s += axes(t0, t1, v0, v1, ylabel="24h intake (ml)")
    s += hline(DAILY, t0, t1, v0, v1, color="#e07020", dash="8,4", label=f"daily target {DAILY:.0f} ml")

    # Compute intake curve: sample densely
    N = 300
    pts_raw = []
    for i in range(N+1):
        t = t0 + i * (t1 - t0) / N
        # avoid exact feed times (discontinuity)
        v = intake_ss(t, feeds)
        pts_raw.append((t, v))

    # Split at feed times (vertical jumps)
    segments = []
    seg = []
    for i, (t, v) in enumerate(pts_raw):
        # check if we just crossed a feed time
        jumped = False
        for tf, ml in feeds:
            if i > 0 and pts_raw[i-1][0] < tf <= t:
                # end current segment just before feed
                if seg:
                    segments.append(seg)
                seg = []
                jumped = True
                break
        seg.append((mapx(t, t0, t1), mapy(v, v0, v1)))
    if seg:
        segments.append(seg)

    for seg in segments:
        s += polyline(seg)

    # Vertical spikes at feed times
    for tf, _ in feeds:
        v_before = intake_ss(tf - 1e-6, feeds)
        v_after  = intake_ss(tf + 1e-6, feeds)
        s += polyline([(mapx(tf, t0, t1), mapy(v_before, v0, v1)),
                       (mapx(tf, t0, t1), mapy(v_after,  v0, v1))])
        s += feed_dot(tf, v_after, t0, t1, v0, v1)

    for i, (tf, _) in enumerate(feeds):
        s += feed_label(tf, f"F{i+1}", t0, t1, v0, v1)

    s += ytick(DAILY,        t0, t1, v0, v1, f"{DAILY:.0f}", color="#e07020")
    s += ytick(DAILY + MILK, t0, t1, v0, v1, f"{DAILY+MILK:.0f}")
    s += ytick(DAILY - MILK, t0, t1, v0, v1, f"{DAILY-MILK:.0f}", color="#aaa")
    s += bracket(0, SI, DAILY-MILK, t0, t1, v0, v1, "SI = 2h 19m")

    s += annotate(SI*0.5, DAILY+MILK, t0, t1, v0, v1,
                  "intake perfectly flat\n(all bottles < 24h old)",
                  dx=-80, dy=4, color="#888")
    s += annotate(SI*1.5, (DAILY+DAILY+MILK)/2, t0, t1, v0, v1,
                  "linear decay at\nhourlyRate = 43 ml/h",
                  dx=8, dy=-4, color="#555")

    s += svg_end()
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Diagram 6: 24h intake, late feed
# ─────────────────────────────────────────────────────────────────────────────

def diagram_24h_late():
    T_late = SI + 1.0
    feeds_before_F2 = [(0, MILK)]
    feeds_with_F2   = [(0, MILK), (T_late, MILK)]

    t0, t1 = -0.3, T_late + 0.6
    v0, v1 = 870, 1165

    s = svg_start("24h intake — late feed")
    s += title_text("24h intake — F2 given 1 hour late")
    s += axes(t0, t1, v0, v1, ylabel="24h intake (ml)")
    s += hline(DAILY, t0, t1, v0, v1, color="#e07020", dash="8,4", label=f"{DAILY:.0f} ml target")
    s += vline_dashed(SI, t0, t1, v0, v1, color="#bbb", label="normal SI")

    N = 300
    pts_before = []
    pts_after  = []
    for i in range(N+1):
        t = t0 + i * (t1 - t0) / N
        if t <= T_late - 1e-6:
            pts_before.append((mapx(t, t0, t1), mapy(intake_ss(t, feeds_before_F2), v0, v1)))
        else:
            pts_after.append((mapx(t, t0, t1), mapy(intake_ss(t, feeds_with_F2), v0, v1)))

    s += polyline(pts_before)
    # dashed portion after SI (overdue)
    si_idx = next((i for i, (mx_t, _) in enumerate(pts_before) if mx_t >= mapx(SI, t0, t1)), len(pts_before))
    if si_idx < len(pts_before):
        s += polyline(pts_before[si_idx:], color="#e05050", width=2.0, dash="6,3")

    # spike at T_late
    v_before_f2 = intake_ss(T_late - 1e-6, feeds_before_F2)
    v_after_f2  = intake_ss(T_late + 1e-6, feeds_with_F2)
    s += polyline([(mapx(T_late, t0, t1), mapy(v_before_f2, v0, v1)),
                   (mapx(T_late, t0, t1), mapy(v_after_f2,  v0, v1))])
    s += polyline(pts_after)

    s += feed_dot(0,      intake_ss(1e-6, [(0,MILK)]), t0, t1, v0, v1)
    s += feed_dot(T_late, v_after_f2,                   t0, t1, v0, v1, color="#e05050")
    s += feed_label(0,      "F1",        t0, t1, v0, v1)
    s += feed_label(T_late, "F2 (late)", t0, t1, v0, v1, color="#c04040")

    s += ytick(DAILY,        t0, t1, v0, v1, f"{DAILY:.0f}", color="#e07020")
    s += ytick(DAILY+MILK,   t0, t1, v0, v1, f"{DAILY+MILK:.0f}")
    s += ytick(round(v_before_f2), t0, t1, v0, v1, f"{v_before_f2:.0f}", color="#c04040")
    s += ytick(round(v_after_f2),  t0, t1, v0, v1, f"{v_after_f2:.0f}",  color="#2c8a50")

    s += annotate(T_late, v_before_f2, t0, t1, v0, v1,
                  f"intake = {v_before_f2:.0f} ml\nwhen F2 given (1h late)",
                  dx=-80, dy=8, color="#c04040")
    s += annotate(T_late, v_after_f2, t0, t1, v0, v1,
                  f"+100 ml → {v_after_f2:.0f} ml\n({DAILY+MILK-v_after_f2:.0f} ml below equilibrium)",
                  dx=8, dy=-4, color="#2c8a50")

    s += bracket(SI, T_late, DAILY-MILK, t0, t1, v0, v1, "+1h overdue")

    s += svg_end()
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Diagram 7: 24h intake, Predictor A
# ─────────────────────────────────────────────────────────────────────────────

def diagram_24h_predA():
    T_late  = SI + 1.0
    T_A     = T_late + SI
    feeds_F2 = [(0, MILK), (T_late, MILK)]
    v_at_TA  = intake_ss(T_A, feeds_F2)
    volumeA  = (DAILY + MILK) - v_at_TA   # = 143 ml

    feeds_F3 = feeds_F2 + [(T_A, volumeA)]

    t0, t1 = T_late - 0.2, T_A + 0.8
    v0, v1 = 870, 1165

    s = svg_start("24h intake — Predictor A")
    s += title_text(f"Predictor A: give {volumeA:.0f} ml milk (≈ {round(volumeA/1.111):.0f} ml water) at standard time")
    s += axes(t0, t1, v0, v1, ylabel="24h intake (ml)")
    s += hline(DAILY,      t0, t1, v0, v1, color="#e07020", dash="8,4", label=f"{DAILY:.0f} ml")
    s += hline(DAILY+MILK, t0, t1, v0, v1, color="#2c8a50", dash="5,3", label=f"{DAILY+MILK:.0f} ml (equilibrium)")

    N = 300
    pts_seg1, pts_seg2 = [], []
    for i in range(N+1):
        t = t0 + i * (t1 - t0) / N
        if t <= T_A - 1e-6:
            pts_seg1.append((mapx(t, t0, t1), mapy(intake_ss(t, feeds_F2), v0, v1)))
        else:
            pts_seg2.append((mapx(t, t0, t1), mapy(intake_ss(t, feeds_F3), v0, v1)))

    v_f2_after = intake_ss(T_late+1e-6, feeds_F2)
    s += polyline(pts_seg1)
    s += polyline([(mapx(T_A, t0, t1), mapy(v_at_TA,      v0, v1)),
                   (mapx(T_A, t0, t1), mapy(DAILY+MILK,    v0, v1))])
    s += polyline(pts_seg2)

    s += feed_dot(T_late, v_f2_after,  t0, t1, v0, v1, color="#e05050")
    s += feed_dot(T_A,    DAILY+MILK,  t0, t1, v0, v1)
    s += feed_label(T_late, "F2 (late)",   t0, t1, v0, v1, color="#c04040")
    s += feed_label(T_A,   "F3 (Pred A)", t0, t1, v0, v1)

    # "give" arrow
    xa = mapx(T_A, t0, t1) + 3
    ya1 = mapy(v_at_TA,   v0, v1)
    ya2 = mapy(DAILY+MILK, v0, v1)
    s += f'  <line x1="{xa:.1f}" y1="{ya1:.1f}" x2="{xa:.1f}" y2="{ya2:.1f}" stroke="#2c8a50" stroke-width="1.5" stroke-dasharray="3,2"/>\n'
    s += f'  <polygon points="{xa:.1f},{ya2:.1f} {xa-4:.1f},{ya2+8:.1f} {xa+4:.1f},{ya2+8:.1f}" fill="#2c8a50"/>\n'

    s += annotate(T_A, v_at_TA, t0, t1, v0, v1,
                  f"intake = {v_at_TA:.0f} ml at SI",
                  dx=-70, dy=6, color="#555")
    s += annotate(T_A, DAILY+MILK, t0, t1, v0, v1,
                  f"give {volumeA:.0f} ml → {DAILY+MILK:.0f} ml",
                  dx=8, dy=-2, color="#2c8a50")

    s += ytick(DAILY,        t0, t1, v0, v1, f"{DAILY:.0f}", color="#e07020")
    s += ytick(DAILY+MILK,   t0, t1, v0, v1, f"{DAILY+MILK:.0f}")
    s += ytick(v_at_TA,      t0, t1, v0, v1, f"{v_at_TA:.0f}", color="#555")
    s += bracket(T_late, T_A, DAILY-MILK, t0, t1, v0, v1, "SI = 2h 19m")

    s += svg_end()
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Diagram 8: 24h intake, Predictor B
# ─────────────────────────────────────────────────────────────────────────────

def diagram_24h_predB():
    T_late   = SI + 1.0
    feeds_F2 = [(0, MILK), (T_late, MILK)]
    v_f2_after = intake_ss(T_late + 1e-6, feeds_F2)

    # Predictor B: find T_B where intake = DAILY
    T_B = None
    for step in range(1, 10000):
        t_try = T_late + step * 0.001
        if intake_ss(t_try, feeds_F2) <= DAILY:
            T_B = t_try
            break
    feeds_F3 = feeds_F2 + [(T_B, MILK)]

    t0, t1 = T_late - 0.2, T_B + 0.9
    v0, v1 = 900, 1165

    s = svg_start("24h intake — Predictor B")
    s += title_text(f"Predictor B: standard 100 ml at T_B = {(T_B-T_late)*60:.0f} min after F2")
    s += axes(t0, t1, v0, v1, ylabel="24h intake (ml)")
    s += hline(DAILY,      t0, t1, v0, v1, color="#e07020", dash="8,4", label=f"{DAILY:.0f} ml (Pred B trigger)")
    s += hline(DAILY+MILK, t0, t1, v0, v1, color="#2c8a50", dash="5,3", label=f"{DAILY+MILK:.0f} ml")

    N = 300
    pts_seg1, pts_seg2 = [], []
    for i in range(N+1):
        t = t0 + i * (t1 - t0) / N
        if t <= T_B - 1e-6:
            pts_seg1.append((mapx(t, t0, t1), mapy(intake_ss(t, feeds_F2), v0, v1)))
        else:
            pts_seg2.append((mapx(t, t0, t1), mapy(intake_ss(t, feeds_F3), v0, v1)))

    s += polyline(pts_seg1)
    s += polyline([(mapx(T_B, t0, t1), mapy(DAILY,      v0, v1)),
                   (mapx(T_B, t0, t1), mapy(DAILY+MILK,  v0, v1))])
    s += polyline(pts_seg2)

    s += feed_dot(T_late, v_f2_after, t0, t1, v0, v1, color="#e05050")
    s += feed_dot(T_B,    DAILY+MILK, t0, t1, v0, v1)
    s += feed_label(T_late, "F2 (late)", t0, t1, v0, v1, color="#c04040")
    s += feed_label(T_B,   f"F3 (T_B)",  t0, t1, v0, v1)

    s += annotate(T_late, v_f2_after, t0, t1, v0, v1,
                  f"intake after F2 = {v_f2_after:.0f} ml",
                  dx=8, dy=-4, color="#555")
    s += annotate(T_B, DAILY, t0, t1, v0, v1,
                  f"intake = {DAILY:.0f} ml → feed now\n+100 ml → {DAILY+MILK:.0f} ml ✓",
                  dx=8, dy=4, color="#1a5fa8")

    s += ytick(DAILY,      t0, t1, v0, v1, f"{DAILY:.0f}",      color="#e07020")
    s += ytick(DAILY+MILK, t0, t1, v0, v1, f"{DAILY+MILK:.0f}")
    s += ytick(v_f2_after, t0, t1, v0, v1, f"{v_f2_after:.0f}", color="#2c8a50")
    s += bracket(T_late, T_B, DAILY, t0, t1, v0, v1, f"{(T_B-T_late)*60:.0f} min after F2")

    s += svg_end()
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Generate all and write to files
# ─────────────────────────────────────────────────────────────────────────────

diagrams = {
    "atb-perfect":  diagram_atb_perfect,
    "atb-late":     diagram_atb_late,
    "atb-predA":    diagram_atb_predA,
    "atb-predB":    diagram_atb_predB,
    "24h-perfect":  diagram_24h_perfect,
    "24h-late":     diagram_24h_late,
    "24h-predA":    diagram_24h_predA,
    "24h-predB":    diagram_24h_predB,
}

results = {}
for name, fn in diagrams.items():
    svg = fn()
    results[name] = svg
    path = os.path.join(OUT_DIR, f"diag-{name}.svg")
    with open(path, "w") as f:
        f.write(svg)
    print(f"  wrote diag-{name}.svg")

# Preview HTML
html = """<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
body { font-family: DejaVu Sans, sans-serif; margin: 30px; background: #f5f5f5; }
h2 { font-size: 13pt; color: #333; margin: 28px 0 4px 0; }
p  { font-size: 9.5pt; color: #666; margin: 4px 0 12px 0; }
</style>
</head><body>
<h1 style="font-size:16pt">MilkWise — Diagram Preview (Option 3 style)</h1>
"""
labels = {
    "atb-perfect": ("§3.1 All-time balance — perfect rhythm", "Saw-tooth: each feed spikes to +100 ml, decays linearly to 0 over SI."),
    "atb-late":    ("§3.1 All-time balance — late feed", "F2 given 1 hour late. Balance falls to −43 ml before F2; recovers only to +57 ml."),
    "atb-predA":   ("§3.1 Predictor A on all-time balance", "Give 143 ml at the standard time (SI after F2) to restore equilibrium."),
    "atb-predB":   ("§3.1 Predictor B on all-time balance", "Give 100 ml when balance = −100 ml (3h 39m after F2)."),
    "24h-perfect": ("§3.4 24h intake — perfect rhythm (steady state)", "Intake flat between feeds (all bottles &lt; 24h old), decays once oldest crosses 24h mark."),
    "24h-late":    ("§3.4 24h intake — late feed", "F2 given 1 hour late. Intake falls to 992 ml; recovers only to 1092 ml (43 ml below equilibrium)."),
    "24h-predA":   ("§3.4 Predictor A on 24h model", "Give 143 ml at SI after F2 → intake returns to 1135 ml (equilibrium)."),
    "24h-predB":   ("§3.4 Predictor B on 24h model", "Give 100 ml when intake = 1035 ml (daily target) — naturally restores to 1135 ml."),
}
for name, (title, desc) in labels.items():
    html += f"<h2>{title}</h2><p>{desc}</p>{results[name]}\n"

html += "</body></html>"
preview_path = os.path.join(OUT_DIR, "diagram-preview.html")
with open(preview_path, "w") as f:
    f.write(html)
print(f"  wrote diagram-preview.html")
