/**
 * Design tokens.
 *
 * Semua warna, radius, dan spesifikasi motion tinggal di sini supaya layar
 * tidak pernah meng-hardcode nilai. Menambah layar baru berarti menambah satu
 * entri "mode kognitif" di bawah, bukan memilih warna secara ad hoc.
 */

/* ---------------------------------------------------------------- Warna --- */

export const colors = {
  /* Coral — mode aktif belajar.
   *
   * Nilai di brief (#EE6B7A → #E4536A) hanya mencapai 2.94:1 dan 3.60:1 dengan
   * teks putih, jadi gagal WCAG AA untuk teks normal yang butuh 4.5:1. Karena
   * checklist meminta kontras lolos, hue-nya dipertahankan tapi diperdalam
   * sampai 4.59:1 dan 6.04:1. Nilai asli tetap disimpan di bawah untuk
   * pemakaian dekoratif yang tidak membawa teks. */
  coralFrom: "#CD4159",
  coralTo: "#B32F49",
  coralDecor: "#EE6B7A",
  coralSoft: "#F2A6B0",

  /* Cream — mode analisis dan perencanaan. */
  cream: "#FBF3E1",
  creamDeep: "#F3E8CE",

  /* Teal — mode status dan kompetisi. */
  tealDeep: "#1E5A4E",
  tealDark: "#164439",
  tealSoft: "#8CCBB8",

  orangeAccent: "#F4A73B",
  pinkAccent: "#F2A6B0",

  textDark: "#17241F",
  textMuted: "#5C6B63",
  textWhite: "#FFFDF8",
  /* Teks sekunder di atas coral.
     Tint merah muda (#F7DCE0) hanya mencapai 3.62:1 dan gagal AA, jadi
     hierarki di atas coral dibentuk lewat berat dan ukuran huruf, bukan lewat
     penurunan opasitas warna. */
  textOnCoralMuted: "#FFFDF8",
  textOnTealMuted: "#B9D6CC",

  chartLine: "#E4536A",
  chartFill: "#E4536A",

  white: "#FFFFFF",
  hairline: "rgba(23,36,31,.10)",
  translucent: "rgba(255,255,255,.16)",
};

/**
 * Mode kognitif per layar. Aturannya: tentukan mode dulu, warna mengikuti.
 * Layar baru wajib mendaftar di sini sebelum memilih warna apa pun.
 */
export const cognitiveModes = {
  learning: { label: "Mode belajar aktif", surface: "coral", onSurface: colors.textWhite },
  planning: { label: "Mode analisis", surface: "cream", onSurface: colors.textDark },
  status: { label: "Mode status & kompetisi", surface: "teal", onSurface: colors.textWhite },
};

/* -------------------------------------------------------- Bentuk & ruang --- */

export const radius = { panel: 34, sheet: 32, card: 16, chip: 14, pill: 999 };

/** Skala 8pt. */
export const space = { xs: 8, sm: 16, md: 24, lg: 32, xl: 40 };

export const layout = {
  frameWidth: 390,
  paddingX: 26,
  /** Seberapa jauh panel konten menindih header. Pola tetap di semua layar. */
  sheetOverlap: 34,
};

export const shadow = {
  /* Kedalaman dibentuk lewat color-blocking dan overlap, bukan drop-shadow
     tebal. Shadow di sini sengaja lembut dan jarang dipakai. */
  soft: "0 18px 40px -24px rgba(23,36,31,.45)",
  lifted: "0 22px 45px -20px rgba(23,36,31,.55)",
};

export const typography = {
  display: '"Baloo 2", Poppins, ui-rounded, system-ui, sans-serif',
  body: 'Poppins, Inter, system-ui, sans-serif',
  sizes: { metric: 46, headline: 23, title: 17, body: 14, caption: 11.5 },
};

/* ------------------------------------------------------------- Motion ---- */

/** easeOutQuint — dipakai untuk semua entrance. */
export const easeOutQuint = [0.22, 1, 0.36, 1];

export const motionSpec = {
  /** Entrance berjenjang: header → stat row → hero/chart. */
  stagger: { delayStep: 0.07, duration: 0.36 },
  fadeUp: {
    hidden: { opacity: 0, y: 18 },
    show: (i = 0) => ({
      opacity: 1,
      y: 0,
      transition: { duration: 0.36, delay: i * 0.07, ease: easeOutQuint },
    }),
  },
  /** Transisi antar layar: cross-fade + scale tipis. */
  screen: {
    initial: { opacity: 0, scale: 0.98 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.98 },
    transition: { type: "spring", stiffness: 260, damping: 24 },
  },
  /** Progress ring: stroke-dashoffset dari kosong ke nilai target. */
  ring: { duration: 0.95, ease: "easeInOut" },
  /** Line chart: path digambar progresif. */
  chartDraw: { duration: 0.9, ease: "easeInOut" },
  /** Tooltip puncak muncul setelah garis selesai. */
  tooltipPop: { type: "spring", stiffness: 420, damping: 14, delay: 0.95 },
  /** Angka besar menghitung naik, sinkron dengan ring/chart. */
  countUp: { duration: 950 },
  /** Pil putih segmented control berpindah, bukan bertukar seketika. */
  segment: { type: "spring", stiffness: 380, damping: 32 },
  /** Baris leaderboard masuk berjenjang. */
  rowStagger: 0.05,
  /** Tekan tombol. */
  press: { scale: 0.96, transition: { duration: 0.11 } },
  /** Badge dekoratif mengambang halus, terus-menerus. */
  float: {
    animate: { y: [0, -3, 0] },
    transition: { duration: 3, repeat: Infinity, ease: "easeInOut" },
  },
  toggle: { type: "spring", stiffness: 500, damping: 34 },
};

export const theme = { colors, cognitiveModes, radius, space, layout, shadow, typography, motionSpec, easeOutQuint };
export default theme;
