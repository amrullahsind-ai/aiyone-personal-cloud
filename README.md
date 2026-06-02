# Aiyone Personal v8 — Auto Cloud Profile

Versi ini memindahkan login dan sinkronisasi ke tombol **Profil** di pojok kanan atas. Settings tidak lagi dipakai untuk memasukkan Supabase URL/anon key.

## Perubahan v8

- Supabase URL dan anon key dibaca otomatis dari server/Vercel Environment Variables.
- User cukup klik **Profil → Login**. Setelah login, data lokal otomatis sync ke cloud.
- UI profil muncul di pojok kanan atas, dengan status akun dan tombol sync ulang/logout.
- Settings hanya untuk AI, memory engine, backup, dan reset local.
- Tetap kompatibel dengan database Supabase lama selama migrasi v6/v7 sudah dijalankan.

## Jalankan lokal

```bash
copy .env.example .env
# isi GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY di .env
node server.js
```

Buka `http://localhost:4173`.

## Deploy ke Vercel

Isi Environment Variables di Vercel:

```env
GEMINI_API_KEY=...
AI_PROVIDER=gemini
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
```

Opsional fallback AI:

```env
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
```

Setelah deploy, buka Aiyone → klik Profil pojok kanan atas → login. Data akan auto sync.

## Supabase

Tidak perlu isi kode Supabase di Settings. Kalau database lama error kolom, baca `MIGRASI_SUPABASE_AMAN.md`.
