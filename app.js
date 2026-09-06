(() => {
  "use strict";

  const DB_NAME = "aiyone_cloud_v3_1";
  // v2 menambah store notes, note_links, dan focus_sessions. Menaikkan versi
  // wajib: onupgradeneeded hanya berjalan kalau nomornya naik, dan tanpa itu
  // pengguna lama tidak akan pernah punya store barunya.
  const DB_VERSION = 2;
  const STORES = [
    "materials", "flashcards", "quizzes", "review_logs", "teaching_sessions",
    "notes", "note_links", "focus_sessions",
    "settings"
  ];
  const dayMs = 86400000;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = (p = "id") => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const now = () => new Date().toISOString();
  const esc = (v = "") => String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // Logika murni yang diuji otomatis lewat `npm test`. Lihat lib/aiyone-core.js.
  const core = window.AiyoneCore;
  if (!core) {
    document.body.innerHTML = '<div style="padding:2rem;font:16px system-ui">Gagal memuat <code>lib/aiyone-core.js</code>. Muat ulang halaman atau clear cache.</div>';
    return;
  }

  /**
   * Ikon Heroicons. Lihat lib/aiyone-icons.js.
   *
   * `ikon()` dipakai di dalam template konten dinamis; `pasangIkon()` mengisi
   * elemen bermarkah data-icon di markup statis. Keduanya aman kalau modul
   * ikonnya gagal dimuat — hasilnya kosong, bukan error.
   */
  const ikon = (nama, size = 20, kelas = "") =>
    window.AiyoneIcons ? window.AiyoneIcons.svg(nama, { size, className: kelas }) : "";

  function pasangIkon(root = document) {
    if (!window.AiyoneIcons) return;
    $$("[data-icon]", root).forEach(el => {
      if (el.dataset.iconDone === "1") return;
      const size = Number(el.dataset.iconSize) || 20;
      el.innerHTML = window.AiyoneIcons.svg(el.dataset.icon, { size });
      el.dataset.iconDone = "1";
    });
  }

  let db;
  let state = {
    materials: [], flashcards: [], quizzes: [], logs: [], teaching: [],
    notes: [], noteLinks: [], focusSessions: [],
    user: null, supa: null, supabaseConfig: null, deferredInstall: null,
    settings: defaultSettings(), currentReview: 0, currentQuiz: null, currentFlash: null, currentSession: null, reviewStartedAt: 0,
    reviewSessionDone: 0, reviewSessionClosed: false, hiddenCloudMaterials: 0, migrationWarned: false,
    noteFilter: "", openNoteId: null, linkPickerFor: null, rankRange: "week",
    pomodoro: null, pomodoroTicker: 0
  };

  /* --------------------------------------------------------------------- *
   * Notifikasi & dialog
   *
   * Menggantikan alert()/confirm() bawaan browser: keduanya memblokir thread,
   * tidak bisa ditata, dan di PWA mobile terasa seperti error sistem.
   * --------------------------------------------------------------------- */

  function notify(message, kind = "info", timeout = 5200) {
    const host = $("#toastHost");
    const text = String(message || "").trim();
    if (!text) return;
    if (!host) { console[kind === "error" ? "error" : "log"](text); return; }
    const toast = document.createElement("div");
    toast.className = `toast toast-${kind}`;
    toast.textContent = text;
    const close = document.createElement("button");
    close.className = "toast-close";
    close.type = "button";
    close.setAttribute("aria-label", "Tutup notifikasi");
    close.textContent = "×";
    const dismiss = () => { toast.classList.add("leaving"); window.setTimeout(() => toast.remove(), 200); };
    close.onclick = dismiss;
    toast.appendChild(close);
    host.appendChild(toast);
    while (host.children.length > 4) host.firstElementChild.remove();
    if (timeout) window.setTimeout(dismiss, kind === "error" ? Math.max(timeout, 8000) : timeout);
  }

  let askResolver = null;
  function confirmDialog(message, options = {}) {
    const modal = $("#askModal");
    if (!modal) return Promise.resolve(window.confirm(message));
    const title = $("#askTitle"), body = $("#askMessage");
    const confirmBtn = $("#askConfirm"), cancelBtn = $("#askCancel");
    if (title) title.textContent = options.title || "Konfirmasi";
    if (body) body.textContent = message;
    if (confirmBtn) {
      confirmBtn.textContent = options.confirmText || "Lanjut";
      confirmBtn.className = options.danger ? "danger" : "primary";
    }
    if (cancelBtn) cancelBtn.textContent = options.cancelText || "Batal";
    openModal(modal, confirmBtn);
    return new Promise(resolve => { askResolver = resolve; });
  }

  function settleAsk(answer) {
    const resolve = askResolver;
    askResolver = null;
    closeModal($("#askModal"));
    if (resolve) resolve(answer);
  }

  /* --------------------------------------------------------------------- *
   * Manajemen fokus modal
   *
   * Tanpa ini pengguna keyboard/screen reader bisa "keluar" dari modal dengan
   * Tab dan berinteraksi dengan halaman yang tertutup di belakangnya.
   * --------------------------------------------------------------------- */

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const modalStack = [];

  function focusableIn(modal) {
    return $$(FOCUSABLE, modal).filter(el => el.offsetParent !== null || el === document.activeElement);
  }

  function openModal(modal, focusTarget) {
    if (!modal || modal.classList.contains("open")) return;
    modalStack.push({ modal, previousFocus: document.activeElement });
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    // Fokus dipindah langsung, bukan lewat requestAnimationFrame: rAF tidak
    // dijalankan ketika tab sedang di latar belakang, sehingga modal bisa
    // terbuka tanpa fokus sama sekali.
    const focusFirst = () => {
      const target = focusTarget || focusableIn(modal)[0];
      if (!target) return false;
      try { target.focus({ preventScroll: true }); } catch (_) { target.focus?.(); }
      return modal.contains(document.activeElement);
    };
    if (!focusFirst()) window.setTimeout(focusFirst, 60);
  }

  function closeModal(modal) {
    if (!modal || !modal.classList.contains("open")) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    const index = modalStack.findIndex(entry => entry.modal === modal);
    const entry = index >= 0 ? modalStack.splice(index, 1)[0] : null;
    if (!modalStack.length) document.body.classList.remove("modal-open");
    const previous = entry?.previousFocus;
    if (previous && document.contains(previous)) {
      try { previous.focus({ preventScroll: true }); } catch (_) { previous.focus?.(); }
    }
  }

  function topModal() {
    return modalStack.length ? modalStack[modalStack.length - 1].modal : null;
  }

  function handleModalTab(event) {
    const modal = topModal();
    if (!modal || event.key !== "Tab") return;
    const items = focusableIn(modal);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    else if (!modal.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
  }

  /* --------------------------------------------------------------------- *
   * Pembungkus aksi async
   *
   * Sebelumnya banyak handler `onclick` async yang melempar error tanpa
   * ditangkap: rating gagal tersimpan tapi pengguna tidak diberi tahu apa pun.
   * --------------------------------------------------------------------- */

  async function guard(task, context = "") {
    try { return await task(); }
    catch (err) {
      console.error(context || "Aksi gagal", err);
      const detail = err?.message || String(err);
      notify(context ? `${context}: ${detail}` : detail, "error");
      return null;
    }
  }

  /** Mengunci tombol selama proses berjalan, supaya klik ganda tidak memicu dua request AI. */
  async function withBusy(button, busyLabel, task) {
    if (!button) return task();
    if (button.disabled) return null;
    const originalLabel = button.textContent;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if (busyLabel) button.textContent = busyLabel;
    try { return await task(); }
    finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (busyLabel) button.textContent = originalLabel;
    }
  }

  function warnMigrationOnce(message) {
    if (state.migrationWarned) return;
    state.migrationWarned = true;
    notify(message || "Database cloud belum punya sebagian kolom baru. Jalankan SQL di MIGRASI_SUPABASE_AMAN.md agar statistik mastery akurat.", "warn", 12000);
  }

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
      lastStreakDate: "",
      // Pomodoro
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      pomodoroSound: true,
      pomodoroAutoBreak: true
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
      state.hiddenCloudMaterials = 0;
    } else {
      const [materials, flashcards, quizzes, logs, teaching, notes, noteLinks, focusSessions] = await Promise.all([
        getAll("materials"), getAll("flashcards"), getAll("quizzes"), getAll("review_logs"), getAll("teaching_sessions"),
        getAll("notes"), getAll("note_links"), getAll("focus_sessions")
      ]);
      state.materials = materials.filter(row => !row.user_id).sort(sortNewest);
      // Baris yang sudah ditandai milik akun cloud sengaja disembunyikan saat
      // logout, supaya data seseorang tidak muncul di perangkat bersama.
      // Jumlahnya dilaporkan lewat renderSync agar tidak terasa seperti hilang.
      state.hiddenCloudMaterials = materials.length - state.materials.length;
      const localMaterialIds = new Set(state.materials.map(row => row.id));
      state.flashcards = flashcards.filter(row => !row.user_id && localMaterialIds.has(row.material_id || row.materialId));
      state.quizzes = quizzes.filter(row => !row.user_id && localMaterialIds.has(row.material_id || row.materialId));
      state.logs = logs.filter(row => !row.user_id && localMaterialIds.has(row.material_id || row.materialId));
      state.teaching = teaching.filter(row => !row.user_id && localMaterialIds.has(row.material_id || row.materialId));
      // Catatan dan sesi fokus TIDAK disaring berdasarkan materi: keduanya
      // sengaja bisa berdiri sendiri tanpa materi induk.
      state.notes = notes.filter(row => !row.user_id).sort(sortNewest);
      const localNoteIds = new Set(state.notes.map(row => row.id));
      state.noteLinks = noteLinks.filter(row => !row.user_id && localNoteIds.has(row.from_note_id) && localNoteIds.has(row.to_note_id));
      state.focusSessions = focusSessions.filter(row => !row.user_id).sort(sortNewest);
    }
  }

  const CLOUD_PAGE_SIZE = 1000;
  const CLOUD_MAX_ROWS = 50000;

  /**
   * Mengambil seluruh baris tabel dengan paging.
   *
   * PostgREST memotong di 1000 baris secara diam-diam. Karena setiap jawaban
   * quiz menulis satu baris review_logs, batas itu tercapai dalam hitungan
   * minggu — dan analytics serta perhitungan mastery jadi salah tanpa error
   * apa pun. Urutan harus deterministik agar paging tidak melewat/mengulang.
   */
  async function fetchAllRows(table, userId, options = {}) {
    const rows = [];
    for (let from = 0; from < CLOUD_MAX_ROWS; from += CLOUD_PAGE_SIZE) {
      const { data, error } = await state.supa
        .from(table)
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + CLOUD_PAGE_SIZE - 1);
      if (error) {
        // Tabel v13 belum ada di database lama. Fitur terkait dimatikan
        // sementara, bukan menjatuhkan seluruh pemuatan data.
        if (options.optional) {
          console.warn(`${table} belum tersedia di cloud:`, error.message);
          warnMigrationOnce(`Tabel ${table} belum ada di cloud. Jalankan supabase/migrasi-v13.sql agar Catatan dan Fokus tersinkron.`);
          return rows;
        }
        throw new Error(`${table}: ${error.message}`);
      }
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < CLOUD_PAGE_SIZE) return rows;
    }
    console.warn(`${table}: melebihi ${CLOUD_MAX_ROWS} baris, sisanya tidak dimuat.`);
    notify(`Data ${table} sangat besar. Sebagian riwayat lama tidak dimuat demi kecepatan.`, "warn", 9000);
    return rows;
  }

  async function loadFromSupabase() {
    const userId = state.user.id;
    const [materials, flashcards, quizzes, logs, teaching, notes, noteLinks, focusSessions] = await Promise.all([
      fetchAllRows("materials", userId),
      fetchAllRows("flashcards", userId),
      fetchAllRows("quizzes", userId),
      fetchAllRows("review_logs", userId),
      fetchAllRows("teaching_sessions", userId),
      // Tabel v13. Database yang belum dimigrasi akan menolak; itu ditangani
      // di fetchAllRows supaya aplikasi tetap jalan tanpa fitur ini.
      fetchAllRows("notes", userId, { optional: true }),
      fetchAllRows("note_links", userId, { optional: true }),
      fetchAllRows("focus_sessions", userId, { optional: true })
    ]);
    state.materials = materials;
    state.flashcards = flashcards;
    state.quizzes = quizzes;
    state.logs = logs;
    state.teaching = teaching;
    state.notes = notes;
    state.noteLinks = noteLinks;
    state.focusSessions = focusSessions;
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
    renderSync(); renderProfile(); renderDashboard(); renderLibrary(); renderReview(); renderTeachOptions(); renderSessionOptions(); renderAnalytics(); renderNotes(); renderFocus(); fillSettings();
  }

  function scrollToTarget(target, behavior = "auto", pulse = false) {
    const el = typeof target === "string" ? $(target) : target;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const mode = reduceMotion ? "auto" : behavior;
    if (!el) { window.scrollTo({ top: 0, behavior: mode }); return; }
    el.scrollIntoView({ behavior: mode, block: "start", inline: "nearest" });
    if (pulse) {
      el.classList?.add("focus-pulse");
      window.setTimeout(() => el.classList?.remove("focus-pulse"), 650);
    }
  }

  /**
   * Peta layar → mode kognitif.
   *
   * Aturannya: tentukan MODE dulu, warna mengikuti. Coral untuk saat pengguna
   * sedang aktif mengerjakan, cream untuk membaca dan menganalisis, teal untuk
   * status dan capaian. Layar baru wajib didaftarkan di sini sebelum diberi
   * warna apa pun, supaya warnanya tidak jadi pilihan acak.
   */
  const SCREENS = {
    dashboard: { mode: "planning", eyebrow: "Ruang belajarmu", title: "Beranda" },
    session:   { mode: "learning", eyebrow: "Guided learning loop", title: "Belajar" },
    focus:     { mode: "status",   eyebrow: "Pomodoro", title: "Fokus" },
    notes:     { mode: "planning", eyebrow: "Zettelkasten", title: "Catatan" },
    analytics: { mode: "status",   eyebrow: "Capaian", title: "Progres" },
    library:   { mode: "planning", eyebrow: "Koleksi", title: "Library" },
    create:    { mode: "learning", eyebrow: "Concept extractor", title: "Materi Baru" },
    review:    { mode: "learning", eyebrow: "Retrieval practice", title: "Review" },
    teach:     { mode: "learning", eyebrow: "Rubric-based", title: "Teaching Mode" },
    settings:  { mode: "status",   eyebrow: "Konfigurasi", title: "Settings" },
  };

  function setView(id, options = {}) {
    $$(".view").forEach(v => v.classList.toggle("active", v.id === id));
    $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === id));

    const layar = SCREENS[id] || { mode: "planning", eyebrow: "Aiyone", title: "Aiyone" };
    const shell = $("#shell");
    if (shell) shell.dataset.mode = layar.mode;
    const setTeks = (sel, val) => { const el = $(sel); if (el) el.textContent = val; };
    setTeks("#pageTitle", layar.title);
    setTeks("#bandEyebrow", layar.eyebrow);
    // Baris bawah pita: sapaan di beranda, deskripsi singkat di layar lain.
    setTeks("#bandSub", id === "dashboard" ? sapaanHariIni() : (options.sub || ""));
    const sub = $("#bandSub");
    if (sub) sub.hidden = !sub.textContent;

    closeDrawer();
    if (id === "review") renderReview();
    if (id === "library") renderLibrary();
    if (id === "teach") renderTeachOptions();
    if (id === "session") { renderSessionOptions(); renderSession(); }
    if (id === "analytics") renderAnalytics();
    if (id === "notes") renderNotes();
    if (id === "focus") renderFocus();
    requestAnimationFrame(() => scrollToTarget(options.target || `#${id}`, options.behavior || (options.target ? "smooth" : "auto"), !!options.pulse));
  }

  function renderSync() {
    const badge = $("#syncBadge"), text = $("#syncText"), auth = $("#authStatus");
    if (isCloud()) {
      if (badge) { badge.textContent = "Cloud"; badge.className = "badge cloud"; }
      if (text) text.textContent = `Cloud aktif. Login sebagai ${state.user.email}.`;
      if (auth) auth.textContent = `Login sebagai ${state.user.email}. Data otomatis tersinkron.`;
    } else if (state.supa) {
      const hidden = state.hiddenCloudMaterials || 0;
      const note = hidden ? ` ${hidden} materi tersimpan di akun cloud-mu dan akan muncul lagi setelah login.` : "";
      if (badge) { badge.textContent = "Login"; badge.className = "badge local"; }
      if (text) text.textContent = `Cloud siap. Login dari tombol profil di kanan atas.${note}`;
      if (auth) auth.textContent = `Cloud siap. Silakan login untuk sinkron otomatis.${note}`;
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
    // Belum login: pakai ikon user, bukan tanda tanya.
    const inisial = $("#profileInitial");
    if (inisial) {
      if (initial === "?") inisial.innerHTML = ikon("user", 20);
      else inisial.textContent = initial;
    }
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

  function conceptKey(value = "") {
    return String(value).toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ");
  }

  function cardsForConcept(materialId, conceptName) {
    const key = conceptKey(conceptName);
    return materialCards(materialId).filter(card => {
      const cardConcept = conceptKey(card.concept || "");
      const cardText = conceptKey(`${card.front || ""} ${card.back || ""}`);
      return (cardConcept && (cardConcept === key || cardConcept.includes(key) || key.includes(cardConcept))) || (key && cardText.includes(key));
    });
  }

  function conceptMastery(material, concept) {
    const cards = cardsForConcept(material.id, concept.name);
    const ids = new Set(cards.map(card => card.id));
    const logs = state.logs.filter(log => log.card_id && ids.has(log.card_id));
    const targetKey = conceptKey(concept.name);
    const quizLogs = state.logs.filter(log => {
      if (log.material_id !== material.id || !String(log.rating || "").startsWith("quiz-answer:")) return false;
      const parts = String(log.rating).split(":");
      try { return conceptKey(decodeURIComponent(parts[3] || "")) === targetKey; } catch (_) { return false; }
    });
    const teachingSessions = state.teaching.filter(session => {
      if (session.material_id !== material.id) return false;
      const focus = conceptKey(session.result?._focus || session.focus || "");
      return focus && (focus === targetKey || focus.includes(targetKey) || targetKey.includes(focus));
    });
    const retention = cards.length ? cards.reduce((sum, card) => sum + cardRetention(card), 0) / cards.length : 0;
    const accuracy = logs.length ? logs.filter(log => log.correct).length / logs.length : 0;
    const repetitions = cards.reduce((sum, card) => sum + Number(card.repetitions || 0), 0);
    const repetitionScore = Math.min(1, repetitions / Math.max(cards.length * 3, 1));
    const hasFlashEvidence = logs.length > 0 || repetitions > 0;
    if (!hasFlashEvidence && !quizLogs.length && !teachingSessions.length) return { score: 0, status: "new", label: "Belum diuji", cards, reviews: 0, quizAttempts: 0, teachingAttempts: 0 };
    const modeWeight = { pretest: .35, practice: .7, posttest: 1 };
    const quizWeightTotal = quizLogs.reduce((sum, log) => sum + (modeWeight[log.quiz_mode] || .5), 0);
    const quizScore = quizWeightTotal ? quizLogs.reduce((sum, log) => sum + (log.correct ? (modeWeight[log.quiz_mode] || .5) : 0), 0) / quizWeightTotal : 0;
    const teachingScore = teachingSessions.length ? teachingSessions.reduce((sum, session) => sum + Number(session.result?.masteryScore || session.result?.mastery_score || 0), 0) / teachingSessions.length / 100 : 0;
    const evidence = [];
    if (hasFlashEvidence) evidence.push({ score: retention * .55 + accuracy * .3 + repetitionScore * .15, weight: .5 });
    if (quizLogs.length) evidence.push({ score: quizScore, weight: .3 });
    if (teachingSessions.length) evidence.push({ score: teachingScore, weight: .2 });
    const evidenceWeight = evidence.reduce((sum, item) => sum + item.weight, 0);
    const score = Math.round(clamp(evidence.reduce((sum, item) => sum + item.score * item.weight, 0) / Math.max(evidenceWeight, .01), 0, 1) * 100);
    const due = cards.some(card => new Date(cardDue(card)) <= new Date());
    const posttestLogs = quizLogs.filter(log => log.quiz_mode === "posttest");
    const posttestPassed = posttestLogs.length && (posttestLogs.filter(log => log.correct).length / posttestLogs.length) >= Number(state.settings.masteryThreshold || 70) / 100;
    const status = due || score < 45 ? "weak" : score < Number(state.settings.masteryThreshold || 70) || !posttestPassed ? "learning" : "mastered";
    const labels = { weak: "Perlu review", learning: "Sedang dipelajari", mastered: "Dikuasai" };
    return { score, status, label: labels[status], cards, reviews: logs.length, quizAttempts: quizLogs.length, teachingAttempts: teachingSessions.length };
  }

  function conceptMasteryList(material) {
    return (material?.concepts || []).map(concept => ({ concept, ...conceptMastery(material, concept) }))
      .sort((a, b) => a.score - b.score || Number(b.concept.importance === "high") - Number(a.concept.importance === "high"));
  }

  function adaptiveRecommendation(material) {
    const concepts = conceptMasteryList(material);
    const target = concepts.find(item => item.status !== "mastered") || concepts[0] || null;
    const due = materialCards(material.id).filter(card => new Date(cardDue(card)) <= new Date());
    if (due.length) return { type: "review", target, cards: target?.cards.filter(card => new Date(cardDue(card)) <= new Date()).length ? target.cards : due, reason: `${due.length} kartu sudah waktunya diulang` };
    if (target?.status === "new") return { type: "learn", target, cards: target.cards, reason: "Konsep ini belum pernah diuji" };
    if (target && target.score < Number(state.settings.masteryThreshold || 70)) return { type: "practice", target, cards: target.cards, reason: `Mastery konsep baru ${target.score}%` };
    return { type: "prove", target, cards: target?.cards || [], reason: "Saatnya membuktikan mastery dengan post-test" };
  }

  /** Sapaan + tanggal untuk baris bawah pita. */
  function sapaanHariIni() {
    const nama = state.user?.email ? state.user.email.split("@")[0] : "kamu";
    const tanggal = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
    return `Hai, ${nama} · ${tanggal}`;
  }

  function renderDashboard() {
    const due = dueCards();
    const concepts = state.materials.reduce((n,m) => n + (m.concepts?.length || 0), 0);
    // Penulisan dibuat aman terhadap elemen yang tidak ada: susunan dashboard
    // berubah antar versi, dan satu id yang hilang tidak boleh menjatuhkan
    // seluruh render sampai layar ikut kosong.
    const set = (sel, value) => { const el = $(sel); if (el) el.textContent = value; };
    set("#mMaterials", state.materials.length);
    set("#mConcepts", concepts);
    set("#mDue", due.length);
    set("#ovMaterials", state.materials.length);
    set("#ovConcepts", concepts);
    const streak = core.currentStreak(state.settings);
    set("#ovStreak", streak);
    const allConceptMastery = state.materials.flatMap(material => conceptMasteryList(material).map(item => item.score));
    const masteryAverage = allConceptMastery.length
      ? Math.round(allConceptMastery.reduce((sum, score) => sum + score, 0) / allConceptMastery.length)
      : 0;
    set("#masteryAverage", `${masteryAverage}%`);

    // Menit fokus Pomodoro adalah data sungguhan, jadi itu yang dipakai kalau
    // ada. Perkiraan dari waktu jawab review hanya cadangan untuk hari-hari
    // sebelum fitur Fokus dipakai — dan ditandai supaya tidak menyesatkan.
    const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
    const focusPerDay = focusMinutesByDay(7);
    const reviewPerDay = Array(7).fill(0);
    state.logs.forEach(log => {
      if (String(log.rating || "").startsWith("quiz-answer:")) return;
      const date = new Date(log.created_at || log.createdAt || 0);
      const daysAgo = Math.floor((endOfToday - date) / 86400000);
      if (daysAgo >= 0 && daysAgo < 7) reviewPerDay[6 - daysAgo] += Math.max(1, Math.round(Number(log.response_seconds || log.responseSeconds || 60) / 60));
    });
    const adaDataFokus = focusPerDay.some(m => m > 0);
    const activity = focusPerDay.map((menit, i) => menit || (adaDataFokus ? 0 : reviewPerDay[i]));
    const sumberLabel = $("#chartSource");
    if (sumberLabel) sumberLabel.textContent = adaDataFokus ? "dari sesi fokus" : "perkiraan dari review";
    renderProgressChart(activity, endOfToday);
    set("#weeklyTotal", `${activity.reduce((sum, value) => sum + value, 0)} menit`);

    // Salam dan tanggal di kepala dashboard.
    const nama = state.user?.email ? state.user.email.split("@")[0] : "kamu";
    // Sapaan ditulis ke pita lewat setView; di sini cukup menyegarkannya
    // kalau beranda sedang tampil.
    if ($("#dashboard")?.classList.contains("active")) set("#bandSub", sapaanHariIni());

    // Medali "Dikuasai" memakai jumlah konsep yang benar-benar lulus ambang.
    const dikuasai = state.materials.reduce((n, m) =>
      n + conceptMasteryList(m).filter(item => item.status === "mastered").length, 0);
    set("#ovMastered", dikuasai);

    const counts = { strong: 0, medium: 0, weak: 0 };
    state.flashcards.forEach(c => counts[memoryStatus(c)]++);
    const total = Math.max(state.flashcards.length, 1);
    setBar("Strong", counts.strong / total); setBar("Medium", counts.medium / total); setBar("Weak", counts.weak / total);

    const box = $("#todayActions");
    if (!box) { renderRecent(); return; }
    box.innerHTML = "";
    if (!state.materials.length) {
      set("#todayBadge", "Belum ada data"); box.className = "stack empty"; box.textContent = "Upload materi untuk memulai learning loop.";
    } else if (!due.length) {
      set("#todayBadge", "Aman"); box.className = "stack";
      const latest = state.materials[0];
      box.innerHTML = `<div class="daily-command"><b>Tidak ada review mendesak.</b><p class="muted">Gunakan waktu ini untuk sesi belajar terarah atau teaching mode pada materi terbaru.</p><div class="action-row wrap"><button class="pill-cta" id="dashStartSession">Mulai Sesi Belajar</button><button class="ghost" id="dashTeach">Teaching Mode</button></div></div>`;
      $("#dashStartSession")?.addEventListener("click", () => { if (latest) state.currentSession = { materialId: latest.id, step: 0, recall: {} }; setView("session", { target: "#sessionBox" }); });
      $("#dashTeach")?.addEventListener("click", () => setView("teach", { target: "#teach" }));
    } else {
      set("#todayBadge", `${due.length} kartu due`); box.className = "stack";
      const cmd = document.createElement("div"); cmd.className = "daily-command";
      cmd.innerHTML = `<b>${due.length} kartu perlu diulang hari ini.</b><p class="muted">Selesaikan review dulu sebelum tambah materi baru. Fokus utama: kartu dengan retensi rendah.</p><button class="pill-cta" id="dashReview">Mulai Review Hari Ini</button>`;
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
  function setBar(name, ratio) {
    const pct = Math.round(ratio * 100);
    const bar = $(`#bar${name}`), label = $(`#txt${name}`);
    if (bar) bar.style.width = `${pct}%`;
    if (label) label.textContent = `${pct}%`;
  }

  /**
   * Grafik garis untuk dashboard.
   *
   * Menggantikan diagram batang lama. Bentuknya mengikuti pola referensi:
   * satu kurva halus, gelembung hitam pada titik tertinggi, dan chip selisih
   * yang melayang di dekat kurva. SVG dipakai untuk kurvanya, sedangkan label
   * dan gelembung dirender sebagai HTML biasa supaya teksnya tetap tajam dan
   * ikut token warna tema.
   */
  function renderProgressChart(values, endOfToday) {
    const host = $("#progressChart");
    if (!host) return;

    const W = 300, H = 132, padX = 10, padTop = 26, padBottom = 22;
    const max = Math.max(...values, 1);
    const stepX = (W - padX * 2) / Math.max(values.length - 1, 1);
    const points = values.map((v, i) => ({
      x: padX + i * stepX,
      y: padTop + (1 - v / max) * (H - padTop - padBottom),
      v, i
    }));

    // Kurva Catmull-Rom diubah jadi kubik Bezier supaya lengkungannya halus
    // tanpa melewati batas nilai di titik ujung.
    const curve = points.map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const p0 = points[i - 2] || points[i - 1];
      const p1 = points[i - 1];
      const p2 = p;
      const p3 = points[i + 1] || p;
      const t = 0.22;
      const c1x = p1.x + (p2.x - p0.x) * t, c1y = p1.y + (p2.y - p0.y) * t;
      const c2x = p2.x - (p3.x - p1.x) * t, c2y = p2.y - (p3.y - p1.y) * t;
      return `C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }).join(" ");
    const area = `${curve} L ${points[points.length - 1].x} ${H - padBottom} L ${points[0].x} ${H - padBottom} Z`;

    const puncak = points.reduce((a, b) => (b.v >= a.v ? b : a), points[0]);
    const hariFormatter = new Intl.DateTimeFormat("id-ID", { weekday: "short" });
    const tanggalFormatter = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long" });
    const tanggalKe = i => new Date(endOfToday.getTime() - (values.length - 1 - i) * dayMs);

    // Chip selisih hanya ditampilkan kalau perubahannya berarti, dan titik
    // puncak dilewati supaya tidak bertabrakan dengan gelembung nilai.
    const chips = points
      .map((p, i) => ({ p, delta: i === 0 ? 0 : p.v - points[i - 1].v }))
      .filter(item => item.p !== puncak && Math.abs(item.delta) >= Math.max(3, max * 0.18))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 2);

    // Posisi horizontal dijepit supaya gelembung dan chip tidak menggantung
    // keluar dari tepi kartu saat titiknya ada di ujung.
    const persenX = n => `${clamp(n / W * 100, 13, 87).toFixed(2)}%`;
    const persenY = n => `${(n / H * 100).toFixed(2)}%`;

    // Kotak dalam ini HANYA membungkus SVG. Gelembung dan chip diposisikan
    // dengan persentase terhadap viewBox, jadi acuannya harus setinggi SVG —
    // kalau baris sumbu ikut masuk, semua overlay meleset ke bawah.
    host.innerHTML = `
      <div class="chart-box">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" class="fill-top" />
            <stop offset="100%" class="fill-bottom" />
          </linearGradient>
        </defs>
        <path class="chart-area" d="${area}" fill="url(#chartFill)" />
        <path class="chart-line" d="${curve}" fill="none" />
        <circle class="chart-dot" cx="${puncak.x}" cy="${puncak.y}" r="4.5" />
      </svg>
      <div class="chart-bubble" style="left:${persenX(puncak.x)};top:${persenY(puncak.y)}">
        ${puncak.v} m
      </div>
      ${chips.map(item => `<span class="delta-chip ${item.delta > 0 ? "up" : "down"}" style="left:${persenX(item.p.x)};top:${persenY(item.p.y)}">${item.delta > 0 ? "+" : ""}${item.delta}</span>`).join("")}
      </div>
      <div class="chart-axis">
        ${points.map((p, i) => `<span class="${i === points.length - 1 ? "now" : ""}">${i === points.length - 1 ? "Hari ini" : esc(hariFormatter.format(tanggalKe(i)))}</span>`).join("")}
      </div>`;

    host.setAttribute("aria-label",
      `Waktu belajar tujuh hari terakhir. ` +
      points.map((p, i) => `${tanggalFormatter.format(tanggalKe(i))}: ${p.v} menit`).join(", "));
  }

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
    el.querySelector(".quiz").onclick = () => startQuiz(m.id, "practice");
    el.querySelector(".del").onclick = () => guard(() => deleteMaterial(m.id), "Gagal menghapus materi");
    return el;
  }

  function showDetail(id) {
    const m = findMaterial(id); if (!m) return;
    const cards = materialCards(id), quizzes = quizPool(id), concepts = m.concepts || [];
    const conceptStates = conceptMasteryList(m);
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
          <button class="close-detail" id="closeDetail" aria-label="Tutup detail">${ikon("close", 18)}</button>
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
          <div class="concept-grid">${conceptStates.map(item => {
            const c = item.concept;
            return `<div class="concept-mini concept-state ${item.status}">
              <div class="concept-state-head"><b>${esc(c.name)}</b><span>${item.score}%</span></div>
              <div class="concept-meter"><i style="width:${item.score}%"></i></div>
              <small class="concept-status">${esc(item.label)} · ${item.reviews} review · ${item.quizAttempts || 0} kuis · ${item.teachingAttempts || 0} teaching</small>
              <p>${esc(c.definition || "")}</p>
              ${c.example ? `<small><b>Contoh:</b> ${esc(c.example)}</small>` : ""}
              ${c.sourceRef || c.source_ref ? `<small class="source-ref">Sumber: ${esc(c.sourceRef || c.source_ref)}</small>` : ""}
              <small class="muted"><b>Miskonsepsi:</b> ${esc(c.common_misconception || c.commonMisconception || "-")}</small>
              <button class="text-action note-from-concept" data-name="${esc(c.name)}">Buat catatan</button>
            </div>`;
          }).join("") || "<p class='muted'>Belum ada konsep.</p>"}</div>
        </section>

        <section class="detail-tab-panel" data-panel="flashcards">
          <div class="flashcard-guide-card">
            <div><h4>Flashcard itu bukan dibaca semuanya.</h4><p class="muted">Mode yang benar: lihat pertanyaan → jawab di kepala → buka jawaban → beri rating. Rating ini menentukan jadwal review berikutnya.</p></div>
            <button class="pill-cta" id="startFlashFromTab">Mulai Latihan Flashcard</button>
          </div>
          <div class="stack">${cards.slice(0,10).map((c, i) => `<div class="flash-preview"><span>${i+1}</span><div><b>${esc(c.front)}</b><p class="muted">Jawaban disembunyikan di mode latihan supaya kamu benar-benar mengingat.</p><small>Due: ${shortDate(cardDue(c))} • ${esc(c.difficulty || "medium")}</small><button class="text-action edit-card" data-id="${esc(c.id)}">Edit kartu</button></div></div>`).join("") || "<p class='muted'>Belum ada flashcard.</p>"}</div>
        </section>

        <section class="detail-tab-panel" data-panel="quiz">
          <div class="section-intro"><h4>Quiz Bertingkat</h4><p class="muted">Pre-test untuk diagnosis, quiz untuk latihan, post-test untuk bukti mastery.</p></div>
          <div class="quiz-mode-grid">
            <button class="quiz-mode-card" id="startPretestFromTab"><b>Pre-test</b><span>Kerjakan sebelum belajar. Tidak masalah jika salah.</span></button>
            <button class="quiz-mode-card" id="startQuizFromTab"><b>Practice Quiz</b><span>Latihan setelah membaca modul dan flashcard.</span></button>
            <button class="quiz-mode-card" id="startPosttestFromTab"><b>Post-test</b><span>Target mastery ${Number(state.settings.masteryThreshold || 70)}%.</span></button>
          </div>
          <div class="stack quiz-preview-list">${quizzes.slice(0,8).map(q => `<div class="flash-mini"><b>[${esc(q.level || "understanding")}] ${esc(q.question)}</b><p class="muted">${esc(q.explanation || "")}</p><button class="text-action edit-quiz" data-id="${esc(q.id)}">Edit soal</button></div>`).join("") || "<p class='muted'>Belum ada quiz.</p>"}</div>
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
    $$(".note-from-concept", p).forEach(button => button.onclick = () => guard(async () => {
      const konsep = (m.concepts || []).find(c => c.name === button.dataset.name);
      if (!konsep) return;
      const noteId = await createNote({
        title: konsep.name,
        // Definisi AI sengaja dijadikan bahan mentah, bukan isi final: catatan
        // Zettelkasten harus ditulis ulang dengan bahasa sendiri.
        body: `Tulis ulang dengan bahasamu sendiri:

${konsep.definition || ""}`,
        tags: [m.category || "Umum"],
        materialId: m.id,
        conceptName: konsep.name,
        sourceRef: konsep.sourceRef || konsep.source_ref || ""
      });
      notify("Catatan dibuat. Tulis ulang pakai bahasamu sendiri, jangan disalin.", "success", 8000);
      openNote(noteId);
    }, "Gagal membuat catatan"));
    $$(".edit-card", p).forEach(button => button.onclick = () => openContentEditor("card", button.dataset.id, id));
    $$(".edit-quiz", p).forEach(button => button.onclick = () => openContentEditor("quiz", button.dataset.id, id));
    $$(".detail-tab", p).forEach(btn => btn.onclick = () => switchDetailTab(p, btn.dataset.tab));
    setView("library", { target: "#detailPanel" });
  }

  function openContentEditor(type, itemId, materialId) {
    const item = type === "card" ? state.flashcards.find(row => row.id === itemId) : state.quizzes.find(row => row.id === itemId);
    if (!item) return;
    const modal = $("#quizModal"), panel = $("#quizModalCard");
    if (type === "card") {
      panel.innerHTML = `<div class="content-editor">
        <div class="quiz-topline"><div><span class="badge soft">Editor</span><h3>Edit flashcard</h3></div><button class="quiz-close" id="editorClose" aria-label="Tutup editor">${ikon("close", 18)}</button></div>
        <label>Konsep<input id="editConcept" value="${esc(item.concept || "")}"></label>
        <label>Pertanyaan<textarea id="editFront" rows="3">${esc(item.front || "")}</textarea></label>
        <label>Jawaban<textarea id="editBack" rows="5">${esc(item.back || "")}</textarea></label>
        <label>Kesulitan<select id="editDifficulty"><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
        <div class="action-row wrap"><button class="pill-cta" id="editorSave">Simpan perubahan</button><button class="danger" id="editorDelete">Hapus kartu</button></div>
      </div>`;
      $("#editDifficulty", panel).value = item.difficulty || "medium";
    } else {
      panel.innerHTML = `<div class="content-editor">
        <div class="quiz-topline"><div><span class="badge soft">Editor</span><h3>Edit soal</h3></div><button class="ghost small" id="editorClose">×</button></div>
        <label>Konsep<input id="editConcept" value="${esc(item.concept || "")}"></label>
        <label>Pertanyaan<textarea id="editQuestion" rows="3">${esc(item.question || "")}</textarea></label>
        <label>Opsi, satu per baris<textarea id="editOptions" rows="6">${esc((item.options || []).join("\n"))}</textarea></label>
        <label>Nomor jawaban benar<select id="editAnswer">${(item.options || []).map((_, i) => `<option value="${i}">Opsi ${i + 1}</option>`).join("")}</select></label>
        <label>Penjelasan<textarea id="editExplanation" rows="4">${esc(item.explanation || "")}</textarea></label>
        <div class="action-row wrap"><button class="pill-cta" id="editorSave">Simpan perubahan</button><button class="danger" id="editorDelete">Hapus soal</button></div>
      </div>`;
      $("#editAnswer", panel).value = String(item.answer_index || 0);
    }
    openModal(modal, $("#editorSave", panel));
    $("#editorClose", panel).onclick = closeQuizModal;
    $("#editorSave", panel).onclick = () => guard(async () => {
      let updated;
      if (type === "card") {
        const front = $("#editFront", panel).value.trim(), back = $("#editBack", panel).value.trim();
        if (!front || !back) { notify("Pertanyaan dan jawaban wajib diisi.", "warn"); return; }
        updated = { ...item, concept: $("#editConcept", panel).value.trim(), front, back, difficulty: $("#editDifficulty", panel).value, updated_at: now() };
      } else {
        const question = $("#editQuestion", panel).value.trim();
        const options = $("#editOptions", panel).value.split("\n").map(value => value.trim()).filter(Boolean);
        const answerIndex = Number($("#editAnswer", panel).value);
        if (!question || options.length < 2 || answerIndex >= options.length) { notify("Soal harus memiliki minimal dua opsi dan jawaban benar yang valid.", "warn"); return; }
        updated = { ...item, concept: $("#editConcept", panel).value.trim(), question, options, answer_index: answerIndex, explanation: $("#editExplanation", panel).value.trim(), updated_at: now() };
      }
      if (isCloud()) {
        const table = type === "card" ? "flashcards" : "quizzes";
        const { error } = await state.supa.from(table).update(updated).eq("id", item.id);
        if (error) { notify(`Gagal menyimpan: ${error.message}`, "error"); return; }
      } else await put(type === "card" ? "flashcards" : "quizzes", updated);
      closeQuizModal();
      await refreshAll();
      showDetail(materialId);
      notify("Perubahan tersimpan.", "success");
    }, "Gagal menyimpan perubahan");
    $("#editorDelete", panel).onclick = () => guard(async () => {
      const label = type === "card" ? "flashcard" : "soal";
      if (!await confirmDialog(`Hapus ${label} ini? Tindakan ini tidak bisa dibatalkan.`, { title: `Hapus ${label}`, confirmText: "Hapus", danger: true })) return;
      const table = type === "card" ? "flashcards" : "quizzes";
      if (isCloud()) {
        const { error } = await state.supa.from(table).delete().eq("id", item.id);
        if (error) { notify(`Gagal menghapus: ${error.message}`, "error"); return; }
      } else await del(table, item.id);
      closeQuizModal();
      await refreshAll();
      showDetail(materialId);
      notify("Item dihapus.", "success");
    }, "Gagal menghapus");
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
    return `<div class="study-sections">${list.map((s, i) => `<article class="study-section"><div class="step-no">${i+1}</div><div><h5>${esc(s.title || `Bagian ${i+1}`)}</h5>${s.sourceRef || s.source_ref ? `<span class="source-ref">Sumber: ${esc(s.sourceRef || s.source_ref)}</span>` : ""}<div class="prose-block">${htmlParagraphs(s.explanation || s.content || "-")}</div>${s.example ? `<p class="example"><b>Contoh:</b> ${esc(s.example)}</p>` : ""}${s.activeRecall || s.active_recall ? `<p class="recall"><b>Active recall:</b> ${esc(s.activeRecall || s.active_recall)}</p>` : ""}</div></article>`).join("")}</div>`;
  }

  // Pemecahan paragraf dipindah ke core: regex lama memakai lookbehind `(?<=\.)`
  // yang tidak didukung Safari di bawah 16.4 — di iPhone lama seluruh app.js
  // gagal di-parse dan aplikasi jadi layar kosong.
  function htmlParagraphs(text = "") {
    const parts = core.splitParagraphs(text);
    if (!parts.length) return "<p>-</p>";
    return parts.map(p => `<p>${esc(p)}</p>`).join("");
  }

  function parsePageRange(value, totalPages) {
    const clean = String(value || "").trim();
    if (!clean) return Array.from({ length: Math.min(totalPages, 200) }, (_, i) => i + 1);
    const pages = new Set();
    for (const part of clean.split(",")) {
      const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) throw new Error(`Rentang halaman tidak valid: ${part}`);
      const start = Number(match[1]), end = Number(match[2] || match[1]);
      if (start < 1 || end < start || end > totalPages) throw new Error(`Halaman harus berada antara 1-${totalPages}.`);
      for (let page = start; page <= end; page++) pages.add(page);
    }
    if (pages.size > 200) throw new Error("Maksimal 200 halaman per proses.");
    return [...pages].sort((a, b) => a - b);
  }

  async function extractPdf(file, range = "") {
    if (!window.pdfjsLib) throw new Error("pdf.js belum terload. Coba cek internet/CDN.");
    if (file.size > 50 * 1024 * 1024) throw new Error("PDF maksimal 50 MB.");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const selectedPages = parsePageRange(range, pdf.numPages);
    let text = "";
    let lowTextPages = 0;
    for (const i of selectedPages) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(it => it.str).join(" ").replace(/\s+/g, " ").trim();
      if (pageText.length < 30) lowTextPages += 1;
      text += `\n\n--- Halaman ${i} ---\n${pageText}`;
    }
    if (!text.replace(/--- Halaman \d+ ---/g, "").trim() || lowTextPages === selectedPages.length) throw new Error("PDF tampaknya berupa scan/gambar. OCR diperlukan sebelum diproses.");
    return { text: text.trim(), pages: selectedPages.length, lowTextPages, totalPages: pdf.numPages };
  }

  async function generateMaterial() {
    const text = $("#textInput").value.trim();
    if (text.length < 80) { notify("Materi terlalu pendek. Tempel minimal beberapa paragraf dulu.", "warn"); return; }
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
      console.error(err);
      setStatus(`Gagal generate AI: ${err.message}\n\nSolusi cepat: cek .env / Vercel Environment Variables, coba model lain, atau simpan tanpa AI.`);
      notify(`Generate gagal: ${err.message}`, "error");
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
        activeRecall: String(x.activeRecall || x.active_recall || x.question || "").slice(0, 400),
        sourceRef: String(x.sourceRef || x.source_ref || "").slice(0, 120)
      })).filter(x => x.title || x.explanation);
    }
    return splitIntoSections(summary);
  }

  function splitIntoSections(text = "") {
    return core.splitParagraphs(text)
      .slice(0, 6)
      .map((p, i) => ({ title: `Bagian ${i + 1}`, explanation: p, example: "", activeRecall: "Apa inti dari bagian ini?" }));
  }

  function normalizeConcepts(list = []) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 12).map(c => ({
      id: c.id || uid("concept"),
      name: String(c.name || c.concept || "Konsep").slice(0, 100),
      definition: String(c.definition || c.explanation || "").slice(0, 600),
      example: String(c.example || "").slice(0, 400),
      common_misconception: String(c.common_misconception || c.commonMisconception || c.misconception || "").slice(0, 400),
      importance: String(c.importance || "medium"),
      sourceRef: String(c.sourceRef || c.source_ref || "").slice(0, 120)
    }));
  }
  function normalizeCards(list = [], m) {
    if (!Array.isArray(list) || !list.length) {
      return (m.concepts || []).slice(0, 8).map(c => ({ concept: c.name, front: `Jelaskan konsep ${c.name}`, back: c.definition, difficulty: "medium" }));
    }
    return list.slice(0, 24).filter(c => c.front || c.question).map(c => ({ concept: c.concept || "", front: String(c.front || c.question).slice(0, 260), back: String(c.back || c.answer).slice(0, 900), difficulty: c.difficulty || "medium" }));
  }
  /**
   * Normalisasi soal dari AI.
   *
   * Logikanya ada di lib/aiyone-core.js karena ini titik paling rawan: dulu
   * opsi di-dedup dan dipotong ke 4 SEBELUM indeks jawaban diresolusi, sehingga
   * `answer_index` menunjuk ke opsi yang salah dan pengguna dinilai keliru
   * padahal jawabannya benar. Sekarang teks jawaban diresolusi lebih dulu,
   * baru opsi dibersihkan dan diacak, lalu indeksnya dihitung ulang.
   */
  function normalizeQuizzes(list = [], m) {
    if (!Array.isArray(list) || !list.length) return fallbackQuizzesFromMaterial(m);
    const normalized = core.normalizeQuizList(list, { max: 20 });
    return normalized.length >= 5 ? normalized : [...normalized, ...fallbackQuizzesFromMaterial(m)].slice(0, 12);
  }

  /**
   * Soal cadangan saat AI tidak menghasilkan quiz yang layak.
   *
   * Opsinya wajib diacak: sebelumnya jawaban benar selalu ditaruh di posisi
   * pertama, jadi pengguna bisa lulus post-test hanya dengan selalu memilih A.
   */
  function fallbackQuizzesFromMaterial(m) {
    const concepts = Array.isArray(m?.concepts) ? m.concepts : [];
    return concepts.slice(0, 8).map((c, i) => {
      const name = c.name || "konsep ini";
      const answer = String(c.definition || `Penjelasan utama tentang ${name}`).slice(0, 180);
      const rawOptions = [
        answer,
        String(c.common_misconception || "Pernyataan yang terdengar benar tetapi keliru").slice(0, 180),
        String(c.example ? `Contoh terpisah: ${c.example}` : "Contoh yang tidak terkait langsung").slice(0, 180),
        "Pernyataan umum yang tidak menjelaskan konsep ini"
      ];
      const built = core.buildQuizOptions(rawOptions, answer);
      return {
        concept: c.name || "Konsep",
        level: i % 2 ? "understanding" : "definition",
        question: `Apa inti dari konsep “${name}”?`,
        options: built.options,
        answer_index: built.answerIndex,
        explanation: "Konsep ini perlu dipahami lewat definisi, contoh, dan batasan penggunaannya."
      };
    });
  }

  async function saveManual() {
    const text = $("#textInput").value.trim();
    if (!text) { notify("Isi teks materi dulu.", "warn"); return; }
    const materialId = await saveLearningPack(text, $("#titleInput").value.trim(), $("#categoryInput").value.trim(), { title: $("#titleInput").value.trim() || "Materi Manual", category: $("#categoryInput").value.trim() || "Umum", summaryShort: text.slice(0, 180), concepts: [], flashcards: [], quizzes: [] });
    await refreshAll(); state.currentSession = { materialId, step: 0, recall: {} }; setView("session", { target: "#sessionBox" });
  }

  async function callAI(type, payload) {
    const body = { type, provider: state.settings.provider, model: modelForProvider(), payload };
    const headers = { "Content-Type": "application/json" };
    if (state.supa) {
      const { data } = await state.supa.auth.getSession();
      if (data?.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
    }
    const res = await fetch("/api/generate", { method: "POST", headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    if (!data?.result) throw new Error("Server tidak mengembalikan result.");
    if (Array.isArray(data.warnings) && data.warnings.length) console.warn("Peringatan kualitas AI:", data.warnings);
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
      // Penghitung sengaja TIDAK direset di sini: renderReview dipanggil dua
      // kali per siklus (refreshAll + setView), jadi reset langsung akan
      // menghapus jumlahnya sebelum sempat ditampilkan.
      const done = state.reviewSessionDone || 0;
      state.reviewSessionClosed = true;
      state.currentReview = 0;
      box.className = "review empty review-empty-v7";
      box.innerHTML = done
        ? `<h3>Review hari ini selesai.</h3><p>${done} kartu sudah kamu kerjakan. Kartu berikutnya akan muncul sesuai jadwal lupa masing-masing.</p>`
        : state.flashcards.length
          ? `<h3>Tidak ada review mendesak.</h3><p>Semua kartu masih aman. Kamu bisa lanjut belajar materi baru atau latihan flashcard manual dari Library.</p>`
          : `<h3>Belum ada flashcard.</h3><p>Upload materi dulu, lalu Aiyone akan membuat kartu review untukmu.</p>`;
      return;
    }
    box.className = "review review-v7";
    // Sesi baru dimulai: penghitung dari sesi sebelumnya yang sudah tuntas
    // baru dinolkan di sini.
    if (state.reviewSessionClosed) { state.reviewSessionDone = 0; state.reviewSessionClosed = false; }
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
      <div class="review-meta-line"><span>${(state.reviewSessionDone || 0) + 1}/${(state.reviewSessionDone || 0) + cards.length}</span><span>Retensi ±${ret}%</span><span>Stability ${Number(c.stability || c.interval_days || 1).toFixed(1)} hari</span></div>
      <span class="badge soft material-pill">${esc(materialTitle(m || {}))}</span>
      <div class="review-question">${esc(c.front)}</div>
      <button class="pill-cta reveal-answer" id="showAns">Saya sudah menjawab, tampilkan jawaban</button>
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
        <button class="pill-cta" data-rate="good"><b>Paham</b><span>jadwal normal</span></button>
        <button class="pill-cta" data-rate="easy"><b>Mudah</b><span>jarak review lebih jauh</span></button>
      </div>`;
    box.appendChild(div);
    $("#showAns").onclick = () => { $("#answerBox").hidden = false; $("#rateBtns").hidden = false; $("#reviewMeta").hidden = false; scrollToTarget("#answerBox"); };
    $$('[data-rate]', div).forEach(btn => btn.onclick = () => {
      const meta = {
        confidence: Number($("#confidenceSelect")?.value || 3),
        responseSeconds: Math.max(1, Math.round((Date.now() - state.reviewStartedAt) / 1000)),
        retentionBefore: cardRetention(c)
      };
      // Semua tombol rating dikunci supaya ketukan ganda tidak menilai dua kali.
      $$('[data-rate]', div).forEach(other => { other.disabled = true; });
      guard(() => reviewCard(c, btn.dataset.rate, meta), "Gagal menyimpan review")
        .then(saved => { if (saved === null) $$('[data-rate]', div).forEach(other => { other.disabled = false; }); });
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
    // Indeks TIDAK dinaikkan: kartu yang baru dinilai keluar dari daftar due,
    // jadi kartu berikutnya otomatis menempati posisi yang sama. Menaikkan
    // indeks membuat urutan review melompat-lompat seperti pada versi lama.
    state.reviewSessionDone = (state.reviewSessionDone || 0) + 1;
    await refreshAll();
    setView("review", { target: "#reviewBox" });
    return true;
  }

  // Kolom yang baru ada sejak migrasi v6. Kalau database belum dimigrasi,
  // kolom dibuang SATU PER SATU sesuai pesan error — bukan diborong semua.
  // Versi lama langsung membuang `score` dan `quiz_mode`, padahal keduanya
  // dipakai conceptMastery(), sehingga mastery jadi salah tanpa gejala.
  const REVIEW_LOG_OPTIONAL_COLUMNS = ["retention_before", "confidence", "response_seconds", "score", "quiz_mode"];

  async function insertReviewLogs(logs) {
    const rows = (Array.isArray(logs) ? logs : [logs]).filter(Boolean);
    if (!rows.length) return;
    if (!isCloud()) {
      for (const row of rows) await put("review_logs", row);
      return;
    }
    let payload = rows.map(row => ({ ...row }));
    for (let attempt = 0; attempt <= REVIEW_LOG_OPTIONAL_COLUMNS.length; attempt++) {
      const { error } = await state.supa.from("review_logs").insert(payload);
      if (!error) return;
      const message = String(error.message || error.details || "");
      const missing = REVIEW_LOG_OPTIONAL_COLUMNS.find(column => message.includes(column) && column in payload[0]);
      if (!missing) throw new Error(error.message || "Gagal menyimpan log review.");
      console.warn(`Kolom review_logs.${missing} belum ada di database.`);
      warnMigrationOnce();
      payload = payload.map(row => { const copy = { ...row }; delete copy[missing]; return copy; });
    }
    throw new Error("Gagal menyimpan log review setelah beberapa percobaan.");
  }

  const insertReviewLog = log => insertReviewLogs([log]);

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
    // Lantai interval per rating. Tanpa ini, kartu baru yang dijawab "Paham"
    // jatuh tempo ~7 jam kemudian, sehingga review terasa tidak pernah selesai
    // dalam satu hari. "Lupa" tetap sengaja muncul lagi dalam hitungan menit.
    const minInterval = rating === "again" ? 10 / 1440
      : rating === "hard" ? 0.5
      : 1;
    const interval = Math.max(minInterval, -stability * Math.log(target));
    const due = new Date(Date.now() + interval * dayMs).toISOString();
    return { ease, repetitions: reps, interval_days: interval, stability, memory_difficulty: difficulty, lapses, due_at: due, last_reviewed_at: now(), last_confidence: confidence, last_response_seconds: seconds, updated_at: now() };
  }

  /**
   * Streak sekarang benar-benar bisa putus.
   *
   * Versi lama hanya pernah menambah dan memakai tanggal UTC, jadi setelah
   * bolong tiga minggu angkanya tetap lanjut naik — dan di WIB "hari baru"
   * dimulai pukul 07:00. Aturan barunya ada di lib/aiyone-core.js dan diuji.
   */
  async function updateSmartStreak(ratingOrScore) {
    const score = typeof ratingOrScore === "number" ? ratingOrScore : (["good","easy"].includes(ratingOrScore) ? 100 : ratingOrScore === "hard" ? 70 : 0);
    const next = core.streakAfterActivity(state.settings, score, Number(state.settings.masteryThreshold || 70));
    if (!next) return;
    state.settings.streak = next.streak;
    state.settings.lastStreakDate = next.lastStreakDate;
    await saveSettings();
  }

  /**
   * Kumpulan soal untuk satu materi: yang tersimpan, ditambah soal turunan dari
   * flashcard kalau jumlahnya kurang.
   *
   * Dua perbaikan penting di sini:
   * 1. ID soal turunan sekarang deterministik (`auto_<id kartu>`). Dulu memakai
   *    uid() acak setiap panggilan, sehingga penyaring "soal yang belum pernah
   *    keluar" di post-test tidak pernah menemukan kecocokan dan post-test bisa
   *    mengulang soal latihan yang sama.
   * 2. Opsi diacak dan indeks jawabannya dihitung ulang, bukan selalu nol.
   */
  function quizPool(materialId) {
    const existing = materialQuizzes(materialId).filter(q => q.question && Array.isArray(q.options) && q.options.length >= 2);
    if (existing.length >= 5) return existing;
    const m = findMaterial(materialId) || {};
    const cards = materialCards(materialId).filter(c => c.front && c.back);
    const generated = cards.slice(0, Math.max(0, 10 - existing.length)).map((c, i) => {
      const answer = String(c.back).slice(0, 220);
      const distractors = cards
        .filter(other => other.id !== c.id && other.back && String(other.back).trim() !== String(c.back).trim())
        .map(other => String(other.back).slice(0, 220));
      const rawOptions = [answer, ...core.shuffle(distractors).slice(0, 3)];
      while (rawOptions.length < 4) {
        rawOptions.push(rawOptions.length % 2
          ? "Konsep berbeda yang tidak menjawab pertanyaan"
          : "Jawaban terlalu umum dan tidak spesifik");
      }
      const built = core.buildQuizOptions(rawOptions, answer);
      return {
        id: `auto_${c.id}`,
        material_id: materialId,
        concept: c.concept || "",
        level: i % 3 === 0 ? "application" : "understanding",
        question: c.front,
        options: built.options,
        answer_index: built.answerIndex,
        explanation: c.back
      };
    });
    if (!generated.length && Array.isArray(m.concepts)) generated.push(...fallbackQuizzesFromMaterial(m));
    return [...existing, ...generated].slice(0, 12);
  }

  function quizIdentity(quiz) {
    return String(quiz.id || conceptKey(quiz.question || "").slice(0, 80));
  }

  function spreadByConcept(quizzes, limit, preferredLevels = []) {
    const ranked = [...quizzes].sort((a, b) => {
      const ai = preferredLevels.indexOf(a.level);
      const bi = preferredLevels.indexOf(b.level);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    const selected = [], seenConcepts = new Set();
    for (const quiz of ranked) {
      const key = conceptKey(quiz.concept || quiz.question);
      if (!seenConcepts.has(key)) { selected.push(quiz); seenConcepts.add(key); }
      if (selected.length >= limit) return selected;
    }
    for (const quiz of ranked) {
      if (!selected.includes(quiz)) selected.push(quiz);
      if (selected.length >= limit) break;
    }
    return selected;
  }

  function quizzesForMode(materialId, mode) {
    const pool = quizPool(materialId);
    if (mode === "pretest") return spreadByConcept(shuffle(pool), Math.min(8, pool.length), ["definition", "understanding"]);
    if (mode === "practice") {
      const material = findMaterial(materialId);
      const weak = new Set(conceptMasteryList(material).filter(item => item.status !== "mastered").map(item => conceptKey(item.concept.name)));
      const prioritized = [...pool].sort((a, b) => Number(weak.has(conceptKey(b.concept))) - Number(weak.has(conceptKey(a.concept))));
      return spreadByConcept(prioritized, Math.min(10, pool.length), ["understanding", "application", "analysis"]);
    }
    const seenInLearning = new Set(state.logs.filter(log => log.material_id === materialId && /^quiz-answer:(pretest|practice):/.test(log.rating || "")).map(log => String(log.rating).split(":")[2]));
    const unseen = pool.filter(quiz => !seenInLearning.has(encodeURIComponent(quizIdentity(quiz))));
    const candidates = unseen.length >= Math.min(5, pool.length) ? unseen : pool;
    return spreadByConcept(shuffle(candidates), Math.min(12, candidates.length), ["analysis", "application", "understanding"]);
  }

  function startQuiz(materialId, mode = "practice") {
    const quizzes = quizzesForMode(materialId, mode);
    if (!quizzes.length) { notify("Belum ada quiz untuk materi ini.", "warn"); return; }
    state.currentQuiz = { materialId, mode, quizzes, index: 0, correct: 0, answered: false, mistakes: [], answers: [], startedAt: Date.now() };
    showQuiz();
  }

  // Fisher-Yates dari core: sort berbasis Math.random() punya bias distribusi.
  function shuffle(list) { return core.shuffle(list); }

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

  function quizConceptSummary(answers = []) {
    const groups = new Map();
    answers.forEach(answer => {
      const name = answer.concept || "Umum";
      if (!groups.has(name)) groups.set(name, { name, correct: 0, total: 0 });
      const group = groups.get(name);
      group.total += 1;
      if (answer.correct) group.correct += 1;
    });
    return [...groups.values()].map(group => ({ ...group, score: Math.round(group.correct / group.total * 100) })).sort((a, b) => a.score - b.score);
  }

  function showQuiz() {
    const qstate = state.currentQuiz; if (!qstate) return;
    const q = qstate.quizzes[qstate.index];
    const modal = $("#quizModal");
    const p = $("#quizModalCard");
    const progress = Math.round(((qstate.index + 1) / qstate.quizzes.length) * 100);
    const info = quizInstruction(qstate.mode);
    p.innerHTML = `
      <div class="quiz-shell quiz-v7-shell">
        <div class="quiz-topline">
          <div><span class="badge soft">${esc(quizModeLabel(qstate.mode))}</span><h3>Soal ${qstate.index + 1} dari ${qstate.quizzes.length}</h3></div>
          <button class="quiz-close" id="closeQuiz" aria-label="Tutup quiz">${ikon("close", 18)}</button>
        </div>
        <div class="mode-brief quiz-brief"><b>${esc(info.title)}</b><p>${esc(info.text)}</p></div>
        <div class="quiz-progress-wrap"><div class="quiz-progress"><i style="width:${progress}%"></i></div><span>${progress}%</span></div>
        <p class="muted quiz-level">Level: ${esc(q.level || "understanding")}</p>
        <h4 class="quiz-question">${esc(q.question)}</h4>
        <div id="quizOptions" class="quiz-options">${q.options.map((o,i) => `<button class="quiz-option" data-i="${i}"><span>${String.fromCharCode(65+i)}</span><b>${esc(o)}</b></button>`).join("")}</div>
        <div id="quizExplain" class="quiz-feedback" hidden></div>
        <div class="action-row wrap quiz-actions"><button class="pill-cta" id="quizNext" hidden>${qstate.index + 1 >= qstate.quizzes.length ? "Lihat hasil" : "Lanjut ke soal berikutnya"}</button></div>
      </div>`;
    openModal(modal, $(".quiz-option", p));
    $("#closeQuiz", p).onclick = () => closeQuizModal();
    $$(".quiz-option", p).forEach(btn => btn.onclick = () => answerQuiz(btn, q, qstate, p));
  }

  function answerQuiz(btn, q, qstate, panel) {
    if (qstate.answered) return;
    qstate.answered = true;
    const chosen = Number(btn.dataset.i), answer = Number(q.answer_index || 0);
    const correct = chosen === answer;
    const answerRecord = { quizId: quizIdentity(q), concept: q.concept || "Umum", level: q.level || "understanding", correct, chosen, answer };
    qstate.answers.push(answerRecord);
    if (correct) qstate.correct += 1; else qstate.mistakes.push({ quizId: answerRecord.quizId, concept: answerRecord.concept, question: q.question, chosen: q.options[chosen], correct: q.options[answer], explanation: q.explanation || "" });
    $$(".quiz-option", panel).forEach((b, i) => {
      b.disabled = true;
      if (qstate.mode === "practice") b.classList.add(i === answer ? "correct" : i === chosen ? "wrong" : "dimmed");
      else b.classList.add(i === chosen ? "selected" : "dimmed");
    });
    const exp = $("#quizExplain", panel);
    exp.hidden = false;
    exp.innerHTML = qstate.mode === "practice"
      ? `<b>${correct ? "Benar." : "Belum tepat."}</b><p>${esc(q.explanation || "Cek kembali konsepnya dari materi dan flashcard.")}</p>`
      : `<b>Jawaban disimpan.</b><p>Pembahasan dan hasil ditampilkan setelah seluruh ${qstate.mode === "pretest" ? "diagnosis" : "post-test"} selesai.</p>`;
    const next = $("#quizNext", panel);
    next.hidden = false;
    next.onclick = () => withBusy(next, null, () => guard(async () => {
      qstate.index += 1;
      qstate.answered = false;
      if (qstate.index >= qstate.quizzes.length) {
        const score = Math.round(qstate.correct / qstate.quizzes.length * 100);
        await applyQuizResults(qstate.materialId, score, qstate.mistakes, qstate.mode, qstate.startedAt, qstate.answers);
        await updateSmartStreak(score);
        const conceptResults = quizConceptSummary(qstate.answers);
        const conceptResultsHtml = `<div class="concept-result-list"><h4>Hasil per konsep</h4>${conceptResults.map(item => `<div><span>${esc(item.name)}</span><i><em style="width:${item.score}%"></em></i><b>${item.score}%</b></div>`).join("")}</div>`;
        const mistakesHtml = qstate.mistakes.length ? `<div class="mistake-list"><h4>Soal yang perlu diulang</h4>${qstate.mistakes.map((x, i) => `<div class="flash-mini"><b>${i+1}. ${esc(x.question)}</b><p><b>Jawaban benar:</b> ${esc(x.correct)}</p><p class="muted">${esc(x.explanation || "Cek konsep terkait dari materi.")}</p></div>`).join("")}</div>` : `<p class="muted">Tidak ada soal salah. Coba teaching mode untuk memastikan kamu bisa menjelaskan ulang.</p>`;
        panel.innerHTML = `<div class="quiz-result quiz-result-v7"><span class="badge ${score >= Number(state.settings.masteryThreshold || 70) ? "cloud" : "local"}">${score >= Number(state.settings.masteryThreshold || 70) ? "Lulus mastery" : "Perlu review"}</span><h3>Hasil ${esc(quizModeLabel(qstate.mode))}</h3><div class="score-hero"><strong>${score}%</strong><span>${qstate.correct}/${qstate.quizzes.length} benar</span></div><p class="muted">${qstate.mode === "pretest" ? "Ini diagnosis awal dan belum menjadi bukti mastery." : qstate.mode === "posttest" ? "Post-test menjadi bukti mastery. Konsep yang belum lulus akan masuk sesi adaptif." : "Quiz latihan selesai. Konsep yang salah akan diprioritaskan untuk review."}</p>${conceptResultsHtml}${mistakesHtml}<div class="action-row wrap"><button class="pill-cta" id="retryWrong">Latihan konsep salah</button><button class="ghost" id="goFlashAfterQuiz">Flashcard</button><button class="ghost" id="goTeachAfterQuiz">Teaching Mode</button><button class="ghost" id="backLibrary">Kembali</button></div></div>`;
        const doneMaterialId = qstate.materialId;
        state.currentQuiz = null;
        await refreshAll();
        $("#retryWrong", panel).onclick = () => startQuiz(doneMaterialId, "practice");
        $("#goFlashAfterQuiz", panel).onclick = () => { closeQuizModal(); startFlashcards(doneMaterialId); };
        $("#goTeachAfterQuiz", panel).onclick = () => { closeQuizModal(); setView("teach", { target: "#teach" }); };
        $("#backLibrary", panel).onclick = () => { closeQuizModal(); setView("session", { target: "#sessionBox" }); };
      } else showQuiz();
    }, "Gagal menyimpan hasil quiz"));
  }

  async function applyQuizResults(materialId, score, mistakes = [], mode = "practice", startedAt = Date.now(), answers = []) {
    const m = findMaterial(materialId);
    if (!m) return;
    const currentMastery = Number(m.mastery_score || 0);
    const updatedMaterial = { ...m, mastery_score: mode === "posttest" ? Math.max(currentMastery, score) : currentMastery, updated_at: now() };
    const conceptsWrong = new Set(mistakes.map(x => conceptKey(x.concept || x.question)));
    const dueSoon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const cardsToNudge = materialCards(materialId).filter(c => [...conceptsWrong].some(key => conceptKey(c.concept || "") === key || conceptKey(`${c.front || ""} ${c.back || ""}`).includes(key))).slice(0, 8);
    const log = { id: uid("log"), user_id: state.user?.id || null, card_id: null, material_id: materialId, rating: `quiz-${mode}-${score}`, correct: score >= Number(state.settings.masteryThreshold || 70), previous_due_at: null, next_due_at: null, score, quiz_mode: mode, response_seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)), confidence: null, retention_before: null, created_at: now() };
    const secondsPerAnswer = Math.max(1, Math.round(Number(log.response_seconds) / Math.max(answers.length, 1)));
    const answerLogs = answers.map(answer => ({
      id: uid("log"), user_id: state.user?.id || null, card_id: null, material_id: materialId,
      rating: `quiz-answer:${mode}:${encodeURIComponent(answer.quizId)}:${encodeURIComponent(answer.concept || "Umum")}`,
      correct: Boolean(answer.correct), previous_due_at: null, next_due_at: null,
      score: answer.correct ? 100 : 0, quiz_mode: mode, response_seconds: secondsPerAnswer,
      confidence: null, retention_before: null, created_at: now()
    }));
    if (isCloud()) {
      if (mode === "posttest") {
        const { error } = await state.supa.from("materials").update({ mastery_score: updatedMaterial.mastery_score, updated_at: updatedMaterial.updated_at }).eq("id", materialId);
        if (error) console.warn(error.message);
      }
      // Satu insert untuk semua log, bukan satu request per jawaban.
      await insertReviewLogs([log, ...answerLogs]);
      if (cardsToNudge.length) {
        const { error } = await state.supa.from("flashcards")
          .update({ due_at: dueSoon, updated_at: now() })
          .in("id", cardsToNudge.map(c => c.id));
        if (error) console.warn("Gagal memajukan jadwal kartu:", error.message);
      }
    } else {
      await put("materials", updatedMaterial);
      await insertReviewLogs([log, ...answerLogs]);
      for (const c of cardsToNudge) await put("flashcards", { ...c, due_at: dueSoon, updated_at: now() });
    }
  }


  function startFlashcards(materialId, cardsList = null) {
    const cards = (cardsList && cardsList.length ? cardsList : materialCards(materialId)).filter(c => c.front && c.back);
    if (!cards.length) { notify("Belum ada flashcard untuk materi ini.", "warn"); return; }
    state.currentFlash = { materialId, cards: shuffle(cards), index: 0, shown: false, startedAt: Date.now(), done: 0 };
    showFlashcard();
  }

  function showFlashcard() {
    const f = state.currentFlash; if (!f) return;
    const modal = $("#quizModal"), p = $("#quizModalCard");
    const card = f.cards[f.index];
    const m = findMaterial(card.material_id || card.materialId || f.materialId);
    const progress = Math.round(((f.index + 1) / f.cards.length) * 100);
    f.startedAt = Date.now();
    p.innerHTML = `
      <div class="flash-shell flash-v7-shell">
        <div class="quiz-topline">
          <div><span class="badge soft">Flashcard aktif</span><h3>Kartu ${f.index + 1} dari ${f.cards.length}</h3></div>
          <button class="quiz-close" id="closeFlash" aria-label="Tutup flashcard">${ikon("close", 18)}</button>
        </div>
        <div class="mode-brief"><b>Cara pakai</b><p>Jangan baca jawaban dulu. Jawab di kepala, baru tekan tombol tampilkan jawaban. Inilah active recall.</p></div>
        <div class="quiz-progress-wrap"><div class="quiz-progress"><i style="width:${progress}%"></i></div><span>${progress}%</span></div>
        <span class="badge soft material-pill">${esc(materialTitle(m || {}))}</span>
        <div class="flash-question-card"><span>Pertanyaan</span><h4>${esc(card.front)}</h4></div>
        <button class="pill-cta reveal-answer" id="flashReveal">Saya sudah jawab, tampilkan jawaban</button>
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
          <button class="pill-cta" data-flash-rate="good"><b>Paham</b><span>jawaban cukup benar</span></button>
          <button class="pill-cta" data-flash-rate="easy"><b>Mudah</b><span>langsung ingat</span></button>
        </div>
      </div>`;
    openModal(modal, $("#flashReveal", p));
    $("#closeFlash", p).onclick = () => { state.currentFlash = null; closeQuizModal(); };
    $("#flashReveal", p).onclick = () => { $("#flashAnswer", p).hidden = false; $("#flashMeta", p).hidden = false; $("#flashRateBtns", p).hidden = false; scrollToTarget($("#flashAnswer", p)); };
    $$('[data-flash-rate]', p).forEach(btn => btn.onclick = () => {
      $$('[data-flash-rate]', p).forEach(other => { other.disabled = true; });
      guard(() => rateFlashcard(card, btn.dataset.flashRate), "Gagal menyimpan rating")
        .then(saved => { if (saved === null) $$('[data-flash-rate]', p).forEach(other => { other.disabled = false; }); });
    });
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
      p.innerHTML = `<div class="quiz-result quiz-result-v7"><span class="badge cloud">Flashcard selesai</span><h3>Latihan selesai</h3><div class="score-hero"><strong>${f.done}</strong><span>kartu sudah kamu review</span></div><p class="muted">Kartu yang sulit akan muncul lebih cepat. Lanjutkan dengan quiz atau post-test untuk cek mastery.</p><div class="action-row wrap"><button class="pill-cta" id="flashToQuiz">Lanjut Quiz</button><button class="ghost" id="flashToPost">Post-test</button><button class="ghost" id="flashBackSession">Kembali Belajar</button></div></div>`;
      await refreshAll();
      $("#flashToQuiz", p).onclick = () => startQuiz(materialId, "practice");
      $("#flashToPost", p).onclick = () => startQuiz(materialId, "posttest");
      $("#flashBackSession", p).onclick = () => { closeQuizModal(); setView("session", { target: "#sessionBox" }); };
    } else {
      await refreshAll();
      showFlashcard();
    }
    return true;
  }

  function renderTeachOptions() {
    const s = $("#teachMaterial"); if (!s) return;
    const previous = s.value;
    s.innerHTML = state.materials.map(m => `<option value="${esc(m.id)}">${esc(materialTitle(m))}</option>`).join("");
    if (previous && state.materials.some(m => m.id === previous)) s.value = previous;
  }
  async function evaluateTeaching() {
    const materialId = $("#teachMaterial").value; const m = findMaterial(materialId);
    if (!m) { notify("Pilih materi dulu.", "warn"); return; }
    const answer = $("#teachAnswer").value.trim();
    if (answer.length < 50) { notify("Penjelasan terlalu pendek. Coba jelaskan lebih lengkap.", "warn"); return; }
    const focus = $("#teachFocus").value.trim() || adaptiveRecommendation(m).target?.concept?.name || "";
    const out = $("#teachOutput"); out.hidden = false; out.textContent = "AI sedang menilai pemahamanmu...";
    try {
      const result = await callAI("evaluateTeaching", { material: { title: m.title, summary: m.summary_long || m.summary_short, concepts: m.concepts || [] }, focus, answer });
      const score = Math.round(Number(result.masteryScore || result.mastery_score || 0));
      out.innerHTML = `<div class="teach-focus-result"><span>Konsep yang dinilai</span><b>${esc(focus || "Keseluruhan materi")}</b></div><div class="teach-score"><span>Skor Penguasaan</span><strong>${score}%</strong></div><div class="feedback-grid"><section><h4>Feedback</h4>${htmlParagraphs(result.feedback || "-")}</section><section><h4>Miskonsepsi</h4><ul>${(result.misconceptions || []).length ? (result.misconceptions || []).map(x => `<li>${esc(x)}</li>`).join("") : "<li>Tidak terdeteksi.</li>"}</ul></section><section><h4>Bagian yang Kurang</h4><ul>${(result.missingPoints || result.missing_points || []).length ? (result.missingPoints || result.missing_points || []).map(x => `<li>${esc(x)}</li>`).join("") : "<li>Tidak ada catatan khusus.</li>"}</ul></section><section><h4>Langkah Berikutnya</h4><p>${esc(result.nextAction || result.next_action || "Review kartu lemah.")}</p></section></div><div class="rubric-bars">${renderRubric(result.rubric || {})}</div>`;
      const row = { id: uid("teach"), user_id: state.user?.id || null, material_id: materialId, answer_text: answer, result: { ...result, _focus: focus }, created_at: now() };
      if (isCloud()) await state.supa.from("teaching_sessions").insert(row); else await put("teaching_sessions", row);
      await updateSmartStreak(score);
      await refreshAll();
    } catch (err) {
      console.error(err);
      out.textContent = `Gagal: ${err.message}`;
      notify(`Penilaian gagal: ${err.message}`, "error");
    }
  }

  function renderRubric(rubric = {}) {
    const rows = [["accuracy", "Akurasi"], ["completeness", "Kelengkapan"], ["examples", "Contoh"], ["clarity", "Kejelasan"]];
    return rows.map(([key, label]) => { const v = clamp(Math.round(Number(rubric[key] || 0)), 0, 100); return `<div><span>${label}</span><div class="bar"><i style="width:${v}%"></i></div><b>${v}%</b></div>`; }).join("");
  }

  async function deleteMaterial(id) {
    if (!await confirmDialog("Materi ini beserta seluruh flashcard, quiz, dan riwayat reviewnya akan dihapus permanen.", { title: "Hapus materi", confirmText: "Hapus permanen", danger: true })) return;
    if (isCloud()) {
      // Foreign key di schema.sql memakai ON DELETE CASCADE, jadi flashcards,
      // quizzes, review_logs, dan teaching_sessions ikut terhapus sendiri.
      const { error } = await state.supa.from("materials").delete().eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      await del("materials", id);
      for (const c of materialCards(id)) await del("flashcards", c.id);
      for (const q of materialQuizzes(id)) await del("quizzes", q.id);
      // Log dan teaching session dibaca langsung dari IndexedDB: state hanya
      // memuat baris yang lolos filter, jadi sisanya dulu tertinggal jadi
      // sampah yang menumpuk selamanya.
      const [logs, teaching] = await Promise.all([getAll("review_logs"), getAll("teaching_sessions")]);
      for (const row of logs) if ((row.material_id || row.materialId) === id) await del("review_logs", row.id);
      for (const row of teaching) if ((row.material_id || row.materialId) === id) await del("teaching_sessions", row.id);
    }
    await refreshAll();
    notify("Materi dihapus.", "success");
  }

  function fillSettings() {
    $("#providerSelect").value = state.settings.provider;
    $("#geminiModel").value = state.settings.geminiModel;
    $("#groqModel").value = state.settings.groqModel;
    $("#openrouterModel").value = state.settings.openrouterModel;
    if ($("#masteryThreshold")) $("#masteryThreshold").value = state.settings.masteryThreshold || 70;
    if ($("#targetRetention")) $("#targetRetention").value = state.settings.targetRetention || 0.85;
    if ($("#focusMinutes")) $("#focusMinutes").value = state.settings.focusMinutes || 25;
    if ($("#shortBreakMinutes")) $("#shortBreakMinutes").value = state.settings.shortBreakMinutes || 5;
    if ($("#longBreakMinutes")) $("#longBreakMinutes").value = state.settings.longBreakMinutes || 15;
    if ($("#longBreakEvery")) $("#longBreakEvery").value = state.settings.longBreakEvery || 4;
    if ($("#pomodoroSound")) $("#pomodoroSound").checked = state.settings.pomodoroSound !== false;
    if ($("#pomodoroAutoBreak")) $("#pomodoroAutoBreak").checked = state.settings.pomodoroAutoBreak !== false;
  }

  async function exportJSON() {
    const data = {
      exportedAt: now(),
      version: 2,
      settings: { ...state.settings, supabaseAnon: "", supabaseUrl: "" },
      materials: state.materials,
      flashcards: state.flashcards,
      quizzes: state.quizzes,
      logs: state.logs,
      teaching: state.teaching,
      notes: state.notes,
      noteLinks: state.noteLinks,
      focusSessions: state.focusSessions
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `aiyone-backup-${core.dateKey()}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke ditunda: sebagian browser membatalkan unduhan kalau URL blob
    // dicabut tepat setelah click().
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    notify("Backup JSON diunduh.", "success");
  }

  /**
   * Import backup. Isi file tidak dipercaya begitu saja: bentuknya divalidasi,
   * baris tanpa id dibuang, dan `teaching` kini ikut diimpor — sebelumnya
   * teaching session diekspor tapi tidak pernah dibaca kembali, jadi backup
   * diam-diam tidak lengkap.
   */
  async function importJSON(file) {
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (_) { notify("File itu bukan backup JSON yang valid.", "error"); return; }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      notify("Struktur file backup tidak dikenali.", "error");
      return;
    }

    const groups = [
      ["materials", "materials", data.materials],
      ["flashcards", "flashcards", data.flashcards],
      ["quizzes", "quizzes", data.quizzes],
      ["review_logs", "logs", data.logs ?? data.review_logs],
      ["teaching_sessions", "teaching", data.teaching ?? data.teaching_sessions],
      ["notes", "catatan", data.notes],
      ["note_links", "tautan", data.noteLinks ?? data.note_links],
      ["focus_sessions", "sesi fokus", data.focusSessions ?? data.focus_sessions]
    ].map(([store, label, rows]) => ({
      store,
      label,
      rows: (Array.isArray(rows) ? rows : []).filter(row => row && typeof row === "object" && row.id)
    }));

    const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
    if (!total) { notify("Tidak ada data yang bisa diimpor dari file itu.", "warn"); return; }

    const summary = groups.filter(g => g.rows.length).map(g => `${g.rows.length} ${g.label}`).join(", ");
    if (!await confirmDialog(`Menambahkan ${summary} ke database di perangkat ini. Baris dengan id yang sama akan ditimpa.`, { title: "Import backup", confirmText: "Import" })) return;

    for (const group of groups) {
      for (const row of group.rows) await put(group.store, { ...row, user_id: null });
    }
    await refreshAll();
    notify(`Import selesai: ${summary}.`, "success");
  }

  async function resetLocal() {
    if (!await confirmDialog("Semua materi, flashcard, quiz, dan riwayat di perangkat ini akan dihapus. Data di cloud Supabase tidak ikut terhapus.", { title: "Reset data lokal", confirmText: "Reset sekarang", danger: true })) return;
    for (const s of ["materials", "flashcards", "quizzes", "review_logs", "teaching_sessions", "notes", "note_links", "focus_sessions"]) await clear(s);
    state.currentSession = null;
    state.reviewSessionDone = 0;
    state.reviewSessionClosed = false;
    state.currentReview = 0;
    await refreshAll();
    notify("Data lokal sudah direset.", "success");
  }


  function renderSessionOptions() {
    const s = $("#sessionMaterial"); if (!s) return;
    s.innerHTML = state.materials.map(m => `<option value="${esc(m.id)}">${esc(materialTitle(m))}</option>`).join("");
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
    const recommendation = adaptiveRecommendation(m);
    if (!state.currentSession.adaptiveInitialized) {
      const targetName = conceptKey(recommendation.target?.concept?.name || "");
      const targetStep = targetName ? sections.findIndex(section => conceptKey(`${section.title || ""} ${section.explanation || section.content || ""}`).includes(targetName)) : -1;
      if (targetStep >= 0) state.currentSession.step = targetStep;
      state.currentSession.targetConcept = recommendation.target?.concept?.name || "";
      state.currentSession.adaptiveInitialized = true;
    }
    const step = clamp(state.currentSession.step || 0, 0, Math.max(sections.length - 1, 0));
    state.currentSession.step = step;
    const sec = sections[step] || { title: materialTitle(m), explanation: m.summary_long || m.summary_short || "Belum ada materi bertahap.", example: "", activeRecall: "Jelaskan inti bagian ini dengan bahasamu." };
    const progress = sections.length ? Math.round(((step + 1) / sections.length) * 100) : 0;
    const cards = materialCards(m.id);
    const dueCount = cards.filter(c => new Date(cardDue(c)) <= new Date()).length;
    box.className = "session-box session-v7";
    box.innerHTML = `
      <div class="learning-coach-card">
        <span class="badge soft">Rekomendasi adaptif</span>
        <h3>${recommendation.target ? `Fokus: ${esc(recommendation.target.concept.name)}` : "Mulai dari fondasi materi."}</h3>
        <p>${esc(recommendation.reason)}. ${recommendation.type === "review" ? "Kerjakan retrieval sebelum membaca ulang." : recommendation.type === "learn" ? "Pelajari bagian terkait, lalu jawab active recall." : recommendation.type === "practice" ? "Perkuat dengan flashcard dan latihan." : "Gunakan post-test tanpa melihat materi."}</p>
        ${recommendation.target ? `<div class="adaptive-score"><span>Mastery konsep</span><b>${recommendation.target.score}%</b><i><em style="width:${recommendation.target.score}%"></em></i></div>` : ""}
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
        <button class="pill-cta" id="nextStep">${step + 1 >= sections.length ? "Selesai baca → latihan" : "Saya paham, lanjut →"}</button>
        <button class="ghost" id="sessionTeach">Nilai jawaban ini</button>
      </div>`;
    const savedRecall = state.currentSession.recall?.[step] || "";
    $("#sessionRecall", box).value = savedRecall;
    $("#sessionRecall", box).oninput = e => { state.currentSession.recall[step] = e.target.value; };
    $("#prevStep", box).onclick = () => { state.currentSession.step = Math.max(0, step - 1); renderSession(); scrollToTarget("#readStep"); };
    $("#nextStep", box).onclick = () => { if (step + 1 >= sections.length) { startFlashcards(m.id); } else { state.currentSession.step = step + 1; renderSession(); scrollToTarget("#readStep"); } };
    $("#jumpRead", box).onclick = () => scrollToTarget("#readStep");
    $("#sessionPretest", box).onclick = () => startQuiz(m.id, "pretest");
    $("#sessionFlash", box).onclick = () => startFlashcards(m.id, recommendation.cards.length ? recommendation.cards : null);
    $("#sessionQuiz", box).onclick = () => startQuiz(m.id, "practice");
    $("#sessionPosttest", box).onclick = () => startQuiz(m.id, "posttest");
    $("#sessionTeach", box).onclick = () => {
      const recall = $("#sessionRecall", box).value.trim();
      setView("teach", { target: "#teach" });
      $("#teachMaterial").value = m.id;
      $("#teachFocus").value = recommendation.target?.concept?.name || sec.title || "";
      $("#teachAnswer").value = recall;
      $("#teachOutput").hidden = true;
      $("#teachAnswer").focus();
    };
  }

  function renderAnalytics() {
    const visibleLogs = state.logs.filter(log => !String(log.rating || "").startsWith("quiz-answer:"));
    const reviewCount = visibleLogs.length;
    const correct = visibleLogs.filter(l => l.correct).length;
    const acc = reviewCount ? Math.round((correct / reviewCount) * 100) : 0;
    const weakCards = state.flashcards.filter(c => memoryStatus(c) === "weak");
    const setText = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    setText("#aReviews", reviewCount);
    setText("#aAccuracy", `${acc}%`);
    setText("#aTeaching", state.teaching.length);
    setText("#aWeak", weakCards.length);

    // Peringkat konsep milikmu sendiri. Aiyone aplikasi personal, jadi tidak
    // ada leaderboard antar-pengguna — yang diperingkat adalah penguasaanmu
    // per konsep, supaya tetap jujur dan tetap berguna.
    const rankBox = $("#conceptRanking");
    if (rankBox) {
      const rentang = state.rankRange || "week";
      const batas = Date.now() - 7 * dayMs;
      // Mode "Minggu ini" hanya menghitung konsep yang memang disentuh sepekan
      // terakhir, supaya papan peringkat mencerminkan usaha terbaru.
      const aktifPekanIni = new Set(
        state.logs
          .filter(l => new Date(l.created_at || 0).getTime() >= batas)
          .map(l => conceptKey(decodeURIComponent(String(l.rating || "").split(":")[3] || "")))
          .filter(Boolean)
      );
      const semua = state.materials.flatMap(m =>
        conceptMasteryList(m).map(item => ({ ...item, material: m })));
      let daftar = semua.filter(i => i.status !== "new");
      if (rentang === "week") {
        const pekan = daftar.filter(i => aktifPekanIni.has(conceptKey(i.concept.name)));
        // Kalau minggu ini belum ada aktivitas, jangan tampilkan papan kosong.
        if (pekan.length) daftar = pekan;
      }
      const teratas = daftar.sort((a, b) => b.score - a.score).slice(0, 5);

      rankBox.innerHTML = "";
      if (!teratas.length) {
        rankBox.className = "rank-list empty";
        rankBox.textContent = "Belum ada konsep yang diuji. Kerjakan quiz atau review dulu.";
      } else {
        rankBox.className = "rank-list";
        // Satu ikon piala untuk semua peringkat; yang membedakan warnanya.
        const piala = ikon("trophy", 15);
        teratas.forEach((item, i) => {
          const row = document.createElement("button");
          row.type = "button";
          row.className = `rank-row rank-${Math.min(i + 1, 4)}`;
          row.innerHTML = `
            <span class="rank-badge"><i aria-hidden="true">${piala}</i>#${i + 1}</span>
            <span class="rank-hatch" aria-hidden="true"></span>
            <span class="rank-score">${item.score}%</span>
            <span class="rank-orb" aria-hidden="true">${esc((item.concept.name[0] || "?").toUpperCase())}</span>
            <span class="sr-only">${esc(item.concept.name)}, ${esc(materialTitle(item.material))}, ${esc(item.label)}</span>`;
          row.title = `${item.concept.name} — ${materialTitle(item.material)} (${item.label})`;
          row.onclick = () => showDetail(item.material.id);
          rankBox.appendChild(row);
        });
      }

      // Kartu sorotan: konsep terlemah yang paling layak dikerjakan berikutnya.
      const sorot = $("#rankSpotlight");
      if (sorot) {
        const lemah = semua.filter(i => i.status !== "new").sort((a, b) => a.score - b.score)[0];
        sorot.hidden = !lemah;
        if (lemah) {
          sorot.innerHTML = `
            <span class="spotlight-orb" aria-hidden="true">${ikon("sparkles", 22)}</span>
            <div class="spotlight-body">
              <div class="spotlight-tags">
                <span class="tag">#${esc(conceptKey(lemah.material.category || "Umum").replace(/\s+/g, ""))}</span>
                <span class="tag soft-tag">${lemah.score}%</span>
              </div>
              <b>${esc(lemah.concept.name)}</b>
              <small>${esc(materialTitle(lemah.material))}</small>
            </div>
            <span class="linkout dark" aria-hidden="true"><span>Kerjakan</span><i>${ikon("linkout", 16)}</i></span>`;
          sorot.onclick = () => showDetail(lemah.material.id);
        }
      }
    }

    const focusBox = $("#focusSummary");
    if (focusBox) {
      const stat = focusStatsToday();
      const mingguan = focusMinutesByDay(7).reduce((a, b) => a + b, 0);
      focusBox.innerHTML = `
        <article><span>Sesi hari ini</span><b>${stat.sesi}</b></article>
        <article><span>Menit hari ini</span><b>${stat.menit}</b></article>
        <article><span>Menit 7 hari</span><b>${mingguan}</b></article>
        <article><span>Total sesi</span><b>${stat.totalSesi}</b></article>`;
    }

    const noteBox = $("#noteSummary");
    if (noteBox) {
      const yatim = orphanNotes().length;
      const rata = state.notes.length ? (state.noteLinks.length * 2 / state.notes.length).toFixed(1) : "0";
      noteBox.innerHTML = `
        <article><span>Catatan</span><b>${state.notes.length}</b></article>
        <article><span>Tautan</span><b>${state.noteLinks.length}</b></article>
        <article><span>Rata-rata tautan</span><b>${rata}</b></article>
        <article><span>Belum tertaut</span><b>${yatim}</b></article>`;
    }

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
        ...visibleLogs.map(l => ({ type:"Review", at:l.created_at || now(), text:`${l.rating || "review"} • ${l.correct ? "benar" : "perlu ulang"}` })),
        ...state.teaching.map(t => ({ type:"Teaching", at:t.created_at || now(), text:`skor ${Math.round(Number(t.result?.masteryScore || t.result?.mastery_score || 0))}%` }))
      ].sort((a,b) => new Date(b.at) - new Date(a.at)).slice(0, 12);
      actBox.innerHTML = "";
      if (!activities.length) { actBox.className = "stack empty"; actBox.textContent = "Belum ada aktivitas."; }
      else { actBox.className = "stack"; activities.forEach(a => { const div = document.createElement("div"); div.className = "flash-mini"; div.innerHTML = `<b>${esc(a.type)}</b><p>${esc(a.text)}</p><small class="muted">${shortDate(a.at)}</small>`; actBox.appendChild(div); }); }
    }
  }

  async function syncLocalToCloud(options = {}) {
    const silent = !!options.silent;
    if (!isCloud()) { if (!silent) notify("Login dulu sampai status Cloud aktif.", "warn"); return false; }
    const [lm, lc, lq, ll, lt, ln, lnl, lfs] = await Promise.all([
      getAll("materials"), getAll("flashcards"), getAll("quizzes"), getAll("review_logs"), getAll("teaching_sessions"),
      getAll("notes"), getAll("note_links"), getAll("focus_sessions")
    ]);
    const uidUser = state.user.id;
    const localMaterials = lm.filter(m => !m.user_id);
    const localNotes = ln.filter(n => !n.user_id);
    const localFocus = lfs.filter(f => !f.user_id);
    if (!localMaterials.length && !localNotes.length && !localFocus.length) { if (!silent) notify("Tidak ada materi lokal yang perlu dipindahkan."); return true; }
    if (!silent && !await confirmDialog(`Pindahkan ${localMaterials.length} materi lokal ke Cloud? Data lokal tidak dihapus.`, { title: "Sync ke cloud", confirmText: "Pindahkan" })) return false;
    const ids = new Set(localMaterials.map(m => m.id));
    const materials = localMaterials.map(m => ({ ...m, user_id: uidUser, updated_at: now() }));
    const cards = lc.filter(c => ids.has(c.material_id || c.materialId)).map(c => ({ ...c, user_id: uidUser, material_id: c.material_id || c.materialId }));
    const quizzes = lq.filter(q => ids.has(q.material_id || q.materialId)).map(q => ({ ...q, user_id: uidUser, material_id: q.material_id || q.materialId }));
    const logs = ll.filter(l => ids.has(l.material_id || l.materialId)).map(l => ({ ...l, user_id: uidUser, material_id: l.material_id || l.materialId }));
    const teaching = lt.filter(t => ids.has(t.material_id || t.materialId)).map(t => ({ ...t, user_id: uidUser, material_id: t.material_id || t.materialId }));
    // Catatan dan sesi fokus tidak wajib punya materi induk, jadi tidak disaring.
    const notes = localNotes.map(n => ({ ...n, user_id: uidUser, updated_at: now() }));
    const noteIds = new Set(notes.map(n => n.id));
    const noteLinks = lnl.filter(l => !l.user_id && noteIds.has(l.from_note_id) && noteIds.has(l.to_note_id)).map(l => ({ ...l, user_id: uidUser }));
    const focus = localFocus.map(f => ({ ...f, user_id: uidUser }));
    const upsert = async (table, rows) => { if (!rows.length) return; const { error } = await state.supa.from(table).upsert(rows, { onConflict: "id" }); if (error) throw new Error(`${table}: ${error.message}`); };
    try {
      await upsert("materials", materials);
      await upsert("flashcards", cards);
      await upsert("quizzes", quizzes);
      await upsert("review_logs", logs);
      await upsert("teaching_sessions", teaching);
      await upsert("notes", notes);
      await upsert("note_links", noteLinks);
      await upsert("focus_sessions", focus);
      // Tandai data lokal sebagai milik user ini agar tidak di-upsert berulang kali di setiap login.
      for (const row of materials) await put("materials", row);
      for (const row of cards) await put("flashcards", row);
      for (const row of quizzes) await put("quizzes", row);
      for (const row of logs) await put("review_logs", row);
      for (const row of teaching) await put("teaching_sessions", row);
      for (const row of notes) await put("notes", row);
      for (const row of noteLinks) await put("note_links", row);
      for (const row of focus) await put("focus_sessions", row);
      await refreshAll();
      if (!silent) notify(`Selesai. ${materials.length} materi, ${notes.length} catatan, dan ${focus.length} sesi fokus dipindahkan ke Cloud.`, "success");
      return true;
    } catch (e) {
      console.error("Sync gagal", e);
      if (!silent) notify(`Gagal sync: ${e.message}`, "error");
      else notify("Sync otomatis ke cloud gagal. Coba tombol sync ulang di menu Profil.", "warn");
      return false;
    }
  }

  /* ===================================================================== *
   * Penyimpanan generik
   * ===================================================================== */

  async function saveRow(table, row) {
    if (isCloud()) {
      const { error } = await state.supa.from(table).upsert(row, { onConflict: "id" });
      if (error) throw new Error(error.message);
    } else {
      await put(table, row);
    }
  }

  async function deleteRow(table, id) {
    if (isCloud()) {
      const { error } = await state.supa.from(table).delete().eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      await del(table, id);
    }
  }

  /* ===================================================================== *
   * Zettelkasten
   *
   * Yang membuat ini bernilai belajar bukan kemampuan menyimpan catatan,
   * melainkan kewajiban menuliskan ALASAN saat menautkan dua gagasan.
   * Menjelaskan hubungan memaksa elaborative encoding — prinsip yang sama
   * yang dipakai Teaching Mode, tapi biayanya jauh lebih murah.
   * ===================================================================== */

  const noteById = id => state.notes.find(n => n.id === id) || null;
  const noteTitle = n => (n?.title || "Tanpa judul").trim();

  function noteTags(note) {
    const raw = note?.tags;
    if (Array.isArray(raw)) return raw.map(t => String(t).trim()).filter(Boolean);
    if (typeof raw === "string") { try { return JSON.parse(raw) || []; } catch (_) { return []; } }
    return [];
  }

  function parseTags(value = "") {
    return [...new Set(String(value).split(/[,\n]/).map(t => t.trim().replace(/^#/, "")).filter(Boolean))].slice(0, 8);
  }

  const outgoingLinks = id => state.noteLinks.filter(l => l.from_note_id === id);
  const incomingLinks = id => state.noteLinks.filter(l => l.to_note_id === id);
  const linkCount = id => outgoingLinks(id).length + incomingLinks(id).length;

  /** Catatan tanpa satu pun tautan. Di Zettelkasten ini sinyal utama: catatan
   *  yang tidak terhubung ke apa pun praktis tidak akan pernah ditemukan lagi. */
  const orphanNotes = () => state.notes.filter(n => linkCount(n.id) === 0);

  /** Usulan tautan berdasarkan irisan kata yang bermakna. Sengaja sederhana dan
   *  lokal: tidak memanggil AI, jadi tetap jalan offline dan tanpa biaya. */
  function suggestLinks(note, limit = 5) {
    if (!note) return [];
    const stop = new Set(["yang","dan","atau","untuk","dari","pada","dengan","ini","itu","adalah","akan","tidak","bisa","dalam","ke","di","the","and","for","with","that","this"]);
    const words = text => new Set(conceptKey(text).split(" ").filter(w => w.length > 3 && !stop.has(w)));
    const mine = words(`${note.title} ${note.body || ""} ${noteTags(note).join(" ")}`);
    if (!mine.size) return [];
    const linked = new Set([...outgoingLinks(note.id).map(l => l.to_note_id), ...incomingLinks(note.id).map(l => l.from_note_id)]);
    return state.notes
      .filter(other => other.id !== note.id && !linked.has(other.id))
      .map(other => {
        const theirs = words(`${other.title} ${other.body || ""} ${noteTags(other).join(" ")}`);
        let shared = 0;
        for (const w of mine) if (theirs.has(w)) shared += 1;
        return { note: other, score: shared / Math.max(Math.min(mine.size, theirs.size), 1), shared };
      })
      .filter(item => item.shared >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async function createNote(seed = {}) {
    const note = {
      id: uid("note"),
      user_id: state.user?.id || null,
      title: String(seed.title || "Catatan baru").slice(0, 200),
      body: String(seed.body || "").slice(0, 20000),
      tags: parseTags(Array.isArray(seed.tags) ? seed.tags.join(",") : seed.tags || ""),
      material_id: seed.materialId || null,
      concept_name: seed.conceptName || null,
      source_ref: seed.sourceRef || null,
      created_at: now(),
      updated_at: now()
    };
    await saveRow("notes", note);
    await refreshAll();
    return note.id;
  }

  async function saveNote(note) {
    await saveRow("notes", { ...note, updated_at: now() });
    await refreshAll();
  }

  async function deleteNote(id) {
    const note = noteById(id);
    if (!note) return;
    const jumlah = linkCount(id);
    const peringatan = jumlah ? ` Catatan ini punya ${jumlah} tautan yang ikut terhapus.` : "";
    if (!await confirmDialog(`Hapus catatan “${noteTitle(note)}”?${peringatan}`, { title: "Hapus catatan", confirmText: "Hapus", danger: true })) return;
    // Tautan dihapus lebih dulu supaya mode lokal tidak meninggalkan sampah.
    // Di cloud, foreign key cascade sebenarnya sudah menanganinya.
    for (const link of [...outgoingLinks(id), ...incomingLinks(id)]) await deleteRow("note_links", link.id);
    await deleteRow("notes", id);
    if (state.openNoteId === id) state.openNoteId = null;
    await refreshAll();
    notify("Catatan dihapus.", "success");
  }

  async function linkNotes(fromId, toId, relation, reason) {
    if (!fromId || !toId || fromId === toId) { notify("Catatan tidak bisa ditautkan ke dirinya sendiri.", "warn"); return false; }
    const sudahAda = state.noteLinks.some(l =>
      (l.from_note_id === fromId && l.to_note_id === toId) ||
      (l.from_note_id === toId && l.to_note_id === fromId));
    if (sudahAda) { notify("Kedua catatan itu sudah tertaut.", "warn"); return false; }
    if (!String(reason || "").trim()) { notify("Tulis dulu alasan hubungannya. Bagian ini yang bikin tautannya berguna.", "warn", 7000); return false; }
    await saveRow("note_links", {
      id: uid("link"),
      user_id: state.user?.id || null,
      from_note_id: fromId,
      to_note_id: toId,
      relation: String(relation || "terkait").slice(0, 40),
      reason: String(reason).trim().slice(0, 600),
      created_at: now()
    });
    await refreshAll();
    notify("Tautan dibuat.", "success");
    return true;
  }

  async function unlinkNotes(linkId) {
    await deleteRow("note_links", linkId);
    await refreshAll();
  }

  /** Mengubah catatan jadi flashcard, sehingga gagasanmu sendiri ikut masuk
   *  jadwal review — bukan cuma materi dari AI. */
  async function noteToFlashcard(note) {
    const body = String(note.body || "").trim();
    if (body.length < 10) { notify("Isi catatannya dulu supaya ada yang bisa diingat.", "warn"); return; }
    const card = {
      id: uid("card"),
      user_id: state.user?.id || null,
      material_id: note.material_id || null,
      concept: note.concept_name || noteTitle(note),
      front: `Jelaskan: ${noteTitle(note)}`,
      back: body.slice(0, 900),
      difficulty: "medium",
      ease: 2.5, interval_days: 1, stability: 1, memory_difficulty: 5,
      repetitions: 0, lapses: 0,
      due_at: now(), last_reviewed_at: null,
      created_at: now(), updated_at: now()
    };
    if (isCloud() && !card.material_id) {
      // Kolom material_id boleh null di skema, jadi kartu lepas tetap sah.
      const { error } = await state.supa.from("flashcards").insert(card);
      if (error) throw new Error(error.message);
    } else {
      await saveRow("flashcards", card);
    }
    await refreshAll();
    notify("Catatan masuk antrean review sebagai flashcard.", "success");
  }

  /* --------------------------------------------------------------------- *
   * Wikilink — menautkan sambil menulis
   *
   * Mengetik `[[Judul]]` di isi catatan langsung membentuk tautan, seperti di
   * Obsidian. Tautan hasil wikilink ditandai relation "wikilink" supaya bisa
   * disinkronkan otomatis; tautan manual yang sudah kamu beri alasan tidak
   * pernah disentuh, karena itu hasil pemikiran, bukan turunan teks.
   * --------------------------------------------------------------------- */

  const noteByTitle = nama => {
    const kunci = core.linkKey(nama);
    return state.notes.find(n => core.linkKey(n.title) === kunci) || null;
  };

  /** Dipakai renderer Markdown untuk menentukan tampilan tiap wikilink. */
  const resolveWikilink = nama => {
    const n = noteByTitle(nama);
    return { id: n ? n.id : null, ada: !!n };
  };

  /** Menyamakan tautan otomatis dengan wikilink yang ada di isi catatan. */
  async function sinkronWikilink(note) {
    const target = core.parseWikilinks(note.body || "")
      .map(w => noteByTitle(w.target))
      .filter(n => n && n.id !== note.id);
    const idTarget = new Set(target.map(n => n.id));
    const otomatis = outgoingLinks(note.id).filter(l => l.relation === "wikilink");
    const sudahAda = new Set(otomatis.map(l => l.to_note_id));

    for (const n of target) {
      if (sudahAda.has(n.id)) continue;
      // Sudah ada tautan manual ke catatan yang sama? Biarkan; alasannya lebih
      // berharga daripada tautan otomatis.
      const bentrok = state.noteLinks.some(l =>
        (l.from_note_id === note.id && l.to_note_id === n.id) ||
        (l.from_note_id === n.id && l.to_note_id === note.id));
      if (bentrok) continue;
      await saveRow("note_links", {
        id: uid("link"),
        user_id: state.user?.id || null,
        from_note_id: note.id,
        to_note_id: n.id,
        relation: "wikilink",
        reason: null,
        created_at: now()
      });
    }

    for (const l of otomatis) {
      if (!idTarget.has(l.to_note_id)) await deleteRow("note_links", l.id);
    }
  }

  /* --------------------------------------------------------------------- *
   * Graf catatan
   *
   * Digambar sebagai SVG, bukan canvas: node perlu bisa diklik, difokuskan
   * lewat keyboard, dan mewarisi warna tema — semuanya nyaris gratis di SVG.
   * --------------------------------------------------------------------- */

  /** @param fokusId  bila diisi, hanya catatan itu dan tetangganya digambar. */
  function renderGraph(host, { fokusId = null, width = 320, height = 300 } = {}) {
    if (!host) return;

    let daftar = state.notes;
    if (fokusId) {
      const tetangga = new Set([fokusId]);
      for (const l of state.noteLinks) {
        if (l.from_note_id === fokusId) tetangga.add(l.to_note_id);
        if (l.to_note_id === fokusId) tetangga.add(l.from_note_id);
      }
      daftar = state.notes.filter(n => tetangga.has(n.id));
    }

    if (!daftar.length) {
      host.innerHTML = `<p class="graph-empty">Belum ada catatan untuk digambar.</p>`;
      return;
    }

    const idAda = new Set(daftar.map(n => n.id));
    const garis = state.noteLinks.filter(l => idAda.has(l.from_note_id) && idAda.has(l.to_note_id));

    const posisi = core.layoutGraph(
      daftar.map(n => ({ id: n.id })),
      garis.map(l => ({ from: l.from_note_id, to: l.to_note_id })),
      { width, height, iterations: daftar.length > 40 ? 160 : 260, padding: 26 }
    );
    const peta = new Map(posisi.map(p => [p.id, p]));

    // Node yang lebih banyak tertaut digambar lebih besar: kepadatan tautan
    // adalah sinyal utama di Zettelkasten.
    const jariJari = id => 7 + Math.min(linkCount(id), 6) * 1.7;

    const svgGaris = garis.map(l => {
      const a = peta.get(l.from_note_id), b = peta.get(l.to_note_id);
      if (!a || !b) return "";
      const belumDijelaskan = !String(l.reason || "").trim();
      const dekatFokus = fokusId && (l.from_note_id === fokusId || l.to_note_id === fokusId);
      return `<line class="graph-edge${belumDijelaskan ? " unexplained" : ""}${dekatFokus ? " active" : ""}" `
        + `x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" />`;
    }).join("");

    const svgNode = daftar.map(n => {
      const p = peta.get(n.id);
      if (!p) return "";
      const r = jariJari(n.id);
      const label = noteTitle(n);
      const pendek = label.length > 18 ? `${label.slice(0, 17)}…` : label;
      const kelas = `graph-node${n.id === fokusId ? " focus" : ""}${linkCount(n.id) ? "" : " orphan"}`;
      return `<g class="${kelas}" data-note="${esc(n.id)}" tabindex="0" role="button" `
        + `aria-label="Buka catatan ${esc(label)}, ${linkCount(n.id)} tautan">`
        + `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" />`
        + `<text x="${p.x.toFixed(1)}" y="${(p.y + r + 11).toFixed(1)}" text-anchor="middle">${esc(pendek)}</text>`
        + `</g>`;
    }).join("");

    host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" class="graph-svg" role="img" `
      + `aria-label="Graf ${daftar.length} catatan dengan ${garis.length} tautan">`
      + `<g class="graph-edges">${svgGaris}</g><g class="graph-nodes">${svgNode}</g></svg>`;

    $$(".graph-node", host).forEach(g => {
      const buka = () => openNote(g.dataset.note);
      g.onclick = buka;
      g.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); buka(); } };
    });
  }

  /* --------------------------------------------------------------------- *
   * Editor Markdown
   * --------------------------------------------------------------------- */

  /* Huruf B/I/H adalah konvensi tipografi yang dikenali lintas aplikasi, jadi
     dipertahankan sebagai teks. Sisanya pakai Heroicons: glif Unicode seperti
     ☑ dan ❝ tampil berbeda-beda per sistem operasi dan sebagian jatuh ke font
     emoji berwarna. */
  const ALAT_MD = [
    { teks: "B", label: "Tebal", sisip: ["**", "**"] },
    { teks: "I", label: "Miring", sisip: ["*", "*"] },
    { teks: "H", label: "Sub-judul", awal: "## " },
    { ikon: "list", label: "Daftar", awal: "- " },
    { ikon: "checklist", label: "Checklist", awal: "- [ ] " },
    { ikon: "quote", label: "Kutipan", awal: "> " },
    { ikon: "code", label: "Kode", sisip: ["`", "`"] },
    { ikon: "link", label: "Tautkan catatan", sisip: ["[[", "]]"] }
  ];

  /** Menyisipkan markup di sekitar teks terpilih pada textarea. */
  function terapkanAlat(ta, alat) {
    const mulai = ta.selectionStart, akhir = ta.selectionEnd, nilai = ta.value;
    if (alat.awal) {
      // Alat baris: awalan ditambahkan (atau dicabut) di tiap baris tersentuh.
      const kiri = nilai.lastIndexOf("\n", mulai - 1) + 1;
      const kanan = nilai.indexOf("\n", akhir);
      const batas = kanan === -1 ? nilai.length : kanan;
      const blok = nilai.slice(kiri, batas).split("\n")
        .map(b => b.startsWith(alat.awal) ? b.slice(alat.awal.length) : alat.awal + b)
        .join("\n");
      ta.value = nilai.slice(0, kiri) + blok + nilai.slice(batas);
      ta.setSelectionRange(kiri, kiri + blok.length);
    } else {
      const [a, b] = alat.sisip;
      const pilih = nilai.slice(mulai, akhir);
      ta.value = nilai.slice(0, mulai) + a + pilih + b + nilai.slice(akhir);
      ta.setSelectionRange(mulai + a.length, mulai + a.length + pilih.length);
    }
    ta.focus();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /** Saran judul catatan saat mengetik `[[`, termasuk opsi membuat yang baru. */
  function pasangSaranWikilink(ta, kotak) {
    if (!ta || !kotak) return;
    const tutup = () => { kotak.hidden = true; kotak.innerHTML = ""; };

    const perbarui = () => {
      const pos = ta.selectionStart;
      const sebelum = ta.value.slice(0, pos);
      const m = sebelum.match(/\[\[([^\]\n]*)$/);
      if (!m) { tutup(); return; }
      const ketikan = m[1].trim();
      const kueri = core.linkKey(m[1]);
      const cocok = state.notes.filter(n => !kueri || core.linkKey(n.title).includes(kueri)).slice(0, 6);
      const persisAda = state.notes.some(n => core.linkKey(n.title) === kueri);
      if (!cocok.length && !ketikan) { tutup(); return; }

      kotak.hidden = false;
      kotak.innerHTML = cocok
        .map(n => `<button type="button" class="suggest-item" data-isi="${esc(n.title)}">${esc(noteTitle(n))}<small>${linkCount(n.id)} tautan</small></button>`)
        .join("")
        + (!persisAda && ketikan
          ? `<button type="button" class="suggest-item baru" data-isi="${esc(ketikan)}">Tautkan ke “${esc(ketikan)}”<small>catatan baru</small></button>`
          : "");

      $$(".suggest-item", kotak).forEach(b => b.onclick = () => {
        const awal = sebelum.lastIndexOf("[[");
        const sesudah = ta.value.slice(pos);
        const penutup = sesudah.startsWith("]]") ? "" : "]]";
        ta.value = `${ta.value.slice(0, awal)}[[${b.dataset.isi}${penutup}${sesudah}`;
        const kursor = awal + 2 + b.dataset.isi.length + penutup.length;
        ta.setSelectionRange(kursor, kursor);
        tutup();
        ta.focus();
      });
    };

    ta.addEventListener("input", perbarui);
    ta.addEventListener("click", perbarui);
    ta.addEventListener("keydown", e => {
      if (e.key === "Escape" && !kotak.hidden) { e.stopPropagation(); tutup(); }
    });
    // Ditunda supaya klik pada item saran sempat terproses sebelum kotak hilang.
    ta.addEventListener("blur", () => window.setTimeout(tutup, 160));
  }

  /** Pratinjau ringkas untuk kartu: markup Markdown dan wikilink dilucuti. */
  function cuplikanCatatan(body = "") {
    return String(body)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => (a || t))
      .replace(/[#*>`~=]|^- \[[ x]\]/gm, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function renderNotes() {
    const box = $("#notesList");
    if (!box) return;

    const total = state.notes.length;
    const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    setText("#nTotal", total);
    setText("#nLinks", state.noteLinks.length);
    setText("#nOrphan", orphanNotes().length);

    const graf = $("#noteGraph");
    if (graf) {
      const lebar = Math.max(280, Math.min(graf.clientWidth || 320, 560));
      renderGraph(graf, { width: lebar, height: Math.round(lebar * 0.72) });
    }

    const q = conceptKey(state.noteFilter || "");
    const items = state.notes.filter(n => {
      if (!q) return true;
      return conceptKey(`${n.title} ${n.body || ""} ${noteTags(n).join(" ")}`).includes(q);
    });

    box.innerHTML = "";
    if (!items.length) {
      box.className = "cards empty";
      box.textContent = total
        ? "Tidak ada catatan yang cocok."
        : "Belum ada catatan. Mulai dari satu gagasan kecil, lalu tautkan ke gagasan lain.";
      return;
    }
    box.className = "cards";
    for (const note of items) {
      const jumlah = linkCount(note.id);
      const el = document.createElement("article");
      el.className = `note-card${jumlah ? "" : " orphan"}`;
      const material = note.material_id ? findMaterial(note.material_id) : null;
      const cuplikan = cuplikanCatatan(note.body);
      el.innerHTML = `
        <div class="note-card-head">
          <h4>${esc(noteTitle(note))}</h4>
          <span class="link-chip${jumlah ? "" : " zero"}">${jumlah} tautan</span>
        </div>
        <p>${esc(cuplikan.slice(0, 150) || "Belum ada isi.")}</p>
        <div class="note-meta">
          ${noteTags(note).map(t => `<span class="tag">#${esc(t)}</span>`).join("")}
          ${material ? `<span class="tag soft-tag">${esc(materialTitle(material))}</span>` : ""}
          <span class="tag soft-tag">${shortDate(note.created_at || now())}</span>
        </div>`;
      el.onclick = () => openNote(note.id);
      box.appendChild(el);
    }
  }

  function openNote(id) {
    const note = noteById(id);
    if (!note) return;
    state.openNoteId = id;
    const panel = $("#noteDetail");
    if (!panel) return;
    panel.hidden = false;

    const keluar = outgoingLinks(id);
    const masuk = incomingLinks(id);
    const usulan = suggestLinks(note);
    const material = note.material_id ? findMaterial(note.material_id) : null;
    const belumDijelaskan = [...keluar, ...masuk].filter(l => !String(l.reason || "").trim()).length;

    const barisTautan = (link, arah) => {
      const lawan = noteById(arah === "keluar" ? link.to_note_id : link.from_note_id);
      if (!lawan) return "";
      const alasan = String(link.reason || "").trim();
      return `<div class="link-row${alasan ? "" : " unexplained"}">
        <div class="link-row-main">
          <b>${esc(noteTitle(lawan))}</b>
          <span class="relation">${arah === "keluar" ? "→" : "←"} ${esc(link.relation || "terkait")}</span>
          <p>${alasan ? esc(alasan) : "Belum dijelaskan kenapa keduanya terhubung."}</p>
        </div>
        <div class="link-row-actions">
          <button class="text-action open-linked" data-id="${esc(lawan.id)}">Buka</button>
          ${alasan ? "" : `<button class="text-action explain-link" data-id="${esc(link.id)}">Jelaskan</button>`}
          <button class="text-action danger-action unlink" data-id="${esc(link.id)}">Lepas</button>
        </div>
        ${alasan ? "" : `<div class="explain-box" data-for="${esc(link.id)}" hidden>
          <textarea rows="2" placeholder="Karena keduanya sama-sama menjelaskan..."></textarea>
          <button class="pill-cta save-explain" data-id="${esc(link.id)}">Simpan alasan</button>
        </div>`}
      </div>`;
    };

    panel.innerHTML = `
      <div class="note-detail-head">
        <div>
          <span class="section-label">Catatan</span>
          <h3>${esc(noteTitle(note))}</h3>
          <p class="lead">${keluar.length + masuk.length} tautan · ${shortDate(note.created_at || now())}${material ? ` · dari ${esc(materialTitle(material))}` : ""}</p>
        </div>
        <button class="icon-btn" id="closeNote" aria-label="Tutup catatan">${ikon("close", 18)}</button>
      </div>

      <label>Judul<input id="noteTitle" value="${esc(noteTitle(note))}" maxlength="200" /></label>

      <div class="editor">
        <div class="editor-bar">
          <div class="md-tools" role="toolbar" aria-label="Format teks">
            ${ALAT_MD.map((a, i) => `<button type="button" class="md-tool" data-alat="${i}" title="${esc(a.label)}" aria-label="${esc(a.label)}">${a.ikon ? ikon(a.ikon, 16) : esc(a.teks)}</button>`).join("")}
          </div>
          <div class="editor-modes" role="tablist" aria-label="Mode editor">
            <button type="button" class="editor-mode active" data-mode="tulis" role="tab" aria-selected="true">Tulis</button>
            <button type="button" class="editor-mode" data-mode="baca" role="tab" aria-selected="false">Pratinjau</button>
          </div>
        </div>
        <div class="editor-body">
          <div class="editor-write">
            <textarea id="noteBody" rows="12" spellcheck="true" placeholder="Tulis dengan bahasamu sendiri, bukan menyalin.&#10;&#10;## Sub-judul&#10;- poin&#10;- [ ] tugas&#10;&gt; kutipan&#10;&#10;Ketik [[ untuk menautkan ke catatan lain.">${esc(note.body || "")}</textarea>
            <div class="suggest" id="noteSuggest" hidden></div>
          </div>
          <div class="editor-read prose" id="notePreview" hidden></div>
        </div>
        <p class="editor-hint">Markdown didukung. Ketik <code>[[</code> untuk menautkan catatan, <code>#tag</code> untuk menandai.</p>
      </div>

      <label>Tag tambahan, pisahkan dengan koma<input id="noteTagsInput" value="${esc(noteTags(note).join(", "))}" placeholder="misal: memori, ujian" /></label>
      <div class="action-row wrap">
        <button class="pill-cta" id="noteSave">Simpan</button>
        <button class="ghost" id="noteToCard">Jadikan flashcard</button>
        <button class="danger" id="noteDelete">Hapus</button>
      </div>

      <div class="link-section">
        <div class="block-head">
          <div>
            <h4>Graf sekitar catatan ini</h4>
            <p class="lead">Klik node untuk berpindah. Garis putus-putus artinya hubungannya belum dijelaskan.</p>
          </div>
        </div>
        <div class="graph-box" id="noteLocalGraph"></div>
      </div>

      ${belumDijelaskan ? `<p class="nudge">${belumDijelaskan} tautan belum punya alasan. Menjelaskan hubungannya yang membuat kamu benar-benar memahaminya.</p>` : ""}

      <div class="link-section">
        <h4>Tautan keluar (${keluar.length})</h4>
        ${keluar.map(l => barisTautan(l, "keluar")).join("") || `<p class="lead">Belum ada. Ketik <code>[[</code> di isi catatan untuk menautkan sambil menulis.</p>`}
      </div>

      <div class="link-section">
        <h4>Tautan masuk (${masuk.length})</h4>
        ${masuk.map(l => barisTautan(l, "masuk")).join("") || `<p class="lead">Belum ada catatan lain yang menunjuk ke sini.</p>`}
      </div>

      <div class="link-builder">
        <h4>Tautkan dengan alasan</h4>
        <p class="lead">Wikilink cepat untuk menangkap hubungan. Bagian ini untuk menjelaskan <em>kenapa</em> — dan itu yang membuatnya melekat.</p>
        <div class="field-row">
          <label>Catatan tujuan
            <select id="linkTarget">
              <option value="">— pilih catatan —</option>
              ${state.notes.filter(n => n.id !== id).map(n => `<option value="${esc(n.id)}">${esc(noteTitle(n))}</option>`).join("")}
            </select>
          </label>
          <label>Jenis hubungan
            <select id="linkRelation">
              <option value="terkait">terkait dengan</option>
              <option value="mendukung">mendukung</option>
              <option value="membantah">membantah</option>
              <option value="contoh">adalah contoh dari</option>
              <option value="prasyarat">prasyarat untuk</option>
              <option value="lanjutan">lanjutan dari</option>
            </select>
          </label>
        </div>
        <label>Kenapa keduanya terhubung?
          <textarea id="linkReason" rows="2" placeholder="Karena keduanya sama-sama menjelaskan..."></textarea>
        </label>
        <button class="pill-cta" id="linkCreate">Buat tautan</button>
      </div>

      ${usulan.length ? `<div class="link-section suggestions">
        <h4>Mungkin berhubungan</h4>
        <p class="lead">Berdasarkan kata yang sama-sama muncul. Kamu tetap yang menentukan dan menjelaskan alasannya.</p>
        ${usulan.map(s => `<div class="link-row"><div class="link-row-main"><b>${esc(noteTitle(s.note))}</b><span class="relation">${s.shared} kata beririsan</span></div>
          <div class="link-row-actions"><button class="text-action pick-suggestion" data-id="${esc(s.note.id)}">Pilih</button></div></div>`).join("")}
      </div>` : ""}
    `;

    const ta = $("#noteBody", panel);
    const pratinjau = $("#notePreview", panel);
    const areaTulis = $(".editor-write", panel);

    const gambarPratinjau = () => {
      pratinjau.innerHTML = core.renderMarkdown(ta.value, { resolveLink: resolveWikilink })
        || `<p class="lead">Belum ada isi.</p>`;
      $$(".md-link", pratinjau).forEach(b => b.onclick = () => guard(async () => {
        if (b.dataset.note) { openNote(b.dataset.note); return; }
        const nama = b.dataset.name;
        if (!await confirmDialog(`Catatan “${nama}” belum ada. Buat sekarang?`, { title: "Buat catatan", confirmText: "Buat" })) return;
        // Isi editor disimpan dulu, kalau tidak wikilink-nya hilang saat panel
        // digambar ulang untuk catatan yang baru.
        const isi = ta.value;
        await saveRow("notes", { ...note, body: isi, updated_at: now() });
        const baru = await createNote({ title: nama });
        await sinkronWikilink({ ...note, body: isi });
        await refreshAll();
        openNote(baru);
      }, "Gagal membuka tautan"));
    };

    $$(".editor-mode", panel).forEach(b => b.onclick = () => {
      const baca = b.dataset.mode === "baca";
      $$(".editor-mode", panel).forEach(x => {
        x.classList.toggle("active", x === b);
        x.setAttribute("aria-selected", String(x === b));
      });
      areaTulis.hidden = baca;
      pratinjau.hidden = !baca;
      if (baca) gambarPratinjau();
    });

    $$(".md-tool", panel).forEach(b => b.onclick = () => terapkanAlat(ta, ALAT_MD[Number(b.dataset.alat)]));
    pasangSaranWikilink(ta, $("#noteSuggest", panel));
    renderGraph($("#noteLocalGraph", panel), { fokusId: id, width: 320, height: 260 });

    $("#closeNote", panel).onclick = () => { panel.hidden = true; state.openNoteId = null; };
    $("#noteSave", panel).onclick = () => guard(async () => {
      const judul = $("#noteTitle", panel).value.trim();
      if (!judul) { notify("Judul catatan tidak boleh kosong.", "warn"); return; }
      const isi = ta.value;
      // Tag dari kolom digabung dengan #tag yang ditulis langsung di isi.
      const tag = [...new Set([...parseTags($("#noteTagsInput", panel).value), ...core.parseTags(isi)])].slice(0, 12);
      const diperbarui = { ...note, title: judul, body: isi, tags: tag };
      await saveRow("notes", { ...diperbarui, updated_at: now() });
      await refreshAll();
      await sinkronWikilink(diperbarui);
      await refreshAll();
      openNote(id);
      notify("Catatan tersimpan.", "success");
    }, "Gagal menyimpan catatan");
    $("#noteDelete", panel).onclick = () => guard(() => deleteNote(id), "Gagal menghapus");
    $("#noteToCard", panel).onclick = () => guard(() => noteToFlashcard(note), "Gagal membuat flashcard");
    $("#linkCreate", panel).onclick = () => guard(async () => {
      const ok = await linkNotes(id, $("#linkTarget", panel).value, $("#linkRelation", panel).value, $("#linkReason", panel).value);
      if (ok) openNote(id);
    }, "Gagal membuat tautan");
    $$(".open-linked", panel).forEach(b => b.onclick = () => openNote(b.dataset.id));
    $$(".unlink", panel).forEach(b => b.onclick = () => guard(async () => { await unlinkNotes(b.dataset.id); openNote(id); }, "Gagal melepas tautan"));
    $$(".explain-link", panel).forEach(b => b.onclick = () => {
      const box = $(`.explain-box[data-for="${b.dataset.id}"]`, panel);
      if (!box) return;
      box.hidden = !box.hidden;
      if (!box.hidden) $("textarea", box).focus();
    });
    $$(".save-explain", panel).forEach(b => b.onclick = () => guard(async () => {
      const link = state.noteLinks.find(l => l.id === b.dataset.id);
      const alasan = $("textarea", b.closest(".explain-box")).value.trim();
      if (!link || !alasan) { notify("Tulis dulu alasannya.", "warn"); return; }
      await saveRow("note_links", {
        ...link,
        // Wikilink yang sudah dijelaskan naik pangkat jadi tautan biasa,
        // supaya sinkronisasi otomatis tidak pernah menghapusnya.
        relation: link.relation === "wikilink" ? "terkait" : link.relation,
        reason: alasan.slice(0, 600)
      });
      await refreshAll();
      openNote(id);
      notify("Alasan tersimpan.", "success");
    }, "Gagal menyimpan alasan"));
    $$(".pick-suggestion", panel).forEach(b => b.onclick = () => {
      $("#linkTarget", panel).value = b.dataset.id;
      $("#linkReason", panel).focus();
      scrollToTarget($(".link-builder", panel), "smooth", true);
    });
    setView("notes", { target: "#noteDetail" });
  }

  /* ===================================================================== *
   * Pomodoro
   *
   * Timer saja itu komoditas. Nilai tambahnya di sini: setiap sesi dicatat
   * beserta materi yang dikerjakan, sehingga grafik "Waktu belajar" memakai
   * menit sungguhan, bukan perkiraan kasar dari waktu jawab review.
   * ===================================================================== */

  const POMODORO_MODES = {
    focus: { label: "Fokus", key: "focusMinutes", fallback: 25 },
    short: { label: "Istirahat pendek", key: "shortBreakMinutes", fallback: 5 },
    long: { label: "Istirahat panjang", key: "longBreakMinutes", fallback: 15 }
  };

  const pomodoroMinutes = mode => {
    const cfg = POMODORO_MODES[mode] || POMODORO_MODES.focus;
    return clamp(Number(state.settings[cfg.key] || cfg.fallback), 1, 180);
  };

  function pomodoroElapsed() {
    const p = state.pomodoro;
    if (!p) return 0;
    const berjalan = p.running ? (Date.now() - p.startedAt) / 1000 : 0;
    return Math.max(0, Math.floor(p.elapsedBefore + berjalan));
  }

  const pomodoroTotal = () => pomodoroMinutes(state.pomodoro?.mode || "focus") * 60;
  const pomodoroRemaining = () => Math.max(0, pomodoroTotal() - pomodoroElapsed());

  function formatClock(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  function startPomodoro(mode = "focus", materialId = null) {
    stopTicker();
    state.pomodoro = {
      mode,
      running: true,
      startedAt: Date.now(),
      elapsedBefore: 0,
      materialId: materialId ?? state.pomodoro?.materialId ?? null,
      cycle: state.pomodoro?.cycle || 0
    };
    startTicker();
    renderFocus();
  }

  function pausePomodoro() {
    const p = state.pomodoro;
    if (!p || !p.running) return;
    p.elapsedBefore = pomodoroElapsed();
    p.running = false;
    stopTicker();
    renderFocus();
  }

  function resumePomodoro() {
    const p = state.pomodoro;
    if (!p || p.running) return;
    p.startedAt = Date.now();
    p.running = true;
    startTicker();
    renderFocus();
  }

  function startTicker() {
    stopTicker();
    state.pomodoroTicker = window.setInterval(() => {
      if (!state.pomodoro?.running) return;
      if (pomodoroRemaining() <= 0) { guard(finishPomodoro, "Gagal menyimpan sesi fokus"); return; }
      paintPomodoroClock();
    }, 250);
  }

  function stopTicker() {
    if (state.pomodoroTicker) window.clearInterval(state.pomodoroTicker);
    state.pomodoroTicker = 0;
  }

  /** Menyimpan sesi. `selesai` membedakan timer yang tuntas dari yang dihentikan. */
  async function recordFocusSession(selesai) {
    const p = state.pomodoro;
    if (!p) return;
    const detik = pomodoroElapsed();
    // Sesi sangat pendek tidak dicatat supaya statistik tidak dikotori.
    if (detik < 30) return;
    await saveRow("focus_sessions", {
      id: uid("focus"),
      user_id: state.user?.id || null,
      material_id: p.materialId || null,
      note_id: null,
      mode: p.mode,
      planned_minutes: pomodoroMinutes(p.mode),
      actual_seconds: detik,
      completed: !!selesai,
      started_at: new Date(Date.now() - detik * 1000).toISOString(),
      ended_at: now(),
      created_at: now()
    });
  }

  async function finishPomodoro() {
    const p = state.pomodoro;
    if (!p) return;
    stopTicker();
    p.running = false;
    p.elapsedBefore = pomodoroTotal();
    const modeSelesai = p.mode;
    await recordFocusSession(true);
    beep();

    if (modeSelesai === "focus") {
      const siklus = (p.cycle || 0) + 1;
      const setiap = clamp(Number(state.settings.longBreakEvery || 4), 2, 8);
      const berikutnya = siklus % setiap === 0 ? "long" : "short";
      state.pomodoro = { mode: berikutnya, running: false, startedAt: 0, elapsedBefore: 0, materialId: p.materialId, cycle: siklus };
      notify(`Sesi fokus selesai. Saatnya ${POMODORO_MODES[berikutnya].label.toLowerCase()}.`, "success", 8000);
      if (state.settings.pomodoroAutoBreak) startPomodoro(berikutnya, p.materialId);
    } else {
      state.pomodoro = { mode: "focus", running: false, startedAt: 0, elapsedBefore: 0, materialId: p.materialId, cycle: p.cycle || 0 };
      notify("Istirahat selesai. Siap fokus lagi?", "success");
    }
    await refreshAll();
    renderFocus();
  }

  async function stopPomodoro() {
    const p = state.pomodoro;
    if (!p) return;
    stopTicker();
    p.running = false;
    p.elapsedBefore = pomodoroElapsed();
    const detik = pomodoroElapsed();
    if (detik >= 30) {
      await recordFocusSession(false);
      notify(`Sesi dihentikan. ${Math.round(detik / 60)} menit tetap tercatat.`, "info");
    }
    state.pomodoro = { mode: "focus", running: false, startedAt: 0, elapsedBefore: 0, materialId: p.materialId, cycle: p.cycle || 0 };
    await refreshAll();
    renderFocus();
  }

  /** Nada pendek lewat WebAudio, jadi tidak perlu file audio sama sekali. */
  function beep() {
    if (!state.settings.pomodoroSound) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.16);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.55);
      osc.onended = () => ctx.close().catch(() => {});
    } catch (_) { /* audio diblokir browser, abaikan */ }
  }

  /** Menit fokus per hari. Dipakai grafik dashboard dan ringkasan harian. */
  function focusMinutesByDay(days = 7) {
    const hasil = Array(days).fill(0);
    const akhirHariIni = new Date(); akhirHariIni.setHours(23, 59, 59, 999);
    for (const sesi of state.focusSessions) {
      if (sesi.mode !== "focus") continue;
      const tanggal = new Date(sesi.started_at || sesi.created_at || 0);
      const selisih = Math.floor((akhirHariIni - tanggal) / dayMs);
      if (selisih >= 0 && selisih < days) hasil[days - 1 - selisih] += Number(sesi.actual_seconds || 0) / 60;
    }
    return hasil.map(m => Math.round(m));
  }

  function focusStatsToday() {
    const kunci = core.dateKey();
    const hariIni = state.focusSessions.filter(s => s.mode === "focus" && core.dateKey(new Date(s.started_at || s.created_at || 0)) === kunci);
    return {
      sesi: hariIni.filter(s => s.completed).length,
      menit: Math.round(hariIni.reduce((t, s) => t + Number(s.actual_seconds || 0), 0) / 60),
      totalSesi: state.focusSessions.filter(s => s.mode === "focus" && s.completed).length
    };
  }

  function paintPomodoroClock() {
    const p = state.pomodoro;
    if (!p) return;
    const sisa = pomodoroRemaining();
    const total = pomodoroTotal();
    const el = $("#focusClock");
    if (el) el.textContent = formatClock(sisa);
    const sub = $("#focusElapsed");
    if (sub) sub.textContent = `${formatClock(pomodoroElapsed())} / ${formatClock(total)}`;
    const ring = $("#focusRing");
    if (ring) {
      const persen = total ? clamp((total - sisa) / total, 0, 1) : 0;
      ring.style.setProperty("--progress", `${(persen * 100).toFixed(1)}%`);
    }
    if (p.running) document.title = `${formatClock(sisa)} · ${POMODORO_MODES[p.mode].label} — Aiyone`;
    else document.title = "Aiyone Personal";
  }

  function renderFocus() {
    const box = $("#focusBox");
    if (!box) return;
    if (!state.pomodoro) {
      state.pomodoro = { mode: "focus", running: false, startedAt: 0, elapsedBefore: 0, materialId: null, cycle: 0 };
    }
    const p = state.pomodoro;
    const stat = focusStatsToday();
    const setiap = clamp(Number(state.settings.longBreakEvery || 4), 2, 8);
    const kePanjang = setiap - ((p.cycle || 0) % setiap);

    const nama = state.user?.email ? state.user.email.split("@")[0] : "kamu";
    const materi = p.materialId ? findMaterial(p.materialId) : null;
    const tanggal = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

    // Empat pita bertumpuk, tiap pita membawa satu lapis informasi:
    // salam → ringkasan hari ini → pilihan sesi → pemutar.
    box.className = `bands mode-${p.mode}`;
    box.innerHTML = `
      <div class="band band-coral">
        <header class="greet on-color">
          <div class="greet-text">
            <h2>Hai, ${esc(nama)} <span class="wave" aria-hidden="true">&#128075;</span></h2>
            <p>${esc(tanggal)}</p>
          </div>
          <span class="greet-avatar static" aria-hidden="true">${esc((nama[0] || "A").toUpperCase())}</span>
        </header>
        <div class="band-actions">
          <button class="pill-cta" id="focusQuickStart" type="button">
            <span class="cta-dot">${ikon(p.running ? "pause" : "play", 15)}</span>${p.running ? "Sedang berjalan" : "Mulai sesi fokus"}
          </button>
          <button class="linkout on-color" data-jump="settings" type="button">
            <span>Atur durasi</span><i aria-hidden="true">&#8599;</i>
          </button>
        </div>
      </div>

      <div class="band band-cream lift">
        <span class="band-label">Sesi ke-${(p.cycle || 0) + 1}</span>
        <h3>Fokus hari ini</h3>
        <div class="inline-stats">
          <div><span class="mini-icon">${ikon("clock", 16)}</span><small>Menit</small><b>${stat.menit}</b></div>
          <div><span class="mini-icon">${ikon("check", 16)}</span><small>Sesi</small><b>${stat.sesi}</b></div>
          <div><span class="mini-icon">${ikon("moon", 16)}</span><small>Rehat panjang</small><b>${kePanjang}</b></div>
        </div>
      </div>

      <div class="band band-gold lift">
        <div class="band-row-pick">
          <span class="band-orb" aria-hidden="true">${materi ? esc(materialTitle(materi)[0].toUpperCase()) : ikon("academic", 22)}</span>
          <label class="band-select">Sedang mengerjakan
            <select id="focusMaterial">
              <option value="">Tanpa materi tertentu</option>
              ${state.materials.map(m => `<option value="${esc(m.id)}"${p.materialId === m.id ? " selected" : ""}>${esc(materialTitle(m))}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="mode-chips" role="tablist">
          ${Object.entries(POMODORO_MODES).map(([key, cfg]) =>
            `<button class="focus-mode${p.mode === key ? " active" : ""}" data-mode="${key}" role="tab" aria-selected="${p.mode === key}">${esc(cfg.label)}<small>${pomodoroMinutes(key)} menit</small></button>`).join("")}
        </div>
      </div>

      <div class="band band-teal player lift">
        <div class="arc-wrap">
          <!-- Cincin dan teks jam sengaja bersaudara, bukan bersarang: cincin
               memakai CSS mask untuk membentuk donat, dan mask itu ikut
               menghapus apa pun yang ada di dalamnya. -->
          <div class="focus-ring" id="focusRing" style="--progress:0%"></div>
          <div class="focus-time">
            <strong id="focusClock">${formatClock(pomodoroRemaining())}</strong>
            <span class="focus-mode-name">${esc(POMODORO_MODES[p.mode].label)}</span>
          </div>
        </div>
        <p class="player-elapsed" id="focusElapsed">${formatClock(pomodoroElapsed())} / ${formatClock(pomodoroTotal())}</p>
        <div class="player-ctrls">
          <button class="round-ctrl" id="focusStop" type="button" aria-label="Hentikan sesi">${ikon("stop", 20)}</button>
          <button class="round-ctrl play" id="focusToggle" type="button" aria-label="${p.running ? "Jeda" : "Mulai"}">${ikon(p.running ? "pause" : "play", 26)}</button>
          <button class="round-ctrl" id="focusSkip" type="button" aria-label="Lewati ke sesi berikutnya">${ikon("forward", 20)}</button>
        </div>
      </div>`;

    $("#focusQuickStart", box).onclick = () => {
      if (p.running) { pausePomodoro(); return; }
      if (pomodoroElapsed() > 0) resumePomodoro();
      else startPomodoro(p.mode, $("#focusMaterial", box).value || null);
    };
    $$(".focus-mode", box).forEach(b => b.onclick = () => {
      if (p.running) { notify("Hentikan atau jeda sesi berjalan dulu.", "warn"); return; }
      state.pomodoro = { ...p, mode: b.dataset.mode, elapsedBefore: 0, running: false, startedAt: 0 };
      renderFocus();
    });
    $("#focusToggle", box).onclick = () => {
      if (p.running) pausePomodoro();
      else if (pomodoroElapsed() > 0) resumePomodoro();
      else startPomodoro(p.mode, $("#focusMaterial", box).value || null);
    };
    $("#focusStop", box).onclick = () => guard(stopPomodoro, "Gagal menghentikan sesi");
    $("#focusSkip", box).onclick = () => guard(finishPomodoro, "Gagal melewati sesi");
    $("#focusMaterial", box).onchange = e => { state.pomodoro.materialId = e.target.value || null; };
    paintPomodoroClock();
  }

  function openProfile() {
    renderProfile();
    openModal($("#profileModal"), isCloud() ? $("#syncLocalBtn") : $("#authEmail"));
  }
  function closeProfile() {
    closeModal($("#profileModal"));
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
    closeModal($("#quizModal"));
    const card = $("#quizModalCard");
    if (card) card.innerHTML = "";
  }

  function bindEvents() {
    $$(".nav-item").forEach(b => b.onclick = () => setView(b.dataset.view));
    $$("#menuToggle").forEach(b => b.onclick = openDrawer);
    $$("#drawerClose, #drawerOverlay").forEach(b => b.onclick = closeDrawer);
    document.addEventListener("keydown", e => {
      if (e.key === "Tab") { handleModalTab(e); return; }
      if (e.key !== "Escape") return;
      // Escape hanya menutup lapisan paling atas, bukan semuanya sekaligus.
      const top = topModal();
      if (top?.id === "askModal") { settleAsk(false); return; }
      if (top?.id === "quizModal") { closeQuizModal(); return; }
      if (top?.id === "profileModal") { closeProfile(); return; }
      closeDrawer();
    });
    const askModal = $("#askModal");
    if (askModal) askModal.addEventListener("click", e => { if (e.target === askModal) settleAsk(false); });
    if ($("#askConfirm")) $("#askConfirm").onclick = () => settleAsk(true);
    if ($("#askCancel")) $("#askCancel").onclick = () => settleAsk(false);
    ["#profileBtn", "#mobileProfileBtn"].forEach(sel => { const b = $(sel); if (b) b.onclick = openProfile; });
    const profileModal = $("#profileModal"); if (profileModal) profileModal.addEventListener("click", e => { if (e.target === profileModal) closeProfile(); });
    const profileClose = $("#profileClose"); if (profileClose) profileClose.onclick = closeProfile;
    $$('[data-jump]').forEach(b => b.onclick = () => setView(b.dataset.jump));
    $("#pdfInput").onchange = async (e) => {
      const file = e.target.files[0];
      // Input di-reset supaya memilih file yang SAMA dua kali tetap memicu onchange.
      e.target.value = "";
      if (!file) return;
      setStatus("Membaca PDF...");
      try {
        const extracted = await extractPdf(file, $("#pdfPageRange")?.value || "");
        $("#textInput").value = extracted.text;
        const warning = extracted.lowTextPages ? ` ${extracted.lowTextPages} halaman hanya memiliki sedikit teks dan mungkin hasil scan.` : "";
        setStatus(`PDF terbaca: ${extracted.pages}/${extracted.totalPages} halaman, ${extracted.text.length.toLocaleString("id-ID")} karakter.${warning}`);
      }
      catch (err) {
        console.error(err);
        setStatus(`Gagal baca PDF: ${err.message}`);
        notify(`Gagal baca PDF: ${err.message}`, "error");
      }
    };
    // Semua tombol yang memanggil AI dikunci selama proses: klik ganda dulu
    // memicu dua request, dua materi duplikat, dan jatah rate limit terbakar.
    const generateBtn = $("#generateBtn");
    generateBtn.onclick = () => withBusy(generateBtn, "Memproses...", () => guard(generateMaterial, "Gagal generate"));
    const saveManualBtn = $("#saveManualBtn");
    saveManualBtn.onclick = () => withBusy(saveManualBtn, "Menyimpan...", () => guard(saveManual, "Gagal menyimpan"));
    $("#searchInput").oninput = renderLibrary;

    $$("#rankRange .seg").forEach(b => b.onclick = () => {
      state.rankRange = b.dataset.range;
      $$("#rankRange .seg").forEach(x => x.classList.toggle("active", x === b));
      renderAnalytics();
    });
    const noteSearch = $("#noteSearch");
    if (noteSearch) noteSearch.oninput = e => { state.noteFilter = e.target.value; renderNotes(); };
    const newNoteBtn = $("#newNoteBtn");
    if (newNoteBtn) newNoteBtn.onclick = () => guard(async () => {
      const id = await createNote({ title: "Catatan baru", body: "" });
      openNote(id);
    }, "Gagal membuat catatan");
    $("#refreshBtn").onclick = () => { state.reviewSessionDone = 0; state.reviewSessionClosed = false; state.currentReview = 0; renderReview(); };
    const teachBtn = $("#teachBtn");
    teachBtn.onclick = () => withBusy(teachBtn, "Menilai...", () => guard(evaluateTeaching, "Gagal menilai"));
    $("#saveAiSettings").onclick = () => guard(async () => {
      state.settings.provider = $("#providerSelect").value;
      state.settings.geminiModel = $("#geminiModel").value.trim();
      state.settings.groqModel = $("#groqModel").value.trim();
      state.settings.openrouterModel = $("#openrouterModel").value.trim();
      state.settings.masteryThreshold = clamp(Number($("#masteryThreshold")?.value || 70), 50, 95);
      state.settings.targetRetention = clamp(Number($("#targetRetention")?.value || 0.85), 0.7, 0.95);
      state.settings.focusMinutes = clamp(Number($("#focusMinutes")?.value || 25), 1, 180);
      state.settings.shortBreakMinutes = clamp(Number($("#shortBreakMinutes")?.value || 5), 1, 60);
      state.settings.longBreakMinutes = clamp(Number($("#longBreakMinutes")?.value || 15), 1, 90);
      state.settings.longBreakEvery = clamp(Number($("#longBreakEvery")?.value || 4), 2, 8);
      state.settings.pomodoroSound = !!$("#pomodoroSound")?.checked;
      state.settings.pomodoroAutoBreak = !!$("#pomodoroAutoBreak")?.checked;
      await saveSettings();
      renderAll();
      notify("AI & Memory settings tersimpan.", "success");
    }, "Gagal menyimpan settings");
    const testAiBtn = $("#testAiBtn");
    testAiBtn.onclick = () => withBusy(testAiBtn, "Mengetes...", async () => {
      try {
        const r = await callAI("ping", { text: "Jawab singkat: AI server aktif." });
        notify(`AI server aktif: ${r.message || JSON.stringify(r)}`, "success");
      } catch (e) {
        notify(`AI server gagal: ${e.message}`, "error");
      }
    });
    const signUpBtn = $("#signUpBtn");
    if (signUpBtn) signUpBtn.onclick = () => withBusy(signUpBtn, "Membuat...", () => guard(() => authAction("signUp"), "Gagal membuat akun"));
    const loginBtn = $("#loginBtn");
    if (loginBtn) loginBtn.onclick = () => withBusy(loginBtn, "Masuk...", () => guard(() => authAction("signInWithPassword"), "Gagal login"));
    const logoutBtn = $("#logoutBtn");
    if (logoutBtn) logoutBtn.onclick = () => withBusy(logoutBtn, "Keluar...", () => guard(async () => {
      if (state.supa) await state.supa.auth.signOut();
      closeProfile();
      await refreshAll();
      notify("Kamu sudah logout. Data cloud tetap aman.", "success");
    }, "Gagal logout"));
    $("#exportBtn").onclick = () => guard(exportJSON, "Gagal export");
    $("#importInput").onchange = e => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file) guard(() => importJSON(file), "Gagal import");
    };
    const syncLocalBtn = $("#syncLocalBtn");
    if (syncLocalBtn) syncLocalBtn.onclick = () => withBusy(syncLocalBtn, "Sync...", () => guard(() => syncLocalToCloud(), "Gagal sync"));
    $("#resetBtn").onclick = () => guard(resetLocal, "Gagal reset");
    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault(); state.deferredInstall = e;
      const b = $("#mobileInstallBtn");
      if (b) b.hidden = false;
    });
    const install = async () => {
      if (state.deferredInstall) {
        state.deferredInstall.prompt(); state.deferredInstall = null;
        const b = $("#mobileInstallBtn");
        if (b) b.hidden = true;
      }
    };
    if ($("#mobileInstallBtn")) $("#mobileInstallBtn").onclick = install;
  }

  async function authAction(kind) {
    if (!state.supa) { notify("Cloud belum aktif di server. Isi SUPABASE_URL dan SUPABASE_ANON_KEY di Environment Variables Vercel sekali saja.", "warn", 10000); return; }
    const email = $("#authEmail")?.value.trim(), password = $("#authPassword")?.value;
    if (!email || !password) { notify("Isi email dan password dulu.", "warn"); return; }

    const { data, error } = await state.supa.auth[kind]({ email, password });
    if (error) { notify(error.message, "error"); return; }

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
      notify("Akun dibuat. Kalau email confirmation aktif, cek email dulu, lalu login lagi.", "success", 10000);
    } else {
      notify(kind === "signUp" ? "Akun dibuat, login berhasil, dan data otomatis disinkronkan." : "Login berhasil. Data otomatis disinkronkan.", "success");
      closeProfile();
    }
  }

  async function boot() {
    db = await openDB();
    await loadSettings();
    await loadPublicConfig();
    // Kegagalan Supabase tidak boleh menjatuhkan seluruh aplikasi: mode lokal
    // harus tetap bisa dipakai walaupun cloud sedang bermasalah.
    try { await initSupabase(); }
    catch (err) {
      console.error("Supabase gagal diinisialisasi", err);
      state.supa = null; state.user = null;
    }
    await loadData();
    bindEvents();
    renderAll();
    pasangIkon();
    if (!state.supa && state.supabaseConfig) notify("Cloud dikonfigurasi tapi gagal tersambung. Aiyone jalan dalam mode lokal.", "warn", 9000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  boot().catch(err => {
    console.error(err);
    notify(`Aiyone gagal start: ${err.message}`, "error", 0);
  });
})();
