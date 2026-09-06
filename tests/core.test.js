const assert = require("assert");
const core = require("../lib/aiyone-core.js");

// Shuffle identitas supaya urutan opsi bisa diprediksi saat diuji.
const keep = list => [...list];

/* ---------------------------------------------------------------------------
 * Pemetaan jawaban quiz.
 * Ini regresi dari bug nyata: opsi di-dedup dan dipotong SEBELUM indeks jawaban
 * diresolusi, sehingga jawaban benar bergeser ke opsi lain.
 * ------------------------------------------------------------------------- */

// Duplikat di depan menggeser indeks jawaban.
{
  const q = { question: "Soal", options: ["A", "A", "B", "C"], answerIndex: 2 };
  const out = core.normalizeQuiz(q, { shuffle: keep });
  assert.deepEqual(out.options, ["A", "B", "C"]);
  assert.equal(out.options[out.answer_index], "B", "jawaban harus tetap B setelah dedup");
}

// Lebih dari 4 opsi: jawaban benar tidak boleh terbuang saat dipotong.
{
  const q = { question: "Soal", options: ["A", "B", "C", "D", "E"], answerIndex: 4 };
  const out = core.normalizeQuiz(q, { shuffle: keep });
  assert.equal(out.options.length, 4);
  assert.equal(out.options[out.answer_index], "E", "jawaban benar wajib ikut terbawa");
}

// Opsi kosong di depan.
{
  const q = { question: "Soal", options: ["", "A", "B", "C"], answerIndex: 3 };
  const out = core.normalizeQuiz(q, { shuffle: keep });
  assert.equal(out.options[out.answer_index], "C");
}

// Penomoran 1-based dari model.
{
  const q = { question: "Soal", options: ["A", "B", "C", "D"], answerIndex: 4 };
  const out = core.normalizeQuiz(q, { shuffle: keep });
  assert.equal(out.options[out.answer_index], "D");
}

// Jawaban berupa huruf.
{
  const q = { question: "Soal", options: ["Alpha", "Beta", "Gamma"], answer: "C" };
  const out = core.normalizeQuiz(q, { shuffle: keep });
  assert.equal(out.options[out.answer_index], "Gamma");
}

// Jawaban berupa teks persis.
{
  const q = { question: "Soal", options: ["Alpha", "Beta", "Gamma"], answer: "beta" };
  const out = core.normalizeQuiz(q, { shuffle: keep });
  assert.equal(out.options[out.answer_index], "Beta");
}

// Indeks di luar jangkauan tidak boleh melempar, cukup jatuh ke opsi pertama.
{
  const q = { question: "Soal", options: ["Alpha", "Beta"], answerIndex: 9 };
  const out = core.normalizeQuiz(q, { shuffle: keep });
  assert.equal(out.options[out.answer_index], "Alpha");
}

// Soal tanpa pertanyaan atau kurang dari dua opsi dibuang.
{
  const list = core.normalizeQuizList([
    { question: "", options: ["A", "B"], answerIndex: 0 },
    { question: "Valid", options: ["A"], answerIndex: 0 },
    { question: "Valid", options: ["A", "B"], answerIndex: 1 }
  ], { shuffle: keep });
  assert.equal(list.length, 1);
  assert.equal(list[0].options[list[0].answer_index], "B");
}

// Pengacakan opsi benar-benar terjadi dan indeks tetap konsisten.
{
  const q = { question: "Soal", options: ["Benar", "Salah 1", "Salah 2", "Salah 3"], answerIndex: 0 };
  let movedAtLeastOnce = false;
  for (let i = 0; i < 60; i++) {
    const out = core.normalizeQuiz(q);
    assert.equal(out.options[out.answer_index], "Benar", "indeks harus ikut posisi jawaban setelah diacak");
    if (out.answer_index !== 0) movedAtLeastOnce = true;
  }
  assert.ok(movedAtLeastOnce, "opsi harus diacak, jawaban benar tidak boleh selalu di posisi A");
}

/* ---------------------------------------------------------------------------
 * Streak
 * ------------------------------------------------------------------------- */

const at = iso => new Date(iso);

// Streak putus setelah bolong lebih dari satu hari.
assert.equal(core.currentStreak({ streak: 12, lastStreakDate: "2026-01-01" }, at("2026-02-01T10:00:00")), 0);
// Masih hidup kalau terakhir kemarin.
assert.equal(core.currentStreak({ streak: 12, lastStreakDate: "2026-01-31" }, at("2026-02-01T10:00:00")), 12);
// Masih hidup kalau terakhir hari ini.
assert.equal(core.currentStreak({ streak: 3, lastStreakDate: "2026-02-01" }, at("2026-02-01T10:00:00")), 3);

// Lanjut dari kemarin.
assert.deepEqual(
  core.streakAfterActivity({ streak: 4, lastStreakDate: "2026-01-31" }, 90, 70, at("2026-02-01T10:00:00")),
  { streak: 5, lastStreakDate: "2026-02-01" }
);
// Mulai dari nol lagi setelah rantai putus.
assert.deepEqual(
  core.streakAfterActivity({ streak: 40, lastStreakDate: "2025-12-01" }, 90, 70, at("2026-02-01T10:00:00")),
  { streak: 1, lastStreakDate: "2026-02-01" }
);
// Sudah dihitung hari ini, tidak dobel.
assert.equal(
  core.streakAfterActivity({ streak: 5, lastStreakDate: "2026-02-01" }, 90, 70, at("2026-02-01T22:00:00")),
  null
);
// Skor di bawah ambang tidak menaikkan streak.
assert.equal(
  core.streakAfterActivity({ streak: 5, lastStreakDate: "2026-01-31" }, 40, 70, at("2026-02-01T10:00:00")),
  null
);
// Skor rendah setelah rantai putus tetap menulis balik nol.
assert.deepEqual(
  core.streakAfterActivity({ streak: 9, lastStreakDate: "2025-11-01" }, 10, 70, at("2026-02-01T10:00:00")),
  { streak: 0, lastStreakDate: "" }
);

// dateKey memakai waktu lokal, bukan UTC.
{
  const local = new Date(2026, 1, 1, 3, 0, 0); // 1 Feb, jam 03:00 lokal
  assert.equal(core.dateKey(local), "2026-02-01");
}

/* ---------------------------------------------------------------------------
 * Pemecahan paragraf
 * ------------------------------------------------------------------------- */

// Tidak boleh memakai lookbehind: cukup pastikan hasilnya wajar.
{
  const text = "Satu. Dua. Tiga.\n\nParagraf kedua dimulai di sini.";
  const parts = core.splitParagraphs(text, { minLength: 5 });
  assert.ok(parts.length >= 2);
  assert.ok(parts.join(" ").includes("Paragraf kedua"));
}

// Kalimat pendek digabung, tidak dipecah satu per satu.
{
  const text = "Ini kalimat pertama. Ini kedua. Ini ketiga.";
  const parts = core.splitParagraphs(text, { minLength: 500 });
  assert.equal(parts.length, 1, "kalimat pendek harus digabung jadi satu paragraf");
}

// Teks kosong aman.
assert.deepEqual(core.splitParagraphs(""), []);
assert.deepEqual(core.splitParagraphs(null), []);



/* ---------------------------------------------------------------------------
 * Wikilink
 * ------------------------------------------------------------------------- */

{
  const l = core.parseWikilinks("Lihat [[Beban Kognitif]] dan [[Memori Kerja|memori]].");
  assert.equal(l.length, 2);
  assert.equal(l[0].target, "Beban Kognitif");
  assert.equal(l[0].alias, null);
  assert.equal(l[1].target, "Memori Kerja");
  assert.equal(l[1].alias, "memori");
}

// Duplikat digabung, pencocokan tidak peduli besar-kecil huruf.
{
  const l = core.parseWikilinks("[[Alpha]] lalu [[alpha]] lagi [[ALPHA]]");
  assert.equal(l.length, 1);
}

// Wikilink di dalam kode TIDAK boleh jadi tautan.
{
  assert.equal(core.parseWikilinks("teks `[[bukan]]` biasa").length, 0);
  assert.equal(core.parseWikilinks("```\n[[juga bukan]]\n```").length, 0);
}

// Kurung kosong diabaikan.
assert.equal(core.parseWikilinks("[[]] dan [[   ]]").length, 0);

/* ---------------------------------------------------------------------------
 * Tag
 * ------------------------------------------------------------------------- */

{
  const t = core.parseTags("Belajar #memori dan #cognitive-load hari ini");
  assert.ok(t.includes("memori"));
  assert.ok(t.includes("cognitive-load"));
}
// Heading Markdown bukan tag.
assert.equal(core.parseTags("# Judul Besar").length, 0);
// Tag di dalam kode diabaikan.
assert.equal(core.parseTags("`#bukantag`").length, 0);

/* ---------------------------------------------------------------------------
 * Markdown
 * ------------------------------------------------------------------------- */

const md = (s, o) => core.renderMarkdown(s, o);

// HTML dari pengguna WAJIB di-escape. Ini pertahanan utama terhadap XSS.
{
  const html = md('<img src=x onerror="alert(1)"> <script>bad()</scr' + 'ipt>');
  assert.ok(!html.includes("<img"), "tag img mentah tidak boleh lolos");
  assert.ok(!html.includes("<script"), "tag script mentah tidak boleh lolos");
  assert.ok(html.includes("&lt;img"), "harus ter-escape");
}

// Heading mulai dari h3 supaya tidak menyaingi judul catatan.
assert.ok(md("# Judul").includes("<h3"));
assert.ok(md("## Sub").includes("<h4"));

// Penekanan.
assert.ok(md("**tebal**").includes("<strong>tebal</strong>"));
assert.ok(md("*miring*").includes("<em>miring</em>"));
assert.ok(md("==sorot==").includes("<mark"));

// Daftar.
{
  const html = md("- satu\n- dua");
  assert.ok(html.includes("<ul"));
  assert.equal((html.match(/<li>/g) || []).length, 2);
}
assert.ok(md("1. satu\n2. dua").includes("<ol"));

// Checklist.
{
  const html = md("- [x] selesai\n- [ ] belum");
  assert.ok(html.includes("md-task done"));
  assert.ok(html.includes("md-tasks"));
}

// Kutipan dan garis.
assert.ok(md("> kutipan").includes("<blockquote"));
assert.ok(md("---").includes("<hr"));

// Blok kode: isinya tidak boleh diproses sebagai markup.
{
  const html = md("```\n**bukan tebal**\n```");
  assert.ok(html.includes("<pre"));
  assert.ok(!html.includes("<strong>"), "isi blok kode harus apa adanya");
}

// Wikilink dirender jadi tombol, dan yang belum ada ditandai.
{
  const html = md("[[Ada]] dan [[Belum]]", {
    resolveLink: (n) => n === "Ada" ? { id: "note_1", ada: true } : { id: null, ada: false }
  });
  assert.ok(html.includes('data-note="note_1"'));
  assert.ok(html.includes("md-link missing"));
}

// Alias yang ditampilkan, target yang disimpan.
{
  const html = md("[[Memori Kerja|memori]]", { resolveLink: () => ({ id: "x", ada: true }) });
  assert.ok(html.includes(">memori</button>"));
  assert.ok(html.includes('data-name="Memori Kerja"'));
}

// Teks kosong menghasilkan kosong, bukan error.
assert.equal(md(""), "");
assert.equal(md(null), "");

/* ---------------------------------------------------------------------------
 * Tata letak graf
 * ------------------------------------------------------------------------- */

{
  const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const edges = [{ from: "a", to: "b" }];
  const out = core.layoutGraph(nodes, edges, { width: 300, height: 300, iterations: 60 });
  assert.equal(out.length, 3);
  // Semua node berada di dalam bidang.
  assert.ok(out.every(n => n.x >= 0 && n.x <= 300 && n.y >= 0 && n.y <= 300));
  // Tidak ada koordinat NaN.
  assert.ok(out.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
  // Node yang tertaut lebih dekat daripada yang tidak tertaut.
  const jarak = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const [a, b, c] = out;
  assert.ok(jarak(a, b) < jarak(a, c), "node tertaut harus lebih berdekatan");
}

// Deterministik: input sama menghasilkan tata letak sama.
{
  const n = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const e = [{ from: "a", to: "b" }, { from: "c", to: "d" }];
  const p1 = core.layoutGraph(n, e, { width: 240, height: 240, iterations: 80 });
  const p2 = core.layoutGraph(n, e, { width: 240, height: 240, iterations: 80 });
  assert.deepEqual(p1.map(x => [x.x.toFixed(4), x.y.toFixed(4)]), p2.map(x => [x.x.toFixed(4), x.y.toFixed(4)]));
}

// Graf kosong dan tautan menggantung tidak boleh melempar error.
assert.deepEqual(core.layoutGraph([], []), []);
assert.equal(core.layoutGraph([{ id: "a" }], [{ from: "a", to: "hantu" }], { iterations: 10 }).length, 1);


// Atribut title wikilink tidak boleh terputus oleh kutip lurus di dalamnya:
// kalau terputus, browser memecah sisanya jadi atribut-atribut sampah.
{
  const html = core.renderMarkdown("lihat [[Belum Ada]]");
  const m = html.match(/title="([^"]*)"/);
  assert.ok(m, "atribut title harus ada");
  assert.ok(m[1].endsWith("membuatnya."), "title terpotong: " + m[1]);
  // Sekalian pastikan judul yang mengandung kutip tetap ter-escape.
  const html2 = core.renderMarkdown('[[Judul "nakal"]]');
  assert.ok(!/title="[^"]*"[^ >]/.test(html2), "atribut title pecah oleh kutip di judul");
}

console.log("core: ok");
