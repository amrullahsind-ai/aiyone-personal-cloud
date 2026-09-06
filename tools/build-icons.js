/**
 * Menghasilkan lib/aiyone-icons.js dari paket npm `heroicons` (tim Tailwind).
 *
 * Data path di-inline ke berkas JS, bukan dimuat dari CDN saat runtime, supaya
 * aplikasi tetap bekerja offline sebagai PWA. Path yang digambar ulang manual
 * pasti melenceng, jadi selalu diambil dari sumber resminya.
 *
 * Jalankan:  node tools/build-icons.js
 * Untuk menambah ikon: tambahkan entri di IKON lalu jalankan ulang.
 */
const fs = require("fs");
const path = require("path");

const VERSI = "2.1.5";
const BASE = `https://cdn.jsdelivr.net/npm/heroicons@${VERSI}/24/outline`;
const TUJUAN = path.join(__dirname, "..", "lib", "aiyone-icons.js");

/** nama internal → nama berkas Heroicons */
const IKON = {
  menu: "bars-3",
  close: "x-mark",
  back: "chevron-left",
  grid: "squares-2x2",
  install: "arrow-down-tray",
  linkout: "arrow-up-right",
  refresh: "arrow-path",
  home: "home",
  play: "play",
  pause: "pause",
  stop: "stop",
  forward: "forward",
  clock: "clock",
  notes: "document-text",
  trophy: "trophy",
  book: "book-open",
  check: "check-circle",
  bolt: "bolt",
  arrowRight: "arrow-right",
  star: "star",
  sparkles: "sparkles",
  moon: "moon",
  user: "user",
  academic: "academic-cap",
  search: "magnifying-glass",
  plus: "plus",
  trash: "trash",
  link: "link",
  speaker: "speaker-wave",
  list: "queue-list",
  // Dipakai toolbar editor Markdown.
  code: "code-bracket",
  quote: "chat-bubble-bottom-center-text",
  checklist: "check",
  hash: "hashtag",
  share: "share",
};

/** Mengambil isi <svg>…</svg> tanpa pembungkusnya. */
function isiSvg(teks) {
  const m = teks.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  if (!m) throw new Error("bentuk SVG tidak dikenali");
  return m[1].replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
}

(async () => {
  const hasil = {};
  const gagal = [];
  for (const [nama, berkas] of Object.entries(IKON)) {
    try {
      const res = await fetch(`${BASE}/${berkas}.svg`);
      if (!res.ok) { gagal.push(`${nama} (${berkas}) HTTP ${res.status}`); continue; }
      hasil[nama] = isiSvg(await res.text());
      process.stdout.write(".");
    } catch (e) {
      gagal.push(`${nama} (${berkas}) ${e.message}`);
    }
  }
  console.log();

  // Gagal sebagian lebih berbahaya daripada gagal total: berkas jadi separuh
  // terisi dan ikon yang hilang muncul sebagai ruang kosong tanpa error.
  if (gagal.length) {
    console.error("GAGAL:", gagal.join(" | "));
    process.exit(1);
  }

  const baris = Object.entries(hasil)
    .map(([k, v]) => `    ${k}: '${v.replace(/'/g, "\'")}',`)
    .join("\n");

  fs.writeFileSync(TUJUAN, `/**
 * Ikon Heroicons (heroicons.com, dari tim Tailwind), varian outline 24px.
 *
 * Data path di-inline, bukan dimuat dari CDN, supaya aplikasi tetap bekerja
 * offline sebagai PWA. BERKAS INI DIHASILKAN OTOMATIS — jangan diedit tangan.
 * Untuk menambah ikon: ubah daftar IKON di tools/build-icons.js lalu jalankan
 * \`node tools/build-icons.js\`.
 *
 * Dipakai lewat window.AiyoneIcons.svg("play", { size: 20 }).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AiyoneIcons = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const PATHS = {
${baris}
  };

  /**
   * Menghasilkan markup SVG satu ikon.
   *
   * Selalu aria-hidden: ikon di aplikasi ini menyertai teks, atau berada di
   * tombol yang sudah punya aria-label sendiri.
   */
  function svg(nama, opsi = {}) {
    const isi = PATHS[nama];
    if (!isi) return "";
    const size = opsi.size || 20;
    const stroke = opsi.strokeWidth || 1.7;
    const cls = opsi.className ? \` class="\${opsi.className}"\` : "";
    return \`<svg\${cls} width="\${size}" height="\${size}" viewBox="0 0 24 24" fill="none" \` +
      \`stroke="currentColor" stroke-width="\${stroke}" stroke-linecap="round" stroke-linejoin="round" \` +
      \`aria-hidden="true" focusable="false">\${isi}</svg>\`;
  }

  const names = () => Object.keys(PATHS);

  return { svg, names, PATHS };
});
`);
  console.log(`${Object.keys(hasil).length} ikon ditulis ke ${TUJUAN}`);
})();
