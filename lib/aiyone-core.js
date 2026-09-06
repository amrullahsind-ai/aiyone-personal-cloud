/**
 * Aiyone core — fungsi murni tanpa DOM.
 *
 * File ini sengaja dipisah dari app.js supaya logika yang paling rawan salah
 * (pemetaan jawaban quiz, streak, pemecahan paragraf) bisa diuji otomatis lewat
 * `npm test`. Dipakai di browser sebagai `window.AiyoneCore` dan di Node lewat
 * `require("./lib/aiyone-core.js")`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AiyoneCore = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const dayMs = 86400000;

  function shuffle(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /**
   * Menentukan TEKS jawaban benar, bukan indeksnya.
   *
   * Ini kuncinya: indeks dari AI menunjuk ke array opsi ASLI. Kalau kita
   * membersihkan opsi (buang kosong, buang duplikat, potong ke 4) sebelum
   * indeks diresolusi, indeksnya jadi menunjuk ke opsi yang salah. Jadi
   * resolusi selalu dilakukan lebih dulu terhadap array asli.
   */
  function resolveAnswerValue(quiz = {}, rawOptions = []) {
    const options = Array.isArray(rawOptions) ? rawOptions : [];
    const raw = quiz.answerIndex ?? quiz.answer_index ?? quiz.correctIndex ?? quiz.correct_index;
    const parsed = Number(raw);
    let idx = Number.isInteger(raw) ? raw : Number.isInteger(parsed) ? parsed : -1;
    // Sebagian model menomori opsi mulai dari 1, bukan 0.
    if (idx === options.length && idx >= 1) idx -= 1;
    if (idx >= 0 && idx < options.length && options[idx]) return options[idx];

    const answerText = typeof quiz.answer === "string" ? quiz.answer.trim()
      : typeof quiz.correctAnswer === "string" ? quiz.correctAnswer.trim()
      : "";
    if (answerText) {
      const exact = options.find(option => option && option.toLowerCase() === answerText.toLowerCase());
      if (exact) return exact;
      // Format "A" / "B." / "c)" hanya diterima kalau memang satu huruf.
      const letterMatch = answerText.match(/^([A-Ha-h])[).\s]*$/);
      if (letterMatch) {
        const letterIdx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
        if (letterIdx >= 0 && letterIdx < options.length && options[letterIdx]) return options[letterIdx];
      }
    }
    return options.find(Boolean) || "";
  }

  /**
   * Membersihkan opsi lalu MENGACAKNYA, dan mengembalikan indeks jawaban yang
   * dihitung ulang dari posisi teks jawaban di array hasil.
   *
   * Pengacakan penting secara pedagogis: sebelumnya semua soal buatan otomatis
   * menaruh jawaban benar di posisi A, sehingga user bisa lulus post-test hanya
   * dengan selalu memilih opsi pertama.
   */
  function buildQuizOptions(rawOptions = [], answerValue = "", options = {}) {
    const limit = options.limit || 4;
    const mix = options.shuffle || shuffle;
    const maxLength = options.maxLength || 220;

    const trim = value => String(value == null ? "" : value).trim().slice(0, maxLength);
    const answer = trim(answerValue);

    const seen = new Set();
    const unique = [];
    for (const option of Array.isArray(rawOptions) ? rawOptions : []) {
      const clean = trim(option);
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      unique.push(clean);
    }
    if (answer && !seen.has(answer.toLowerCase())) unique.unshift(answer);

    // Jawaban benar tidak boleh ikut terbuang saat daftar dipotong ke `limit`.
    let kept = unique.slice(0, limit);
    if (answer && !kept.some(option => option.toLowerCase() === answer.toLowerCase())) {
      kept = [answer, ...unique.filter(option => option.toLowerCase() !== answer.toLowerCase())].slice(0, limit);
    }

    const mixed = mix(kept);
    const answerIndex = answer
      ? mixed.findIndex(option => option.toLowerCase() === answer.toLowerCase())
      : 0;
    return { options: mixed, answerIndex: answerIndex < 0 ? 0 : answerIndex };
  }

  /** Normalisasi satu soal mentah dari AI menjadi bentuk yang disimpan. */
  function normalizeQuiz(quiz = {}, options = {}) {
    const rawOptions = Array.isArray(quiz.options)
      ? quiz.options.map(option => String(option == null ? "" : option).trim().slice(0, 220))
      : [];
    const answerValue = resolveAnswerValue(quiz, rawOptions);
    const built = buildQuizOptions(rawOptions, answerValue, options);
    return {
      concept: String(quiz.concept || "").slice(0, 120),
      level: String(quiz.level || "understanding").slice(0, 40),
      question: String(quiz.question || "").slice(0, 650),
      options: built.options,
      answer_index: built.answerIndex,
      explanation: String(quiz.explanation || "").slice(0, 1000)
    };
  }

  function normalizeQuizList(list = [], options = {}) {
    if (!Array.isArray(list)) return [];
    return list
      .slice(0, options.max || 20)
      .map(quiz => normalizeQuiz(quiz, options))
      .filter(quiz => quiz.question && quiz.options.length >= 2);
  }

  /** Kunci tanggal LOKAL (bukan UTC) supaya streak tidak berganti jam 07:00 WIB. */
  function dateKey(date = new Date()) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    const pad = value => String(value).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /**
   * Streak yang benar-benar streak: nol lagi kalau kemarin dan hari ini kosong.
   * Versi sebelumnya hanya pernah menambah, tidak pernah reset.
   */
  function currentStreak(settings = {}, nowDate = new Date()) {
    const last = String(settings.lastStreakDate || "");
    if (!last) return 0;
    const today = dateKey(nowDate);
    const yesterday = dateKey(new Date(new Date(nowDate).getTime() - dayMs));
    if (last !== today && last !== yesterday) return 0;
    return Number(settings.streak || 0);
  }

  /** Menghitung nilai streak berikutnya. Mengembalikan null kalau tidak berubah. */
  function streakAfterActivity(settings = {}, score, threshold = 70, nowDate = new Date()) {
    const today = dateKey(nowDate);
    const base = currentStreak(settings, nowDate);
    if (!(Number(score) >= Number(threshold))) {
      // Rantai yang sudah putus tetap perlu ditulis balik ke 0.
      if (base === 0 && Number(settings.streak || 0) !== 0) return { streak: 0, lastStreakDate: "" };
      return null;
    }
    if (settings.lastStreakDate === today) return null;
    return { streak: base + 1, lastStreakDate: today };
  }

  /**
   * Pecah teks jadi paragraf tanpa lookbehind regex.
   *
   * Regex lama memakai `(?<=\.)` yang tidak didukung Safari di bawah 16.4 —
   * di iPhone lama seluruh app.js gagal di-parse dan aplikasi jadi blank.
   * Bonus: kalimat digabung sampai ambang panjang tertentu, jadi ringkasan
   * tidak lagi jadi satu paragraf per kalimat.
   */
  function splitParagraphs(text = "", options = {}) {
    const minLength = options.minLength || 220;
    const clean = String(text == null ? "" : text).replace(/\r/g, "").trim();
    if (!clean) return [];
    const out = [];
    for (const block of clean.split(/\n{2,}/)) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const sentences = trimmed.match(/[^.!?]+(?:[.!?]+|$)\s*/g) || [trimmed];
      let buffer = "";
      for (const sentence of sentences) {
        buffer += sentence;
        if (buffer.trim().length >= minLength) { out.push(buffer.trim()); buffer = ""; }
      }
      if (buffer.trim()) out.push(buffer.trim());
    }
    return out;
  }

  /* ======================================================================= *
   * Catatan: wikilink dan Markdown
   *
   * Bagian ini yang membuat menulis catatan terasa seperti Obsidian. Semuanya
   * fungsi murni supaya bisa diuji — parsing teks adalah tempat bug paling
   * mudah menyelinap, terutama soal escaping.
   * ======================================================================= */

  const escapeHtml = (v = "") =>
    String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /** Normalisasi judul untuk pencocokan wikilink: tanpa besar-kecil dan spasi ganda. */
  const linkKey = (v = "") => String(v).trim().toLowerCase().replace(/\s+/g, " ");

  /**
   * Mengambil semua wikilink `[[Judul]]` atau `[[Judul|teks tampil]]` dari teks.
   * Mengembalikan daftar unik berdasarkan target, dengan urutan kemunculan.
   */
  function parseWikilinks(body = "") {
    const hasil = [];
    const terlihat = new Set();
    // Kode dalam backtick dilewati supaya `[[contoh]]` di blok kode tidak
    // ikut jadi tautan.
    const bersih = String(body == null ? "" : body)
      .replace(/```[\s\S]*?```/g, m => " ".repeat(m.length))
      .replace(/`[^`\n]*`/g, m => " ".repeat(m.length));
    for (const m of bersih.matchAll(/\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g)) {
      const target = m[1].trim();
      if (!target) continue;
      const kunci = linkKey(target);
      if (terlihat.has(kunci)) continue;
      terlihat.add(kunci);
      hasil.push({ target, alias: (m[2] || "").trim() || null, key: kunci });
    }
    return hasil;
  }

  /** Mengambil `#tag` dari teks, melewati blok kode dan heading Markdown. */
  function parseTags(body = "") {
    const bersih = String(body == null ? "" : body)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`\n]*`/g, " ")
      .replace(/^#{1,6}\s.*$/gm, " ");
    const set = new Set();
    for (const m of bersih.matchAll(/(^|\s)#([\p{L}\p{N}_-]{2,40})/gu)) set.add(m[2]);
    return [...set];
  }

  /**
   * Merender Markdown terbatas menjadi HTML.
   *
   * Sengaja bukan parser penuh: hanya yang dipakai untuk mencatat. Urutannya
   * penting — HTML di-escape LEBIH DULU, jadi tidak mungkin ada markup dari
   * teks pengguna yang lolos.
   *
   * `resolveLink(nama)` dipanggil untuk tiap wikilink dan harus mengembalikan
   * `{ id, ada }`; tautan ke catatan yang belum ada diberi kelas berbeda.
   */
  function renderMarkdown(body = "", options = {}) {
    const resolveLink = options.resolveLink || (() => ({ id: null, ada: false }));
    const teks = String(body == null ? "" : body).replace(/\r\n?/g, "\n");
    if (!teks.trim()) return "";

    // 1. Blok kode disimpan dulu supaya isinya tidak ikut diproses.
    const blokKode = [];
    let kerja = teks.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, bahasa, isi) => {
      blokKode.push(`<pre class="md-code"><code>${escapeHtml(isi.replace(/\n$/, ""))}</code></pre>`);
      return `\u0000BLOK${blokKode.length - 1}\u0000`;
    });

    // 2. Escape seluruh HTML sebelum markup apa pun ditambahkan.
    kerja = escapeHtml(kerja);

    // 3. Inline.
    const kodeInline = [];
    kerja = kerja.replace(/`([^`\n]+)`/g, (_, isi) => {
      kodeInline.push(`<code class="md-inline">${isi}</code>`);
      return `\u0000KODE${kodeInline.length - 1}\u0000`;
    });

    kerja = kerja
      .replace(/\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g, (_, target, alias) => {
        const nama = target.trim();
        const tampil = (alias || "").trim() || nama;
        const { id, ada } = resolveLink(nama) || {};
        const kelas = ada ? "md-link" : "md-link missing";
        const attr = id ? ` data-note="${escapeHtml(id)}"` : "";
        const judul = ada ? `Buka catatan ${escapeHtml(nama)}` : `Catatan “${escapeHtml(nama)}” belum ada. Klik untuk membuatnya.`;
        return `<button type="button" class="${kelas}"${attr} data-name="${escapeHtml(nama)}" title="${judul}">${escapeHtml(tampil)}</button>`;
      })
      .replace(/(^|[\s(])#([\p{L}\p{N}_-]{2,40})/gu, (_, depan, tag) => `${depan}<span class="md-tag">#${tag}</span>`)
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
      .replace(/==([^=\n]+)==/g, '<mark class="md-mark">$1</mark>');

    // 4. Blok: heading, garis, kutipan, daftar, paragraf.
    const baris = kerja.split("\n");
    const keluar = [];
    let daftar = null;

    const tutupDaftar = () => { if (daftar) { keluar.push(`</${daftar}>`); daftar = null; } };

    for (const b of baris) {
      const t = b.trim();

      if (!t) { tutupDaftar(); continue; }
      if (/^\u0000BLOK\d+\u0000$/.test(t)) { tutupDaftar(); keluar.push(t); continue; }

      const heading = t.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        tutupDaftar();
        const level = Math.min(heading[1].length + 2, 6); // h1 dokumen dipakai judul catatan
        keluar.push(`<h${level} class="md-h">${heading[2]}</h${level}>`);
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { tutupDaftar(); keluar.push('<hr class="md-hr" />'); continue; }

      const kutipan = t.match(/^&gt;\s?(.*)$/);
      if (kutipan) { tutupDaftar(); keluar.push(`<blockquote class="md-quote">${kutipan[1]}</blockquote>`); continue; }

      const centang = t.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
      if (centang) {
        if (daftar !== "ul") { tutupDaftar(); keluar.push('<ul class="md-list md-tasks">'); daftar = "ul"; }
        const dicentang = centang[1].toLowerCase() === "x";
        keluar.push(`<li class="md-task${dicentang ? " done" : ""}"><span class="md-box" aria-hidden="true"></span>${centang[2]}</li>`);
        continue;
      }

      const takBerurut = t.match(/^[-*]\s+(.*)$/);
      if (takBerurut) {
        if (daftar !== "ul") { tutupDaftar(); keluar.push('<ul class="md-list">'); daftar = "ul"; }
        keluar.push(`<li>${takBerurut[1]}</li>`);
        continue;
      }

      const berurut = t.match(/^\d+[.)]\s+(.*)$/);
      if (berurut) {
        if (daftar !== "ol") { tutupDaftar(); keluar.push('<ol class="md-list">'); daftar = "ol"; }
        keluar.push(`<li>${berurut[1]}</li>`);
        continue;
      }

      tutupDaftar();
      keluar.push(`<p>${t}</p>`);
    }
    tutupDaftar();

    // 5. Kembalikan kode yang disimpan.
    let html = keluar.join("");
    html = html.replace(/\u0000KODE(\d+)\u0000/g, (_, i) => kodeInline[Number(i)] || "");
    html = html.replace(/\u0000BLOK(\d+)\u0000/g, (_, i) => blokKode[Number(i)] || "");
    return html;
  }

  /**
   * Tata letak graf dengan simulasi gaya sederhana.
   *
   * Ditulis sendiri, bukan memakai pustaka, karena aplikasi ini harus tetap
   * jalan offline tanpa dependensi runtime. Deterministik: posisi awal berasal
   * dari indeks node, jadi graf yang sama selalu tersusun sama.
   */
  function layoutGraph(nodes, edges, options = {}) {
    const width = options.width || 320;
    const height = options.height || 320;
    const iterasi = options.iterations || 260;
    if (!nodes.length) return [];

    const cx = width / 2, cy = height / 2;
    const radius = Math.min(width, height) * 0.34;
    const titik = nodes.map((n, i) => {
      const sudut = (i / nodes.length) * Math.PI * 2;
      return { ...n, x: cx + Math.cos(sudut) * radius, y: cy + Math.sin(sudut) * radius, vx: 0, vy: 0 };
    });
    const indeks = new Map(titik.map((n, i) => [n.id, i]));
    const garis = edges
      .map(e => ({ a: indeks.get(e.from), b: indeks.get(e.to) }))
      .filter(e => e.a !== undefined && e.b !== undefined && e.a !== e.b);

    const jarakIdeal = Math.max(46, Math.min(width, height) / Math.sqrt(titik.length + 1));
    const tolak = jarakIdeal * jarakIdeal * 0.9;

    for (let step = 0; step < iterasi; step++) {
      const dingin = 1 - step / iterasi;

      // Tolakan antar semua node.
      for (let i = 0; i < titik.length; i++) {
        for (let j = i + 1; j < titik.length; j++) {
          let dx = titik[i].x - titik[j].x, dy = titik[i].y - titik[j].y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = (i - j) * 0.1 + 0.05; dy = 0.05; d2 = 0.01; }
          const gaya = tolak / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * gaya, fy = (dy / d) * gaya;
          titik[i].vx += fx; titik[i].vy += fy;
          titik[j].vx -= fx; titik[j].vy -= fy;
        }
      }
      // Tarikan sepanjang tautan.
      for (const g of garis) {
        const a = titik[g.a], b = titik[g.b];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const gaya = (d - jarakIdeal) * 0.06;
        const fx = (dx / d) * gaya, fy = (dy / d) * gaya;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
      // Tarikan lembut ke tengah supaya tidak melayang jauh.
      for (const n of titik) {
        n.vx += (cx - n.x) * 0.012;
        n.vy += (cy - n.y) * 0.012;
        n.x += Math.max(-12, Math.min(12, n.vx)) * dingin;
        n.y += Math.max(-12, Math.min(12, n.vy)) * dingin;
        n.vx *= 0.82; n.vy *= 0.82;
      }
    }

    // Jaga agar semua node tetap di dalam bidang.
    const tepi = options.padding || 26;
    for (const n of titik) {
      n.x = Math.max(tepi, Math.min(width - tepi, n.x));
      n.y = Math.max(tepi, Math.min(height - tepi, n.y));
      delete n.vx; delete n.vy;
    }
    return titik;
  }

  return {
    dayMs,
    shuffle,
    resolveAnswerValue,
    buildQuizOptions,
    normalizeQuiz,
    normalizeQuizList,
    dateKey,
    currentStreak,
    streakAfterActivity,
    splitParagraphs,
    escapeHtml,
    linkKey,
    parseWikilinks,
    parseTags,
    renderMarkdown,
    layoutGraph
  };
});
