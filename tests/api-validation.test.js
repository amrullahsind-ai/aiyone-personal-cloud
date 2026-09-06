const assert = require("assert");
const { _test } = require("../api/generate.js");

assert.throws(
  () => _test.validatePayload("buildMaterial", { text: "pendek" }),
  /terlalu pendek/
);

assert.throws(
  () => _test.validatePayload("evaluateTeaching", { answer: "belum cukup" }),
  /terlalu pendek/
);

const validPack = {
  title: "Materi Uji",
  summaryShort: "Ringkasan",
  concepts: [
    { name: "A", definition: "Definisi A", sourceRef: "Halaman 1" },
    { name: "B", definition: "Definisi B", sourceRef: "Halaman 9" },
    { name: "C", definition: "Definisi C", sourceRef: "Halaman 2" }
  ],
  flashcards: Array.from({ length: 4 }, (_, i) => ({ front: `Tanya ${i}`, back: `Jawab ${i}` })),
  quizzes: Array.from({ length: 4 }, (_, i) => ({
    question: `Soal ${i}`,
    options: ["Benar", "Salah"],
    answerIndex: 0
  })),
  studySections: [{ title: "Bagian", explanation: "Isi", sourceRef: "Halaman 2" }]
};

const checked = _test.validateResult(
  "buildMaterial",
  validPack,
  { text: "--- Halaman 1 ---\nIsi\n--- Halaman 2 ---\nIsi" }
);

assert.equal(checked.result.concepts[0].sourceRef, "Halaman 1");
assert.equal(checked.result.concepts[1].sourceRef, "");
assert.equal(checked.result.studySections[0].sourceRef, "Halaman 2");
assert.ok(checked.warnings.length >= 1);

assert.throws(
  () => _test.validateResult("buildMaterial", { title: "Rusak", concepts: [], flashcards: [], quizzes: [] }),
  /terlalu sedikit konsep/
);

const teaching = _test.validateResult("evaluateTeaching", {
  masteryScore: 82,
  rubric: { accuracy: 85, completeness: 80, examples: 75, clarity: 88 }
});
assert.equal(teaching.result.masteryScore, 82);

/* ---------------------------------------------------------------------------
 * Perbaikan JSON rusak.
 * Regresi: versi lama meng-escape SEMUA newline, termasuk yang di luar string,
 * sehingga JSON yang tadinya bisa diselamatkan justru jadi makin rusak.
 * ------------------------------------------------------------------------- */

// Newline mentah di dalam nilai string harus diselamatkan, bukan bikin gagal.
{
  const broken = ['{"a": "baris satu', 'baris dua"}'].join("\n");
  const parsed = _test.parseJSONMaybe(broken);
  assert.equal(parsed.a, "baris satu\nbaris dua");
}

// Newline antar-token (JSON yang di-pretty-print) tidak boleh dirusak.
{
  const pretty = ['{', '  "a": 1,', '  "b": [1, 2,]', '}'].join("\n");
  const parsed = _test.parseJSONMaybe(pretty);
  assert.equal(parsed.a, 1);
  assert.deepEqual(parsed.b, [1, 2]);
}

// Pagar markdown dan teks di luar objek dibuang.
{
  const fenced = ['```json', '{"ok": true}', '```'].join("\n");
  assert.equal(_test.parseJSONMaybe(fenced).ok, true);
}

// Escape yang sudah benar tidak boleh didobel.
{
  const already = '{"a":"sudah\\nbenar"}';
  assert.equal(_test.escapeNewlinesInsideStrings(already), already);
  assert.equal(_test.parseJSONMaybe(already).a, "sudah\nbenar");
}

// Rate limit menolak setelah ambang terlampaui.
{
  const key = `uji-${Math.random()}`;
  const max = Number(process.env.AI_RATE_LIMIT || 15);
  for (let i = 0; i < max; i++) _test.enforceRateLimit(key);
  assert.throws(() => _test.enforceRateLimit(key), /Batas penggunaan AI/);
}

console.log("api-validation: ok");
