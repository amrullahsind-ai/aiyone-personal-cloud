# Aiyone Personal Cloud Edition

Versi ini memperbaiki dua hal besar:

1. **Server AI aman**: API key AI tidak lagi ditaruh di browser. App memanggil `/api/generate`, lalu server yang menghubungi Gemini/Groq/OpenRouter.
2. **Database profesional gratis**: bisa pakai Supabase Free dengan PostgreSQL + Auth + Row Level Security.

## Fitur inti

- UI/UX v3 lebih rapi: detail materi bertahap, quiz tidak auto-macet, opsi quiz full-width.
- Upload PDF teks atau tempel materi.
- AI Concept Extractor.
- Ringkasan pendek, panjang, dan **Materi Dipelajari Bertahap**.
- Flashcard active recall.
- Quiz bertingkat: definition, understanding, application, analysis; ada fallback quiz dari flashcard kalau AI hanya membuat sedikit soal.
- Teaching Mode dengan rubrik.
- Memory Engine / spaced repetition.
- Smart streak minimal 70%.
- Local-first fallback kalau Supabase belum aktif.
- Export/import backup JSON.
- PWA installable.

## Jalankan lokal

1. Install Node.js LTS.
2. Extract folder ini.
3. Copy `.env.example` menjadi `.env`.
4. Isi minimal:

```env
GEMINI_API_KEY=API_KEY_GEMINI_KAMU
AI_PROVIDER=gemini
```

5. Jalankan:

```bash
node server.js
```

6. Buka:

```text
http://localhost:4173
```

## Deploy gratis ke Vercel

1. Upload folder ini ke GitHub.
2. Import project di Vercel.
3. Buka **Settings → Environment Variables**.
4. Tambahkan:

```env
GEMINI_API_KEY=API_KEY_GEMINI_KAMU
AI_PROVIDER=gemini
```

Opsional fallback:

```env
GROQ_API_KEY=ISI_KEY_GROQ
OPENROUTER_API_KEY=ISI_KEY_OPENROUTER
```

5. Deploy ulang.
6. Buka URL Vercel kamu.

## Aktifkan Supabase Cloud Database

1. Buat project baru di Supabase.
2. Buka **SQL Editor**.
3. Paste isi file:

```text
supabase/schema.sql
```

4. Klik Run.
5. Buka **Project Settings → API**.
6. Copy:
   - Project URL
   - anon public key
7. Di Aiyone, buka **Settings → Supabase Cloud Database**.
8. Paste URL dan anon key.
9. Klik **Simpan koneksi**.
10. Buat akun lewat **Sign up**, atau login kalau sudah ada.

Kalau berhasil, badge kiri bawah berubah menjadi **Cloud**.

## Update dari v2 ke v3

Kalau kamu sudah memakai Supabase sebelum versi ini, buka SQL Editor lalu jalankan ulang `supabase/schema.sql`. File ini aman dirun ulang dan akan menambahkan kolom `study_sections` untuk materi bertahap.

Kalau browser masih menampilkan versi lama, buka DevTools → Application → Service Workers → Unregister, lalu Clear site data.

## Catatan penting

- Supabase anon key memang boleh ada di browser, selama RLS aktif. File schema sudah mengaktifkan RLS.
- Gemini/Groq/OpenRouter key **jangan** ditaruh di browser. Taruh di `.env` lokal atau Environment Variables Vercel.
- PDF scan/foto belum ada OCR penuh. Gunakan PDF teks dulu.
- Kalau browser masih menampilkan versi lama, clear site data / unregister service worker.
