const DEFAULTS = {
  gemini: "gemini-2.5-flash-lite",
  groq: "llama-3.1-8b-instant",
  openrouter: "google/gemini-2.0-flash-exp:free"
};

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (req.body && typeof req.body === "string") return JSON.parse(req.body || "{}");
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => raw += chunk);
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
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
- Return ONLY valid JSON. Tidak boleh markdown, tidak boleh komentar di luar JSON.

Format JSON wajib:
{
  "title": "judul materi rapi",
  "category": "kategori singkat",
  "summaryShort": "ringkasan 2-3 kalimat",
  "summaryLong": "ringkasan 5-8 paragraf pendek, dipisah dengan newline kosong",
  "keyTakeaways": ["5-8 poin penting yang spesifik"],
  "studySections": [
    {"title":"judul bagian belajar","explanation":"penjelasan 4-7 kalimat yang jelas, bertahap, dan mudah dipelajari","example":"contoh konkret","activeRecall":"pertanyaan untuk mengecek pemahaman"}
  ],
  "concepts": [
    {"id":"c1","name":"nama konsep","definition":"definisi jelas 2-3 kalimat","example":"contoh konkret","common_misconception":"miskonsepsi umum","importance":"high|medium|low"}
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

function parseJSONMaybe(text) {
  if (typeof text !== "string") return text;
  let cleaned = text.trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim()
    .replace(/[\u0000-\u001F]+/g, ch => ch === "\n" || ch === "\t" ? ch : " ");
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  try { return JSON.parse(cleaned); } catch (_) {}
  const repaired = cleaned
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/\n/g, "\\n");
  return JSON.parse(repaired);
}

async function callProvider(provider, prompt, model, jsonMode = true) {
  if (provider === "gemini") return callGemini(prompt, model || DEFAULTS.gemini, jsonMode);
  if (provider === "groq") return callOpenAICompat("groq", prompt, model || DEFAULTS.groq, "https://api.groq.com/openai/v1/chat/completions", process.env.GROQ_API_KEY);
  if (provider === "openrouter") return callOpenAICompat("openrouter", prompt, model || DEFAULTS.openrouter, "https://openrouter.ai/api/v1/chat/completions", process.env.OPENROUTER_API_KEY);
  throw new Error(`Provider tidak dikenal: ${provider}`);
}

async function callGemini(prompt, model, jsonMode) {
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
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini HTTP ${res.status}`;
    const err = new Error(msg); err.status = res.status; throw err;
  }
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n") || "";
  if (!text) throw new Error("Gemini tidak mengembalikan teks.");
  return text;
}

async function callOpenAICompat(provider, prompt, model, url, key) {
  if (!key) throw new Error(`${provider.toUpperCase()}_API_KEY belum diset di server/.env/Vercel.`);
  const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${key}` };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost:4173";
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
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `${provider} HTTP ${res.status}`);
  return data?.choices?.[0]?.message?.content || "";
}

async function repairJSON(raw, provider, model, originalType) {
  const repairPrompt = `
Perbaiki teks berikut menjadi JSON valid sesuai maksudnya. Jangan ubah isi substansi kecuali perlu untuk membuat JSON valid.
Return ONLY valid JSON tanpa markdown.

Jenis data: ${originalType}
Teks rusak:
${String(raw).slice(0, 24000)}`;
  const fixedRaw = await callProvider(provider, repairPrompt, model, true);
  return parseJSONMaybe(fixedRaw);
}

function hasProviderKey(provider) {
  if (provider === "gemini") return !!process.env.GEMINI_API_KEY;
  if (provider === "groq") return !!process.env.GROQ_API_KEY;
  if (provider === "openrouter") return !!process.env.OPENROUTER_API_KEY;
  return false;
}

async function main(req, res) {
  if (req.method && req.method.toUpperCase() === "OPTIONS") return send(res, 200, { ok: true });
  if (req.method && req.method.toUpperCase() !== "POST") return send(res, 405, { error: "Method not allowed" });

  try {
    const body = await readBody(req);
    const type = body.type || "buildMaterial";
    const wanted = body.provider || process.env.AI_PROVIDER || "gemini";
    const model = body.model || DEFAULTS[wanted];
    const prompt = buildPrompt(type, body.payload || {});
    const allProviders = [wanted, "gemini", "groq", "openrouter"].filter((p, i, arr) => arr.indexOf(p) === i);
    const providers = allProviders.filter(hasProviderKey);
    if (!providers.length) {
      throw new Error("Belum ada API key AI di server. Isi minimal GEMINI_API_KEY di file .env lokal atau Environment Variables Vercel.");
    }

    const errors = [];
    for (const provider of providers) {
      try {
        const providerModel = provider === wanted ? model : DEFAULTS[provider];
        const raw = await callProvider(provider, prompt, providerModel, true);
        let result;
        try { result = parseJSONMaybe(raw); }
        catch (_) { result = await repairJSON(raw, provider, providerModel, type); }
        return send(res, 200, { ok: true, provider, model: providerModel, result });
      } catch (err) {
        errors.push(`${provider}: ${err.message}`);
        continue;
      }
    }
    throw new Error(`Semua provider AI gagal. ${errors.join(" | ")}`);
  } catch (err) {
    return send(res, err.status || 500, { ok: false, error: err.message || String(err) });
  }
}

module.exports = main;
