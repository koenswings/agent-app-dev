#!/usr/bin/env python3
"""Build the IDEA-DEMO disk tree from publisher sources (see MANIFEST.json).

Every file is downloaded from its publisher (Wikimedia Commons, African
Storybook, Siyavula, Khan Academy's own CDN), checked against source_sha256,
then copied or transcoded into OUT. Nothing is taken from a Kolibri channel.

  ./fetch.sh OUT_DIR            build (fails on any checksum mismatch)
  ./fetch.sh --record OUT_DIR   (maintainers) download and write the
                                checksums into MANIFEST.json
"""
import hashlib, json, os, shutil, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "IDEA-demo-pack/1.0 (https://github.com/koenswings/idea)"

def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()

def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r, open(dest + ".part", "wb") as f:
                shutil.copyfileobj(r, f)
            os.replace(dest + ".part", dest)
            return
        except Exception as e:  # retry slow publishers (Siyavula timed out once)
            print(f"  retry {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
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

def main(argv):
    record = "--record" in argv
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 1:
        raise SystemExit(__doc__)
    out = os.path.abspath(args[0])
    cache = os.path.join(out, ".cache")
    os.makedirs(cache, exist_ok=True)
    mpath = os.path.join(HERE, "MANIFEST.json")
    manifest = json.load(open(mpath))
    bad = []
    for item in manifest["files"]:
        key = hashlib.sha1(item["download_url"].encode()).hexdigest()[:16]
        src = os.path.join(cache, key)
        print("fetch", item["path"])
        download(item["download_url"], src)
        got = sha256(src)
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
    shutil.copytree(os.path.join(HERE, "static"), out, dirs_exist_ok=True)
    shutil.copyfile(os.path.join(HERE, "CREDITS.txt"), os.path.join(out, "CREDITS.txt"))
    shutil.rmtree(cache)
    print("done:", out)

if __name__ == "__main__":
    main(sys.argv[1:])
