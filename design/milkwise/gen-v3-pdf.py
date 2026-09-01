#!/usr/bin/env python3
"""
Build next-session-predictor-design-v3.pdf
- Reads the .md source for prose, tables, structure
- Replaces formula code blocks with KaTeX-rendered HTML
- Embeds SVG diagrams via <img> tags
- Renders to PDF via WeasyPrint
"""
import subprocess, pathlib, re
from weasyprint import HTML

DESIGN_DIR = pathlib.Path("/home/node/workspace/agents/agent-app-dev/design/milkwise")
SKILL_STYLES = pathlib.Path("/home/node/workspace/skills/md-to-pdf/assets/styles")
KATEX_CSS    = pathlib.Path("/home/pi/.npm-global/lib/node_modules/katex/dist/katex.min.css")

import markdown as mdlib

def katex_display(tex):
    r = subprocess.run(
        ["katex", "--display-mode", "--format", "html", "--no-throw-on-error"],
        input=tex, capture_output=True, text=True)
    return f'<div class="eq-block">{r.stdout.strip()}</div>'

def katex_inline(tex):
    r = subprocess.run(
        ["katex", "--format", "html", "--no-throw-on-error"],
        input=tex, capture_output=True, text=True)
    return r.stdout.strip()

# ── All formulae keyed by a unique marker string ─────────────────────────────
# We replace fenced code blocks that contain these markers with KaTeX HTML.

FORMULAS = {
    # §2.2 Energy model
    "dailyTarget  = weightKg": katex_display(
        r"D = w \cdot r \qquad \lambda = \frac{D}{24}"
    ),
    # §4.1 bottle credit
    "bottleCredit(age, milkMl)": katex_display(
        r"""c_i(T) = \begin{cases}
m_i & \text{if } T - t_i \leq 24\,\text{h} \\[6pt]
\max\!\left(0,\; m_i - \lambda\,(T - t_i - 24)\right) & \text{if } T - t_i > 24\,\text{h}
\end{cases}"""
    ) + katex_display(
        r"I(T) = \sum_{i=1}^{n} c_i(T)"
    ),
    # §4.2 SI
    "SI = preferredBottleMilkMl / hourlyRate": katex_display(
        r"\mathit{SI} = \frac{m_0}{\lambda}"
    ),
    # §4.3 surplus
    "surplus(T) = intake(T) − dailyTarget": katex_display(
        r"\text{surplus}(T) = I(T) - D"
    ),
    # §4.4 T_standard
    "T_standard = lastFeed.timestamp + SI": katex_display(
        r"T_{\text{std}} = t_{\text{last}} + \mathit{SI}"
    ),
    # §5.1 Predictor A
    "intake(T_A) = compute intake()": katex_display(
        r"T_A = t_{\text{last}} + \mathit{SI}"
    ) + katex_display(
        r"V_A = \left(D + m_0\right) - I(T_A)"
    ),
    # §5.1 equilibrium proof
    "volumeA_milk = (dailyTarget + preferredBottleMilkMl) − dailyTarget": katex_display(
        r"V_A = (D + m_0) - D = m_0"
    ),
    # §5.2 Predictor B
    "intake(T_B) + preferredBottleMilkMl = dailyTarget + preferredBottleMilkMl": katex_display(
        r"I(T_B) = D"
    ),
    # §6.2 undigested
    "undigested(T, t_feed, milkMl) = max(0, milkMl − hourlyRate × (T − t_feed))": katex_display(
        r"u_i(T) = \max\!\left(0,\; m_i - \lambda\,(T - t_i)\right)"
    ) + katex_display(
        r"S(T) = \sum_{i=1}^{n} u_i(T)"
    ),
    # §6.3 dt_min
    "stomachLoad(T_B) + preferredBottleMilkMl ≤ stomachCapMilk": katex_display(
        r"S(T_B) + m_0 \;\leq\; m_{\text{cap}}"
    ),
    "max(0, lastBottleMilkMl − hourlyRate × dt) + preferredBottleMilkMl ≤ stomachCapMilk":
        "",   # absorbed into next
    "dt_min = max(0, (lastBottleMilkMl + preferredBottleMilkMl − stomachCapMilk) / hourlyRate)": katex_display(
        r"\Delta t_{\min} = \max\!\left(0,\;\frac{m_{\text{last}} + m_0 - m_{\text{cap}}}{\lambda}\right)"
    ),
    # §7.2 gauge pct
    "pct = intake(now) / dailyTarget × 100": katex_display(
        r"p = \frac{I(t_{\text{now}})}{D} \times 100\%"
    ),
}

# ── Read and preprocess markdown ─────────────────────────────────────────────

md_text = (DESIGN_DIR / "next-session-predictor-design-v3.md").read_text("utf-8")

# Replace fenced code blocks that match a known formula key
def replace_code_blocks(text):
    def replacer(m):
        content = m.group(1)
        for key, html in FORMULAS.items():
            if key in content:
                return html if html else ""
        # keep as code block
        return m.group(0)
    return re.sub(r"```[\w]*\n(.*?)```", replacer, text, flags=re.DOTALL)

md_text = replace_code_blocks(md_text)

# Also replace inline backtick expressions for a few key ones
inline_replacements = [
    (r"`dailyTarget = 1035 ml/24h`",
     katex_inline(r"D = 1035\,\text{ml/24h}")),
    (r"`hourlyRate = 43.125 ml/h`",
     katex_inline(r"\lambda = 43.125\,\text{ml/h}")),
    (r"`SI = 100 / 43.125 = 2.318 h ≈ 2h 19m`",
     katex_inline(r"\mathit{SI} = 100/43.125 = 2.318\,\text{h} \approx 2\text{h}\,19\text{m}")),
    (r"`57 − 43 × t = −100  →  t = 3h 39m  →  T_B = 3h 39m after F2`",
     katex_inline(r"57 - 43\,t = -100 \;\Rightarrow\; t = 3\text{h}\,39\text{m}")),
    (r"`1092 − 43 × t = 1035  →  t = 1h 20m`",
     katex_inline(r"1092 - 43\,t = 1035 \;\Rightarrow\; t = 1\text{h}\,20\text{m}")),
    (r"`dt_min = (100 + 100 − 135) / 43.125 = 65 / 43.125 ≈ 1.507 h ≈ 1h 30m`",
     katex_inline(r"\Delta t_{\min} = (100+100-135)/43.1 \approx 1\text{h}\,30\text{m}")),
    (r"`volumeA_milk = (dailyTarget + preferredBottleMilkMl) − dailyTarget = preferredBottleMilkMl`",
     katex_inline(r"V_A = (D + m_0) - D = m_0")),
    (r"`intake(T_A) = dailyTarget`",
     katex_inline(r"I(T_A) = D")),
]
for old, new in inline_replacements:
    md_text = md_text.replace(old, new)

# ── Convert markdown to HTML ─────────────────────────────────────────────────
md_parser = mdlib.Markdown(extensions=["fenced_code", "tables", "toc"])
body = md_parser.convert(md_text)

# ── Assemble full HTML ────────────────────────────────────────────────────────
md_css    = (SKILL_STYLES / "markdown.css").read_text()
code_css  = (SKILL_STYLES / "tomorrow.css").read_text()
pdf_css   = (SKILL_STYLES / "markdown-pdf.css").read_text()
katex_css = KATEX_CSS.read_text()

extra_css = """
.eq-block { margin: 14px 0; }
.eq-block .katex-display { margin: 0; }
.eq-note { text-align: center; font-size: 9pt; color: #666; margin-top: -6px; margin-bottom: 10px; }
img { max-width: 100%; display: block; margin: 12px 0; }
"""

html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>{katex_css}</style>
<style>{md_css}</style>
<style>{code_css}</style>
<style>{pdf_css}</style>
<style>{extra_css}</style>
</head>
<body class="vscode-body">
{body}
</body>
</html>"""

out_html = DESIGN_DIR / "next-session-predictor-design-v3-gen.html"
out_pdf  = DESIGN_DIR / "next-session-predictor-design-v3.pdf"
out_html.write_text(html, "utf-8")

base_url = DESIGN_DIR.as_uri() + "/"
HTML(filename=str(out_html), base_url=base_url).write_pdf(str(out_pdf))
print(f"ok → {out_pdf}")
