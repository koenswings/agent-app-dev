import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// idea#490: African Storybook answered 200 application/pdf with a 53-byte stub
// (just "https://www.africanstorybook.org/include/pdf_html.php"); fetch.py must
// refuse such downloads instead of writing them into the IDEA-DEMO tree.
const demo = fileURLToPath(new URL("../../demo/idea-demo/", import.meta.url));
const ASB_PREFIX = "https://www.africanstorybook.org/include/pdf_html.php";
const pdf = (id, prefix = "") =>
  Buffer.from(`${prefix}%PDF-1.5\n${"x".repeat(20000)}\ntrailer << /ID [<${id}> <${id}>] >>\n%%EOF\n`);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const zeroId = (b) => Buffer.from(b.toString("latin1").replace(/\/ID\s*\[\s*<[0-9A-Fa-f]*>\s*<[0-9A-Fa-f]*>\s*\]/g, (m) => m.replace(/[0-9A-Fa-f]/g, "0")), "latin1");

const routes = {
  "/stub.pdf": ["application/pdf", Buffer.from(ASB_PREFIX)],
  "/page.pdf": ["text/html; charset=utf-8", Buffer.from("<html>" + "y".repeat(20000) + "</html>")],
  "/nomagic.pdf": ["application/pdf", Buffer.from("z".repeat(20000))],
  "/good.pdf": ["application/pdf", pdf("AAAA1111")],
  "/asb.pdf": ["application/pdf", pdf("BEEF2222", ASB_PREFIX)], // a later render: other /ID
};
let server, base;
before(async () => {
  server = createServer((req, res) => {
    const r = routes[req.url];
    if (!r) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": r[0] }).end(r[1]);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function pack(files) {
  const dir = mkdtempSync(join(tmpdir(), "idea-demo-fetch-"));
  mkdirSync(join(dir, "static"));
  writeFileSync(join(dir, "CREDITS.txt"), "test\n");
  writeFileSync(join(dir, "MANIFEST.json"), JSON.stringify({ files }));
  return dir;
}
const item = (path, route, extra = {}) => ({
  path, title: "t", author: "a", source_page: "https://example.org/", licence: "CC BY 4.0",
  download_url: base + route, prepare: "copy", source_sha256: sha(routes[route][1]), ...extra,
});
function fetchPy(dir, ...args) {
  return new Promise((ok) => {
    const p = spawn("python3", [join(demo, "fetch.py"), `--manifest=${join(dir, "MANIFEST.json")}`, ...args, join(dir, "out")]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => ok({ code, out }));
  });
}

for (const [route, why] of [["/stub.pdf", /only 53 bytes/], ["/page.pdf", /text\/html/], ["/nomagic.pdf", /no %PDF header/]]) {
  test(`fetch.py fails loudly on ${route}`, async () => {
    const dir = pack([item("Stories/Book.pdf", route)]);
    const r = await fetchPy(dir);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, why);
    assert.match(r.out, new RegExp(route.replace(".", "\\.")));
    assert.ok(!existsSync(join(dir, "out", "Stories", "Book.pdf")), "no stub written");
  });
}

test("fetch.py writes good PDFs; asb-pdf checksum ignores the per-render /ID", async () => {
  const firstRender = pdf("CAFE3333", ASB_PREFIX); // what the maintainer recorded
  const dir = pack([
    item("Stories/Good.pdf", "/good.pdf"),
    item("Stories/Asb.pdf", "/asb.pdf", { checksum: "asb-pdf", source_sha256: sha(zeroId(firstRender)) }),
  ]);
  const r = await fetchPy(dir);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(readFileSync(join(dir, "out", "Stories", "Good.pdf")), routes["/good.pdf"][1]);
  assert.deepEqual(readFileSync(join(dir, "out", "Stories", "Asb.pdf")), routes["/asb.pdf"][1]);
  // a plain sha256 item still has to match exactly
  const dir2 = pack([item("Stories/Asb.pdf", "/asb.pdf", { source_sha256: sha(firstRender) })]);
  const r2 = await fetchPy(dir2);
  assert.notEqual(r2.code, 0);
  assert.match(r2.out, /checksum mismatch/);
});

test("--seed reuses a previous good copy while the publisher serves stubs", async () => {
  const good = pdf("DEAD4444", ASB_PREFIX);
  const seed = mkdtempSync(join(tmpdir(), "idea-demo-seed-"));
  mkdirSync(join(seed, "Stories"));
  writeFileSync(join(seed, "Stories", "Book.pdf"), good);
  const dir = pack([item("Stories/Book.pdf", "/stub.pdf", { checksum: "asb-pdf", source_sha256: sha(zeroId(good)) })]);
  const r = await fetchPy(dir, `--seed=${seed}`);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /seed\s+Stories\/Book\.pdf/);
  assert.deepEqual(readFileSync(join(dir, "out", "Stories", "Book.pdf")), good);
  // a seeded stub is ignored, so the stub download fails loudly
  writeFileSync(join(seed, "Stories", "Book.pdf"), ASB_PREFIX);
  const r2 = await fetchPy(pack([item("Stories/Book.pdf", "/stub.pdf")]), `--seed=${seed}`);
  assert.notEqual(r2.code, 0);
  assert.match(r2.out, /only 53 bytes/);
});

test("MANIFEST: ASB PDFs use the asb-pdf checksum; the three Read-aloud stories are back", () => {
  const m = JSON.parse(readFileSync(join(demo, "MANIFEST.json"), "utf8"));
  for (const f of m.files.filter((x) => /africanstorybook\.org/.test(x.download_url))) {
    assert.equal(f.checksum, "asb-pdf", f.path);
  }
  for (const t of ["Magozwe", "The Honeyguides revenge", "Grandmas bananas"]) {
    const f = m.files.find((x) => x.path === `kolibri/Early Reading/Stories/${t}.pdf`);
    assert.ok(f, t);
    assert.ok(f.bytes > 100000, t);
    assert.doesNotMatch(f.download_url, /downloadbook\.php/, t);
  }
});
