#!/usr/bin/env python3
"""Generate math-test3.pdf using KaTeX for formula rendering."""
import subprocess, pathlib, textwrap
from weasyprint import HTML, CSS

KATEX_CSS_PATH = "/home/pi/.npm-global/lib/node_modules/katex/dist/katex.min.css"
OUT = pathlib.Path("/home/node/workspace/agents/agent-app-dev/design/milkwise")

def katex(expr, display=True):
    args = ["katex", "--format", "html", "--no-throw-on-error"]
    if display:
        args.append("--display-mode")
    r = subprocess.run(args, input=expr, capture_output=True, text=True)
    return r.stdout.strip()

# ── Formulae ─────────────────────────────────────────────────────────────────

eq_daily = katex(r"D = w \cdot r \qquad \lambda = \frac{D}{24}")

eq_si = katex(r"\mathit{SI} = \frac{m_0}{\lambda}")

eq_credit = katex(r"""
c_i(T) = \begin{cases}
  m_i & \text{if } T - t_i \leq 24\,\text{h} \\[6pt]
  \max\!\left(0,\; m_i - \lambda\,(T - t_i - 24)\right) & \text{if } T - t_i > 24\,\text{h}
\end{cases}
""")

eq_intake = katex(r"I(T) = \sum_{i=1}^{n} c_i(T)")

eq_predA_TA = katex(r"T_A = t_{\text{last}} + \mathit{SI}")
eq_predA_VA = katex(r"V_A = \left(D + m_0\right) - I(T_A)")

eq_predB = katex(r"I(T_B) = D")

eq_stomach = katex(r"""
S(T) = \sum_{i=1}^{n} \max\!\left(0,\; m_i - \lambda\,(T - t_i)\right)
""")

eq_dtmin = katex(r"""
\Delta t_{\min} = \max\!\left(0,\; \frac{m_{\text{last}} + m_0 - m_{\text{cap}}}{\lambda}\right)
""")

eq_dtmin_example = katex(
    r"\Delta t_{\min} = \frac{100 + 100 - 135}{43.1} \approx 1\text{h}\,30\text{m}",
    display=False
)

# ── HTML ─────────────────────────────────────────────────────────────────────

katex_css = pathlib.Path(KATEX_CSS_PATH).read_text()

html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
{katex_css}

@page {{ margin: 25mm 22mm 25mm 22mm; }}
body {{
  font-family: 'DejaVu Sans', sans-serif;
  font-size: 10.5pt;
  line-height: 1.7;
  color: #1a1a1a;
  margin: 0;
}}
h1 {{ font-size: 16pt; margin-bottom: 2px; }}
.doc-meta {{ font-size: 9.5pt; color: #777; margin-bottom: 24px; }}
h2 {{ font-size: 12.5pt; margin-top: 26px; margin-bottom: 5px;
      border-bottom: 1px solid #d0d0d0; padding-bottom: 3px; }}
p  {{ margin: 7px 0 7px 0; }}

/* Display equation: full-width block, centred */
.eq-block {{
  margin: 16px 0 16px 0;
  overflow: hidden;
}}
.eq-block .katex-display {{
  margin: 0;
}}

/* Small note under a formula */
.eq-note {{
  text-align: center;
  font-size: 9pt;
  color: #666;
  margin-top: -6px;
  margin-bottom: 10px;
}}

/* Inline math sits flush with text */
.katex {{ font-size: 1em; }}

/* Definition highlight box */
.def {{
  background: #f5f8ff;
  border-left: 3px solid #2c7be5;
  padding: 8px 14px;
  margin: 14px 0;
  border-radius: 0 3px 3px 0;
}}
</style>
</head>
<body>

<h1>Next Feeding Session Predictor</h1>
<p class="doc-meta">Design Document v3 &nbsp;·&nbsp; Formula typesetting preview &nbsp;·&nbsp; Kit + Koen &nbsp;·&nbsp; 2026-06-28</p>


<h2>§2.2 &nbsp; Energy Model</h2>

<p>Prepared milk is the direct proxy for caloric energy: 1 ml = 1 unit of energy.
The baby's daily target and hourly drain rate follow directly from the
150 ml/kg/day guideline:</p>

<div class="def">
  <div class="eq-block">{eq_daily}</div>
  <p class="eq-note">
    <i>w</i> = baby weight (kg), &nbsp; <i>r</i> = 150 ml/kg/day (default), &nbsp;
    λ = hourly drain rate (ml/h). &nbsp;
    For <i>w</i> = 6.9 kg: <i>D</i> = 1 035 ml, λ = 43.1 ml/h.
  </p>
</div>

<p>The standard interval is the time for one preferred bottle of
<i>m</i><sub>0</sub> ml of prepared milk to be fully spent at rate λ:</p>

<div class="eq-block">{eq_si}</div>
<p class="eq-note">90 ml water → <i>m</i><sub>0</sub> = 100 ml milk, λ = 43.1 ml/h → SI ≈ 2h 19m</p>


<h2>§4.1 &nbsp; The Intake Function</h2>

<p>The app tracks the total milk received in a rolling 24-hour window.
The credit contributed by bottle <i>i</i> (volume <i>m<sub>i</sub></i>,
given at time <i>t<sub>i</sub></i>) evaluated at time <i>T</i> is:</p>

<div class="def">
  <div class="eq-block">{eq_credit}</div>
</div>

<p>The smoothed 24-hour intake at time <i>T</i> is the sum over all feeds
logged before <i>T</i>:</p>

<div class="eq-block">{eq_intake}</div>

<p>The decay rate past 24 h is exactly λ — the same rate at which the baby burns energy.
A bottle's credit diminishes at exactly the speed its nutritional value is consumed.
In steady-state feeding, <i>I</i>(<i>T</i>) oscillates between <i>D</i>
(just before each feed) and <i>D</i> + <i>m</i><sub>0</sub> (just after).</p>


<h2>§5.1 &nbsp; Predictor A — Adjusted Volume at Standard Time</h2>

<p>Predictor A answers: <em>if I feed at the standard time, how much should I give?</em>
It computes the volume that restores intake to the equilibrium peak
<i>D</i> + <i>m</i><sub>0</sub>:</p>

<div class="def">
  <div class="eq-block">{eq_predA_TA}</div>
  <div class="eq-block">{eq_predA_VA}</div>
  <p class="eq-note">
    At equilibrium <i>I</i>(<i>T<sub>A</sub></i>) = <i>D</i>,
    so <i>V<sub>A</sub></i> = <i>m</i><sub>0</sub> — exactly the standard bottle.
  </p>
</div>

<p>The parent is shown <i>V<sub>A</sub></i> converted to water ml and decides which
bottle to use. If <i>V<sub>A</sub></i> ≤ 0 the baby is still above the equilibrium
ceiling — Predictor A is greyed out. If <i>V<sub>A</sub></i> exceeds the stomach
capacity cap it is clamped (§6).</p>


<h2>§5.2 &nbsp; Predictor B — Standard Volume at Adjusted Time</h2>

<p>Predictor B answers: <em>when should I give my preferred bottle?</em>
It finds the time <i>T<sub>B</sub></i> at which the 24-hour intake has
decayed back to exactly the daily target <i>D</i>, so that adding
<i>m</i><sub>0</sub> restores intake to <i>D</i> + <i>m</i><sub>0</sub>:</p>

<div class="def">
  <div class="eq-block">{eq_predB}</div>
  <p class="eq-note">Feed when the 24-hour intake returns to the daily target.</p>
</div>

<p><i>T<sub>B</sub></i> is found by binary search on
[<i>t</i><sub>last</sub>, <i>t</i><sub>last</sub> + <i>T</i><sub>max</sub>].
At equilibrium <i>T<sub>B</sub></i> = <i>t</i><sub>last</sub> + SI.
With a deficit, <i>T<sub>B</sub></i> &lt; <i>t</i><sub>last</sub> + SI
(feed earlier); with a surplus, <i>T<sub>B</sub></i> &gt; <i>t</i><sub>last</sub> + SI
(feed later).</p>


<h2>§6 &nbsp; Stomach Capacity Constraint</h2>

<p>The total undigested milk in the stomach at time <i>T</i> is modelled as
the sum of unmetabolised portions of all recent feeds:</p>

<div class="eq-block">{eq_stomach}</div>

<p>The constraint is <i>S</i>(<i>T<sub>B</sub></i>) + <i>m</i><sub>0</sub> ≤
<i>m</i><sub>cap</sub>, where <i>m</i><sub>cap</sub> is one standard bottle size
above the preferred size. This gives a minimum waiting time:</p>

<div class="def">
  <div class="eq-block">{eq_dtmin}</div>
  <p class="eq-note">Example: {eq_dtmin_example}</p>
</div>

<p>If Predictor B's <i>T<sub>B</sub></i> falls before
<i>t</i><sub>last</sub> + Δ<i>t</i><sub>min</sub>, it is clamped upward
with a note: <em>"Stomach not ready — baby is underfed but needs time to digest."</em></p>

</body>
</html>
"""

out_html = OUT / "math-test3.html"
out_pdf  = OUT / "math-test3.pdf"
out_html.write_text(html, encoding="utf-8")

HTML(filename=str(out_html)).write_pdf(str(out_pdf))
print(f"ok → {out_pdf}")
