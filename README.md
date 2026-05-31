# Aiyone Personal Cloud Edition v5

Aiyone v5 adalah versi mobile-first dari Aiyone Personal Cloud: PWA belajar personal dengan AI server, Supabase cloud database, sesi belajar terarah, quiz full-screen, teaching mode, flashcard memory rating, dan dashboard aksi harian.

## Jalankan lokal

```bash
cp .env.example .env
# isi GEMINI_API_KEY di .env
node server.js
```

Buka `http://localhost:4173`.

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

## Catatan v5

- Mobile memakai hamburger drawer + bottom nav.
- Quiz tampil full-screen, tidak lagi nyempil di Library.
- Setelah generate materi, Aiyone langsung membuka Sesi Belajar Terarah.
- Prompt AI dibuat lebih cocok untuk modul belajar bertahap.
- Service worker cache dinaikkan ke v5.
