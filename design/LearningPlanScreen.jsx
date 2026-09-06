import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { colors, radius, layout, shadow, motionSpec } from "./theme.js";
import { Icon, DockedSheet, GreetingHeader, SectionHead, CountUp } from "./primitives.jsx";

/* Mode kognitif: analisis dan perencanaan → permukaan cream. */

const STATS = [
  { icon: "GraduationCap", value: 44, label: "Total", bg: colors.tealSoft, fg: colors.tealDeep },
  { icon: "BookOpen", value: 12, label: "Completed", bg: colors.pinkAccent, fg: "#8A2338" },
  { icon: "Clock", value: 34, label: "Upcoming", bg: colors.white, fg: colors.orangeAccent },
];

/** Titik data bulanan. Angka realistis, bukan placeholder acak. */
const SERIES = [
  { month: "May", value: 41, delta: null },
  { month: "Jun", value: 53, delta: +12 },
  { month: "July", value: 46, delta: null },
  { month: "August", value: 78, delta: +43, peak: true },
  { month: "Sept", value: 56, delta: -22 },
];

/**
 * Line chart.
 *
 * Path digambar progresif lewat stroke-dasharray, lalu tooltip puncak
 * muncul setelah garisnya selesai — urutannya menyampaikan "progres tercapai",
 * bukan sekadar elemen yang muncul bersamaan.
 */
function ProgressChart({ data, height = 150 }) {
  const W = 320, padX = 14, padTop = 34, padBottom = 30;

  const { titik, garis, area, puncak } = useMemo(() => {
    const max = Math.max(...data.map(d => d.value)) * 1.12;
    const stepX = (W - padX * 2) / (data.length - 1);
    const titik = data.map((d, i) => ({
      ...d,
      x: padX + i * stepX,
      y: padTop + (1 - d.value / max) * (height - padTop - padBottom),
    }));
    // Catmull-Rom → kubik Bezier supaya lengkungnya halus tanpa melewati titik.
    const garis = titik.map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const p0 = titik[i - 2] || titik[i - 1], p1 = titik[i - 1], p3 = titik[i + 1] || p;
      const t = 0.2;
      return `C ${(p1.x + (p.x - p0.x) * t).toFixed(1)} ${(p1.y + (p.y - p0.y) * t).toFixed(1)}, ` +
             `${(p.x - (p3.x - p1.x) * t).toFixed(1)} ${(p.y - (p3.y - p1.y) * t).toFixed(1)}, ` +
             `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }).join(" ");
    const area = `${garis} L ${titik.at(-1).x} ${height - padBottom} L ${titik[0].x} ${height - padBottom} Z`;
    return { titik, garis, area, puncak: titik.find(p => p.peak) || titik[0] };
  }, [data, height]);

  const persen = (n, total) => `${(n / total * 100).toFixed(2)}%`;

  return (
    <div className="w-full" style={{ marginTop: 4 }}>
      {/* Kotak ini HANYA membungkus SVG.
          Tooltip dan chip diposisikan dengan persentase terhadap viewBox, jadi
          kotak acuannya harus berukuran sama persis dengan SVG. Kalau baris
          label bulan ikut masuk ke sini, acuan tingginya jadi lebih besar dan
          semua overlay meleset ke bawah. */}
      <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full block" style={{ overflow: "visible" }} aria-hidden="true">
        <defs>
          <linearGradient id="planFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.chartFill} stopOpacity="0.20" />
            <stop offset="100%" stopColor={colors.chartFill} stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d={area} fill="url(#planFill)"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.55 }}
        />
        <motion.path
          d={garis} fill="none" stroke={colors.chartLine} strokeWidth={3}
          strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={motionSpec.chartDraw}
        />
        <motion.circle
          cx={puncak.x} cy={puncak.y} r={5}
          fill={colors.chartLine} stroke={colors.cream} strokeWidth={3}
          initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 14, delay: 0.9 }}
          style={{ transformOrigin: `${puncak.x}px ${puncak.y}px` }}
        />
      </svg>

      {/* Tooltip pill di titik puncak.
          Pemosisian dan animasi sengaja dipisah ke dua elemen. Framer Motion
          menulis properti `transform` sendiri saat menganimasikan scale/y,
          sehingga translate(-50%,…) untuk memusatkan elemen akan tertimpa
          kalau ditaruh di elemen yang sama. */}
      <div
        className="absolute"
        style={{ left: persen(puncak.x, W), top: persen(puncak.y, height), transform: "translate(-50%,-100%)" }}
      >
        <motion.div
          className="relative font-extrabold tabular-nums"
          style={{
            background: colors.textDark, color: colors.textWhite,
            borderRadius: radius.pill, padding: "6px 13px", fontSize: 12.5,
            whiteSpace: "nowrap", marginBottom: 12,
          }}
          initial={{ opacity: 0, scale: 0.5, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={motionSpec.tooltipPop}
        >
          {puncak.value}%
          <span
            className="absolute left-1/2 rotate-45"
            style={{ width: 9, height: 9, background: colors.textDark, bottom: -4, marginLeft: -4.5 }}
            aria-hidden="true"
          />
        </motion.div>
      </div>

      {/* Label delta kecil, pola pemisahan yang sama. */}
      {titik.filter(p => p.delta !== null && !p.peak).map(p => (
        <div
          key={p.month}
          className="absolute"
          style={{ left: persen(p.x, W), top: persen(p.y, height), transform: "translate(-50%,-100%)" }}
        >
          <motion.span
            className="block font-bold tabular-nums"
            style={{
              background: p.delta > 0 ? colors.tealSoft : colors.pinkAccent,
              color: p.delta > 0 ? colors.tealDeep : "#8A2338",
              borderRadius: radius.pill, padding: "3px 9px", fontSize: 10.5,
              whiteSpace: "nowrap", marginBottom: 10,
            }}
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 1.05 }}
          >
            {p.delta > 0 ? "+" : ""}{p.delta}
          </motion.span>
        </div>
      ))}
      </div>

      <div className="grid mt-1" style={{ gridTemplateColumns: `repeat(${data.length}, 1fr)` }}>
        {data.map(d => (
          <span key={d.month} className="text-center font-semibold" style={{ color: colors.textMuted, fontSize: 11 }}>
            {d.month}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function LearningPlanScreen({ onLearnMore, notif, onNotif }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: motionSpec.stagger.delayStep } } }}
      className="flex flex-col min-h-full flex-1"
      style={{ background: colors.creamDeep }}
    >
      <div style={{ background: colors.creamDeep, padding: `20px ${layout.paddingX}px ${layout.sheetOverlap + 20}px` }}>
        <GreetingHeader
          name="Elizabeth" date="Mon, 23 July" tone="dark"
          avatarBg={colors.white} toggleOn={notif} onToggle={onNotif}
        />
      </div>

      <DockedSheet background={colors.cream}>
        <SectionHead onLearnMore={onLearnMore}>
          <h2 className="font-extrabold leading-tight" style={{ color: colors.textDark, fontSize: 23 }}>
            Learning plan
          </h2>
          <p className="font-medium" style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
            Ringkasan 5 bulan terakhir
          </p>
        </SectionHead>

        {/* Tiga kartu statistik sejajar. */}
        <motion.div variants={motionSpec.fadeUp} custom={2} className="grid grid-cols-3 gap-3 mt-5">
          {STATS.map((s, i) => (
            <article
              key={s.label}
              className="grid justify-items-center gap-1 py-4"
              style={{ background: colors.white, borderRadius: radius.card, boxShadow: shadow.soft }}
            >
              <span
                className="grid place-items-center rounded-full mb-1"
                style={{ width: 38, height: 38, background: s.bg, color: s.fg }}
              >
                <Icon name={s.icon} size={19} />
              </span>
              <CountUp
                value={s.value}
                className="font-extrabold tabular-nums leading-none"
                style={{ color: colors.textDark, fontSize: 24 }}
              />
              <span className="font-semibold" style={{ color: colors.textMuted, fontSize: 11 }}>{s.label}</span>
            </article>
          ))}
        </motion.div>

        {/* Metrik besar. */}
        <motion.div variants={motionSpec.fadeUp} custom={3} className="flex items-end justify-between gap-3 mt-7">
          <div>
            <CountUp
              value={78} suffix="%"
              className="block font-extrabold tabular-nums leading-none"
              style={{ color: colors.textDark, fontSize: 46, letterSpacing: "-0.04em" }}
            />
            <span className="block font-semibold mt-1.5" style={{ color: colors.textMuted, fontSize: 12.5 }}>
              Average progress
            </span>
          </div>
        </motion.div>

        <motion.div variants={motionSpec.fadeUp} custom={4} className="mt-3">
          <ProgressChart data={SERIES} />
        </motion.div>
      </DockedSheet>
    </motion.div>
  );
}
