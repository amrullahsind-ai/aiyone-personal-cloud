const DEFAULTS = {
  gemini: "gemini-2.5-flash-lite",
  groq: "llama-3.1-8b-instant",
  openrouter: "google/gemini-2.0-flash-exp:free"
};
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = Number(process.env.AI_RATE_LIMIT || 15);
const RATE_MAX_KEYS = 5000;

// Anggaran waktu untuk SATU request, termasuk seluruh rantai fallback provider.
// vercel.json membatasi fungsi ini di 30 detik; kalau tiap provider diberi
// timeout 30 detik sendiri-sendiri, rantai 3 provider bisa menembus batas itu
// dan fungsi mati tanpa respons yang berarti.
const TIME_BUDGET_MS = Math.max(5000, Number(process.env.AI_TIME_BUDGET_MS || 25000));
const MIN_PROVIDER_MS = 6000;
const MAX_PROVIDER_MS = 20000;

const rateBuckets = new Map();

function fetchTimed(url, options = {}, timeoutMs = 30000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(Math.max(1000, timeoutMs)) });
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (req.body && typeof req.body === "string") return JSON.parse(req.body || "{}");
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 250000) {
        const err = new Error("Request terlalu besar."); err.status = 413;
        reject(err); req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function requestIp(req) {
  return String(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

/**
 * Batas ini in-memory, jadi TIDAK mengikat di serverless multi-instance:
 * setiap instance punya salinan sendiri dan hilang saat cold start. Ini rem
 * darurat terhadap klik ganda dan loop yang lepas kendali, bukan kuota yang
 * sungguh-sungguh. Untuk batas yang benar-benar berlaku, pindahkan penghitung
 * ini ke Redis atau tabel Supabase.
 */
function enforceRateLimit(key) {
  const now = Date.now();
  pruneRateBuckets(now);
  const current = rateBuckets.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > RATE_MAX) {
    const err = new Error("Batas penggunaan AI tercapai. Coba lagi beberapa menit."); err.status = 429; throw err;
  }
}

// Tanpa ini, Map terus tumbuh selama proses hidup (bocor di server lokal
// yang dibiarkan jalan berhari-hari).
function pruneRateBuckets(now = Date.now()) {
  if (rateBuckets.size < RATE_MAX_KEYS / 2) {
    for (const [key, bucket] of rateBuckets) {
      if (now - bucket.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(key);
    }
    return;
  }
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(key);
    if (rateBuckets.size <= RATE_MAX_KEYS / 2) break;
  }
  while (rateBuckets.size > RATE_MAX_KEYS) rateBuckets.delete(rateBuckets.keys().next().value);
}

async function verifyAuth(req) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY || "";
  const required = String(process.env.AI_REQUIRE_AUTH || (supabaseUrl && anonKey ? "true" : "false")).toLowerCase() === "true";
  if (!required) return { id: requestIp(req), authenticated: false };
  if (!supabaseUrl || !anonKey) {
    const err = new Error("AI_REQUIRE_AUTH aktif tetapi konfigurasi Supabase belum lengkap."); err.status = 503; throw err;
  }
  const authorization = String(req.headers?.authorization || "");
  if (!authorization.startsWith("Bearer ")) {
    const err = new Error("Login diperlukan untuk menggunakan AI."); err.status = 401; throw err;
  }
  let res;
  try {
    res = await fetchTimed(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: anonKey }
    }, 8000);
  } catch (_) {
    const err = new Error("Tidak bisa memverifikasi sesi login. Coba lagi."); err.status = 503; throw err;
  }
  const user = await res.json().catch(() => ({}));
  if (!res.ok || !user.id) {
    const err = new Error("Sesi login tidak valid atau sudah kedaluwarsa."); err.status = 401; throw err;
  }
  return { id: user.id, authenticated: true };
}

function validatePayload(type, payload = {}) {
  if (type === "buildMaterial") {
    const text = String(payload.text || "");
    if (text.length < 80) { const err = new Error("Materi terlalu pendek."); err.status = 400; throw err; }
    if (text.length > 30000) { const err = new Error("Materi maksimal 30.000 karakter per proses."); err.status = 413; throw err; }
  }
  if (type === "evaluateTeaching") {
    const answer = String(payload.answer || "");
    if (answer.length < 50) { const err = new Error("Penjelasan terlalu pendek untuk dinilai."); err.status = 400; throw err; }
    if (answer.length > 12000) { const err = new Error("Penjelasan maksimal 12.000 karakter."); err.status = 413; throw err; }
  }
}

function validateResult(type, result, payload = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("AI tidak menghasilkan objek JSON.");
  if (type === "ping") return { result, warnings: [] };
  if (type === "evaluateTeaching") {
    const score = Number(result.masteryScore ?? result.mastery_score);
    if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("Skor evaluasi AI tidak valid.");
    if (!result.rubric || typeof result.rubric !== "object") throw new Error("Rubrik evaluasi AI tidak lengkap.");
    return { result, warnings: [] };
  }
  const warnings = [];
  const concepts = Array.isArray(result.concepts) ? result.concepts.filter(c => c?.name && c?.definition) : [];
  const cards = Array.isArray(result.flashcards) ? result.flashcards.filter(c => (c?.front || c?.question) && (c?.back || c?.answer)) : [];
  const quizzes = Array.isArray(result.quizzes) ? result.quizzes.filter(q => q?.question && Array.isArray(q.options) && q.options.length >= 2) : [];
  if (!String(result.title || "").trim()) throw new Error("AI tidak menghasilkan judul materi.");
  if (concepts.length < 3) throw new Error("AI menghasilkan terlalu sedikit konsep yang valid.");
  if (cards.length < 4) throw new Error("AI menghasilkan terlalu sedikit flashcard yang valid.");
  if (quizzes.length < 4) throw new Error("AI menghasilkan terlalu sedikit soal yang valid.");
  if (quizzes.some(q => new Set(q.options.map(x => String(x).trim().toLowerCase())).size !== q.options.length)) warnings.push("Ada opsi quiz duplikat; frontend akan membersihkannya.");
  if (!String(result.summaryShort || result.summary_short || "").trim()) warnings.push("Ringkasan pendek kosong.");
  const sourcePages = new Set([...String(payload.text || "").matchAll(/---\s*Halaman\s+(\d+)\s*---/gi)].map(match => Number(match[1])));
  const cleanRef = item => {
    if (!sourcePages.size) return item;
    const ref = String(item.sourceRef || item.source_ref || "");
    const page = Number(ref.match(/(\d+)/)?.[1]);
    if (!page || !sourcePages.has(page)) return { ...item, sourceRef: "" };
    return { ...item, sourceRef: `Halaman ${page}` };
  };
  const groundedConcepts = concepts.map(cleanRef);
  const sectionsRaw = Array.isArray(result.studySections) ? result.studySections : Array.isArray(result.study_sections) ? result.study_sections : [];
  const groundedSections = sectionsRaw.map(cleanRef);
  if (sourcePages.size && groundedConcepts.some(item => !item.sourceRef)) warnings.push("Sebagian konsep tidak memiliki rujukan halaman yang valid.");
  const grounded = { ...result, concepts: groundedConcepts, flashcards: cards, quizzes };
  if (Array.isArray(result.studySections)) grounded.studySections = groundedSections;
  if (Array.isArray(result.study_sections)) grounded.study_sections = groundedSections;
  return { result: grounded, warnings };
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function buildPrompt(type, payload = {}) {
  if (type === "ping") {
    return `Return only valid JSON: {"message":"AI server aktif"}`;
  }

  if (type === "evaluateTeaching") {
    const material = payload.material || {};
    return `
Kamu adalah Aiyone, pelatih belajar yang ketat tapi membantu. Nilai penjelasan pengguna berdasarkan materi.

MATERI:
Judul: ${material.title || "Materi"}
Ringkasan: ${material.summary || ""}
Konsep inti: ${JSON.stringify(material.concepts || []).slice(0, 12000)}
Fokus: ${payload.focus || "semua konsep penting"}

PENJELASAN PENGGUNA:
${payload.answer || ""}

Tugas:
1. Jangan memuji kosong.
2. Deteksi miskonsepsi, bagian yang hilang, dan konsep prasyarat yang belum kuat.
3. Beri rubrik angka 0-100 untuk accuracy, completeness, examples, clarity.
4. masteryScore adalah rata-rata berbobot: accuracy 40%, completeness 30%, examples 15%, clarity 15%.
5. Gunakan prinsip metakognisi: jelaskan kenapa pengguna terlihat paham atau belum paham.
6. Beri nextAction yang jelas: lanjut/review konsep tertentu/ulang dari dasar.

Return ONLY valid JSON tanpa markdown dengan bentuk:
{
  "masteryScore": 0,
  "rubric": {"accuracy":0,"completeness":0,"examples":0,"clarity":0},
  "misconceptions": ["..."],
  "missingPoints": ["..."],
  "feedback": "...",
  "nextAction": "..."
}`;
  }

  return `
Kamu adalah Aiyone, sistem belajar anti-cognitive-debt. Tugasmu bukan cuma meringkas, tapi mengubah materi menjadi learning pack yang memaksa pengguna berpikir aktif.

MATERI USER:
Judul hint: ${payload.titleHint || ""}
Kategori hint: ${payload.categoryHint || ""}
Teks materi:
${payload.text || ""}

Aturan kualitas psikologi pendidikan:
- Jangan cuma meringkas. Pecah materi jadi urutan belajar bertahap berbasis cognitive load: satu bagian = satu beban konsep utama.
- Urutan studySections harus mengikuti scaffolding: prasyarat/fondasi → konsep inti → contoh → penerapan → miskonsepsi/jebakan.
- Setiap bagian belajar wajib punya judul, penjelasan 4-7 kalimat, contoh konkret, miskonsepsi kecil bila ada, dan active recall question.
- Gunakan active recall, retrieval practice, dual coding teks/contoh, elaboration, dan mastery learning. Hindari jawaban yang membuat pengguna cuma membaca pasif.
- Pecah materi menjadi konsep inti, definisi, contoh, relasi antar konsep, dan miskonsepsi.
- Flashcard harus pendek, spesifik, dan menguji ingatan aktif. Jangan terlalu generik.
- Quiz harus bertingkat: definition, understanding, application, analysis. Sertakan soal miskonsepsi/diagnostik.
- Buat quiz minimal 8 jika materi cukup, dan setiap quiz harus punya 4 opsi.
- Setiap quiz WAJIB punya answerIndex berbasis 0 yang menunjuk ke posisi jawaban benar di dalam array options-nya sendiri. Jangan pakai penomoran mulai 1. Jangan ada dua opsi yang isinya sama.
- Sebar posisi jawaban benar secara merata di seluruh soal. Jangan selalu menaruhnya di opsi pertama.
- Jika teks memiliki penanda "--- Halaman N ---", setiap studySection dan concept wajib memiliki sourceRef seperti "Halaman 3". Jangan mengarang nomor halaman.
- Semua klaim harus dapat ditelusuri ke materi pengguna. Jika materi tidak mendukung suatu klaim, jangan masukkan klaim tersebut.
- Return ONLY valid JSON. Tidak boleh markdown, tidak boleh komentar di luar JSON.

Format JSON wajib:
{
  "title": "judul materi rapi",
  "category": "kategori singkat",
  "summaryShort": "ringkasan 2-3 kalimat",
  "summaryLong": "ringkasan 5-8 paragraf pendek, dipisah dengan newline kosong",
  "keyTakeaways": ["5-8 poin penting yang spesifik"],
  "studySections": [
    {"title":"judul bagian belajar","explanation":"penjelasan 4-7 kalimat yang jelas, bertahap, dan mudah dipelajari","example":"contoh konkret","activeRecall":"pertanyaan untuk mengecek pemahaman","sourceRef":"Halaman 1 atau Bagian sumber"}
  ],
  "concepts": [
    {"id":"c1","name":"nama konsep","definition":"definisi jelas 2-3 kalimat","example":"contoh konkret","common_misconception":"miskonsepsi umum","importance":"high|medium|low","sourceRef":"Halaman 1 atau Bagian sumber"}
  ],
  "flashcards": [
    {"concept":"nama konsep","front":"pertanyaan kartu","back":"jawaban ideal ringkas","difficulty":"easy|medium|hard"}
  ],
  "quizzes": [
    {"concept":"nama konsep","level":"definition|understanding|application|analysis","question":"soal","options":["opsi A","opsi B","opsi C","opsi D"],"answerIndex":0,"explanation":"kenapa jawaban benar dan opsi lain kurang tepat; sebutkan miskonsepsi jika ada"}
  ]
}

Batas jumlah:
- studySections 6-12 bagian jika materi panjang, 4-7 jika materi pendek.
- concepts 6-12.
- flashcards 12-24.
- quizzes 8-16.`;
}

/**
 * Menambahkan escape pada newline yang berada DI DALAM string JSON saja.
 *
 * Versi sebelumnya memakai `.replace(/\n/g, "\\n")` tanpa pandang bulu,
 * sehingga newline antar-token ikut diubah dan menghasilkan JSON yang justru
 * makin rusak — jalur perbaikan malah selalu gagal.
 */
function escapeNewlinesInsideStrings(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of String(text)) {
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === "\\") { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (inString && (ch === "\n" || ch === "\r")) { out += "\\n"; continue; }
    if (inString && ch === "\t") { out += "\\t"; continue; }
    out += ch;
  }
  return out;
}

function parseJSONMaybe(text) {
  if (typeof text !== "string") return text;
  let cleaned = text.trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  try { return JSON.parse(cleaned); } catch (_) {}
  const repaired = escapeNewlinesInsideStrings(cleaned)
    .replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(repaired);
}

async function callProvider(provider, prompt, model, jsonMode = true, timeoutMs = 20000) {
  if (provider === "gemini") return callGemini(prompt, model || DEFAULTS.gemini, jsonMode, timeoutMs);
  if (provider === "groq") return callOpenAICompat("groq", prompt, model || DEFAULTS.groq, "https://api.groq.com/openai/v1/chat/completions", process.env.GROQ_API_KEY, timeoutMs);
  if (provider === "openrouter") return callOpenAICompat("openrouter", prompt, model || DEFAULTS.openrouter, "https://openrouter.ai/api/v1/chat/completions", process.env.OPENROUTER_API_KEY, timeoutMs);
  throw new Error(`Provider tidak dikenal: ${provider}`);
}

async function callGemini(prompt, model, jsonMode, timeoutMs) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY belum diset di server/.env/Vercel.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 20000,
      ...(jsonMode ? { responseMimeType: "application/json" } : {})
    }
  };
  const res = await fetchTimed(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini HTTP ${res.status}`;
    const err = new Error(msg); err.status = res.status; throw err;
  }
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n") || "";
  if (!text) throw new Error("Gemini tidak mengembalikan teks.");
  return text;
}

async function callOpenAICompat(provider, prompt, model, url, key, timeoutMs) {
  if (!key) throw new Error(`${provider.toUpperCase()}_API_KEY belum diset di server/.env/Vercel.`);
  const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${key}` };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.OPENROUTER_REFERER || "http://localhost:4173";
    headers["X-Title"] = "Aiyone Personal Cloud";
  }
  const body = {
    model,
    messages: [
      { role: "system", content: "You return only valid JSON. No markdown." },
      { role: "user", content: prompt }
    ],
    temperature: 0.2,
    response_format: { type: "json_object" }
  };
  const res = await fetchTimed(url, { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `${provider} HTTP ${res.status}`);
  return data?.choices?.[0]?.message?.content || "";
}

async function repairJSON(raw, provider, model, originalType, timeoutMs) {
  const repairPrompt = `
Perbaiki teks berikut menjadi JSON valid sesuai maksudnya. Jangan ubah isi substansi kecuali perlu untuk membuat JSON valid.
Return ONLY valid JSON tanpa markdown.

Jenis data: ${originalType}
Teks rusak:
${String(raw).slice(0, 24000)}`;
  const fixedRaw = await callProvider(provider, repairPrompt, model, true, timeoutMs);
  return parseJSONMaybe(fixedRaw);
}

function hasProviderKey(provider) {
  if (provider === "gemini") return !!process.env.GEMINI_API_KEY;
  if (provider === "groq") return !!process.env.GROQ_API_KEY;
  if (provider === "openrouter") return !!process.env.OPENROUTER_API_KEY;
  return false;
}

async function main(req, res) {
  if (req.method && req.method.toUpperCase() === "OPTIONS") {
    res.setHeader("Allow", "POST, OPTIONS");
    return send(res, 204, { ok: true });
  }
  if (req.method && req.method.toUpperCase() !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }

  const deadline = Date.now() + TIME_BUDGET_MS;
  const remaining = () => deadline - Date.now();

  try {
    const identity = await verifyAuth(req);
    enforceRateLimit(identity.id || requestIp(req));
    const body = await readBody(req);
    const type = body.type || "buildMaterial";
    const wanted = body.provider || process.env.AI_PROVIDER || "gemini";
    if (!["gemini", "groq", "openrouter"].includes(wanted)) {
      const err = new Error("Provider AI tidak diizinkan."); err.status = 400; throw err;
    }
    if (!["buildMaterial", "evaluateTeaching", "ping"].includes(type)) {
      const err = new Error("Jenis permintaan AI tidak dikenal."); err.status = 400; throw err;
    }
    validatePayload(type, body.payload || {});
    const model = body.model || DEFAULTS[wanted];
    const prompt = buildPrompt(type, body.payload || {});
    const allProviders = [wanted, "gemini", "groq", "openrouter"].filter((p, i, arr) => arr.indexOf(p) === i);
    const providers = allProviders.filter(hasProviderKey);
    if (!providers.length) {
      throw new Error("Belum ada API key AI di server. Isi minimal GEMINI_API_KEY di file .env lokal atau Environment Variables Vercel.");
    }

    const errors = [];
    for (const provider of providers) {
      // Berhenti mencoba provider berikutnya kalau sisa waktu sudah tidak
      // cukup. Lebih baik pesan error yang jelas daripada fungsi mati diam.
      if (remaining() < MIN_PROVIDER_MS) {
        errors.push(`${provider}: dilewati, waktu request hampir habis`);
        break;
      }
      const budget = Math.min(MAX_PROVIDER_MS, remaining() - 1500);
      try {
        const providerModel = provider === wanted ? model : DEFAULTS[provider];
        const raw = await callProvider(provider, prompt, providerModel, true, budget);
        let result;
        try { result = parseJSONMaybe(raw); }
        catch (_) {
          if (remaining() < MIN_PROVIDER_MS) throw new Error("JSON rusak dan tidak ada sisa waktu untuk memperbaikinya.");
          result = await repairJSON(raw, provider, providerModel, type, Math.min(MAX_PROVIDER_MS, remaining() - 1000));
        }
        const validated = validateResult(type, result, body.payload || {});
        return send(res, 200, { ok: true, provider, model: providerModel, result: validated.result, warnings: validated.warnings });
      } catch (err) {
        errors.push(`${provider}: ${err.message}`);
        continue;
      }
    }
    const failure = new Error(`Semua provider AI gagal. ${errors.join(" | ")}`);
    failure.status = 502;
    throw failure;
  } catch (err) {
    return send(res, err.status || 500, { ok: false, error: err.message || String(err) });
  }
}

module.exports = main;
module.exports._test = { validatePayload, validateResult, enforceRateLimit, parseJSONMaybe, escapeNewlinesInsideStrings };
