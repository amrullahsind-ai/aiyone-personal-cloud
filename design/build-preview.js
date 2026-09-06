/**
 * Merakit berkas sumber di folder ini menjadi satu halaman HTML yang bisa
 * dibuka langsung, tanpa bundler.
 *
 * Alasannya: kode yang diserahkan dan kode yang dijalankan di preview harus
 * berasal dari sumber yang sama. Kalau preview ditulis terpisah, keduanya
 * pasti melenceng.
 *
 * Transformasinya sengaja dangkal — hanya membuang baris `import` dan kata
 * kunci `export`, karena semua modul digabung ke satu scope. JSX-nya sendiri
 * dikompilasi di browser oleh Babel standalone.
 *
 * Jalankan: node design/build-preview.js
 */
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const URUTAN = ["theme.js", "primitives.jsx", "HomeScreen.jsx", "LearningPlanScreen.jsx", "LeaderboardScreen.jsx", "App.jsx"];

/** Nama default export tiap berkas, supaya `export default function X` tetap terpanggil. */
const DEFAULT_EXPORT = {
  "HomeScreen.jsx": "HomeScreen",
  "LearningPlanScreen.jsx": "LearningPlanScreen",
  "LeaderboardScreen.jsx": "LeaderboardScreen",
  "App.jsx": "App",
};

function bersihkan(isi, berkas) {
  return isi
    // Buang seluruh pernyataan import, termasuk yang multi-baris.
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^import\s+["'][^"']+["'];?\s*$/gm, "")
    // `export default function Nama(` -> `function Nama(`
    .replace(/^export\s+default\s+function\s+/gm, "function ")
    // `export const` / `export function` -> tanpa kata export
    .replace(/^export\s+(const|function|let|class)\s+/gm, "$1 ")
    // Buang baris `export { ... };`
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, "")
    // Buang `export default <ekspresi>;` yang bukan deklarasi fungsi.
    .replace(/^export\s+default\s+[^;\r\n]+;\s*$/gm, "")
    .trim();
}

const bagian = URUTAN.map(nama => {
  const isi = fs.readFileSync(path.join(DIR, nama), "utf8");
  return `/* ======================== ${nama} ======================== */\n${bersihkan(isi, nama)}`;
});

const sumberGabungan = bagian.join("\n\n");

const html = `<title>Learning Progress Kit</title>
<meta name="color-scheme" content="light">
<!-- Font dimuat lewat <link>, bukan @import: @import di dalam <style> menunda
     pemuatan sampai CSS selesai diurai dan sering gagal senyap di lingkungan
     ber-CSP ketat. -->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Poppins:wght@400;500;600;700;800&display=swap">
<style>
  html,body{margin:0;background:#EFE7F2}
  body{font-family:Poppins,Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  h1,h2,b,strong,.tabular-nums{font-family:"Baloo 2",Poppins,system-ui,sans-serif}
  .tabular-nums{font-variant-numeric:tabular-nums}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
  /* Scrubber player. */
  input[type=range]{--p:0%}
  input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:999px;
    background:linear-gradient(90deg,#1E5A4E var(--p),rgba(23,36,31,.14) var(--p))}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;
    background:#1E5A4E;border:3px solid #FBF3E1;margin-top:-6px;box-shadow:0 2px 8px rgba(23,36,31,.35)}
  input[type=range]::-moz-range-track{height:6px;border-radius:999px;background:rgba(23,36,31,.14)}
  input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#1E5A4E;border:3px solid #FBF3E1}
  input[type=range]:focus-visible{outline:3px solid #B32F49;outline-offset:4px}
  *:focus-visible{outline:3px solid #B32F49;outline-offset:2px}
  ::-webkit-scrollbar{width:0;height:0}
  @media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
</style>

<div id="root"></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.4/babel.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/framer-motion@11.11.17/dist/framer-motion.js"></script>
<script src="https://cdn.jsdelivr.net/npm/lucide@0.454.0/dist/umd/lucide.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script>

<script>
  // Framer Motion dan React dipaparkan sebagai global supaya kode sumber yang
  // aslinya memakai import bisa dijalankan apa adanya setelah baris import
  // dibuang oleh build-preview.js.
  window.useState = React.useState; window.useEffect = React.useEffect;
  window.useRef = React.useRef; window.useMemo = React.useMemo;
  window.motion = Motion.motion; window.AnimatePresence = Motion.AnimatePresence;
</script>

<script type="text/babel" data-presets="react">
${sumberGabungan}

/* Scrubber mengecat isian track lewat custom property. */
function SinkronScrubber() {
  React.useEffect(() => {
    const perbarui = () => document.querySelectorAll('input[type=range]').forEach(el => {
      const p = ((el.value - el.min) / (el.max - el.min)) * 100;
      el.style.setProperty('--p', p + '%');
    });
    perbarui();
    const id = setInterval(perbarui, 200);
    document.addEventListener('input', perbarui);
    return () => { clearInterval(id); document.removeEventListener('input', perbarui); };
  }, []);
  return null;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(React.Fragment, null,
    React.createElement(SinkronScrubber),
    React.createElement(App)
  )
);
</script>
`;

const keluaran = path.join(DIR, "preview.html");
fs.writeFileSync(keluaran, html);
console.log(`preview.html ditulis (${(html.length / 1024).toFixed(1)} KB) dari ${URUTAN.length} berkas sumber`);
