import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dir = new URL("../../demo/idea-demo/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("MANIFEST.json", dir), "utf8"));
const credits = readFileSync(new URL("CREDITS.txt", dir), "utf8");

test("every demo file has checksum, licence, source and download URL", () => {
  assert.ok(manifest.files.length >= 30);
  for (const f of manifest.files) {
    assert.match(f.source_sha256, /^[0-9a-f]{64}$/, f.path);
    assert.ok(f.licence && f.title && f.author, f.path);
    assert.match(f.source_page, /^https:\/\//, f.path);
    assert.match(f.download_url, /^https:\/\//, f.path);
    assert.ok(["copy", "video", "video-full"].includes(f.prepare), f.path);
  }
});

test("CREDITS.txt lists every file with its source URL", () => {
  for (const f of manifest.files) {
    assert.ok(credits.includes(`${f.path} | ${f.title} | ${f.author} | ${f.source_page} | ${f.licence}`), f.path);
  }
});

test("no Kolibri-channel content, no dropped clips, Khan from Khan's CDN", () => {
  const paths = manifest.files.map((f) => f.path).join("\n");
  assert.doesNotMatch(paths, /icosahedron|Counting fruit/i);
  for (const f of manifest.files.filter((x) => /Khan/.test(x.author))) {
    assert.match(f.download_url, /^https:\/\/cdn\.kastatic\.org\//);
    assert.match(f.licence, /NC-SA/);
  }
  assert.doesNotMatch(JSON.stringify(manifest), /studio\.learningequality|kolibri-content/i);
});
