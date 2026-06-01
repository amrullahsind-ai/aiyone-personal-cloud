# Aiyone Personal Psychopedagogy Edition v6

Aiyone v6 adalah PWA belajar personal dengan AI server, Supabase cloud database opsional, sesi belajar terarah, quiz full-screen, teaching mode, flashcard memory rating, dashboard aksi harian, dan Memory Engine v2 yang lebih psikopedagogis.

## Yang baru di v6

- Memory Engine v2: rating + confidence + waktu jawab + stability + difficulty + target retention.
- Pre-test dan post-test pada Sesi Belajar untuk diagnosis awal dan bukti mastery.
- Smart streak mengikuti mastery threshold yang bisa diatur di Settings.
- Quiz score disimpan ke riwayat aktivitas dan mastery score materi.
- Kartu dari konsep yang salah saat quiz didorong muncul lebih cepat.
- Prompt AI diperkuat dengan cognitive load, scaffolding, active recall, retrieval practice, elaboration, dan misconception check.
- Schema Supabase diperluas untuk field psikometrik: confidence, response time, retention_before, stability, memory_difficulty.

## Jalankan lokal

```bash
cp .env.example .env
# isi GEMINI_API_KEY di .env
node server.js
```

Buka `http://localhost:4173`.

## Windows

Kalau di Windows CMD:

```bat
copy .env.example .env
node server.js
```

Jangan double click `server.js`; jalankan lewat Terminal/Command Prompt.

## Deploy ke Vercel

Isi Environment Variables:

```env
GEMINI_API_KEY=...
AI_PROVIDER=gemini
```

Opsional:

```env
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
```

## Supabase

Jalankan `supabase/schema.sql` di SQL Editor, lalu masukkan Project URL dan anon key/publishable key di Settings Aiyone.

Kalau kamu sudah pernah menjalankan schema versi lama, schema v6 tetap aman dirun ulang karena memakai `add column if not exists`.
