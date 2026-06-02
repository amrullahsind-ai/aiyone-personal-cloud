(() => {
  "use strict";

  const DB_NAME = "aiyone_cloud_v3_1";
  const DB_VERSION = 1;
  const STORES = ["materials", "flashcards", "quizzes", "review_logs", "teaching_sessions", "settings"];
  const dayMs = 86400000;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = (p = "id") => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const now = () => new Date().toISOString();
  const esc = (v = "") => String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  let db;
  let state = {
    materials: [], flashcards: [], quizzes: [], logs: [], teaching: [],
    user: null, supa: null, supabaseConfig: null, deferredInstall: null,
    settings: defaultSettings(), currentReview: 0, currentQuiz: null, currentFlash: null, currentSession: null, reviewStartedAt: 0
  };

  function defaultSettings() {
    return {
      provider: "gemini",
      geminiModel: "gemini-2.5-flash-lite",
      groqModel: "llama-3.1-8b-instant",
      openrouterModel: "google/gemini-2.0-flash-exp:free",
      supabaseUrl: "",
      supabaseAnon: "",
      masteryThreshold: 70,
      targetRetention: 0.85,
      streak: 0,
      lastStreakDate: ""
    };
  }

  function normalizeSupabaseUrl(value = "") {
    let url = value.trim();
    if (!url) return "";
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    return url.replace(/\/+$/, "");
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        STORES.forEach(store => {
          if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: "id" });
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  const store = (name, mode = "readonly") => db.transaction(name, mode).objectStore(name);
  const getAll = (name) => new Promise((resolve, reject) => {
    const req = store(name).getAll(); req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error);
  });
  const put = (name, value) => new Promise((resolve, reject) => {
    const req = store(name, "readwrite").put(value); req.onsuccess = () => resolve(value); req.onerror = () => reject(req.error);
  });
  const del = (name, id) => new Promise((resolve, reject) => {
    const req = store(name, "readwrite").delete(id); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
  });
  const clear = (name) => new Promise((resolve, reject) => {
    const req = store(name, "readwrite").clear(); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
  });

  async function loadSettings() {
    const rows = await getAll("settings");
    state.settings = { ...defaultSettings(), ...(rows.find(x => x.id === "settings")?.data || {}) };
  }
  async function saveSettings() { await put("settings", { id: "settings", data: state.settings }); }

  async function loadPublicConfig() {
    state.supabaseConfig = null;
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      if (!res.ok) return;
      const cfg = await res.json();
      if (cfg?.supabaseUrl && cfg?.supabaseAnonKey) {
        state.supabaseConfig = {
          supabaseUrl: normalizeSupabaseUrl(cfg.supabaseUrl),
          supabaseAnon: cfg.supabaseAnonKey,
          source: cfg.source || "server"
        };
      }
    } catch (_) {
      // Local static fallback: kalau config endpoint belum ada, pakai setting lama bila tersedia.
    }
  }

  async function initSupabase() {
    state.supa = null; state.user = null;
    const supabaseUrl = normalizeSupabaseUrl(state.supabaseConfig?.supabaseUrl || state.settings.supabaseUrl || "");
    const supabaseAnon = state.supabaseConfig?.supabaseAnon || state.settings.supabaseAnon || "";
    if (!supabaseUrl || !supabaseAnon || !window.supabase) return;
    state.supa = window.supabase.createClient(supabaseUrl, supabaseAnon, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data } = await state.supa.auth.getSession();
    state.user = data?.session?.user || null;
    state.supa.auth.onAuthStateChange(async (_event, session) => {
      const nextUser = session?.user || null;
      if ((state.user?.id || null) === (nextUser?.id || null)) return;
      state.user = nextUser;
      try { await loadData(); renderAll(); } catch (e) { console.error(e); }
    });
  }

  const isCloud = () => !!(state.supa && state.user);

  async function loadData() {
    if (isCloud()) {
      await loadFromSupabase();
    } else {
      const [materials, flashcards, quizzes, logs, teaching] = await Promise.all([
        getAll("materials"), getAll("flashcards"), getAll("quizzes"), getAll("review_logs"), getAll("teaching_sessions")
      ]);
      state.materials = materials.sort(sortNewest);
      state.flashcards = flashcards;
      state.quizzes = quizzes;
      state.logs = logs;
      state.teaching = teaching;
    }
  }

  async function loadFromSupabase() {
    const uid = state.user.id;
    const [m, c, q, l, t] = await Promise.all([
      state.supa.from("materials").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
      state.supa.from("flashcards").select("*").eq("user_id", uid),
      state.supa.from("quizzes").select("*").eq("user_id", uid),
      state.supa.from("review_logs").select("*").eq("user_id", uid),
      state.supa.from("teaching_sessions").select("*").eq("user_id", uid).order("created_at", { ascending: false })
    ]);
    for (const res of [m,c,q,l,t]) if (res.error) throw new Error(res.error.message);
    state.materials = m.data || [];
    state.flashcards = c.data || [];
    state.quizzes = q.data || [];
    state.logs = l.data || [];
    state.teaching = t.data || [];
  }

  const sortNewest = (a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt);
  const materialDate = (m) => m.created_at || m.createdAt || now();
  const materialTitle = (m) => m.title || "Tanpa judul";
  const cardDue = (c) => c.due_at || c.dueAt || now();
  const cardLast = (c) => c.last_reviewed_at || c.lastReviewedAt || null;
  const shortDate = (iso) => new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));

  async function refreshAll() {
    await loadSettings();
    await loadPublicConfig();
    await initSupabase();
    await loadData();
    renderAll();
  }

  function renderAll() {
    renderSync(); renderProfile(); renderDashboard(); renderLibrary(); renderReview(); renderTeachOptions(); renderSessionOptions(); renderAnalytics(); fillSettings();
  }

  function scrollToTarget(target, behavior = "smooth") {
    const el = typeof target === "string" ? $(target) : target;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const mode = reduceMotion ? "auto" : behavior;
    if (!el) { window.scrollTo({ top: 0, behavior: mode }); return; }
    el.scrollIntoView({ behavior: mode, block: "start", inline: "nearest" });
    el.classList?.add("focus-pulse");
    window.setTimeout(() => el.classList?.remove("focus-pulse"), 900);
  }

  function setView(id, options = {}) {
    $$(".view").forEach(v => v.classList.toggle("active", v.id === id));
    $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === id));
    const names = { dashboard:"Dashboard", session:"Sesi Belajar", create:"Tambah Materi", library:"Library", review:"Review", teach:"Teaching Mode", analytics:"Analytics", settings:"Settings" };
    const title = names[id] || "Aiyone";
    const pageTitle = $("#pageTitle"); if (pageTitle) pageTitle.textContent = title;
    const mobileTitle = $("#mobilePageTitle"); if (mobileTitle) mobileTitle.textContent = title;
    closeDrawer();
    if (id === "review") renderReview();
    if (id === "library") renderLibrary();
    if (id === "teach") renderTeachOptions();
    if (id === "session") { renderSessionOptions(); renderSession(); }
    if (id === "analytics") renderAnalytics();
    requestAnimationFrame(() => scrollToTarget(options.target || `#${id}`, options.behavior || "smooth"));
  }

  function renderSync() {
    const badge = $("#syncBadge"), text = $("#syncText"), auth = $("#authStatus");
    if (isCloud()) {
      if (badge) { badge.textContent = "Cloud"; badge.className = "badge cloud"; }
      if (text) text.textContent = `Cloud aktif. Login sebagai ${state.user.email}.`;
      if (auth) auth.textContent = `Login sebagai ${state.user.email}. Data otomatis tersinkron.`;
    } else if (state.supa) {
      if (badge) { badge.textContent = "Login"; badge.className = "badge local"; }
      if (text) text.textContent = "Cloud siap. Login dari tombol profil di kanan atas.";
      if (auth) auth.textContent = "Cloud siap. Silakan login untuk sinkron otomatis.";
    } else {
      if (badge) { badge.textContent = "Local"; badge.className = "badge local"; }
      if (text) text.textContent = "Data tersimpan lokal. Cloud belum dikonfigurasi di server.";
      if (auth) auth.textContent = "Cloud belum aktif di server. Aplikasi tetap bisa dipakai lokal.";
    }
  }

  function renderProfile() {
    const email = state.user?.email || "";
    const initial = email ? email[0].toUpperCase() : "?";
    const label = email ? (email.split("@")[0] || "Profil") : "Login";
    const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    setText("#profileInitial", initial);
    setText("#profileLabel", label);
    setText("#profileAvatarLarge", initial === "?" ? "A" : initial);
    setText("#profileEmail", email || "Belum login");

    const loginArea = $("#profileLoginArea"), loggedArea = $("#profileLoggedArea"), hint = $("#cloudSetupHint");
    if (loginArea) loginArea.hidden = isCloud() || !state.supa;
    if (loggedArea) loggedArea.hidden = !isCloud();
    if (hint) hint.hidden = !!state.supa;
    const status = $("#profileCloudStatus");
    if (status) status.textContent = isCloud() ? "Cloud aktif. Data tersimpan ke Supabase dan otomatis sync antar-device." : state.supa ? "Cloud siap. Login untuk sinkron." : "Cloud belum aktif di server.";
  }

  function dueCards() { return state.flashcards.filter(c => new Date(cardDue(c)) <= new Date()).sort((a,b) => new Date(cardDue(a)) - new Date(cardDue(b))); }
  function cardRetention(card) {
    const last = cardLast(card);
    if (!last) return 0.35;
    const days = Math.max(0, (Date.now() - new Date(last).getTime()) / dayMs);
    const stability = Math.max(Number(card.stability || card.interval_days || card.intervalDays || 1), 0.1);
    return Math.exp(-days / stability);
  }
  function memoryStatus(card) {
    const retention = cardRetention(card);
    if (new Date(cardDue(card)) <= new Date() || retention < .55 || (card.lapses || 0) > 1 && retention < .7) return "weak";
    if (retention < .8) return "medium";
    return "strong";
  }

  function renderDashboard() {
    const due = dueCards();
    const concepts = state.materials.reduce((n,m) => n + (m.concepts?.length || 0), 0);
    $("#mMaterials").textContent = state.materials.length;
    $("#mConcepts").textContent = concepts;
    $("#mDue").textContent = due.length;
    $("#mStreak").textContent = `${state.settings.streak || 0}🔥`;

    const counts = { strong: 0, medium: 0, weak: 0 };
    state.flashcards.forEach(c => counts[memoryStatus(c)]++);
    const total = Math.max(state.flashcards.length, 1);
    setBar("Strong", counts.strong / total); setBar("Medium", counts.medium / total); setBar("Weak", counts.weak / total);

    const box = $("#todayActions"); box.innerHTML = "";
    if (!state.materials.length) {
      $("#todayBadge").textContent = "Belum ada data"; box.className = "stack empty"; box.textContent = "Upload materi untuk memulai learning loop.";
    } else if (!due.length) {
      $("#todayBadge").textContent = "Aman"; box.className = "stack";
      const latest = state.materials[0];
      box.innerHTML = `<div class="daily-command"><b>Tidak ada review mendesak.</b><p class="muted">Gunakan waktu ini untuk sesi belajar terarah atau teaching mode pada materi terbaru.</p><div class="action-row wrap"><button class="primary" id="dashStartSession">Mulai Sesi Belajar</button><button class="ghost" id="dashTeach">Teaching Mode</button></div></div>`;
      $("#dashStartSession")?.addEventListener("click", () => { if (latest) state.currentSession = { materialId: latest.id, step: 0, recall: {} }; setView("session", { target: "#sessionBox" }); });
      $("#dashTeach")?.addEventListener("click", () => setView("teach", { target: "#teach" }));
    } else {
      $("#todayBadge").textContent = `${due.length} kartu due`; box.className = "stack";
      const cmd = document.createElement("div"); cmd.className = "daily-command";
      cmd.innerHTML = `<b>${due.length} kartu perlu diulang hari ini.</b><p class="muted">Selesaikan review dulu sebelum tambah materi baru. Fokus utama: kartu dengan retensi rendah.</p><button class="primary" id="dashReview">Mulai Review Hari Ini</button>`;
      box.appendChild(cmd);
      $("#dashReview", cmd).onclick = () => setView("review", { target: "#reviewBox" });
      due.slice(0, 5).forEach(c => {
        const m = findMaterial(c.material_id || c.materialId);
        const div = document.createElement("div"); div.className = "flash-mini priority";
        div.innerHTML = `<b>${esc(c.front)}</b><p class="muted">${esc(materialTitle(m || {}))} • retensi ±${Math.round(cardRetention(c)*100)}% • due ${shortDate(cardDue(c))}</p>`;
        box.appendChild(div);
      });
    }
    renderRecent();
  }
  function setBar(name, ratio) { const pct = Math.round(ratio * 100); $(`#bar${name}`).style.width = `${pct}%`; $(`#txt${name}`).textContent = `${pct}%`; }

  function findMaterial(id) { return state.materials.find(m => m.id === id); }
  function materialCards(id) { return state.flashcards.filter(c => (c.material_id || c.materialId) === id); }
  function materialQuizzes(id) { return state.quizzes.filter(q => (q.material_id || q.materialId) === id); }

  function renderRecent() {
    const box = $("#recentList"); box.innerHTML = "";
    if (!state.materials.length) { box.className = "cards empty"; box.textContent = "Belum ada materi."; return; }
    box.className = "cards"; state.materials.slice(0,4).forEach(m => box.appendChild(materialCardEl(m)));
  }

  function renderLibrary() {
    const q = ($("#searchInput")?.value || "").toLowerCase().trim();
    const box = $("#libraryList"); box.innerHTML = "";
    const items = state.materials.filter(m => !q || `${m.title} ${m.category} ${m.summary_short || m.summaryShort} ${(m.concepts||[]).map(c=>c.name).join(" ")}`.toLowerCase().includes(q));
    if (!items.length) { box.className = "cards empty"; box.textContent = q ? "Tidak ditemukan." : "Belum ada materi."; return; }
    box.className = "cards"; items.forEach(m => box.appendChild(materialCardEl(m)));
  }

  function materialCardEl(m) {
    const node = $("#materialCardTpl").content.cloneNode(true);
    const el = node.querySelector(".material-card");
    el.querySelector(".cat").textContent = m.category || "Umum";
    el.querySelector("h4").textContent = materialTitle(m);
    el.querySelector("p").textContent = `${materialCards(m.id).length} flashcard • ${materialQuizzes(m.id).length} quiz • ${shortDate(materialDate(m))} • ${(m.summary_short || m.summaryShort || "").slice(0, 110)}`;
    el.querySelector(".open").onclick = () => showDetail(m.id);
    el.querySelector(".session-start")?.addEventListener("click", () => { state.currentSession = { materialId: m.id, step: 0, recall: {} }; setView("session", { target: "#sessionBox" }); });
    el.querySelector(".flash")?.addEventListener("click", () => startFlashcards(m.id));
    el.querySelector(".quiz").onclick = () => startQuiz(m.id, "practice");
    el.querySelector(".del").onclick = () => deleteMaterial(m.id);
    return el;
  }

  function showDetail(id) {
    const m = findMaterial(id); if (!m) return;
    const cards = materialCards(id), quizzes = quizPool(id), concepts = m.concepts || [];
    const p = $("#detailPanel"); p.hidden = false;
    const sections = m.study_sections || m.studySections || splitIntoSections(m.summary_long || m.summaryLong || "");
    const mastery = Math.round(Number(m.mastery_score || m.masteryScore || 0));
    const dueCount = cards.filter(c => new Date(cardDue(c)) <= new Date()).length;
    p.innerHTML = `
      <div class="detail-v7">
        <div class="detail-hero v7-hero">
          <div>
            <span class="badge soft">${esc(m.category || "Umum")}</span>
            <h3>${esc(materialTitle(m))}</h3>
            <p class="muted">${shortDate(materialDate(m))} • ${cards.length} flashcard • ${quizzes.length} quiz • ${dueCount} due review</p>
          </div>
          <button class="ghost small close-detail" id="closeDetail" aria-label="Tutup detail">×</button>
        </div>

        <div class="learning-path-card">
          <div class="path-head">
            <span class="section-label">Jalur Belajar Disarankan</span>
            <b>Ikuti urutan ini biar tidak bingung.</b>
            <p class="muted">Aiyone bukan cuma tempat baca materi. Kamu diarahkan dari cek awal sampai bukti penguasaan.</p>
          </div>
          <div class="journey-steps compact">
            <button class="journey-step" id="startPretestFromDetail"><span>1</span><b>Pre-test</b><small>Cek awal tanpa lihat materi</small></button>
            <button class="journey-step primary-step" id="startSessionFromDetail"><span>2</span><b>Belajar</b><small>Baca bagian kecil + active recall</small></button>
            <button class="journey-step" id="startFlashFromDetail"><span>3</span><b>Flashcard</b><small>Ingat dulu, baru buka jawaban</small></button>
            <button class="journey-step" id="startQuizFromDetail"><span>4</span><b>Quiz</b><small>Latihan pemahaman</small></button>
            <button class="journey-step" id="startPosttestFromDetail"><span>5</span><b>Post-test</b><small>Target mastery ${Number(state.settings.masteryThreshold || 70)}%</small></button>
          </div>
        </div>

        <div class="material-status-grid">
          <article><span>Mastery</span><b>${mastery}%</b></article>
          <article><span>Bagian belajar</span><b>${Math.max(sections.length, 1)}</b></article>
          <article><span>Flashcard</span><b>${cards.length}</b></article>
          <article><span>Due</span><b>${dueCount}</b></article>
        </div>

        <div class="detail-tabs" role="tablist">
          <button class="detail-tab active" data-tab="summary">Ringkasan</button>
          <button class="detail-tab" data-tab="sections">Modul</button>
          <button class="detail-tab" data-tab="concepts">Konsep</button>
          <button class="detail-tab" data-tab="flashcards">Flashcard</button>
          <button class="detail-tab" data-tab="quiz">Quiz</button>
        </div>

        <section class="detail-tab-panel active" data-panel="summary">
          <div class="study-overview">
            <div><span class="section-label">Ringkasan Cepat</span><p>${esc(m.summary_short || m.summaryShort || "Belum ada ringkasan pendek.")}</p></div>
            ${renderTakeaways(m.key_takeaways || m.keyTakeaways || [])}
          </div>
          <div class="prose-block summary-long">${htmlParagraphs(m.summary_long || m.summaryLong || "")}</div>
        </section>

        <section class="detail-tab-panel" data-panel="sections">
          <div class="section-intro"><h4>Materi Dipelajari Bertahap</h4><p class="muted">Baca satu bagian, jawab active recall, baru lanjut. Jangan langsung scroll habis.</p></div>
          ${renderStudySections(sections, m.summary_long || m.summaryLong || "-")}
        </section>

        <section class="detail-tab-panel" data-panel="concepts">
          <div class="section-intro"><h4>Konsep Inti</h4><p class="muted">Pakai bagian ini untuk melihat definisi, contoh, dan miskonsepsi utama.</p></div>
          <div class="concept-grid">${concepts.map(c => `<div class="concept-mini"><b>${esc(c.name)}</b><p>${esc(c.definition || "")}</p>${c.example ? `<small><b>Contoh:</b> ${esc(c.example)}</small>` : ""}<small class="muted"><b>Miskonsepsi:</b> ${esc(c.common_misconception || c.commonMisconception || "-")}</small></div>`).join("") || "<p class='muted'>Belum ada konsep.</p>"}</div>
        </section>

        <section class="detail-tab-panel" data-panel="flashcards">
          <div class="flashcard-guide-card">
            <div><h4>Flashcard itu bukan dibaca semuanya.</h4><p class="muted">Mode yang benar: lihat pertanyaan → jawab di kepala → buka jawaban → beri rating. Rating ini menentukan jadwal review berikutnya.</p></div>
            <button class="primary" id="startFlashFromTab">Mulai Latihan Flashcard</button>
          </div>
          <div class="stack">${cards.slice(0,10).map((c, i) => `<div class="flash-preview"><span>${i+1}</span><div><b>${esc(c.front)}</b><p class="muted">Jawaban disembunyikan di mode latihan supaya kamu benar-benar mengingat.</p><small>Due: ${shortDate(cardDue(c))} • ${esc(c.difficulty || "medium")}</small></div></div>`).join("") || "<p class='muted'>Belum ada flashcard.</p>"}</div>
        </section>

        <section class="detail-tab-panel" data-panel="quiz">
          <div class="section-intro"><h4>Quiz Bertingkat</h4><p class="muted">Pre-test untuk diagnosis, quiz untuk latihan, post-test untuk bukti mastery.</p></div>
          <div class="quiz-mode-grid">
            <button class="quiz-mode-card" id="startPretestFromTab"><b>Pre-test</b><span>Kerjakan sebelum belajar. Tidak masalah jika salah.</span></button>
            <button class="quiz-mode-card" id="startQuizFromTab"><b>Practice Quiz</b><span>Latihan setelah membaca modul dan flashcard.</span></button>
            <button class="quiz-mode-card" id="startPosttestFromTab"><b>Post-test</b><span>Target mastery ${Number(state.settings.masteryThreshold || 70)}%.</span></button>
          </div>
          <div class="stack quiz-preview-list">${quizzes.slice(0,8).map(q => `<div class="flash-mini"><b>[${esc(q.level || "understanding")}] ${esc(q.question)}</b><p class="muted">${esc(q.explanation || "")}</p></div>`).join("") || "<p class='muted'>Belum ada quiz.</p>"}</div>
        </section>
      </div>
    `;
    $("#closeDetail").onclick = () => { p.hidden = true; };
    $("#startSessionFromDetail")?.addEventListener("click", () => { state.currentSession = { materialId: id, step: 0, recall: {} }; setView("session", { target: "#sessionBox" }); });
    $("#startPretestFromDetail")?.addEventListener("click", () => startQuiz(id, "pretest"));
    $("#startFlashFromDetail")?.addEventListener("click", () => startFlashcards(id));
    $("#startQuizFromDetail")?.addEventListener("click", () => startQuiz(id, "practice"));
    $("#startPosttestFromDetail")?.addEventListener("click", () => startQuiz(id, "posttest"));
    $("#startFlashFromTab")?.addEventListener("click", () => startFlashcards(id));
    $("#startPretestFromTab")?.addEventListener("click", () => startQuiz(id, "pretest"));
    $("#startQuizFromTab")?.addEventListener("click", () => startQuiz(id, "practice"));
    $("#startPosttestFromTab")?.addEventListener("click", () => startQuiz(id, "posttest"));
    $$(".detail-tab", p).forEach(btn => btn.onclick = () => switchDetailTab(p, btn.dataset.tab));
    setView("library", { target: "#detailPanel" });
  }

  function switchDetailTab(root, tab) {
    $$(".detail-tab", root).forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".detail-tab-panel", root).forEach(panel => panel.classList.toggle("active", panel.dataset.panel === tab));
    requestAnimationFrame(() => scrollToTarget(root));
  }

  function renderTakeaways(items = []) {
    if (!Array.isArray(items) || !items.length) return "";
    return `<div><span class="section-label">Poin Penting</span><ul class="takeaways">${items.slice(0,8).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  }

  function renderStudySections(sections = [], fallback = "") {
    const list = Array.isArray(sections) && sections.length ? sections : splitIntoSections(fallback);
    if (!list.length) return `<div class="prose-block">${htmlParagraphs(fallback || "-")}</div>`;
    return `<div class="study-sections">${list.map((s, i) => `<article class="study-section"><div class="step-no">${i+1}</div><div><h5>${esc(s.title || `Bagian ${i+1}`)}</h5><div class="prose-block">${htmlParagraphs(s.explanation || s.content || "-")}</div>${s.example ? `<p class="example"><b>Contoh:</b> ${esc(s.example)}</p>` : ""}${s.activeRecall || s.active_recall ? `<p class="recall"><b>Active recall:</b> ${esc(s.activeRecall || s.active_recall)}</p>` : ""}</div></article>`).join("")}</div>`;
  }

  function htmlParagraphs(text = "") {
    const clean = String(text || "").trim();
    if (!clean) return "<p>-</p>";
    return clean.split(/\n{2,}|(?<=\.)\s+(?=[A-ZÀ-ÝA-Z0-9])/g).map(p => `<p>${esc(p.trim())}</p>`).join("");
  }

  async function extractPdf(file) {
    if (!window.pdfjsLib) throw new Error("pdf.js belum terload. Coba cek internet/CDN.");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += `\n\n--- Halaman ${i} ---\n` + content.items.map(it => it.str).join(" ");
    }
    return text.trim();
  }

  async function generateMaterial() {
    const text = $("#textInput").value.trim();
    if (text.length < 80) return alert("Materi terlalu pendek. Tempel minimal beberapa paragraf dulu.");
    const titleHint = $("#titleInput").value.trim();
    const categoryHint = $("#categoryInput").value.trim();
    setStatus("AI sedang memecah materi jadi konsep, flashcard, quiz, dan jadwal review...");
    try {
      const result = await callAI("buildMaterial", { text: text.slice(0, 30000), titleHint, categoryHint });
      const materialId = await saveLearningPack(text, titleHint, categoryHint, result);
      setStatus("Selesai. Learning pack sudah tersimpan. Aiyone membuka sesi belajar terarah.");
      $("#textInput").value = ""; $("#titleInput").value = ""; $("#categoryInput").value = "";
      await refreshAll();
      state.currentSession = { materialId, step: 0, recall: {} };
      setView("session", { target: "#sessionBox" });
    } catch (err) {
      setStatus(`Gagal generate AI: ${err.message}\n\nSolusi cepat: cek .env / Vercel Environment Variables, coba model lain, atau simpan tanpa AI.`);
    }
  }

  async function saveLearningPack(sourceText, titleHint, categoryHint, ai = {}) {
    const m = {
      id: uid("mat"),
      user_id: state.user?.id || null,
      title: ai.title || titleHint || "Materi Baru",
      category: ai.category || categoryHint || "Umum",
      source_text: sourceText,
      summary_short: ai.summaryShort || ai.summary_short || "Belum ada ringkasan.",
      summary_long: ai.summaryLong || ai.summary_long || "",
      study_sections: normalizeStudySections(ai.studySections || ai.study_sections || ai.learningSections || ai.learning_sections, ai.summaryLong || ai.summary_long || ""),
      key_takeaways: normalizeTakeaways(ai.keyTakeaways || ai.key_takeaways || []),
      concepts: normalizeConcepts(ai.concepts),
      mastery_score: 0,
      created_at: now(), updated_at: now()
    };
    const flashcards = normalizeCards(ai.flashcards, m).map(c => ({ ...c, id: uid("card"), user_id: state.user?.id || null, material_id: m.id, ease: 2.5, interval_days: 1, stability: 1, memory_difficulty: c.difficulty === "hard" ? 7 : c.difficulty === "easy" ? 3 : 5, repetitions: 0, lapses: 0, due_at: now(), last_reviewed_at: null, last_confidence: null, last_response_seconds: null, created_at: now(), updated_at: now() }));
    const quizzes = normalizeQuizzes(ai.quizzes, m).map(q => ({ ...q, id: uid("quiz"), user_id: state.user?.id || null, material_id: m.id, created_at: now(), updated_at: now() }));
    if (isCloud()) {
      await insertMaterialCloud(m);
      if (flashcards.length) { const { error } = await state.supa.from("flashcards").insert(flashcards); if (error) throw new Error(error.message); }
      if (quizzes.length) { const { error } = await state.supa.from("quizzes").insert(quizzes); if (error) throw new Error(error.message); }
    } else {
      await put("materials", m);
      for (const c of flashcards) await put("flashcards", c);
      for (const q of quizzes) await put("quizzes", q);
    }
    return m.id;
  }

  async function insertMaterialCloud(material) {
    const { error } = await state.supa.from("materials").insert(material);
    if (!error) return;
    const msg = String(error.message || error.details || "");
    if (msg.includes("study_sections") || msg.includes("schema cache")) {
      const fallback = { ...material };
      delete fallback.study_sections;
      const retry = await state.supa.from("materials").insert(fallback);
      if (retry.error) throw new Error(retry.error.message);
      return;
    }
    throw new Error(error.message);
  }

  function normalizeTakeaways(list = []) {
    if (!Array.isArray(list)) return [];
    return list.map(x => String(x || "").trim()).filter(Boolean).slice(0, 8);
  }

  function normalizeStudySections(list = [], summary = "") {
    if (Array.isArray(list) && list.length) {
      return list.slice(0, 8).map((x, i) => ({
        title: String(x.title || x.heading || `Bagian ${i + 1}`).slice(0, 120),
        explanation: String(x.explanation || x.content || x.body || "").slice(0, 1400),
        example: String(x.example || x.contoh || "").slice(0, 700),
        activeRecall: String(x.activeRecall || x.active_recall || x.question || "").slice(0, 400)
      })).filter(x => x.title || x.explanation);
    }
    return splitIntoSections(summary);
  }

  function splitIntoSections(text = "") {
    const clean = String(text || "").replace(/\r/g, "").trim();
    if (!clean) return [];
    const paras = clean.split(/\n{2,}|(?<=\.)\s+(?=[A-ZÀ-ÝA-Z0-9])/g).map(x => x.trim()).filter(Boolean);
    return paras.slice(0, 6).map((p, i) => ({ title: `Bagian ${i + 1}`, explanation: p, example: "", activeRecall: "Apa inti dari bagian ini?" }));
  }

  function normalizeConcepts(list = []) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 12).map(c => ({
      id: c.id || uid("concept"),
      name: String(c.name || c.concept || "Konsep").slice(0, 100),
      definition: String(c.definition || c.explanation || "").slice(0, 600),
      example: String(c.example || "").slice(0, 400),
      common_misconception: String(c.common_misconception || c.commonMisconception || c.misconception || "").slice(0, 400),
      importance: String(c.importance || "medium")
    }));
  }
  function normalizeCards(list = [], m) {
    if (!Array.isArray(list) || !list.length) {
      return (m.concepts || []).slice(0, 8).map(c => ({ concept: c.name, front: `Jelaskan konsep ${c.name}`, back: c.definition, difficulty: "medium" }));
    }
    return list.slice(0, 24).filter(c => c.front || c.question).map(c => ({ concept: c.concept || "", front: String(c.front || c.question).slice(0, 260), back: String(c.back || c.answer).slice(0, 900), difficulty: c.difficulty || "medium" }));
  }
  function normalizeQuizzes(list = [], m) {
    if (!Array.isArray(list) || !list.length) return fallbackQuizzesFromMaterial(m);
    const normalized = list.slice(0, 20).map(q => {
      let options = Array.isArray(q.options) ? q.options.map(x => String(x || "").trim()).filter(Boolean) : [];
      options = [...new Set(options)].slice(0, 4);
      let raw = q.answerIndex ?? q.answer_index ?? q.correctIndex ?? q.correct_index;
      let idx = Number.isInteger(raw) ? raw : Number.isInteger(Number(raw)) ? Number(raw) : -1;
      if (idx >= options.length && idx >= 1 && idx <= options.length) idx -= 1;
      if (idx < 0 && typeof q.answer === "string") {
        const ans = q.answer.trim();
        const letter = { A:0, B:1, C:2, D:3 }[ans.toUpperCase()];
        idx = Number.isInteger(letter) ? letter : options.findIndex(o => o.toLowerCase() === ans.toLowerCase());
      }
      if (idx < 0 || idx >= options.length) idx = 0;
      return {
        concept: String(q.concept || "").slice(0, 120),
        level: String(q.level || "understanding").slice(0, 40),
        question: String(q.question || "").slice(0, 650),
        options,
        answer_index: idx,
        explanation: String(q.explanation || "").slice(0, 1000)
      };
    }).filter(q => q.question && q.options.length >= 2);
    return normalized.length >= 5 ? normalized : [...normalized, ...fallbackQuizzesFromMaterial(m)].slice(0, 12);
  }

  function fallbackQuizzesFromMaterial(m) {
    const concepts = Array.isArray(m.concepts) ? m.concepts : [];
    return concepts.slice(0, 8).map((c, i) => ({
      concept: c.name || "Konsep",
      level: i % 2 ? "understanding" : "definition",
      question: `Apa inti dari konsep “${c.name || "konsep ini"}”?`,
      options: [
        c.definition || `Penjelasan utama tentang ${c.name || "konsep ini"}`,
        c.common_misconception || "Pernyataan yang terdengar benar tetapi keliru",
        c.example || "Contoh yang tidak terkait langsung",
        "Semua jawaban di atas selalu benar"
      ].map(x => String(x).slice(0, 180)),
      answer_index: 0,
      explanation: `Konsep ini perlu dipahami lewat definisi, contoh, dan batasan penggunaannya.`
    }));
  }

  async function saveManual() {
    const text = $("#textInput").value.trim();
    if (!text) return alert("Isi teks materi dulu.");
    const materialId = await saveLearningPack(text, $("#titleInput").value.trim(), $("#categoryInput").value.trim(), { title: $("#titleInput").value.trim() || "Materi Manual", category: $("#categoryInput").value.trim() || "Umum", summaryShort: text.slice(0, 180), concepts: [], flashcards: [], quizzes: [] });
    await refreshAll(); state.currentSession = { materialId, step: 0, recall: {} }; setView("session", { target: "#sessionBox" });
  }

  async function callAI(type, payload) {
    const body = { type, provider: state.settings.provider, model: modelForProvider(), payload };
    const res = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    if (!data?.result) throw new Error("Server tidak mengembalikan result.");
    return data.result;
  }
  function modelForProvider() {
    if (state.settings.provider === "groq") return state.settings.groqModel;
    if (state.settings.provider === "openrouter") return state.settings.openrouterModel;
    return state.settings.geminiModel;
  }

  function setStatus(text) { const el = $("#statusBox"); el.hidden = false; el.textContent = text; }

  function renderReview() {
    const cards = dueCards();
    const box = $("#reviewBox"); box.innerHTML = "";
    if (!cards.length) {
      box.className = "review empty review-empty-v7";
      box.innerHTML = state.flashcards.length
        ? `<h3>Tidak ada review mendesak.</h3><p>Semua kartu masih aman. Kamu bisa lanjut belajar materi baru atau latihan flashcard manual dari Library.</p>`
        : `<h3>Belum ada flashcard.</h3><p>Upload materi dulu, lalu Aiyone akan membuat kartu review untukmu.</p>`;
      return;
    }
    box.className = "review review-v7";
    state.currentReview = clamp(state.currentReview, 0, cards.length - 1);
    state.reviewStartedAt = Date.now();
    const c = cards[state.currentReview], m = findMaterial(c.material_id || c.materialId);
    const ret = Math.round(cardRetention(c) * 100);
    const div = document.createElement("div"); div.className = "review-card review-card-v7";
    div.innerHTML = `
      <div class="mode-brief review-brief">
        <span class="badge soft">Review aktif</span>
        <h3>Ingat dulu, jangan langsung buka jawaban.</h3>
        <p>Jawab pertanyaan ini di kepala atau ucapkan pelan. Setelah yakin, buka jawaban dan pilih rating yang paling jujur.</p>
      </div>
      <div class="review-meta-line"><span>${state.currentReview+1}/${cards.length}</span><span>Retensi ±${ret}%</span><span>Stability ${Number(c.stability || c.interval_days || 1).toFixed(1)} hari</span></div>
      <span class="badge soft material-pill">${esc(materialTitle(m || {}))}</span>
      <div class="review-question">${esc(c.front)}</div>
      <button class="primary reveal-answer" id="showAns">Saya sudah menjawab, tampilkan jawaban</button>
      <div class="review-answer" id="answerBox" hidden>${esc(c.back)}</div>
      <div class="psychometric-row" id="reviewMeta" hidden>
        <label>Seberapa yakin?
          <select id="confidenceSelect"><option value="1">1 — nebak</option><option value="2">2 — ragu</option><option value="3" selected>3 — cukup yakin</option><option value="4">4 — yakin</option><option value="5">5 — sangat yakin</option></select>
        </label>
        <p class="muted">Aiyone memakai confidence + waktu jawab untuk menyesuaikan jadwal review berikutnya.</p>
      </div>
      <div class="rating-grid" id="rateBtns" hidden>
        <button class="danger" data-rate="again"><b>Lupa</b><span>muncul lagi segera</span></button>
        <button class="ghost" data-rate="hard"><b>Sulit</b><span>ulang lebih cepat</span></button>
        <button class="primary" data-rate="good"><b>Paham</b><span>jadwal normal</span></button>
        <button class="primary" data-rate="easy"><b>Mudah</b><span>jarak review lebih jauh</span></button>
      </div>`;
    box.appendChild(div);
    $("#showAns").onclick = () => { $("#answerBox").hidden = false; $("#rateBtns").hidden = false; $("#reviewMeta").hidden = false; scrollToTarget("#answerBox"); };
    $$('[data-rate]', div).forEach(btn => btn.onclick = () => {
      const meta = {
        confidence: Number($("#confidenceSelect")?.value || 3),
        responseSeconds: Math.max(1, Math.round((Date.now() - state.reviewStartedAt) / 1000)),
        retentionBefore: cardRetention(c)
      };
      reviewCard(c, btn.dataset.rate, meta);
    });
  }

  async function reviewCard(card, rating, meta = {}) {
    const updated = scheduleCard(card, rating, meta);
    const log = { id: uid("log"), user_id: state.user?.id || null, card_id: card.id, material_id: card.material_id || card.materialId, rating, correct: ["good","easy"].includes(rating), previous_due_at: cardDue(card), next_due_at: updated.due_at, response_seconds: meta.responseSeconds || null, confidence: meta.confidence || null, retention_before: meta.retentionBefore || null, created_at: now() };
    if (isCloud()) {
      const { error } = await state.supa.from("flashcards").update(updated).eq("id", card.id); if (error) throw new Error(error.message);
      await insertReviewLog(log);
    } else {
      await put("flashcards", { ...card, ...updated }); await put("review_logs", log);
    }
    await updateSmartStreak(rating);
    state.currentReview += 1;
    await refreshAll(); setView("review", { target: "#reviewBox" });
  }

  async function insertReviewLog(log) {
    if (!isCloud()) return put("review_logs", log);
    const { error } = await state.supa.from("review_logs").insert(log);
    if (!error) return;
    const fallback = { id: log.id, user_id: log.user_id, card_id: log.card_id || null, material_id: log.material_id || null, rating: log.rating || null, correct: !!log.correct, previous_due_at: log.previous_due_at || null, next_due_at: log.next_due_at || null, created_at: log.created_at || now() };
    const retry = await state.supa.from("review_logs").insert(fallback);
    if (retry.error) throw new Error(retry.error.message);
  }

  function scheduleCard(card, rating, meta = {}) {
    let ease = Number(card.ease || 2.5), reps = Number(card.repetitions || 0), lapses = Number(card.lapses || 0);
    let stability = Math.max(Number(card.stability || card.interval_days || 1), 0.08);
    let difficulty = clamp(Number(card.memory_difficulty || (card.difficulty === "hard" ? 7 : card.difficulty === "easy" ? 3 : 5)), 1, 10);
    const confidence = clamp(Number(meta.confidence || 3), 1, 5);
    const seconds = Math.max(Number(meta.responseSeconds || 30), 1);
    const speedFactor = seconds < 12 ? 1.08 : seconds > 90 ? 0.88 : 1;
    const confidenceFactor = 0.82 + confidence * 0.08;
    const retention = clamp(Number(meta.retentionBefore ?? cardRetention(card)), 0.05, 0.99);

    if (rating === "again") {
      ease = Math.max(1.3, ease - .32); reps = 0; lapses += 1; stability = 0.12; difficulty = clamp(difficulty + .9, 1, 10);
    }
    if (rating === "hard") {
      ease = Math.max(1.3, ease - .16); reps += 1; stability = Math.max(1, stability * (1.12 + confidence * .04) * speedFactor * Math.max(.78, retention)); difficulty = clamp(difficulty + .25, 1, 10);
    }
    if (rating === "good") {
      reps += 1; stability = Math.max(1.2, stability * (1.85 + (ease - 2.3) * .25) * confidenceFactor * speedFactor); difficulty = clamp(difficulty - .12, 1, 10);
    }
    if (rating === "easy") {
      ease = Math.min(3.3, ease + .16); reps += 1; stability = Math.max(3, stability * (2.65 + confidence * .18) * speedFactor); difficulty = clamp(difficulty - .35, 1, 10);
    }
    const target = clamp(Number(state.settings.targetRetention || 0.85), .70, .95);
    const interval = Math.max(10 / 1440, -stability * Math.log(target));
    const due = new Date(Date.now() + interval * dayMs).toISOString();
    return { ease, repetitions: reps, interval_days: interval, stability, memory_difficulty: difficulty, lapses, due_at: due, last_reviewed_at: now(), last_confidence: confidence, last_response_seconds: seconds, updated_at: now() };
  }

  async function updateSmartStreak(ratingOrScore) {
    const score = typeof ratingOrScore === "number" ? ratingOrScore : (["good","easy"].includes(ratingOrScore) ? 100 : ratingOrScore === "hard" ? 70 : 0);
    const today = new Date().toISOString().slice(0,10);
    if (score >= Number(state.settings.masteryThreshold || 70) && state.settings.lastStreakDate !== today) {
      state.settings.streak = (state.settings.streak || 0) + 1;
      state.settings.lastStreakDate = today;
      await saveSettings();
    }
  }

  function quizPool(materialId) {
    const existing = materialQuizzes(materialId).filter(q => q.question && Array.isArray(q.options) && q.options.length >= 2);
    if (existing.length >= 5) return existing;
    const m = findMaterial(materialId) || {};
    const cards = materialCards(materialId);
    const distractors = cards.map(c => c.back).filter(Boolean);
    const generated = cards.slice(0, Math.max(0, 10 - existing.length)).map((c, i) => {
      const opts = [c.back, ...distractors.filter(x => x !== c.back).slice(0,3)];
      while (opts.length < 4) opts.push(i % 2 ? "Konsep berbeda yang tidak menjawab pertanyaan" : "Jawaban terlalu umum dan tidak spesifik");
      return { id: uid("quiztemp"), material_id: materialId, concept: c.concept || "", level: i % 3 === 0 ? "application" : "understanding", question: c.front, options: opts.slice(0,4).map(x => String(x).slice(0,220)), answer_index: 0, explanation: c.back };
    });
    if (!generated.length && Array.isArray(m.concepts)) generated.push(...fallbackQuizzesFromMaterial(m));
    return [...existing, ...generated].slice(0, 12);
  }

  function startQuiz(materialId, mode = "practice") {
    let quizzes = quizPool(materialId);
    if (!quizzes.length) return alert("Belum ada quiz untuk materi ini.");
    if (mode === "pretest") quizzes = shuffle(quizzes).slice(0, Math.min(8, quizzes.length));
    if (mode === "posttest") quizzes = shuffle(quizzes).slice(0, Math.min(12, quizzes.length));
    state.currentQuiz = { materialId, mode, quizzes, index: 0, correct: 0, answered: false, mistakes: [], startedAt: Date.now() };
    showQuiz();
  }

  function shuffle(list) {
    return [...list].map(x => [Math.random(), x]).sort((a,b) => a[0] - b[0]).map(x => x[1]);
  }

  function quizModeLabel(mode) {
    if (mode === "pretest") return "Pre-test diagnostik";
    if (mode === "posttest") return "Post-test mastery";
    return "Quiz latihan";
  }

  function quizInstruction(mode) {
    if (mode === "pretest") return { title: "Tujuan sesi", text: "Jawab tanpa melihat materi. Ini cuma diagnosis awal, jadi salah itu wajar." };
    if (mode === "posttest") return { title: "Tujuan sesi", text: `Buktikan penguasaan materi. Target mastery: ${Number(state.settings.masteryThreshold || 70)}%.` };
    return { title: "Cara mengerjakan", text: "Pilih jawaban terbaik. Setelah salah, Aiyone akan mendorong konsep terkait masuk review." };
  }

  function showQuiz() {
    const qstate = state.currentQuiz; if (!qstate) return;
    const q = qstate.quizzes[qstate.index];
    const modal = $("#quizModal");
    const p = $("#quizModalCard");
    if (modal) { modal.classList.add("open"); modal.setAttribute("aria-hidden", "false"); }
    const progress = Math.round(((qstate.index + 1) / qstate.quizzes.length) * 100);
    const info = quizInstruction(qstate.mode);
    p.innerHTML = `
      <div class="quiz-shell quiz-v7-shell">
        <div class="quiz-topline">
          <div><span class="badge soft">${esc(quizModeLabel(qstate.mode))}</span><h3>Soal ${qstate.index + 1} dari ${qstate.quizzes.length}</h3></div>
          <button class="ghost small quiz-close" id="closeQuiz" aria-label="Tutup quiz">×</button>
        </div>
        <div class="mode-brief quiz-brief"><b>${esc(info.title)}</b><p>${esc(info.text)}</p></div>
        <div class="quiz-progress-wrap"><div class="quiz-progress"><i style="width:${progress}%"></i></div><span>${progress}%</span></div>
        <p class="muted quiz-level">Level: ${esc(q.level || "understanding")}</p>
        <h4 class="quiz-question">${esc(q.question)}</h4>
        <div id="quizOptions" class="quiz-options">${q.options.map((o,i) => `<button class="quiz-option" data-i="${i}"><span>${String.fromCharCode(65+i)}</span><b>${esc(o)}</b></button>`).join("")}</div>
        <div id="quizExplain" class="quiz-feedback" hidden></div>
        <div class="action-row wrap quiz-actions"><button class="primary" id="quizNext" hidden>${qstate.index + 1 >= qstate.quizzes.length ? "Lihat hasil" : "Lanjut ke soal berikutnya"}</button></div>
      </div>`;
    $("#closeQuiz", p).onclick = () => closeQuizModal();
    $$(".quiz-option", p).forEach(btn => btn.onclick = () => answerQuiz(btn, q, qstate, p));
  }

  function answerQuiz(btn, q, qstate, panel) {
    if (qstate.answered) return;
    qstate.answered = true;
    const chosen = Number(btn.dataset.i), answer = Number(q.answer_index || 0);
    const correct = chosen === answer;
    if (correct) qstate.correct += 1; else qstate.mistakes.push({ question: q.question, chosen: q.options[chosen], correct: q.options[answer], explanation: q.explanation || "" });
    $$(".quiz-option", panel).forEach((b, i) => {
      b.disabled = true;
      b.classList.add(i === answer ? "correct" : i === chosen ? "wrong" : "dimmed");
    });
    const exp = $("#quizExplain", panel);
    exp.hidden = false;
    exp.innerHTML = `<b>${correct ? "Benar." : "Belum tepat."}</b><p>${esc(q.explanation || "Cek kembali konsepnya dari materi dan flashcard.")}</p>`;
    const next = $("#quizNext", panel);
    next.hidden = false;
    next.onclick = async () => {
      qstate.index += 1;
      qstate.answered = false;
      if (qstate.index >= qstate.quizzes.length) {
        const score = Math.round(qstate.correct / qstate.quizzes.length * 100);
        await applyQuizResults(qstate.materialId, score, qstate.mistakes, qstate.mode, qstate.startedAt);
        await updateSmartStreak(score);
        const mistakesHtml = qstate.mistakes.length ? `<div class="mistake-list"><h4>Soal yang perlu diulang</h4>${qstate.mistakes.map((x, i) => `<div class="flash-mini"><b>${i+1}. ${esc(x.question)}</b><p><b>Jawaban benar:</b> ${esc(x.correct)}</p><p class="muted">${esc(x.explanation || "Cek konsep terkait dari materi.")}</p></div>`).join("")}</div>` : `<p class="muted">Tidak ada soal salah. Coba teaching mode untuk memastikan kamu bisa menjelaskan ulang.</p>`;
        panel.innerHTML = `<div class="quiz-result quiz-result-v7"><span class="badge ${score >= Number(state.settings.masteryThreshold || 70) ? "cloud" : "local"}">${score >= Number(state.settings.masteryThreshold || 70) ? "Lulus mastery" : "Perlu review"}</span><h3>Hasil ${esc(quizModeLabel(qstate.mode))}</h3><div class="score-hero"><strong>${score}%</strong><span>${qstate.correct}/${qstate.quizzes.length} benar</span></div><p class="muted">${qstate.mode === "pretest" ? "Ini baru diagnosis awal. Lanjutkan ke modul belajar bertahap." : qstate.mode === "posttest" ? "Post-test dipakai sebagai bukti mastery. Kalau belum lulus, ulangi flashcard dan konsep salah." : "Quiz latihan selesai. Konsep yang salah akan diprioritaskan untuk review."}</p>${mistakesHtml}<div class="action-row wrap"><button class="primary" id="retryWrong">Latihan konsep salah</button><button class="ghost" id="goFlashAfterQuiz">Flashcard</button><button class="ghost" id="goTeachAfterQuiz">Teaching Mode</button><button class="ghost" id="backLibrary">Kembali</button></div></div>`;
        const doneMaterialId = qstate.materialId;
        state.currentQuiz = null;
        await refreshAll();
        $("#retryWrong", panel).onclick = () => startQuiz(doneMaterialId, "practice");
        $("#goFlashAfterQuiz", panel).onclick = () => { closeQuizModal(); startFlashcards(doneMaterialId); };
        $("#goTeachAfterQuiz", panel).onclick = () => { closeQuizModal(); setView("teach", { target: "#teach" }); };
        $("#backLibrary", panel).onclick = () => { closeQuizModal(); setView("session", { target: "#sessionBox" }); };
      } else showQuiz();
    };
  }

  async function applyQuizResults(materialId, score, mistakes = [], mode = "practice", startedAt = Date.now()) {
    const m = findMaterial(materialId);
    if (!m) return;
    const updatedMaterial = { ...m, mastery_score: Math.max(Number(m.mastery_score || 0), score), updated_at: now() };
    const conceptsWrong = new Set(mistakes.map(x => String(x.question || "").toLowerCase()));
    const dueSoon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const cardsToNudge = materialCards(materialId).filter(c => [...conceptsWrong].some(q => q.includes(String(c.concept || "").toLowerCase()) || q.includes(String(c.front || "").slice(0, 30).toLowerCase()))).slice(0, 5);
    const log = { id: uid("log"), user_id: state.user?.id || null, card_id: null, material_id: materialId, rating: `quiz-${mode}-${score}`, correct: score >= Number(state.settings.masteryThreshold || 70), previous_due_at: null, next_due_at: null, score, quiz_mode: mode, response_seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)), confidence: null, retention_before: null, created_at: now() };
    if (isCloud()) {
      const { error } = await state.supa.from("materials").update({ mastery_score: updatedMaterial.mastery_score, updated_at: updatedMaterial.updated_at }).eq("id", materialId);
      if (error) console.warn(error.message);
      await insertReviewLog(log);
      for (const c of cardsToNudge) await state.supa.from("flashcards").update({ due_at: dueSoon, updated_at: now() }).eq("id", c.id);
    } else {
      await put("materials", updatedMaterial);
      await put("review_logs", log);
      for (const c of cardsToNudge) await put("flashcards", { ...c, due_at: dueSoon, updated_at: now() });
    }
  }


  function startFlashcards(materialId, cardsList = null) {
    const cards = (cardsList && cardsList.length ? cardsList : materialCards(materialId)).filter(c => c.front && c.back);
    if (!cards.length) return alert("Belum ada flashcard untuk materi ini.");
    state.currentFlash = { materialId, cards: shuffle(cards), index: 0, shown: false, startedAt: Date.now(), done: 0 };
    showFlashcard();
  }

  function showFlashcard() {
    const f = state.currentFlash; if (!f) return;
    const modal = $("#quizModal"), p = $("#quizModalCard");
    if (modal) { modal.classList.add("open"); modal.setAttribute("aria-hidden", "false"); }
    const card = f.cards[f.index];
    const m = findMaterial(card.material_id || card.materialId || f.materialId);
    const progress = Math.round(((f.index + 1) / f.cards.length) * 100);
    f.startedAt = Date.now();
    p.innerHTML = `
      <div class="flash-shell flash-v7-shell">
        <div class="quiz-topline">
          <div><span class="badge soft">Flashcard aktif</span><h3>Kartu ${f.index + 1} dari ${f.cards.length}</h3></div>
          <button class="ghost small quiz-close" id="closeFlash" aria-label="Tutup flashcard">×</button>
        </div>
        <div class="mode-brief"><b>Cara pakai</b><p>Jangan baca jawaban dulu. Jawab di kepala, baru tekan tombol tampilkan jawaban. Inilah active recall.</p></div>
        <div class="quiz-progress-wrap"><div class="quiz-progress"><i style="width:${progress}%"></i></div><span>${progress}%</span></div>
        <span class="badge soft material-pill">${esc(materialTitle(m || {}))}</span>
        <div class="flash-question-card"><span>Pertanyaan</span><h4>${esc(card.front)}</h4></div>
        <button class="primary reveal-answer" id="flashReveal">Saya sudah jawab, tampilkan jawaban</button>
        <div class="review-answer flash-answer" id="flashAnswer" hidden>${esc(card.back)}</div>
        <div class="psychometric-row" id="flashMeta" hidden>
          <label>Seberapa yakin?
            <select id="flashConfidence"><option value="1">1 — nebak</option><option value="2">2 — ragu</option><option value="3" selected>3 — cukup yakin</option><option value="4">4 — yakin</option><option value="5">5 — sangat yakin</option></select>
          </label>
          <p class="muted">Ratingmu akan menentukan kapan kartu ini muncul lagi.</p>
        </div>
        <div class="rating-grid" id="flashRateBtns" hidden>
          <button class="danger" data-flash-rate="again"><b>Lupa</b><span>aku belum ingat</span></button>
          <button class="ghost" data-flash-rate="hard"><b>Sulit</b><span>ingat tapi berat</span></button>
          <button class="primary" data-flash-rate="good"><b>Paham</b><span>jawaban cukup benar</span></button>
          <button class="primary" data-flash-rate="easy"><b>Mudah</b><span>langsung ingat</span></button>
        </div>
      </div>`;
    $("#closeFlash", p).onclick = () => { state.currentFlash = null; closeQuizModal(); };
    $("#flashReveal", p).onclick = () => { $("#flashAnswer", p).hidden = false; $("#flashMeta", p).hidden = false; $("#flashRateBtns", p).hidden = false; scrollToTarget($("#flashAnswer", p)); };
    $$('[data-flash-rate]', p).forEach(btn => btn.onclick = () => rateFlashcard(card, btn.dataset.flashRate));
  }

  async function rateFlashcard(card, rating) {
    const f = state.currentFlash; if (!f) return;
    const meta = {
      confidence: Number($("#flashConfidence")?.value || 3),
      responseSeconds: Math.max(1, Math.round((Date.now() - f.startedAt) / 1000)),
      retentionBefore: cardRetention(card)
    };
    const updated = scheduleCard(card, rating, meta);
    const log = { id: uid("log"), user_id: state.user?.id || null, card_id: card.id, material_id: card.material_id || card.materialId || f.materialId, rating: `flash-${rating}`, correct: ["good","easy"].includes(rating), previous_due_at: cardDue(card), next_due_at: updated.due_at, response_seconds: meta.responseSeconds, confidence: meta.confidence, retention_before: meta.retentionBefore, created_at: now() };
    if (isCloud()) {
      const { error } = await state.supa.from("flashcards").update(updated).eq("id", card.id); if (error) throw new Error(error.message);
      await insertReviewLog(log);
    } else {
      await put("flashcards", { ...card, ...updated }); await put("review_logs", log);
    }
    await updateSmartStreak(rating);
    f.done += 1;
    f.index += 1;
    if (f.index >= f.cards.length) {
      const materialId = f.materialId;
      state.currentFlash = null;
      const p = $("#quizModalCard");
      p.innerHTML = `<div class="quiz-result quiz-result-v7"><span class="badge cloud">Flashcard selesai</span><h3>Latihan selesai</h3><div class="score-hero"><strong>${f.done}</strong><span>kartu sudah kamu review</span></div><p class="muted">Kartu yang sulit akan muncul lebih cepat. Lanjutkan dengan quiz atau post-test untuk cek mastery.</p><div class="action-row wrap"><button class="primary" id="flashToQuiz">Lanjut Quiz</button><button class="ghost" id="flashToPost">Post-test</button><button class="ghost" id="flashBackSession">Kembali Belajar</button></div></div>`;
      await refreshAll();
      $("#flashToQuiz", p).onclick = () => startQuiz(materialId, "practice");
      $("#flashToPost", p).onclick = () => startQuiz(materialId, "posttest");
      $("#flashBackSession", p).onclick = () => { closeQuizModal(); setView("session", { target: "#sessionBox" }); };
    } else {
      await refreshAll();
      showFlashcard();
    }
  }

  function renderTeachOptions() {
    const s = $("#teachMaterial"); if (!s) return;
    s.innerHTML = state.materials.map(m => `<option value="${m.id}">${esc(materialTitle(m))}</option>`).join("");
  }
  async function evaluateTeaching() {
    const materialId = $("#teachMaterial").value; const m = findMaterial(materialId);
    if (!m) return alert("Pilih materi dulu.");
    const answer = $("#teachAnswer").value.trim(); if (answer.length < 50) return alert("Penjelasan terlalu pendek. Coba jelaskan lebih lengkap.");
    const out = $("#teachOutput"); out.hidden = false; out.textContent = "AI sedang menilai pemahamanmu...";
    try {
      const result = await callAI("evaluateTeaching", { material: { title: m.title, summary: m.summary_long || m.summary_short, concepts: m.concepts || [] }, focus: $("#teachFocus").value.trim(), answer });
      const score = Math.round(Number(result.masteryScore || result.mastery_score || 0));
      out.innerHTML = `<div class="teach-score"><span>Skor Penguasaan</span><strong>${score}%</strong></div><div class="feedback-grid"><section><h4>Feedback</h4>${htmlParagraphs(result.feedback || "-")}</section><section><h4>Miskonsepsi</h4><ul>${(result.misconceptions || []).length ? (result.misconceptions || []).map(x => `<li>${esc(x)}</li>`).join("") : "<li>Tidak terdeteksi.</li>"}</ul></section><section><h4>Bagian yang Kurang</h4><ul>${(result.missingPoints || result.missing_points || []).length ? (result.missingPoints || result.missing_points || []).map(x => `<li>${esc(x)}</li>`).join("") : "<li>Tidak ada catatan khusus.</li>"}</ul></section><section><h4>Langkah Berikutnya</h4><p>${esc(result.nextAction || result.next_action || "Review kartu lemah.")}</p></section></div><div class="rubric-bars">${renderRubric(result.rubric || {})}</div>`;
      const row = { id: uid("teach"), user_id: state.user?.id || null, material_id: materialId, answer_text: answer, result, created_at: now() };
      if (isCloud()) await state.supa.from("teaching_sessions").insert(row); else await put("teaching_sessions", row);
      await updateSmartStreak(score);
      await refreshAll();
    } catch (err) { out.textContent = `Gagal: ${err.message}`; }
  }

  function renderRubric(rubric = {}) {
    const rows = [["accuracy", "Akurasi"], ["completeness", "Kelengkapan"], ["examples", "Contoh"], ["clarity", "Kejelasan"]];
    return rows.map(([key, label]) => { const v = clamp(Math.round(Number(rubric[key] || 0)), 0, 100); return `<div><span>${label}</span><div class="bar"><i style="width:${v}%"></i></div><b>${v}%</b></div>`; }).join("");
  }

  async function deleteMaterial(id) {
    if (!confirm("Hapus materi ini beserta flashcard dan quiz?")) return;
    if (isCloud()) {
      await state.supa.from("materials").delete().eq("id", id);
      await state.supa.from("flashcards").delete().eq("material_id", id);
      await state.supa.from("quizzes").delete().eq("material_id", id);
    } else {
      await del("materials", id);
      for (const c of materialCards(id)) await del("flashcards", c.id);
      for (const q of materialQuizzes(id)) await del("quizzes", q.id);
    }
    await refreshAll();
  }

  function fillSettings() {
    $("#providerSelect").value = state.settings.provider;
    $("#geminiModel").value = state.settings.geminiModel;
    $("#groqModel").value = state.settings.groqModel;
    $("#openrouterModel").value = state.settings.openrouterModel;
    if ($("#masteryThreshold")) $("#masteryThreshold").value = state.settings.masteryThreshold || 70;
    if ($("#targetRetention")) $("#targetRetention").value = state.settings.targetRetention || 0.85;
  }

  async function exportJSON() {
    const data = { exportedAt: now(), settings: { ...state.settings, supabaseAnon: "", supabaseUrl: "" }, materials: state.materials, flashcards: state.flashcards, quizzes: state.quizzes, logs: state.logs, teaching: state.teaching };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `aiyone-backup-${new Date().toISOString().slice(0,10)}.json` });
    a.click(); URL.revokeObjectURL(url);
  }
  async function importJSON(file) {
    const data = JSON.parse(await file.text());
    if (!confirm("Import akan menambahkan data ke local database. Lanjut?")) return;
    for (const m of data.materials || []) await put("materials", { ...m, user_id: null });
    for (const c of data.flashcards || []) await put("flashcards", { ...c, user_id: null });
    for (const q of data.quizzes || []) await put("quizzes", { ...q, user_id: null });
    for (const l of data.logs || []) await put("review_logs", { ...l, user_id: null });
    await refreshAll();
  }

  async function resetLocal() {
    if (!confirm("Reset semua data lokal? Data cloud Supabase tidak ikut terhapus.")) return;
    for (const s of ["materials", "flashcards", "quizzes", "review_logs", "teaching_sessions"]) await clear(s);
    await refreshAll();
  }


  function renderSessionOptions() {
    const s = $("#sessionMaterial"); if (!s) return;
    s.innerHTML = state.materials.map(m => `<option value="${m.id}">${esc(materialTitle(m))}</option>`).join("");
    if (state.currentSession?.materialId) s.value = state.currentSession.materialId;
    if (!s.dataset.bound) {
      s.onchange = () => { state.currentSession = { materialId: s.value, step: 0, recall: {} }; renderSession(); };
      s.dataset.bound = "1";
    }
  }

  function getStudySectionsForMaterial(m) {
    return m ? (m.study_sections || m.studySections || splitIntoSections(m.summary_long || m.summaryLong || m.summary_short || m.summaryShort || "")) : [];
  }

  function renderSession() {
    const box = $("#sessionBox"); if (!box) return;
    if (!state.materials.length) { box.className = "session-box empty"; box.innerHTML = `<h3>Belum ada materi.</h3><p>Upload satu PDF/catatan dulu. Setelah itu Aiyone akan membuat jalur belajar otomatis.</p>`; return; }
    const select = $("#sessionMaterial");
    const materialId = state.currentSession?.materialId || select?.value || state.materials[0]?.id;
    const m = findMaterial(materialId) || state.materials[0];
    if (!state.currentSession || state.currentSession.materialId !== m.id) state.currentSession = { materialId: m.id, step: 0, recall: {} };
    if (select) select.value = m.id;
    const sections = getStudySectionsForMaterial(m);
    const step = clamp(state.currentSession.step || 0, 0, Math.max(sections.length - 1, 0));
    state.currentSession.step = step;
    const sec = sections[step] || { title: materialTitle(m), explanation: m.summary_long || m.summary_short || "Belum ada materi bertahap.", example: "", activeRecall: "Jelaskan inti bagian ini dengan bahasamu." };
    const progress = sections.length ? Math.round(((step + 1) / sections.length) * 100) : 0;
    const cards = materialCards(m.id);
    const dueCount = cards.filter(c => new Date(cardDue(c)) <= new Date()).length;
    box.className = "session-box session-v7";
    box.innerHTML = `
      <div class="learning-coach-card">
        <span class="badge soft">Aiyone Coach</span>
        <h3>Hari ini, ikuti urutan belajar ini.</h3>
        <p>Jangan langsung loncat-loncat. Mulai dari diagnosis, pelajari bagian kecil, lalu uji dengan flashcard dan post-test.</p>
      </div>
      <div class="journey-steps">
        <button class="journey-step" id="sessionPretest"><span>1</span><b>Pre-test</b><small>Cek awal</small></button>
        <button class="journey-step primary-step" id="jumpRead"><span>2</span><b>Baca modul</b><small>Step ${step + 1}/${Math.max(sections.length, 1)}</small></button>
        <button class="journey-step" id="sessionFlash"><span>3</span><b>Flashcard</b><small>${cards.length} kartu • ${dueCount} due</small></button>
        <button class="journey-step" id="sessionQuiz"><span>4</span><b>Quiz</b><small>Latihan</small></button>
        <button class="journey-step" id="sessionPosttest"><span>5</span><b>Post-test</b><small>Mastery ${Number(state.settings.masteryThreshold || 70)}%</small></button>
      </div>
      <div class="session-hero" id="readStep">
        <div><span class="badge soft">Bagian ${step + 1}/${Math.max(sections.length, 1)}</span><h3>${esc(sec.title || `Bagian ${step + 1}`)}</h3><p class="muted">${esc(materialTitle(m))}</p></div>
        <div class="session-progress"><div class="bar"><i style="width:${progress}%"></i></div><b>${progress}%</b></div>
      </div>
      <div class="mode-brief"><b>Instruksi</b><p>Baca bagian ini pelan-pelan. Setelah itu tutup sebentar, lalu jawab active recall dengan bahasamu sendiri.</p></div>
      <div class="prose-block learning-copy">${htmlParagraphs(sec.explanation || sec.content || "-")}</div>
      ${sec.example ? `<div class="example"><b>Contoh:</b> ${esc(sec.example)}</div>` : ""}
      <div class="recall-box">
        <label><b>Active recall</b><span>${esc(sec.activeRecall || sec.active_recall || "Coba jelaskan ulang bagian ini tanpa melihat catatan.")}</span><textarea id="sessionRecall" rows="4" placeholder="Tulis jawaban singkatmu. Tidak harus sempurna, yang penting otakmu bekerja..."></textarea></label>
      </div>
      <div class="action-row wrap session-actions">
        <button class="ghost" id="prevStep" ${step <= 0 ? "disabled" : ""}>← Sebelumnya</button>
        <button class="primary" id="nextStep">${step + 1 >= sections.length ? "Selesai baca → latihan" : "Saya paham, lanjut →"}</button>
        <button class="ghost" id="sessionTeach">Jelaskan ke AI</button>
      </div>`;
    const savedRecall = state.currentSession.recall?.[step] || "";
    $("#sessionRecall", box).value = savedRecall;
    $("#sessionRecall", box).oninput = e => { state.currentSession.recall[step] = e.target.value; };
    $("#prevStep", box).onclick = () => { state.currentSession.step = Math.max(0, step - 1); renderSession(); scrollToTarget("#readStep"); };
    $("#nextStep", box).onclick = () => { if (step + 1 >= sections.length) { startFlashcards(m.id); } else { state.currentSession.step = step + 1; renderSession(); scrollToTarget("#readStep"); } };
    $("#jumpRead", box).onclick = () => scrollToTarget("#readStep");
    $("#sessionPretest", box).onclick = () => startQuiz(m.id, "pretest");
    $("#sessionFlash", box).onclick = () => startFlashcards(m.id);
    $("#sessionQuiz", box).onclick = () => startQuiz(m.id, "practice");
    $("#sessionPosttest", box).onclick = () => startQuiz(m.id, "posttest");
    $("#sessionTeach", box).onclick = () => { setView("teach", { target: "#teach" }); $("#teachMaterial").value = m.id; };
  }

  function renderAnalytics() {
    const reviewCount = state.logs.length;
    const correct = state.logs.filter(l => l.correct).length;
    const acc = reviewCount ? Math.round((correct / reviewCount) * 100) : 0;
    const weakCards = state.flashcards.filter(c => memoryStatus(c) === "weak");
    const setText = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    setText("#aReviews", reviewCount);
    setText("#aAccuracy", `${acc}%`);
    setText("#aTeaching", state.teaching.length);
    setText("#aWeak", weakCards.length);

    const weakBox = $("#weakConceptList");
    if (weakBox) {
      weakBox.innerHTML = "";
      if (!weakCards.length) { weakBox.className = "stack empty"; weakBox.textContent = state.flashcards.length ? "Belum ada konsep rawan. Pertahankan review." : "Belum ada data review."; }
      else {
        weakBox.className = "stack";
        weakCards.slice(0, 10).forEach(c => {
          const m = findMaterial(c.material_id || c.materialId);
          const div = document.createElement("div"); div.className = "flash-mini priority";
          div.innerHTML = `<b>${esc(c.concept || c.front)}</b><p class="muted">${esc(materialTitle(m || {}))} • retensi ±${Math.round(cardRetention(c)*100)}% • lapses ${c.lapses || 0}</p><p>${esc(c.front)}</p>`;
          weakBox.appendChild(div);
        });
      }
    }
    const actBox = $("#activityList");
    if (actBox) {
      const activities = [
        ...state.logs.map(l => ({ type:"Review", at:l.created_at || now(), text:`${l.rating || "review"} • ${l.correct ? "benar" : "perlu ulang"}` })),
        ...state.teaching.map(t => ({ type:"Teaching", at:t.created_at || now(), text:`skor ${Math.round(Number(t.result?.masteryScore || t.result?.mastery_score || 0))}%` }))
      ].sort((a,b) => new Date(b.at) - new Date(a.at)).slice(0, 12);
      actBox.innerHTML = "";
      if (!activities.length) { actBox.className = "stack empty"; actBox.textContent = "Belum ada aktivitas."; }
      else { actBox.className = "stack"; activities.forEach(a => { const div = document.createElement("div"); div.className = "flash-mini"; div.innerHTML = `<b>${esc(a.type)}</b><p>${esc(a.text)}</p><small class="muted">${shortDate(a.at)}</small>`; actBox.appendChild(div); }); }
    }
  }

  async function syncLocalToCloud(options = {}) {
    const silent = !!options.silent;
    if (!isCloud()) { if (!silent) alert("Login dulu sampai status Cloud aktif."); return false; }
    const [lm, lc, lq, ll, lt] = await Promise.all([getAll("materials"), getAll("flashcards"), getAll("quizzes"), getAll("review_logs"), getAll("teaching_sessions")]);
    const uidUser = state.user.id;
    const localMaterials = lm.filter(m => !m.user_id || m.user_id !== uidUser);
    if (!localMaterials.length) { if (!silent) alert("Tidak ada materi lokal yang perlu dipindahkan."); return true; }
    if (!silent && !confirm(`Pindahkan ${localMaterials.length} materi lokal ke Cloud? Data lokal tidak dihapus.`)) return false;
    const ids = new Set(localMaterials.map(m => m.id));
    const materials = localMaterials.map(m => ({ ...m, user_id: uidUser, updated_at: now() }));
    const cards = lc.filter(c => ids.has(c.material_id || c.materialId)).map(c => ({ ...c, user_id: uidUser, material_id: c.material_id || c.materialId }));
    const quizzes = lq.filter(q => ids.has(q.material_id || q.materialId)).map(q => ({ ...q, user_id: uidUser, material_id: q.material_id || q.materialId }));
    const logs = ll.filter(l => ids.has(l.material_id || l.materialId)).map(l => ({ ...l, user_id: uidUser, material_id: l.material_id || l.materialId }));
    const teaching = lt.filter(t => ids.has(t.material_id || t.materialId)).map(t => ({ ...t, user_id: uidUser, material_id: t.material_id || t.materialId }));
    const upsert = async (table, rows) => { if (!rows.length) return; const { error } = await state.supa.from(table).upsert(rows, { onConflict: "id" }); if (error) throw new Error(`${table}: ${error.message}`); };
    try {
      await upsert("materials", materials);
      await upsert("flashcards", cards);
      await upsert("quizzes", quizzes);
      await upsert("review_logs", logs);
      await upsert("teaching_sessions", teaching);
      // Tandai data lokal sebagai milik user ini agar tidak di-upsert berulang kali di setiap login.
      for (const row of materials) await put("materials", row);
      for (const row of cards) await put("flashcards", row);
      for (const row of quizzes) await put("quizzes", row);
      for (const row of logs) await put("review_logs", row);
      for (const row of teaching) await put("teaching_sessions", row);
      await refreshAll();
      if (!silent) alert("Data lokal berhasil dipindahkan ke Cloud.");
      return true;
    } catch (e) { if (!silent) alert(`Gagal sync: ${e.message}`); else console.warn("Auto sync gagal", e); return false; }
  }

  function openProfile() {
    renderProfile();
    const modal = $("#profileModal");
    if (modal) { modal.classList.add("open"); modal.setAttribute("aria-hidden", "false"); }
  }
  function closeProfile() {
    const modal = $("#profileModal");
    if (modal) { modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); }
  }

  function openDrawer() {
    $("#sidebar")?.classList.add("open");
    $("#drawerOverlay")?.classList.add("show");
  }
  function closeDrawer() {
    $("#sidebar")?.classList.remove("open");
    $("#drawerOverlay")?.classList.remove("show");
  }
  function closeQuizModal() {
    state.currentQuiz = null;
    state.currentFlash = null;
    const modal = $("#quizModal");
    const card = $("#quizModalCard");
    if (modal) { modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); }
    if (card) card.innerHTML = "";
  }

  function bindEvents() {
    $$(".nav-item").forEach(b => b.onclick = () => setView(b.dataset.view));
    $$("#menuToggle").forEach(b => b.onclick = openDrawer);
    $$("#drawerClose, #drawerOverlay").forEach(b => b.onclick = closeDrawer);
    document.addEventListener("keydown", e => { if (e.key === "Escape") { closeDrawer(); closeQuizModal(); closeProfile(); } });
    ["#profileBtn", "#mobileProfileBtn"].forEach(sel => { const b = $(sel); if (b) b.onclick = openProfile; });
    const profileModal = $("#profileModal"); if (profileModal) profileModal.addEventListener("click", e => { if (e.target === profileModal) closeProfile(); });
    const profileClose = $("#profileClose"); if (profileClose) profileClose.onclick = closeProfile;
    $$('[data-jump]').forEach(b => b.onclick = () => setView(b.dataset.jump));
    $("#pdfInput").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      setStatus("Membaca PDF...");
      try { $("#textInput").value = await extractPdf(file); setStatus(`PDF terbaca: ${$("#textInput").value.length.toLocaleString("id-ID")} karakter.`); }
      catch (err) { setStatus(`Gagal baca PDF: ${err.message}`); }
    };
    $("#generateBtn").onclick = generateMaterial;
    $("#saveManualBtn").onclick = saveManual;
    $("#searchInput").oninput = renderLibrary;
    $("#refreshBtn").onclick = renderReview;
    $("#teachBtn").onclick = evaluateTeaching;
    $("#saveAiSettings").onclick = async () => {
      state.settings.provider = $("#providerSelect").value;
      state.settings.geminiModel = $("#geminiModel").value.trim();
      state.settings.groqModel = $("#groqModel").value.trim();
      state.settings.openrouterModel = $("#openrouterModel").value.trim();
      state.settings.masteryThreshold = clamp(Number($("#masteryThreshold")?.value || 70), 50, 95);
      state.settings.targetRetention = clamp(Number($("#targetRetention")?.value || 0.85), 0.7, 0.95);
      await saveSettings(); alert("AI & Memory settings tersimpan.");
    };
    $("#testAiBtn").onclick = async () => {
      try { const r = await callAI("ping", { text: "Jawab singkat: AI server aktif." }); alert(`AI server aktif: ${r.message || JSON.stringify(r)}`); }
      catch (e) { alert(`AI server gagal: ${e.message}`); }
    };
    if ($("#signUpBtn")) $("#signUpBtn").onclick = async () => authAction("signUp");
    if ($("#loginBtn")) $("#loginBtn").onclick = async () => authAction("signInWithPassword");
    if ($("#logoutBtn")) $("#logoutBtn").onclick = async () => { if (state.supa) await state.supa.auth.signOut(); closeProfile(); await refreshAll(); };
    $("#exportBtn").onclick = exportJSON;
    $("#importInput").onchange = e => e.target.files[0] && importJSON(e.target.files[0]);
    $("#syncLocalBtn") && ($("#syncLocalBtn").onclick = syncLocalToCloud);
    $("#resetBtn").onclick = resetLocal;
    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault(); state.deferredInstall = e;
      const a = $("#installBtn"), b = $("#mobileInstallBtn");
      if (a) a.hidden = false; if (b) b.hidden = false;
    });
    const install = async () => {
      if (state.deferredInstall) {
        state.deferredInstall.prompt(); state.deferredInstall = null;
        const a = $("#installBtn"), b = $("#mobileInstallBtn");
        if (a) a.hidden = true; if (b) b.hidden = true;
      }
    };
    if ($("#installBtn")) $("#installBtn").onclick = install;
    if ($("#mobileInstallBtn")) $("#mobileInstallBtn").onclick = install;
  }

  async function authAction(kind) {
    if (!state.supa) return alert("Cloud belum aktif di server. Isi SUPABASE_URL dan SUPABASE_ANON_KEY di Environment Variables Vercel sekali saja.");
    const email = $("#authEmail")?.value.trim(), password = $("#authPassword")?.value;
    if (!email || !password) return alert("Isi email dan password dulu.");

    const { data, error } = await state.supa.auth[kind]({ email, password });
    if (error) return alert(error.message);

    // Supabase kadang menyimpan session sedikit setelah response auth. Ambil session langsung
    // supaya badge sidebar tidak terlihat kontradiktif saat alert login muncul.
    let user = data?.session?.user || data?.user || null;
    if (!user) {
      const sessionRes = await state.supa.auth.getSession();
      user = sessionRes.data?.session?.user || null;
    }
    state.user = user;
    await loadData();
    if (state.user) await syncLocalToCloud({ silent: true });
    renderAll();

    if (kind === "signUp" && !state.user) {
      alert("Akun dibuat. Kalau email confirmation aktif, cek email dulu, lalu login lagi.");
    } else {
      alert(kind === "signUp" ? "Akun dibuat, login berhasil, dan data otomatis disinkronkan." : "Login berhasil. Data otomatis disinkronkan.");
      closeProfile();
    }
  }

  async function boot() {
    db = await openDB(); await loadSettings(); await loadPublicConfig(); await initSupabase(); await loadData(); bindEvents(); renderAll();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  boot().catch(err => { console.error(err); alert(`Aiyone gagal start: ${err.message}`); });
})();
