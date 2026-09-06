/**
 * Audit kontras WCAG AA untuk dijalankan di konsol browser.
 *
 * Cara pakai: buka aplikasi, tempel isi berkas ini di konsol, lalu jalankan
 *   await AiyoneAudit.sapuSemua()      // semua layar + detail catatan
 *   AiyoneAudit.periksa("nama-layar")  // hanya yang sedang tampil
 *
 * Ulangi di terang dan gelap (prefers-color-scheme), mobile dan desktop.
 *
 * Ambang: 4.5:1 teks normal, 3:1 teks besar (>=24px, atau >=18.66px tebal)
 * dan objek grafis seperti node/garis graf.
 *
 * Dua jebakan yang sudah pernah menghasilkan laporan palsu, keduanya kini
 * ditangani di sini:
 *   1. color-mix() dilaporkan sebagai color(srgb 0.95 …) — skala 0-1, bukan
 *      0-255. Dibaca dengan pola sendiri.
 *   2. Elemen bergradien punya backgroundColor transparan, sehingga penelusuran
 *      latar menembusnya dan mengukur ke induk yang salah. Stop gradiennya
 *      dibaca, lalu rasio TERBURUK di antara stop itu yang dinilai.
 */
(function (root) {
  "use strict";

  const srgb = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const ratio = (a, b) => { const v = [lum(a), lum(b)].sort((p, q) => q - p); return (v[0] + 0.05) / (v[1] + 0.05); };

  function parse(s) {
    if (!s) return null;
    let m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
    if (m) return { rgb: [+m[1] * 255, +m[2] * 255, +m[3] * 255], a: m[4] === undefined ? 1 : +m[4] };
    m = s.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.%]+))?\)/);
    if (!m) return null;
    const a = m[4] === undefined ? 1 : (String(m[4]).endsWith("%") ? parseFloat(m[4]) / 100 : +m[4]);
    return { rgb: [+m[1], +m[2], +m[3]], a };
  }

  const stopGradien = s => (s && s !== "none")
    ? [...s.matchAll(/rgba?\([^)]*\)|color\(srgb[^)]*\)/g)].map(m => parse(m[0])).filter(c => c && c.a > 0)
    : [];

  const over = (fg, bg) => fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a));

  /** Mengembalikan SEMUA latar yang mungkin; gradien menyumbang lebih dari satu. */
  function bgOf(el) {
    let node = el, acc = null;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      const grad = stopGradien(cs.backgroundImage);
      if (grad.length) return grad.map(g => (acc ? over(acc, g.rgb) : g.rgb).map(Math.round));
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        acc = acc === null ? c : { rgb: over(acc, c.rgb), a: 1 };
        if (c.a === 1) return [acc.rgb.map(Math.round)];
      }
      node = node.parentElement;
    }
    return [acc ? acc.rgb.map(Math.round) : [255, 255, 255]];
  }

  const terlihat = el => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.opacity !== "0";
  };

  const nama = el => el.tagName.toLowerCase() + (el.classList.length ? "." + [...el.classList].join(".") : "");

  function periksa(tanda = "") {
    const temuan = [];

    document.querySelectorAll("body *").forEach(el => {
      if (!terlihat(el)) return;
      // Hanya elemen yang benar-benar memuat teks sendiri, bukan pembungkusnya.
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      if (!fg) return;
      const px = parseFloat(cs.fontSize);
      const besar = px >= 24 || (px >= 18.66 && (parseInt(cs.fontWeight) || 400) >= 700);
      const min = besar ? 3 : 4.5;
      const r = Math.min(...bgOf(el).map(bg => ratio(fg.a < 1 ? over(fg, bg) : fg.rgb, bg)));
      if (r < min) temuan.push({ dari: tanda, tipe: "teks", sel: nama(el), teks: el.textContent.trim().slice(0, 45), rasio: +r.toFixed(2), min, px });
    });

    document.querySelectorAll("svg circle, svg line, svg path, svg rect").forEach(el => {
      if (!terlihat(el)) return;
      const cs = getComputedStyle(el);
      const bgs = bgOf(el.closest("svg").parentElement);
      ["fill", "stroke"].forEach(prop => {
        // <line> tidak pernah terisi, tapi computed fill-nya tetap hitam —
        // pernah menghasilkan temuan palsu 1.36:1 pada garis graf.
        if (prop === "fill" && el.tagName.toLowerCase() === "line") return;
        const v = parse(cs[prop]);
        if (!v || v.a === 0) return;
        const r = Math.min(...bgs.map(bg => ratio(v.a < 1 ? over(v, bg) : v.rgb, bg)));
        // Stroke yang nyaris sewarna latar memang pemisah visual, bukan info.
        if (prop === "stroke" && r < 1.35) return;
        if (r < 3) temuan.push({ dari: tanda, tipe: "grafis " + prop, sel: nama(el), rasio: +r.toFixed(2), min: 3 });
      });
    });

    return temuan;
  }

  const tidur = ms => new Promise(r => setTimeout(r, ms));

  async function sapuSemua() {
    const hasil = [];
    const sidebar = document.querySelector(".sidebar");
    if (sidebar) { sidebar.classList.add("open"); await tidur(400); hasil.push(...periksa("sidebar")); sidebar.classList.remove("open"); }

    const layar = [...new Set([...document.querySelectorAll("[data-view],[data-jump]")]
      .map(b => b.dataset.view || b.dataset.jump))];
    for (const v of layar) {
      document.querySelector(`[data-view="${v}"],[data-jump="${v}"]`).click();
      await tidur(500);
      hasil.push(...periksa(v));
    }

    // Detail catatan punya tiga state yang tidak terlihat dari daftar layar.
    document.querySelector('[data-view="notes"]')?.click(); await tidur(400);
    if (document.querySelector(".note-card")) {
      document.querySelector(".note-card").click(); await tidur(700);
      hasil.push(...periksa("catatan/tulis"));
      document.querySelector('.editor-mode[data-mode="baca"]')?.click(); await tidur(350);
      hasil.push(...periksa("catatan/pratinjau"));
      document.querySelector(".explain-link")?.click(); await tidur(250);
      hasil.push(...periksa("catatan/jelaskan"));
    }

    console.table(hasil);
    console.log(hasil.length ? `${hasil.length} temuan` : "nol temuan");
    return hasil;
  }

  root.AiyoneAudit = { periksa, sapuSemua, ratio, parse };
})(typeof self !== "undefined" ? self : globalThis);
