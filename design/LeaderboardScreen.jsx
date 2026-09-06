import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { colors, radius, layout, shadow, motionSpec } from "./theme.js";
import { Icon, IconButton, LearnMore, CountUp } from "./primitives.jsx";

/* Mode kognitif: status dan kompetisi → permukaan teal gelap. */

const PAPAN = {
  weekly: [
    { rank: 1, name: "Amara Putri", score: 35, bg: colors.pinkAccent, fg: "#8A2338" },
    { rank: 2, name: "Reza Mahendra", score: 61, bg: colors.cream, fg: colors.textDark },
    { rank: 3, name: "Nadia Kusuma", score: 52, bg: colors.orangeAccent, fg: colors.textDark },
  ],
  month: [
    { rank: 1, name: "Reza Mahendra", score: 88, bg: colors.pinkAccent, fg: "#8A2338" },
    { rank: 2, name: "Nadia Kusuma", score: 74, bg: colors.cream, fg: colors.textDark },
    { rank: 3, name: "Amara Putri", score: 69, bg: colors.orangeAccent, fg: colors.textDark },
  ],
};

const TAB = [
  { id: "weekly", label: "Weekly" },
  { id: "month", label: "Month" },
];

/** Segmented control. Pil putih berpindah lewat layoutId, bukan bertukar seketika. */
function Segmented({ value, onChange }) {
  return (
    <div
      className="relative inline-flex p-1.5 rounded-full"
      style={{ background: colors.translucent }}
      role="tablist"
      aria-label="Rentang papan peringkat"
    >
      {TAB.map(t => {
        const aktif = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={aktif}
            onClick={() => onChange(t.id)}
            className="relative rounded-full font-bold"
            style={{ padding: "11px 30px", fontSize: 13.5, color: aktif ? colors.textDark : colors.textOnTealMuted }}
          >
            {aktif && (
              <motion.span
                layoutId="segmen-aktif"
                transition={motionSpec.segment}
                className="absolute inset-0 rounded-full"
                style={{ background: colors.white }}
              />
            )}
            <span className="relative z-10">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function BarisRank({ item, index }) {
  return (
    <motion.li
      initial={{ opacity: 0, x: 26 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -18 }}
      transition={{ duration: 0.34, delay: index * motionSpec.rowStagger, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-3 rounded-full"
      style={{ background: "rgba(255,255,255,.10)", padding: 7 }}
    >
      <span
        className="flex items-center gap-1.5 rounded-full font-extrabold shrink-0"
        style={{ background: item.bg, color: item.fg, padding: "11px 17px", fontSize: 14 }}
      >
        <Icon name="Trophy" size={16} />#{item.rank}
      </span>

      {/* Garis titik-titik penghubung. */}
      <span
        className="flex-1 min-w-3"
        style={{
          height: 2,
          backgroundImage: `radial-gradient(circle, ${colors.tealSoft} 1.1px, transparent 1.2px)`,
          backgroundSize: "8px 2px",
          opacity: 0.55,
        }}
        aria-hidden="true"
      />

      {/* Badge persentase yang menindih foto avatar. */}
      <span className="flex items-center shrink-0">
        <span
          className="grid place-items-center rounded-full font-extrabold tabular-nums"
          style={{
            width: 52, height: 40, background: colors.white, color: colors.textDark,
            fontSize: 12.5, marginRight: -14, position: "relative", zIndex: 2, boxShadow: shadow.soft,
          }}
        >
          {item.score}%
        </span>
        <span
          className="grid place-items-center rounded-full"
          style={{
            width: 42, height: 42, background: colors.tealSoft, color: colors.tealDeep,
            border: `2.5px solid ${colors.tealDeep}`,
          }}
          role="img"
          aria-label={`Foto profil ${item.name}`}
        >
          <Icon name="User" size={19} />
        </span>
      </span>

      <span className="sr-only">Peringkat {item.rank}: {item.name}, skor {item.score} persen</span>
    </motion.li>
  );
}

export default function LeaderboardScreen({ onBack, onLearnMore }) {
  const [rentang, setRentang] = useState("weekly");
  const daftar = PAPAN[rentang];

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: motionSpec.stagger.delayStep } } }}
      className="relative flex flex-col min-h-full flex-1 overflow-hidden"
      style={{ background: colors.tealDeep }}
    >
      {/* Lengkung dekoratif di latar. */}
      <span
        aria-hidden="true"
        className="absolute rounded-full pointer-events-none"
        style={{ width: 300, height: 300, right: -130, top: -80, border: `28px solid rgba(255,255,255,.045)` }}
      />
      <span
        aria-hidden="true"
        className="absolute rounded-full pointer-events-none"
        style={{ width: 240, height: 240, left: -120, top: 210, border: `26px solid rgba(255,255,255,.04)` }}
      />

      <div className="relative z-10" style={{ padding: `18px ${layout.paddingX}px 0` }}>
        <motion.div variants={motionSpec.fadeUp} custom={0} className="flex items-center justify-between">
          <IconButton
            label="Kembali ke layar sebelumnya" name="ArrowLeft" onClick={onBack}
            style={{ background: colors.translucent, color: colors.textWhite }}
          />
          <IconButton
            label="Buka menu papan peringkat" name="LayoutGrid"
            style={{ background: colors.translucent, color: colors.textWhite }}
          />
        </motion.div>

        <motion.div variants={motionSpec.fadeUp} custom={1} className="flex items-start justify-between gap-3 mt-6">
          <h2 className="font-extrabold leading-tight" style={{ color: colors.textWhite, fontSize: 27 }}>
            Leaderboard
          </h2>
          <LearnMore onClick={onLearnMore} tone="light" />
        </motion.div>

        <motion.div variants={motionSpec.fadeUp} custom={2} className="mt-4">
          <Segmented value={rentang} onChange={setRentang} />
        </motion.div>

        <motion.ul variants={motionSpec.fadeUp} custom={3} className="grid gap-3 mt-5" aria-live="polite">
          <AnimatePresence mode="popLayout" initial={false}>
            {daftar.map((item, i) => (
              <BarisRank key={`${rentang}-${item.rank}`} item={item} index={i} />
            ))}
          </AnimatePresence>
        </motion.ul>
      </div>

      {/* Kartu teaser mengambang, sengaja terpotong supaya terbaca bisa di-swipe. */}
      <motion.article
        variants={motionSpec.fadeUp}
        custom={4}
        drag="y"
        dragConstraints={{ top: -18, bottom: 0 }}
        dragElastic={0.18}
        className="relative z-10 mt-auto"
        style={{
          background: colors.cream,
          borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
          margin: `24px ${layout.paddingX - 12}px -14px`,
          padding: "18px 18px 30px",
          boxShadow: shadow.lifted,
          cursor: "grab",
        }}
        aria-label="Kursus disarankan, tarik ke atas untuk detail"
      >
        <span
          className="block mx-auto rounded-full mb-3"
          style={{ width: 42, height: 4, background: colors.hairline }}
          aria-hidden="true"
        />
        <div className="flex items-center gap-3">
          <span
            className="grid place-items-center shrink-0"
            style={{ width: 52, height: 52, borderRadius: radius.card, background: colors.coralFrom, color: colors.textWhite }}
          >
            <Icon name="Calculator" size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex gap-1.5 mb-1">
              {["#Accounting", "#Math"].map(t => (
                <span
                  key={t}
                  className="rounded-full font-bold"
                  style={{ background: colors.pinkAccent, color: "#8A2338", padding: "3px 9px", fontSize: 10 }}
                >
                  {t}
                </span>
              ))}
            </div>
            <b className="block truncate" style={{ color: colors.textDark, fontSize: 15 }}>Accounting basics</b>
          </div>
          <LearnMore onClick={onLearnMore} />
        </div>
      </motion.article>
    </motion.div>
  );
}
