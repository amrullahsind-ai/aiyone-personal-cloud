import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { colors, radius, layout, shadow, motionSpec } from "./theme.js";

/**
 * Ikon Lucide.
 *
 * Di proyek dengan bundler, ganti isi berkas ini dengan
 * `export { Play, Pause, Star } from "lucide-react"` dan pakai langsung.
 * Versi ini membaca data node Lucide dari global UMD supaya prototipe bisa
 * jalan tanpa build step — ikonnya tetap Lucide yang sama, satu library.
 */
export function Icon({ name, size = 20, strokeWidth = 1.75, className = "", style }) {
  const node = (typeof window !== "undefined" && window.lucide?.icons?.[name]) || null;
  if (!node) return null;
  const [, attrs, children = []] = node;
  return (
    <svg
      {...attrs}
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {children.map(([tag, props], i) => React.createElement(tag, { ...props, key: i }))}
    </svg>
  );
}

/** Tombol ikon. Wajib punya label karena tidak membawa teks. */
export function IconButton({ label, name, onClick, size = 44, iconSize = 20, className = "", style }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      onClick={onClick}
      whileTap={motionSpec.press}
      className={`grid place-items-center rounded-full ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      <Icon name={name} size={iconSize} />
    </motion.button>
  );
}

/**
 * Tautan detail.
 *
 * Progressive disclosure: kartu ringkasan hanya memuat angka utama, dan setiap
 * detail lanjutan disembunyikan di balik tautan ini. Posisinya selalu di
 * kanan-atas section — jangan pernah dipindah ke tengah atau bawah.
 */
export function LearnMore({ onClick, tone = "dark", label = "Learn More" }) {
  const gelap = tone === "dark";
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={motionSpec.press}
      aria-label={`${label} — buka detail`}
      className="flex items-center gap-2 shrink-0"
      style={{ color: gelap ? colors.textDark : colors.textWhite }}
    >
      <span className="text-[12px] font-semibold">{label}</span>
      <span
        className="grid place-items-center rounded-full"
        style={{
          width: 34,
          height: 34,
          background: gelap ? colors.white : colors.translucent,
          boxShadow: gelap ? shadow.soft : "none",
        }}
      >
        <Icon name="ArrowUpRight" size={16} />
      </span>
    </motion.button>
  );
}

/** Kepala section: judul di kiri, Learn More terkunci di kanan-atas. */
export function SectionHead({ children, onLearnMore, tone = "dark" }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">{children}</div>
      {onLearnMore && <LearnMore onClick={onLearnMore} tone={tone} />}
    </div>
  );
}

/**
 * Panel konten yang menindih header — pola tetap "docked bottom-sheet".
 * Dipakai di ketiga layar tanpa kecuali.
 */
export function DockedSheet({ children, background = colors.cream, className = "", style }) {
  return (
    <motion.section
      variants={motionSpec.fadeUp}
      custom={1}
      className={`relative z-10 flex-1 ${className}`}
      style={{
        background,
        marginTop: -layout.sheetOverlap,
        borderTopLeftRadius: radius.sheet,
        borderTopRightRadius: radius.sheet,
        padding: `26px ${layout.paddingX}px 20px`,
        ...style,
      }}
    >
      {children}
    </motion.section>
  );
}

/** Kepala salam. Dipakai di layar A dan B dengan warna berbeda. */
export function GreetingHeader({ name, date, tone = "light", onToggle, toggleOn, avatarBg }) {
  const terang = tone === "light";
  const warnaUtama = terang ? colors.textWhite : colors.textDark;
  const warnaSekunder = terang ? colors.textOnCoralMuted : colors.textMuted;
  return (
    <motion.header variants={motionSpec.fadeUp} custom={0} className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="grid place-items-center rounded-full shrink-0"
          style={{ width: 40, height: 40, background: avatarBg || colors.translucent, color: warnaUtama }}
        >
          <Icon name="Sparkles" size={18} />
        </div>
        <div className="min-w-0">
          <h1 className="font-extrabold leading-tight truncate" style={{ color: warnaUtama, fontSize: 17 }}>
            Hi, {name} <span aria-hidden="true">👋</span>
          </h1>
          {/* Hierarki lewat berat huruf, bukan warna pudar — supaya kontras tetap AA. */}
          <p style={{ color: warnaSekunder, fontSize: 12, fontWeight: 500, opacity: terang ? 0.92 : 1 }}>{date}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div
          className="rounded-full grid place-items-center overflow-hidden"
          style={{ width: 42, height: 42, background: colors.pinkAccent, color: colors.textDark }}
          role="img"
          aria-label={`Foto profil ${name}`}
        >
          <Icon name="User" size={20} />
        </div>
        {onToggle && <ThemeToggle on={toggleOn} onChange={onToggle} tone={tone} />}
      </div>
    </motion.header>
  );
}

/** Switch dengan track yang ikut berubah warna, bukan cuma knop yang geser. */
export function ThemeToggle({ on, onChange, tone = "light" }) {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? "Matikan notifikasi harian" : "Nyalakan notifikasi harian"}
      onClick={() => onChange(!on)}
      whileTap={motionSpec.press}
      className="relative rounded-full shrink-0"
      style={{ width: 46, height: 26, padding: 3 }}
      animate={{ backgroundColor: on ? colors.tealDeep : (tone === "light" ? "rgba(255,255,255,.3)" : colors.creamDeep) }}
      transition={{ duration: 0.2 }}
    >
      <motion.span
        layout
        transition={motionSpec.toggle}
        className="block rounded-full"
        style={{ width: 20, height: 20, background: colors.white, marginLeft: on ? 20 : 0 }}
      />
    </motion.button>
  );
}

/**
 * Angka yang menghitung naik dari nol.
 *
 * Memakai requestAnimationFrame, dan menghormati prefers-reduced-motion dengan
 * langsung menampilkan nilai akhir.
 */
export function CountUp({ value, duration = motionSpec.countUp.duration, suffix = "", className = "", style }) {
  const [tampil, setTampil] = useState(0);
  const ref = useRef();

  useEffect(() => {
    const kurangiGerak = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (kurangiGerak) { setTampil(value); return; }
    const mulai = performance.now();
    const langkah = (t) => {
      const p = Math.min(1, (t - mulai) / duration);
      // easeOutQuint, supaya berhenti selaras dengan ring dan chart.
      const e = 1 - Math.pow(1 - p, 5);
      setTampil(Math.round(value * e));
      if (p < 1) ref.current = requestAnimationFrame(langkah);
    };
    ref.current = requestAnimationFrame(langkah);
    return () => cancelAnimationFrame(ref.current);
  }, [value, duration]);

  return <span className={className} style={style}>{tampil}{suffix}</span>;
}

/** Format detik jadi mm:ss. */
export const formatTime = (detik) => {
  const s = Math.max(0, Math.round(detik));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
