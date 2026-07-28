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

console.log("api-validation: ok");
