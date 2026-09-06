import React from "react";
import { motion } from "framer-motion";
import { colors, radius, layout, shadow, motionSpec } from "./theme.js";
import { Icon, IconButton, DockedSheet, GreetingHeader, SectionHead, formatTime } from "./primitives.jsx";

/* Mode kognitif: belajar aktif → permukaan coral. */

/**
 * Cincin progres.
 *
 * Entrance memakai durasi panjang ease-in-out sesuai spesifikasi motion —
 * itu yang menyampaikan "progres tercapai". Tapi durasi itu hanya boleh sekali:
 * player berdetak tiap detik, dan kalau setiap pembaruan memicu animasi 950ms
 * lagi, cincinnya akan selamanya tertinggal di belakang angka timer. Jadi
 * setelah mount, cincin mengikuti secara linear seirama detak.
 */
function ProgressRing({ progress, size = 188, stroke = 7 }) {
  const r = (size - stroke) / 2;
  const keliling = 2 * Math.PI * r;
  const sudahMasuk = React.useRef(false);

  React.useEffect(() => {
    const id = setTimeout(() => { sudahMasuk.current = true; }, motionSpec.ring.duration * 1000);
    return () => clearTimeout(id);
  }, []);

  return (
    <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(23,36,31,.10)" strokeWidth={stroke} />
      <motion.circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={colors.orangeAccent} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={keliling}
        initial={{ strokeDashoffset: keliling }}
        animate={{ strokeDashoffset: keliling * (1 - progress) }}
        transition={sudahMasuk.current ? { duration: 1, ease: "linear" } : motionSpec.ring}
      />
    </svg>
  );
}

/** Badge dekoratif yang mengambang pelan supaya hero terasa hidup. */
function FloatingBadge({ name, background, color, style, delay = 0, label }) {
  return (
    <motion.span
      className="absolute grid place-items-center rounded-full"
      style={{ width: 42, height: 42, background, color, boxShadow: shadow.soft, ...style }}
      animate={motionSpec.float.animate}
      transition={{ ...motionSpec.float.transition, delay }}
      role="img"
      aria-label={label}
    >
      <Icon name={name} size={19} />
    </motion.span>
  );
}

/** Satu baris statistik inline dengan ikon kecil di kiri teks. */
function InlineStat({ icon, label, value, valueColor = colors.textDark }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span
        className="grid place-items-center rounded-full shrink-0"
        style={{ width: 34, height: 34, background: colors.white, color: colors.tealDeep, boxShadow: shadow.soft }}
      >
        <Icon name={icon} size={17} />
      </span>
      <span className="min-w-0">
        <span className="block font-medium truncate" style={{ color: colors.textMuted, fontSize: 11.5 }}>{label}</span>
        <span className="block font-extrabold truncate" style={{ color: valueColor, fontSize: 14 }}>{value}</span>
      </span>
    </div>
  );
}

export default function HomeScreen({ player, onTogglePlay, onSeek, onLearnMore, notif, onNotif }) {
  const { lesson, elapsed, duration, playing } = player;
  const progress = duration ? elapsed / duration : 0;

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: motionSpec.stagger.delayStep } } }}
      className="flex flex-col min-h-full flex-1"
      style={{ background: colors.cream }}
    >
      {/* Header solid-color. */}
      <div
        style={{
          background: `linear-gradient(160deg, ${colors.coralFrom} 0%, ${colors.coralTo} 100%)`,
          padding: `20px ${layout.paddingX}px ${layout.sheetOverlap + 26}px`,
        }}
      >
        <GreetingHeader
          name="Elizabeth"
          date="Mon, 23 July"
          tone="light"
          toggleOn={notif}
          onToggle={onNotif}
        />

        {/* Pil gelap melayang di bawah header. */}
        <motion.button
          type="button"
          variants={motionSpec.fadeUp}
          custom={1}
          whileTap={motionSpec.press}
          onClick={onLearnMore}
          className="mt-6 flex items-center gap-2.5 rounded-full font-bold"
          style={{
            background: colors.textDark, color: colors.textWhite,
            padding: "13px 22px", fontSize: 13.5, boxShadow: shadow.lifted,
          }}
        >
          <span className="grid place-items-center rounded-full" style={{ width: 22, height: 22, background: colors.coralDecor }}>
            <Icon name="Sparkles" size={13} />
          </span>
          Request Demo
        </motion.button>
      </div>

      {/* Panel konten yang menindih header. */}
      <DockedSheet>
        <SectionHead onLearnMore={onLearnMore}>
          <span className="font-semibold" style={{ color: colors.textMuted, fontSize: 11.5 }}>Level 22</span>
          <h2 className="font-extrabold leading-tight" style={{ color: colors.textDark, fontSize: 23, marginTop: 2 }}>
            Learning progress
          </h2>
        </SectionHead>

        {/* Dua statistik inline. "Active" adalah bukti sesi masih hidup. */}
        <motion.div variants={motionSpec.fadeUp} custom={2} className="grid grid-cols-2 gap-3 mt-5">
          <InlineStat
            icon="Activity"
            label="Current activity"
            value={playing ? "Active" : "Paused"}
            valueColor={playing ? colors.tealDeep : colors.textMuted}
          />
          <InlineStat icon="BookOpen" label="Lessons" value="#44" />
        </motion.div>

        {/* Hero: lingkaran teal + cincin progres + badge mengambang. */}
        <motion.div variants={motionSpec.fadeUp} custom={3} className="relative grid place-items-center mt-7">
          <div className="relative" style={{ width: 188, height: 188 }}>
            <ProgressRing progress={progress} />
            <div
              className="absolute grid place-items-center rounded-full overflow-hidden"
              style={{ inset: 18, background: colors.tealDeep, color: colors.tealSoft }}
              role="img"
              aria-label={`Thumbnail kursus ${lesson.title}`}
            >
              <Icon name="GraduationCap" size={54} strokeWidth={1.4} />
            </div>
            <FloatingBadge
              name="Star" label="Ditandai favorit"
              background={colors.orangeAccent} color={colors.textDark}
              style={{ right: -8, top: 24 }}
            />
            <FloatingBadge
              name="Bookmark" label="Disimpan"
              background={colors.white} color={colors.coralTo}
              style={{ left: -6, bottom: 34 }} delay={0.9}
            />
          </div>

          <p className="font-bold mt-4 text-center" style={{ color: colors.textDark, fontSize: 14 }}>
            {lesson.title}
          </p>
          <p className="font-medium text-center" style={{ color: colors.textMuted, fontSize: 11.5 }}>
            {lesson.chapter}
          </p>
        </motion.div>

        {/* Scrubber. */}
        <motion.div variants={motionSpec.fadeUp} custom={4} className="mt-5">
          <label className="sr-only" htmlFor="scrub">Posisi pemutaran</label>
          <input
            id="scrub"
            type="range"
            min={0}
            max={duration}
            value={Math.round(elapsed)}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="w-full appearance-none bg-transparent cursor-pointer"
            style={{ height: 22 }}
            aria-valuetext={`${formatTime(elapsed)} dari ${formatTime(duration)}`}
          />
          <div className="flex justify-between font-bold tabular-nums" style={{ color: colors.textDark, fontSize: 12.5 }}>
            <span>{formatTime(elapsed)}</span>
            <span style={{ color: colors.textMuted }}>{formatTime(duration)}</span>
          </div>
        </motion.div>

        {/* Control bar. */}
        <motion.div variants={motionSpec.fadeUp} custom={5} className="flex items-center justify-center gap-7 mt-4 mb-1">
          <IconButton
            label="Atur volume" name="Volume2"
            className="shrink-0"
            style={{ background: colors.white, color: colors.textDark, boxShadow: shadow.soft }}
          />
          <motion.button
            type="button"
            onClick={onTogglePlay}
            whileTap={motionSpec.press}
            aria-label={playing ? "Jeda pelajaran" : "Putar pelajaran"}
            className="grid place-items-center rounded-full"
            style={{ width: 68, height: 68, background: colors.tealDeep, color: colors.textWhite, boxShadow: shadow.lifted }}
          >
            {/* Cross-fade antar state, bukan pergantian mendadak. */}
            <motion.span
              key={playing ? "pause" : "play"}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.18 }}
              className="grid place-items-center"
            >
              <Icon name={playing ? "Pause" : "Play"} size={26} strokeWidth={2} />
            </motion.span>
          </motion.button>
          <IconButton
            label="Buka daftar pelajaran" name="ListMusic"
            className="shrink-0"
            style={{ background: colors.white, color: colors.textDark, boxShadow: shadow.soft }}
          />
        </motion.div>
      </DockedSheet>
    </motion.div>
  );
}
