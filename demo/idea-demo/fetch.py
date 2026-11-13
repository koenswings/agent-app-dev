#!/usr/bin/env python3
"""Build the IDEA-DEMO disk tree from publisher sources (see MANIFEST.json).

Every file is downloaded from its publisher (Wikimedia Commons, African
Storybook, Siyavula, Khan Academy's own CDN), checked against source_sha256,
then copied or transcoded into OUT. Nothing is taken from a Kolibri channel.

  ./fetch.sh OUT_DIR            build (fails on any checksum mismatch)
  ./fetch.sh --seed=DIR OUT_DIR use DIR/<path> (e.g. a previous build) for any
                                file whose checksum still matches; download
                                the rest
  ./fetch.sh --record OUT_DIR   (maintainers) download and write the
                                checksums into MANIFEST.json

Every download is checked before it is used: an HTML/text answer, a body
smaller than MIN_BYTES, or a .pdf without the %PDF header fails loudly
instead of being written into the tree (idea#490: African Storybook started
answering with a 53-byte stub served as application/pdf).

"checksum": "asb-pdf" marks an African Storybook PDF. ASB renders the PDF on
every request (Prince) with a fresh random /ID, so the same book never has the
same sha256 twice; for those items source_sha256 is taken over the bytes with
the /ID array zeroed (see normalised()).
"""
import hashlib, json, os, re, shutil, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "IDEA-demo-pack/1.0 (https://github.com/koenswings/idea)"

MIN_BYTES = 1024           # no demo file is anywhere near this small
MIN_PDF_BYTES = 10 * 1024  # smallest demo PDF is ~15 KB
PDF_HEADER_WITHIN = 1024   # ASB PDFs start with a 53-byte URL before %PDF
PDF_ID = re.compile(rb"/ID\s*\[\s*<[0-9A-Fa-f]*>\s*<[0-9A-Fa-f]*>\s*\]")

class BadPayload(Exception):
    pass

def check_payload(path, data, content_type=None):
    """Raise BadPayload unless data looks like a real file for path."""
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct.startswith("text/") or ct in ("application/json", "application/xhtml+xml"):
        raise BadPayload(f"{path}: publisher sent {ct}, not the file")
    is_pdf = path.lower().endswith(".pdf")
    minimum = MIN_PDF_BYTES if is_pdf else MIN_BYTES
    if len(data) < minimum:
        head = data[:80].decode("latin-1").strip()
        raise BadPayload(f"{path}: only {len(data)} bytes (min {minimum}), starts {head!r}")
    if is_pdf:
        if ct and ct not in ("application/pdf", "application/x-pdf", "application/octet-stream",
                             "binary/octet-stream"):
            raise BadPayload(f"{path}: content-type {ct}, expected application/pdf")
        if b"%PDF-" not in data[:PDF_HEADER_WITHIN]:
            raise BadPayload(f"{path}: no %PDF header in the first {PDF_HEADER_WITHIN} bytes")

def normalised(data):
    """Bytes with every PDF /ID array zeroed (same length, so offsets hold)."""
    return PDF_ID.sub(lambda m: re.sub(rb"[0-9A-Fa-f]", b"0", m.group(0)), data)

def checksum(item, path):
    with open(path, "rb") as f:
        data = f.read()
    if item.get("checksum") == "asb-pdf":
        data = normalised(data)
    return hashlib.sha256(data).hexdigest()

def download(url, dest, path):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        try:
            with open(dest, "rb") as f:
                check_payload(path, f.read())
            return
        except BadPayload as e:  # stub left by an older fetch.py: set aside, refetch
            print(f"  cached copy rejected ({e}); downloading again", file=sys.stderr)
            os.replace(dest, dest + ".bad")
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                ctype = r.headers.get("Content-Type")
                data = r.read()
        except Exception as e:  # retry slow publishers (Siyavula timed out once)
            print(f"  retry {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
            continue
        check_payload(path, data, ctype)  # a stub is not transient: fail now
        with open(dest + ".part", "wb") as f:
            f.write(data)
        os.replace(dest + ".part", dest)
        return
    raise SystemExit(f"download failed: {url}")

def prepare(item, src, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    kind = item["prepare"]
    if kind == "copy":
        shutil.copyfile(src, out)
        return
    has_audio = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
         "-of", "csv=p=0", src], capture_output=True, text=True).stdout.strip() != ""
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-i", src]
    if not has_audio:            # add a silent track so every player accepts the file
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest"]
    if kind == "video":          # Commons clips: at most 90 s
        cmd += ["-t", "90"]
    cmd += ["-map", "0:v:0", "-map", "0:a:0" if has_audio else "1:a:0",
            "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "medium",
            "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart", out]
    subprocess.run(cmd, check=True)

def seeded(item, seed):
    """Path of a previous copy of item under seed that still checks out."""
    if not seed:
        return None
    cand = os.path.join(seed, item["path"])
    if not os.path.isfile(cand):
        return None
    try:
        with open(cand, "rb") as f:
            check_payload(item["path"], f.read())
    except BadPayload:
        return None
    return cand if checksum(item, cand) == item.get("source_sha256") else None

def main(argv):
    record = "--record" in argv
    opts = dict(a[2:].split("=", 1) for a in argv if a.startswith("--") and "=" in a)
    seed = os.path.abspath(opts["seed"]) if "seed" in opts else None
    mpath = os.path.abspath(opts.get("manifest", os.path.join(HERE, "MANIFEST.json")))
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 1:
        raise SystemExit(__doc__)
    out = os.path.abspath(args[0])
    cache = os.path.join(out, ".cache")
    os.makedirs(cache, exist_ok=True)
    manifest = json.load(open(mpath))
    bad = []
    for item in manifest["files"]:
        key = hashlib.sha1(item["download_url"].encode()).hexdigest()[:16]
        src = seeded(item, seed) if not record else None
        if src:
            print("seed ", item["path"])
        else:
            src = os.path.join(cache, key)
            print("fetch", item["path"])
            try:
                download(item["download_url"], src, item["path"])
            except BadPayload as e:
                raise SystemExit(f"bad download from {item['download_url']}: {e}")
        got = checksum(item, src)
        if record:
            item["source_sha256"] = got
        elif got != item.get("source_sha256"):
            bad.append(item["path"])
            continue
        dst = os.path.join(out, item["path"])
        prepare(item, src, dst)
        item["bytes"] = os.path.getsize(dst)
    if bad:
        raise SystemExit("checksum mismatch (publisher changed the file?): " + ", ".join(bad))
    if record:
        json.dump(manifest, open(mpath, "w"), indent=1, ensure_ascii=False)
        open(mpath, "a").write("\n")
    here = os.path.dirname(mpath)
    shutil.copytree(os.path.join(here, "static"), out, dirs_exist_ok=True)
    shutil.copyfile(os.path.join(here, "CREDITS.txt"), os.path.join(out, "CREDITS.txt"))
    shutil.rmtree(cache)
    print("done:", out)

if __name__ == "__main__":
    main(sys.argv[1:])
