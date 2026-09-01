#!/usr/bin/env python3
"""
Generate 24h intake diagrams:
  diag-24h-underfeed-mild.svg   (sub-case 1: D < I < D+m0)
  diag-24h-underfeed-severe.svg (sub-case 2: I < D)
  diag-24h-overfeed.svg

Design rules (Koen-approved 2026-06-29):
- Curve in dark grey (#333), splits at T_A and T_B into future spikes
- T=0 marked with a light dashed vertical
- T_A (blue) and T_B (red) vertical dashed lines
  Labels at TOP of the diagram, non-overlapping:
    earlier time → label left-aligned to the right of its line
    later  time  → label right-aligned to the left of its line
    (if they are close, the later one moves further left)
- Horizontal blue dashed line at I(T_A) with value on y-axis in blue
- Bottle silhouette centred on T_A and T_B vertical lines
  V_A (blue): spans I(T_A) → D+m0
  V_B (red):  spans I(T_B) → I(T_B)+V_B
- I0 tick on y-axis in BLACK
- D tick in orange, D+m0 tick in green
- SI bracket along x-axis
- No text overlap
"""
import os, math
OUT = os.path.dirname(os.path.abspath(__file__))

WEIGHT = 6.47
DAILY  = WEIGHT * 150   # 970.5
RATE   = DAILY / 24     # 40.4375
MILK   = 100.0
SI     = MILK / RATE    # 2.473h

W, H = 640, 270
L, R, T_ax, B = 84, 574, 28, 200

def mapx(t, t0, t1): return L + (t - t0) / (t1 - t0) * (R - L)
def mapy(v, v0, v1): return T_ax + (v1 - v) / (v1 - v0) * (B - T_ax)

def intake_at(t_now, all_feeds):
    total = 0.0
    for tf, ml in all_feeds:
        age = t_now - tf
        if age < 0: continue
        if age <= 24: total += ml
        else:
            c = ml - RATE*(age-24)
            if c > 0: total += c
    return total

def polyline(pts, color, width=2.2, dash=""):
    coords = " ".join(f"{p[0]:.1f},{p[1]:.1f}" for p in pts)
    da = f' stroke-dasharray="{dash}"' if dash else ""
    return f'  <polyline points="{coords}" stroke="{color}" stroke-width="{width}" fill="none" stroke-linecap="round" stroke-linejoin="round"{da}/>\n'

# ── Bottle silhouette (centred on cx) ────────────────────────────────────────

def bottle(cx, y_bottom, y_top, color, label, label_side="right"):
    """Bottle shape centred at cx. y_bottom=curve level, y_top=after feed level."""
    h = y_bottom - y_top
    if h < 5: return ""
    BW = 7; NW = 3; NH = max(5, h*0.22)
    by = y_top + NH
    path = (f"M {cx-NW:.1f},{y_top:.1f} L {cx-BW:.1f},{by:.1f} "
            f"L {cx-BW:.1f},{y_bottom:.1f} L {cx+BW:.1f},{y_bottom:.1f} "
            f"L {cx+BW:.1f},{by:.1f} L {cx+NW:.1f},{y_top:.1f} Z")
    s  = f'  <path d="{path}" fill="{color}" fill-opacity="0.18" stroke="{color}" stroke-width="1.3"/>\n'
    s += f'  <line x1="{cx-NW-2:.1f}" y1="{y_top:.1f}" x2="{cx+NW+2:.1f}" y2="{y_top:.1f}" stroke="{color}" stroke-width="2.5" stroke-linecap="round"/>\n'
    mid = (y_bottom + y_top) / 2
    if label_side == "right":
        s += f'  <text x="{cx+BW+5:.1f}" y="{mid+4:.1f}" font-size="8.5" fill="{color}" font-family="DejaVu Sans" font-weight="bold">{label}</text>\n'
    else:
        s += f'  <text x="{cx-BW-5:.1f}" y="{mid+4:.1f}" font-size="8.5" fill="{color}" font-family="DejaVu Sans" text-anchor="end" font-weight="bold">{label}</text>\n'
    return s

# ── Split curve: history + two future branches ────────────────────────────────

def split_curve_segs(feeds, t0, t1, T_A, V_A_add, T_B, V_B_add, v0_g, v1_g, N=2000):
    """
    Returns SVG polyline strings:
    - history curve from t0 to min(T_A,T_B)
    - branch A: spike at T_A by V_A_add, then decay
    - branch B: spike at T_B by V_B_add, then decay
    """
    T_split = min(T_A, T_B)  # curve is shared up to this point
    T_late  = max(T_A, T_B)

    def iv(t): return intake_at(t, feeds)

    def seg_pts(t_from, t_to, extra=0.0, extra_at=None, n=800):
        """Sample intake from t_from to t_to, optionally adding extra at extra_at."""
        pts = []
        dt = (t_to - t_from) / n
        for i in range(n+1):
            t = t_from + i*dt
            v = iv(t)
            if extra and extra_at is not None and t >= extra_at:
                v += extra
            pts.append((mapx(t, t0, t1), mapy(v, v0_g, v1_g)))
        return pts

    # shared history up to T_split
    hist = []
    feed_times = sorted(tf for tf,_ in feeds if t0-0.01 <= tf <= T_split+0.01)
    n = 1000
    seg = []
    segs = []
    for i in range(n+1):
        t = t0 + i*(T_split-t0)/n
        for tf in feed_times:
            if i>0 and (t0+(i-1)*(T_split-t0)/n) < tf <= t:
                seg.append((mapx(tf, t0, t1), mapy(iv(tf-1e-6), v0_g, v1_g)))
                segs.append(seg)
                seg = [(mapx(tf, t0, t1), mapy(iv(tf+1e-6), v0_g, v1_g))]
                break
        seg.append((mapx(t), mapy(iv(t))) if False else
                   (mapx(t, t0, t1), mapy(iv(t), v0_g, v1_g)))
    if seg: segs.append(seg)

    # At T_split, the two branches diverge
    # If T_B < T_A: branch B spikes at T_B, branch A continues then spikes at T_A
    # If T_A < T_B: branch A spikes at T_A, branch B continues then spikes at T_B

    if T_B <= T_A:
        # T_B is earlier: branch B = spike at T_B, then normal decay with V_B added
        # branch A = no spike at T_B, continues, spikes at T_A
        T_early, V_early = T_B, V_B_add
        T_late2, V_late  = T_A, V_A_add
        col_early, col_late = "#e05050", "#1a5fa8"
    else:
        T_early, V_early = T_A, V_A_add
        T_late2, V_late  = T_B, V_B_add
        col_early, col_late = "#1a5fa8", "#e05050"

    results = []
    # history lines (dark grey)
    for sg in segs:
        results.append(("history", sg))

    # Shared segment from T_split to T_early (only if T_split != T_early)
    # (they're the same when T_B=now or T_A=now)

    # Branch early: spike at T_early, continue to t1
    v_at_early = iv(T_early)
    # spike: vertical line up
    y_before = mapy(v_at_early, v0_g, v1_g)
    y_after  = mapy(v_at_early + V_early, v0_g, v1_g)
    results.append(("spike_early", col_early,
                    [(mapx(T_early, t0, t1), y_before),
                     (mapx(T_early, t0, t1), y_after)]))
    # decay after spike
    def make_future(t_start, v_offset, t_end, n=600):
        pts = []
        # Extra feed added at t_start
        extra_feeds = list(feeds) + [(t_start, v_offset)]
        feed_ts = sorted(tf for tf,_ in extra_feeds if t_start-0.01 <= tf <= t_end+0.01)
        seg2 = []
        segs2 = []
        for i in range(n+1):
            t = t_start + i*(t_end-t_start)/n
            for tf in feed_ts:
                if i>0 and (t_start+(i-1)*(t_end-t_start)/n) < tf <= t:
                    seg2.append((mapx(tf, t0, t1), mapy(intake_at(tf-1e-6, extra_feeds), v0_g, v1_g)))
                    segs2.append(seg2)
                    seg2 = [(mapx(tf, t0, t1), mapy(intake_at(tf+1e-6, extra_feeds), v0_g, v1_g))]
                    break
            seg2.append((mapx(t, t0, t1), mapy(intake_at(t, extra_feeds), v0_g, v1_g)))
        if seg2: segs2.append(seg2)
        return segs2

    for sg in make_future(T_early, V_early, t1):
        results.append(("future_early", col_early, sg))

    # Branch late: no extra feed at T_early, spike at T_late2
    v_at_late = iv(T_late2)
    y_bl = mapy(v_at_late, v0_g, v1_g)
    y_al = mapy(v_at_late + V_late, v0_g, v1_g)
    # segment from T_split to T_late2 (unmodified)
    seg_to_late = []
    for i in range(400):
        t = T_split + i*(T_late2-T_split)/400
        seg_to_late.append((mapx(t, t0, t1), mapy(iv(t), v0_g, v1_g)))
    seg_to_late.append((mapx(T_late2, t0, t1), mapy(iv(T_late2), v0_g, v1_g)))
    results.append(("history_late", col_late, seg_to_late))
    results.append(("spike_late", col_late,
                    [(mapx(T_late2, t0, t1), y_bl),
                     (mapx(T_late2, t0, t1), y_al)]))
    for sg in make_future(T_late2, V_late, t1):
        results.append(("future_late", col_late, sg))

    return results

# ── Core diagram builder ──────────────────────────────────────────────────────

def build_diagram(feeds, t0, t1, v0, v1, T_A, V_A, T_B, V_B,
                  v_iTA, v_iTB, v_i0, title_text,
                  ta_label, tb_label, tb_is_now=False):
    """
    Build a full diagram SVG string.
    V_A: milk to give at T_A (bottle spans v_iTA → v_iTA+V_A)
    V_B: milk to give at T_B (bottle spans v_iTB → v_iTB+V_B)
    """
    s = (f'<svg width="{W}" height="{H}" xmlns="http://www.w3.org/2000/svg" '
         f'style="background:#ffffff;border:1px solid #ccc;border-radius:4px;display:block;">\n')
    s += f'  <text x="{(L+R)/2:.0f}" y="18" font-size="9.5" fill="#444" font-family="DejaVu Sans" text-anchor="middle" font-style="italic">{title_text}</text>\n'

    mx = lambda t: mapx(t, t0, t1)
    my = lambda v: mapy(v, v0, v1)

    # Axes
    s += f'  <line x1="{mx(t0):.1f}" y1="{T_ax-8}" x2="{mx(t0):.1f}" y2="{B+2}" stroke="#222" stroke-width="2" stroke-linecap="round"/>\n'
    s += f'  <polygon points="{mx(t0):.1f},{T_ax-10} {mx(t0)-4:.1f},{T_ax+2} {mx(t0)+4:.1f},{T_ax+2}" fill="#222"/>\n'
    s += f'  <line x1="{mx(t0)-2:.1f}" y1="{B}" x2="{R+8:.1f}" y2="{B}" stroke="#222" stroke-width="2" stroke-linecap="round"/>\n'
    s += f'  <polygon points="{R+10},{B} {R},{B-4} {R},{B+4}" fill="#222"/>\n'
    s += f'  <text x="{R+12}" y="{B+4}" font-size="9" fill="#666" font-family="DejaVu Sans">time</text>\n'
    # y-axis label
    mid = (T_ax+B)/2
    s += f'  <text x="12" y="{mid:.0f}" font-size="9.5" fill="#555" font-family="DejaVu Sans" transform="rotate(-90,12,{mid:.0f})" text-anchor="middle">24h intake (ml)</text>\n'

    # Reference lines
    def hl(v, color, dash, lbl=""):
        y = my(v)
        seg = f'  <line x1="{mx(t0):.1f}" y1="{y:.1f}" x2="{mx(t1):.1f}" y2="{y:.1f}" stroke="{color}" stroke-width="1.3" stroke-dasharray="{dash}"/>\n'
        if lbl:
            seg += f'  <text x="{mx(t1)+3:.1f}" y="{y+4:.1f}" font-size="9" fill="{color}" font-family="DejaVu Sans">{lbl}</text>\n'
        return seg
    s += hl(DAILY,      "#e07020", "8,4", f"D={DAILY:.0f}")
    s += hl(DAILY+MILK, "#2c8a50", "5,3", f"D+m&#x2080;={DAILY+MILK:.0f}")

    # Horizontal blue line at I(T_A)
    y_iTA = my(v_iTA)
    s += f'  <line x1="{mx(t0):.1f}" y1="{y_iTA:.1f}" x2="{mx(T_A):.1f}" y2="{y_iTA:.1f}" stroke="#1a5fa8" stroke-width="1" stroke-dasharray="4,3"/>\n'
    # Y-axis label for I(T_A): placed to left of axis, ensuring no overlap with D/D+m0 ticks
    # Offset down by 10px if it's close to another tick
    y_D     = my(DAILY)
    y_Dm0   = my(DAILY+MILK)
    y_I0    = my(v_i0)
    y_lbl   = y_iTA + 4
    for y_other in [y_D, y_Dm0, y_I0]:
        if abs(y_lbl - y_other) < 12:
            y_lbl = y_other + 14   # push below the conflicting tick
    s += f'  <text x="{mx(t0)-7:.1f}" y="{y_lbl:.1f}" font-size="8" fill="#1a5fa8" font-family="DejaVu Sans" text-anchor="end">{v_iTA:.0f}</text>\n'

    # Draw split curves
    segs = split_curve_segs(feeds, t0, t1, T_A, V_A, T_B, V_B, v0, v1)
    for item in segs:
        kind = item[0]
        if kind == "history":
            for pt in [item[1]]:
                coords = " ".join(f"{p[0]:.1f},{p[1]:.1f}" for p in pt)
                s += f'  <polyline points="{coords}" stroke="#333" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>\n'
        elif kind in ("spike_early","spike_late"):
            col = item[1]; pts = item[2]
            coords = " ".join(f"{p[0]:.1f},{p[1]:.1f}" for p in pts)
            s += f'  <polyline points="{coords}" stroke="{col}" stroke-width="2" fill="none" stroke-linecap="round"/>\n'
        elif kind in ("future_early","future_late","history_late"):
            col = item[1]; pts = item[2]
            coords = " ".join(f"{p[0]:.1f},{p[1]:.1f}" for p in pts)
            dash = "5,3" if "future" in kind else ""
            da = f' stroke-dasharray="{dash}"' if dash else ""
            s += f'  <polyline points="{coords}" stroke="{col}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"{da}/>\n'

    # T=0 vertical
    x0 = mx(0)
    s += f'  <line x1="{x0:.1f}" y1="{T_ax}" x2="{x0:.1f}" y2="{B}" stroke="#bbb" stroke-width="1.2" stroke-dasharray="3,2"/>\n'
    s += f'  <text x="{x0+3:.1f}" y="{T_ax+11:.1f}" font-size="8" fill="#999" font-family="DejaVu Sans">T=0</text>\n'

    # T_A and T_B vertical lines
    x_ta, x_tb = mx(T_A), mx(T_B) if not tb_is_now else mx(0)
    s += f'  <line x1="{x_ta:.1f}" y1="{T_ax}" x2="{x_ta:.1f}" y2="{B}" stroke="#1a5fa8" stroke-width="1.4" stroke-dasharray="4,3"/>\n'
    if not tb_is_now:
        s += f'  <line x1="{x_tb:.1f}" y1="{T_ax}" x2="{x_tb:.1f}" y2="{B}" stroke="#e05050" stroke-width="1.4" stroke-dasharray="4,3"/>\n'

    # Dots at T_A and T_B on the curve
    s += f'  <circle cx="{x_ta:.1f}" cy="{my(v_iTA):.1f}" r="3.5" fill="#1a5fa8" stroke="white" stroke-width="1.2"/>\n'
    if not tb_is_now:
        s += f'  <circle cx="{x_tb:.1f}" cy="{my(v_iTB):.1f}" r="3.5" fill="#e05050" stroke="white" stroke-width="1.2"/>\n'

    # T_A / T_B labels at TOP — non-overlapping.
    # Rule: EARLIER time → label RIGHT-aligned to LEFT of its line (text-anchor=end, x=line_x-3)
    #        LATER  time → label LEFT-aligned to RIGHT of its line (text-anchor=start, x=line_x+3)
    # This ensures the two labels diverge away from each other.
    if tb_is_now:
        # T_B=now is at x=T=0 area — combine with T_B=now arrow; only show T_A label
        # T_A is later than T=0, so it's the LATER one → label to the RIGHT of its line
        s += f'  <text x="{x_ta+3:.1f}" y="{T_ax+10:.1f}" font-size="8.5" fill="#1a5fa8" font-family="DejaVu Sans" font-weight="bold">{ta_label}</text>\n'
    else:
        if x_ta < x_tb:
            # T_A is earlier (left): label to its LEFT (text-anchor=end)
            # T_B is later  (right): label to its RIGHT (text-anchor=start)
            s += f'  <text x="{x_ta-3:.1f}" y="{T_ax+10:.1f}" font-size="8.5" fill="#1a5fa8" font-family="DejaVu Sans" text-anchor="end" font-weight="bold">{ta_label}</text>\n'
            s += f'  <text x="{x_tb+3:.1f}" y="{T_ax+10:.1f}" font-size="8.5" fill="#e05050" font-family="DejaVu Sans" font-weight="bold">{tb_label}</text>\n'
        else:
            # T_B is earlier (left): label to its LEFT
            # T_A is later  (right): label to its RIGHT
            s += f'  <text x="{x_tb-3:.1f}" y="{T_ax+10:.1f}" font-size="8.5" fill="#e05050" font-family="DejaVu Sans" text-anchor="end" font-weight="bold">{tb_label}</text>\n'
            s += f'  <text x="{x_ta+3:.1f}" y="{T_ax+10:.1f}" font-size="8.5" fill="#1a5fa8" font-family="DejaVu Sans" font-weight="bold">{ta_label}</text>\n'

    # Bottle silhouettes — centred on the vertical lines
    # Label placement rule: earlier bottle label on LEFT, later bottle label on RIGHT.
    if tb_is_now or x_ta <= x_tb:
        # T_A is earlier (or T_B=now): V_A label LEFT, V_B label RIGHT
        s += bottle(x_ta, my(v_iTA), my(v_iTA+V_A), "#1a5fa8",
                    f"V&#x2090;={V_A:.0f}ml", label_side="left")
        s += bottle(x_tb, my(v_iTB), my(v_iTB+V_B), "#e05050",
                    f"V&#x1D3D;={V_B:.0f}ml", label_side="right")
    else:
        # T_B is earlier: V_B label LEFT, V_A label RIGHT
        s += bottle(x_tb, my(v_iTB), my(v_iTB+V_B), "#e05050",
                    f"V&#x1D3D;={V_B:.0f}ml", label_side="left")
        s += bottle(x_ta, my(v_iTA), my(v_iTA+V_A), "#1a5fa8",
                    f"V&#x2090;={V_A:.0f}ml", label_side="right")

    # T_B=now: red vertical line + combined label at top (T_B = T=0 = now)
    if tb_is_now:
        # red dashed vertical at T=0
        s += f'  <line x1="{x_tb:.1f}" y1="{T_ax}" x2="{x_tb:.1f}" y2="{B}" stroke="#e05050" stroke-width="1.4" stroke-dasharray="4,3"/>\n'
        # combined label at top, to the left of the T_A line
        s += f'  <text x="{x_tb-3:.1f}" y="{T_ax+10:.1f}" font-size="8.5" fill="#e05050" font-family="DejaVu Sans" text-anchor="end" font-weight="bold">T&#x1D3D; = now</text>\n'
        # small downward arrow on the curve
        yb = my(v_iTB)
        s += f'  <circle cx="{x_tb:.1f}" cy="{yb:.1f}" r="3.5" fill="#e05050" stroke="white" stroke-width="1.2"/>\n'

    # SI bracket
    bx1, bx2, by = mx(0), mx(T_A), B+18
    s += f'  <line x1="{bx1:.1f}" y1="{by}" x2="{bx2:.1f}" y2="{by}" stroke="#888" stroke-width="1.1"/>\n'
    s += f'  <line x1="{bx1:.1f}" y1="{by-4}" x2="{bx1:.1f}" y2="{by+4}" stroke="#888" stroke-width="1.1"/>\n'
    s += f'  <line x1="{bx2:.1f}" y1="{by-4}" x2="{bx2:.1f}" y2="{by+4}" stroke="#888" stroke-width="1.1"/>\n'
    s += f'  <text x="{(bx1+bx2)/2:.1f}" y="{by+12}" font-size="8" fill="#888" font-family="DejaVu Sans" text-anchor="middle">SI={SI*60:.0f} min</text>\n'

    # Y-axis ticks
    def ytk(v, lbl, color):
        y = my(v); x = mx(t0)
        return (f'  <line x1="{x-5:.1f}" y1="{y:.1f}" x2="{x+5:.1f}" y2="{y:.1f}" stroke="{color}" stroke-width="1.2"/>\n'
                f'  <text x="{x-7:.1f}" y="{y+4:.1f}" font-size="8.5" fill="{color}" font-family="DejaVu Sans" text-anchor="end">{lbl}</text>\n')
    s += ytk(v_i0,       f"I&#x2080;={v_i0:.0f}", "#333")     # I0 in BLACK
    s += ytk(DAILY,      f"{DAILY:.0f}",            "#e07020")
    s += ytk(DAILY+MILK, f"{DAILY+MILK:.0f}",       "#2c8a50")
    if abs(v_iTA - v_i0) > 20 and abs(v_iTA - DAILY) > 20 and abs(v_iTA - (DAILY+MILK)) > 20:
        s += ytk(v_iTA, f"{v_iTA:.0f}", "#1a5fa8")

    # Previous feed dots (light)
    for tf, _ in feeds:
        if t0 <= tf < 0:
            s += f'  <circle cx="{mx(tf):.1f}" cy="{my(intake_at(tf+1e-6,feeds)):.1f}" r="2.5" fill="#ccc"/>\n'

    s += "</svg>\n"
    return s

# ── Feed histories ────────────────────────────────────────────────────────────

_pa = 24 + (MILK - 50.0)/RATE
feeds_mild = [
    (-45,MILK),(-42,MILK),(-39,MILK),(-36,MILK),(-33,MILK),
    (-_pa,MILK),(-22.8,MILK),(-20.2,MILK),(-17.6,MILK),(-15,MILK),
    (-12.4,MILK),(-9.8,MILK),(-7.2,MILK),(-4.6,MILK),(-2,MILK),(0,MILK),
]
feeds_sev = [
    (-38,MILK),(-35.5,MILK),(-33,MILK),(-30.5,MILK),(-28,MILK),
    (-21.5,MILK),(-18.5,MILK),(-15.5,MILK),(-12,MILK),
    (-8.5,MILK),(-5,MILK),(-1.5,MILK),(0,MILK),
]
feeds_over = [
    (-38,MILK),(-35.5,MILK),(-33,MILK),(-30.5,MILK),(-28,MILK),
    (-22,MILK),(-19.5,MILK),(-17,MILK),(-14.5,MILK),
    (-12,MILK),(-9.5,MILK),(-7,MILK),(-4.5,MILK),(-2,MILK),(0,MILK),
]

# ── Compute predictor values ──────────────────────────────────────────────────

T_A = SI

# Mild underfeed
v_mild   = intake_at(0.001, feeds_mild)
v_TA_m   = intake_at(T_A, feeds_mild)
V_A_mild = (DAILY + MILK) - v_TA_m
T_B_mild = None
for step in range(500000):
    if intake_at(step*0.0005, feeds_mild) <= DAILY:
        T_B_mild = step*0.0005; break
v_TB_mild = intake_at(T_B_mild, feeds_mild)  # = DAILY
V_B_mild  = MILK  # standard bottle

CAP_MILK = 135.0   # 120ml water = 135ml milk (next size up from 90ml preferred)

# Severe underfeed
v_sev    = intake_at(0.001, feeds_sev)
v_TA_s   = intake_at(T_A, feeds_sev)
V_A_sev  = min((DAILY + MILK) - v_TA_s, CAP_MILK)   # capped to 120ml water
# T_B = now, V_B = standard bottle
v_TB_sev = v_sev  # I(0+) = 800
V_B_sev  = MILK   # standard bottle → 800+100 = 900

# Overfeed
v_over   = intake_at(0.001, feeds_over)
v_TA_o   = intake_at(T_A, feeds_over)
V_A_over = (DAILY + MILK) - v_TA_o
T_B_over = None
for step in range(200000):
    if intake_at(step*0.0005, feeds_over) <= DAILY:
        T_B_over = step*0.0005; break
v_TB_over = intake_at(T_B_over, feeds_over)  # = DAILY
V_B_over  = MILK

# ── Generate ──────────────────────────────────────────────────────────────────

svg_mild = build_diagram(
    feeds=feeds_mild, t0=-1.0, t1=7.0, v0=700, v1=1130,
    T_A=T_A, V_A=V_A_mild, T_B=T_B_mild, V_B=V_B_mild,
    v_iTA=v_TA_m, v_iTB=v_TB_mild, v_i0=v_mild,
    title_text="Sub-case 1: mild underfeed — D &lt; I(0+) &lt; D+m&#x2080;",
    ta_label=f"T&#x2090; (SI={SI*60:.0f}m)",
    tb_label=f"T&#x1D3D; ({T_B_mild*60:.0f}m)",
    tb_is_now=False
)

svg_sev = build_diagram(
    feeds=feeds_sev, t0=-1.0, t1=7.0, v0=680, v1=1130,
    T_A=T_A, V_A=V_A_sev, T_B=0.0, V_B=V_B_sev,
    v_iTA=v_TA_s, v_iTB=v_TB_sev, v_i0=v_sev,
    title_text="Sub-case 2: severe underfeed — I(0+) &lt; D",
    ta_label=f"T&#x2090; (SI={SI*60:.0f}m)",
    tb_label="T&#x1D3D; = now",
    tb_is_now=True
)

svg_over = build_diagram(
    feeds=feeds_over, t0=-3.0, t1=8.5, v0=870, v1=1130,
    T_A=T_A, V_A=V_A_over, T_B=T_B_over, V_B=V_B_over,
    v_iTA=v_TA_o, v_iTB=v_TB_over, v_i0=v_over,
    title_text="24h intake — overfeed scenario (6.47 kg, 90 ml water / 100 ml milk)",
    ta_label=f"T&#x2090; (SI={SI*60:.0f}m)",
    tb_label=f"T&#x1D3D; ({T_B_over*60:.0f}m)",
    tb_is_now=False
)

for name, svg in [("diag-24h-underfeed-mild.svg", svg_mild),
                   ("diag-24h-underfeed-severe.svg", svg_sev),
                   ("diag-24h-overfeed.svg", svg_over)]:
    with open(os.path.join(OUT, name), "w") as f:
        f.write(svg)
    print(f"wrote {name}")
