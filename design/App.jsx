import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { colors, radius, layout, shadow, motionSpec } from "./theme.js";
import { Icon, formatTime } from "./primitives.jsx";
import HomeScreen from "./HomeScreen.jsx";
import LearningPlanScreen from "./LearningPlanScreen.jsx";
import LeaderboardScreen from "./LeaderboardScreen.jsx";

const TABS = [
  { id: "home", label: "Home", icon: "House" },
  { id: "plan", label: "Plan", icon: "ChartNoAxesColumn" },
  { id: "board", label: "Ranks", icon: "Trophy" },
];

const LESSON = { title: "Double-entry bookkeeping", chapter: "Accounting basics · Ch. 3" };
const DURATION = 152; // 02:32

export default function App() {
  const [tab, setTab] = useState("home");
  const [notif, setNotif] = useState(true);

  /**
   * State player hidup di sini, bukan di HomeScreen.
   *
   * Itu yang membuat sesi benar-benar persisten: pindah tab tidak me-reset
   * timer, dan mini-player di bawah tetap memantulkan status yang sama.
   */
  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(42);
  const tick = useRef();

  useEffect(() => {
    if (!playing) return;
    tick.current = setInterval(() => {
      setElapsed(e => (e >= DURATION ? (setPlaying(false), DURATION) : e + 1));
    }, 1000);
    return () => clearInterval(tick.current);
  }, [playing]);

  const player = { lesson: LESSON, elapsed, duration: DURATION, playing };
  const togglePlay = () => setPlaying(p => !p);
  const learnMore = () => {};

  const layar = {
    home: <HomeScreen player={player} onTogglePlay={togglePlay} onSeek={setElapsed} onLearnMore={learnMore} notif={notif} onNotif={setNotif} />,
    plan: <LearningPlanScreen onLearnMore={learnMore} notif={notif} onNotif={setNotif} />,
    board: <LeaderboardScreen onBack={() => setTab("home")} onLearnMore={learnMore} />,
  };

  return (
    <div className="min-h-screen w-full grid place-items-center" style={{ background: "#EFE7F2", padding: "20px 12px" }}>
      {/* Frame ponsel. */}
      <div
        className="relative overflow-hidden flex flex-col"
        style={{
          width: "100%", maxWidth: layout.frameWidth, height: 800,
          borderRadius: 42, background: colors.cream, boxShadow: "0 40px 90px -30px rgba(23,36,31,.5)",
        }}
      >
        <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ paddingBottom: 112 }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={motionSpec.screen.initial}
              animate={motionSpec.screen.animate}
              exit={motionSpec.screen.exit}
              transition={motionSpec.screen.transition}
              className="min-h-full flex flex-col"
            >
              {layar[tab]}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Mini-player: bukti sesi tetap hidup saat pengguna pindah layar. */}
        <AnimatePresence>
          {tab !== "home" && (
            <motion.button
              type="button"
              onClick={() => setTab("home")}
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 26 }}
              className="absolute left-3 right-3 flex items-center gap-3 z-20"
              style={{
                bottom: 84, background: colors.textDark, color: colors.textWhite,
                borderRadius: radius.pill, padding: "9px 12px", boxShadow: shadow.lifted,
              }}
              aria-label={`Kembali ke pemutar. ${LESSON.title}, ${playing ? "sedang berjalan" : "dijeda"}, ${formatTime(elapsed)} dari ${formatTime(DURATION)}`}
            >
              <span
                className="grid place-items-center rounded-full shrink-0"
                style={{ width: 32, height: 32, background: playing ? colors.tealSoft : colors.translucent, color: colors.tealDeep }}
              >
                <Icon name={playing ? "AudioLines" : "Pause"} size={16} />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-1.5">
                  {playing && (
                    <motion.span
                      className="rounded-full shrink-0"
                      style={{ width: 6, height: 6, background: colors.tealSoft }}
                      animate={{ opacity: [1, 0.25, 1] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                      aria-hidden="true"
                    />
                  )}
                  <b className="truncate" style={{ fontSize: 12 }}>{playing ? "Active" : "Paused"}</b>
                </span>
                <span className="block truncate" style={{ fontSize: 10.5, color: colors.textOnCoralMuted }}>
                  {LESSON.title}
                </span>
              </span>
              <span className="font-bold tabular-nums shrink-0" style={{ fontSize: 11.5 }}>
                {formatTime(elapsed)}/{formatTime(DURATION)}
              </span>
            </motion.button>
          )}
        </AnimatePresence>

        {/* Tab bar. */}
        <nav
          className="absolute left-3 right-3 flex z-20"
          style={{
            bottom: 12, background: colors.tealDeep, borderRadius: radius.pill,
            padding: 7, boxShadow: shadow.lifted,
          }}
          aria-label="Navigasi utama"
        >
          {TABS.map(t => {
            const aktif = t.id === tab;
            return (
              <motion.button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                whileTap={motionSpec.press}
                aria-current={aktif ? "page" : undefined}
                className="relative flex-1 grid place-items-center gap-0.5 rounded-full"
                style={{ padding: "9px 4px", color: aktif ? colors.tealDeep : colors.textOnTealMuted }}
              >
                {aktif && (
                  <motion.span
                    layoutId="tab-aktif"
                    transition={motionSpec.segment}
                    className="absolute inset-0 rounded-full"
                    style={{ background: colors.white }}
                  />
                )}
                <span className="relative z-10 grid place-items-center gap-0.5">
                  <Icon name={t.icon} size={18} />
                  <span className="font-bold" style={{ fontSize: 10 }}>{t.label}</span>
                </span>
              </motion.button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
