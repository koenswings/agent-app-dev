#!/usr/bin/env python3
"""Build the duration-tests Kiwix stub ZIM (idea#166 Prefer A).

Small offline "Wikipedia" so `open_wikipedia_*` / `search_browse_wikipedia` /
`leave_wikipedia_*` get a real kiwix-serve UI with a searchable article,
without fetching a multi-GB Wikipedia ZIM onto a pool Pi.

Content is original text written for this fixture (CC0-1.0), not copied from
Wikipedia, so the ZIM can live in agent-app-dev without CC BY-SA attribution.

Usage (box or any host with Python 3.9+):
    python3 -m venv /tmp/zimenv && /tmp/zimenv/bin/pip install 'libzim>=3.4,<4'
    /tmp/zimenv/bin/python build_stub_zim.py [--out PATH]  # default: ../../instances/kiwix-ideaa-001/data/<name>.zim

The output is deterministic in content (not byte-identical: libzim stamps a
UUID). CONTENT.yaml pins paths/titles, not the hash.
"""
from __future__ import annotations

import argparse
import struct
import zlib
from pathlib import Path

from libzim.writer import Creator, FileProvider, Hint, Item, StringProvider  # noqa: F401

BOOK_NAME = "duration_wikipedia_en_grade5a_stub_2026-10"
HERE = Path(__file__).resolve().parent
# Dock-ready location: Engine mounts instances/<id>/data at /data in kiwix-serve.
DEFAULT_OUT = HERE.parents[1] / "instances" / "kiwix-ideaa-001" / "data" / f"{BOOK_NAME}.zim"

CSS = """
body{font-family:sans-serif;max-width:46em;margin:1em auto;padding:0 1em;line-height:1.5}
h1{border-bottom:1px solid #aaa}
.infobox{float:right;border:1px solid #aaa;background:#f8f9fa;padding:.5em;margin:0 0 1em 1em;width:14em}
nav.see-also li{margin:.2em 0}
"""


def page(title: str, body: str) -> str:
    return (
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        f"<title>{title}</title><link rel=\"stylesheet\" href=\"style.css\"></head>"
        f"<body><h1 id=\"firstHeading\">{title}</h1>{body}</body></html>"
    )


# path -> (title, html body). Paths are stable: Pixel / CONTENT.yaml pin them.
ARTICLES: dict[str, tuple[str, str]] = {
    "Main_Page": (
        "Grade 5A Offline Wikipedia",
        """
<p>This is the <b>duration-tests offline encyclopedia</b> for Grade 5A. It is a
small stand-in for Wikipedia served by Kiwix on the shared idea-A Engine.</p>
<h2>Featured articles</h2>
<ul id="featured">
<li><a href="Fraction">Fraction</a> &mdash; parts of a whole</li>
<li><a href="Numerator">Numerator</a> and <a href="Denominator">Denominator</a></li>
<li><a href="Photosynthesis">Photosynthesis</a> &mdash; how plants make food</li>
<li><a href="Water_cycle">Water cycle</a></li>
<li><a href="Solar_System">Solar System</a></li>
</ul>
<p>Use the search box to find an article, for example <i>fraction</i> or
<i>planet</i>.</p>
""",
    ),
    "Fraction": (
        "Fraction",
        """
<div class="infobox"><b>Fraction</b><br>Example: 3/4<br>Numerator: 3<br>Denominator: 4</div>
<p>A <b>fraction</b> describes a number of equal parts of a whole. The fraction
<i>three quarters</i> is written 3/4: the whole is cut into four equal parts and
three of them are taken.</p>
<h2 id="Parts">Parts of a fraction</h2>
<p>The number on top is the <a href="Numerator">numerator</a>. The number on the
bottom is the <a href="Denominator">denominator</a>.</p>
<h2 id="Adding">Adding and subtracting fractions</h2>
<p>To add fractions with the same denominator, add the numerators and keep the
denominator: 1/5 + 2/5 = 3/5. With different denominators, first rewrite both
fractions with a common denominator: 1/2 + 1/4 = 2/4 + 1/4 = 3/4.</p>
<h2 id="Equivalent">Equivalent fractions</h2>
<p>Multiplying numerator and denominator by the same number gives an equivalent
fraction: 1/2 = 2/4 = 4/8.</p>
<nav class="see-also"><h2>See also</h2><ul>
<li><a href="Numerator">Numerator</a></li><li><a href="Denominator">Denominator</a></li>
</ul></nav>
""",
    ),
    "Numerator": (
        "Numerator",
        """
<p>The <b>numerator</b> is the top number of a <a href="Fraction">fraction</a>.
It counts how many equal parts are taken. In 5/8 the numerator is 5.</p>
<p>See also <a href="Denominator">Denominator</a>.</p>
""",
    ),
    "Denominator": (
        "Denominator",
        """
<p>The <b>denominator</b> is the bottom number of a <a href="Fraction">fraction</a>.
It tells into how many equal parts the whole is divided. In 5/8 the denominator
is 8. A denominator can never be zero.</p>
<p>See also <a href="Numerator">Numerator</a>.</p>
""",
    ),
    "Photosynthesis": (
        "Photosynthesis",
        """
<p><b>Photosynthesis</b> is how green plants make their own food. Leaves take in
sunlight, water from the roots and carbon dioxide from the air, and turn them
into sugar and oxygen. The green colour comes from <i>chlorophyll</i>.</p>
<p>Photosynthesis needs water, which plants get thanks to the
<a href="Water_cycle">water cycle</a>, and light from the Sun, the star at the
centre of the <a href="Solar_System">Solar System</a>.</p>
""",
    ),
    "Water_cycle": (
        "Water cycle",
        """
<p>The <b>water cycle</b> is the journey water takes around the Earth. The Sun
heats seas and lakes so water <i>evaporates</i>; the vapour cools into clouds
(<i>condensation</i>); water falls back as rain or snow (<i>precipitation</i>)
and flows to rivers and seas again.</p>
<p>Plants use rain water for <a href="Photosynthesis">photosynthesis</a>.</p>
""",
    ),
    "Solar_System": (
        "Solar System",
        """
<p>The <b>Solar System</b> is the Sun and everything that orbits it. There are
eight planets: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus and Neptune.
Jupiter is the largest planet. Earth is the only planet known to have life.</p>
<p>Sunlight powers <a href="Photosynthesis">photosynthesis</a> and the
<a href="Water_cycle">water cycle</a> on Earth.</p>
""",
    ),
}


def png_48(rgb=(0x33, 0x66, 0x99)) -> bytes:
    """Solid 48x48 PNG (ZIM Illustration_48x48@1 metadata; no PIL needed)."""
    w = h = 48
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


class Page(Item):
    def __init__(self, path: str, title: str, html: str):
        super().__init__()
        self._path, self._title, self._html = path, title, html

    def get_path(self):
        return self._path

    def get_title(self):
        return self._title

    def get_mimetype(self):
        return "text/html"

    def get_contentprovider(self):
        return StringProvider(self._html)

    def get_hints(self):
        return {Hint.FRONT_ARTICLE: True}


class Asset(Item):
    def __init__(self, path: str, mimetype: str, data: str):
        super().__init__()
        self._path, self._mime, self._data = path, mimetype, data

    def get_path(self):
        return self._path

    def get_title(self):
        return ""

    def get_mimetype(self):
        return self._mime

    def get_contentprovider(self):
        return StringProvider(self._data)

    def get_hints(self):
        return {Hint.FRONT_ARTICLE: False}


def build(out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    with Creator(str(out)).config_indexing(True, "eng").config_clustersize(64 * 1024) as c:
        c.set_mainpath("Main_Page")
        c.add_illustration(48, png_48())
        for key, val in {
            "Name": BOOK_NAME,
            "Title": "Grade 5A Offline Wikipedia (stub)",
            "Description": "IDEA duration-tests Kiwix stub: 7 short CC0 articles",
            "LongDescription": "Original CC0 text for IDEA duration-tests (idea#166). Not Wikipedia content.",
            "Language": "eng",
            "Creator": "IDEA duration-tests",
            "Publisher": "Kid (IDEA App Dev)",
            "Date": "2026-10-05",
            "Tags": "_category:wikipedia;_pictures:no;_videos:no;_details:no;_ftindex:yes",
            "Flavour": "stub",
            "License": "CC0-1.0",
            "Source": "https://github.com/koenswings/agent-app-dev/tree/main/tests/duration-tests/fixtures/kiwix",
        }.items():
            c.add_metadata(key, val)
        c.add_item(Asset("style.css", "text/css", CSS))
        for path, (title, body) in ARTICLES.items():
            c.add_item(Page(path, title, page(title, body)))
    print(f"wrote {out} ({out.stat().st_size} bytes, {len(ARTICLES)} articles)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    build(ap.parse_args().out)
