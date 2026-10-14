# IDEA house style for project PDFs
`housestyle.py` + `house.css`: Markdown -> HTML -> PDF (WeasyPrint), extracted from the install guides' build.
Cover page, contents with page numbers, "title - page N of M" footer, red/blue headings, callouts
(`<div class="note|warn|confirm">` and `>` blockquotes), TO CONFIRM badges, numbered figure captions from image alt text,
and automatic blank lines before lists (`fix_lists`). Use: `sys.path.insert(0, "<path>/house-style"); import housestyle; housestyle.build(body, meta, out_pdf, base_url)`.
Users: `docs/tutorial-justice/build.py`, and the install guides' `build.py` (box: /workspace/teacher-manuals/install-guides, via the symlink /workspace/teacher-manuals/house-style).
