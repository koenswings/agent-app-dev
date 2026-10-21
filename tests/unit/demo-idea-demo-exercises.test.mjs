import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// IDEA-written exercises for the demo channels (channel builder `*.exercise.json`, idea#294).
const root = fileURLToPath(new URL("../../demo/idea-demo/static/kolibri/", import.meta.url));
const walk = (d) => readdirSync(d).flatMap((e) => (statSync(join(d, e)).isDirectory() ? walk(join(d, e)) : [join(d, e)]));
const files = walk(root).filter((f) => f.endsWith(".exercise.json"));

test("Maths and Early Reading have exercises", () => {
  assert.ok(files.filter((f) => f.includes("/Maths/")).length >= 2);
  assert.ok(files.some((f) => f.includes("/Early Reading/")));
});

for (const f of files) {
  test(`valid exercise: ${f.slice(root.length)}`, () => {
    const x = JSON.parse(readFileSync(f, "utf8"));
    assert.ok(x.title && Array.isArray(x.questions) && x.questions.length >= 3);
    for (const q of x.questions) {
      assert.ok(q.question && ["choice", "number"].includes(q.type), q.question);
      if (q.type === "choice") {
        assert.ok(q.choices.length >= 2 && q.choices.length <= 8);
        for (const a of [].concat(q.answer)) assert.ok(q.choices.includes(a), `${q.question}: ${a}`);
      } else assert.equal(typeof q.answer, "number");
    }
    if (x.mastery !== "do_all") assert.ok(1 <= x.mastery.m && x.mastery.m <= x.mastery.n);
  });
}
