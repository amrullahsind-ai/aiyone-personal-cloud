# Aiyone Personal v15 — Auto Cloud Profile

Sistem belajar personal: materi diubah jadi konsep, flashcard, quiz bertingkat,
dan jadwal review berbasis prediksi lupa. Ditambah **catatan berjejaring
(Zettelkasten)** dan **timer fokus (Pomodoro)** yang mengisi statistik belajarmu.

Login dan sinkronisasi ada di tombol **Profil** di pojok kanan atas; Settings
untuk AI, memory engine, Pomodoro, dan backup.

- **`PERUBAHAN_V15.md`** — Zettelkasten ala Obsidian: wikilink, Markdown, graf node.
- **`PERUBAHAN_V14.md`** — struktur menu dan bahasa UI/UX baru.
- **`PERUBAHAN_V13.md`** — Zettelkasten, Pomodoro.
- **`PERUBAHAN_V12.md`** — rilis perbaikan menyeluruh sebelumnya.

## Jalankan lokal

```bash
copy .env.example .env
```

Isi `GEMINI_API_KEY` di `.env`. `SUPABASE_URL` dan `SUPABASE_ANON_KEY` opsional
kalau kamu hanya mau memakai mode lokal.

```bash
node server.js
```

Buka `http://localhost:4173`. Di Windows kamu juga bisa klik dua kali
`BUKA_AIYONE.cmd`.

Server hanya mendengarkan di `127.0.0.1`. Kalau kamu ingin membukanya dari HP di
Wi-Fi yang sama:

```bash
HOST=0.0.0.0 node server.js
```

Sadari konsekuensinya: siapa pun di jaringan itu bisa membuka Aiyone milikmu.

## Jalankan tes

```bash
npm test
```

Menguji `lib/aiyone-core.js` (pemetaan jawaban quiz, streak, pemecahan
paragraf) dan validasi endpoint AI. Jalankan ini sebelum deploy.

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

Setelah deploy, buka Aiyone → klik Profil pojok kanan atas → login. Data lokal
otomatis tersinkron.

## Supabase

Tidak perlu isi kode Supabase di Settings — dibaca otomatis dari server.

Jalankan dua file ini di **Supabase SQL Editor**, urutannya bebas. Keduanya
aman dijalankan berulang dan tidak menghapus data:

1. `MIGRASI_SUPABASE_AMAN.md` — kalau database kamu dibuat sebelum v6. Tanpa
   kolom `score` dan `quiz_mode` di `review_logs`, mastery per konsep tidak
   akurat. Aplikasi memberi peringatan kalau mendeteksi kolomnya belum ada.
2. `supabase/migrasi-v12.sql` — index, plus pengerasan RLS dan fungsi trigger.
   Tidak ada kolom baru di v12; skema lama sama sekali tidak punya index,
   padahal setiap query memfilter `user_id`.
3. `supabase/migrasi-v13.sql` — tabel `notes`, `note_links`, dan
   `focus_sessions` untuk Zettelkasten dan Pomodoro.

Untuk database baru, cukup jalankan `supabase/schema.sql` — sudah termasuk
semuanya dan aman dijalankan ulang. Row Level Security aktif di semua tabel,
jadi setiap baris hanya bisa dibaca pemiliknya.

## Perlindungan endpoint AI

Kalau `SUPABASE_URL` dan `SUPABASE_ANON_KEY` tersedia, endpoint AI otomatis
mewajibkan sesi login valid. Gunakan `AI_REQUIRE_AUTH=false` hanya untuk
pengembangan lokal tanpa akun.

- `AI_RATE_LIMIT` — batas permintaan per pengguna/IP dalam 10 menit (default 15).
  Penghitungnya in-memory, jadi tidak mengikat secara ketat di serverless
  multi-instance. Ini rem darurat, bukan kuota sungguhan.
- `AI_TIME_BUDGET_MS` — anggaran waktu total satu request termasuk seluruh
  rantai fallback provider (default 25000). Harus di bawah `maxDuration` 30
  detik di `vercel.json`.
- Materi dibatasi 30.000 karakter per proses.

## Catatan berjejaring (Zettelkasten)

Satu catatan, satu gagasan. Nilainya bukan dari menumpuk catatan, tapi dari
menautkannya — dan dari menjelaskan **kenapa** dua gagasan terhubung.

**Menulis.** Editor Markdown dengan toolbar dan mode Tulis/Pratinjau:
`## sub-judul`, `**tebal**`, `*miring*`, `~~coret~~`, `==sorot==`, daftar,
checklist `- [ ]`, kutipan `>`, kode inline dan blok, serta `#tag` yang
otomatis masuk ke daftar tag saat disimpan.

**Menautkan.** Ada dua cara, dan keduanya disengaja:

- **Wikilink** — ketik `[[Judul Catatan]]` di isi catatan. Mengetik `[[`
  memunculkan saran judul. Tautan terbentuk begitu catatan disimpan; menghapus
  `[[...]]`-nya dari teks juga menghapus tautannya. Alias didukung:
  `[[Spaced Repetition|cara mengulang]]`.
- **Tautan beralasan** — lewat pembuat tautan di bawah catatan. Alasan wajib
  diisi, dan tautan ini **tidak pernah** disentuh sinkronisasi otomatis.
  Tombol **Jelaskan** menaikkan wikilink jadi tautan beralasan.

**Melihat.** Graf node SVG yang bisa diklik: graf global di halaman Catatan,
graf lokal di tiap catatan. Ukuran lingkaran = jumlah tautan; lingkaran kosong
bergaris putus-putus = catatan yang belum tertaut; garis putus-putus = hubungan
yang belum dijelaskan. Tata letaknya deterministik, jadi posisi node tidak
berubah tiap kali dibuka.

- Tautan punya jenis: mendukung, membantah, contoh dari, prasyarat untuk, dan
  seterusnya. Tautan masuk (backlink) muncul otomatis di catatan tujuan.
- Usulan tautan dihitung lokal dari irisan kata, tanpa memanggil AI.
- Catatan bisa dibuat langsung dari konsep sebuah materi, dan bisa diubah jadi
  flashcard supaya masuk jadwal review.
- Catatan **tidak** ikut terhapus saat materinya dihapus.

## Fokus (Pomodoro)

Tiga mode dengan durasi yang bisa diatur, jeda yang benar-benar berhenti, nada
penanda, dan peralihan otomatis ke istirahat.

Setiap sesi dicatat beserta materi yang dikerjakan, jadi grafik **Waktu belajar**
di dashboard memakai menit sungguhan — bukan perkiraan dari waktu jawab review
seperti versi sebelumnya. Sesi di bawah 30 detik tidak dicatat.

## Kualitas materi

- PDF mempertahankan nomor halaman sebagai rujukan sumber, dan rujukan yang
  tidak cocok dengan halaman asli dibuang di sisi server.
- Rentang halaman dapat dipilih, maksimal 200 halaman dan ukuran 50 MB.
- PDF scan tanpa teks ditolak dan perlu diproses OCR terlebih dahulu.
- Respons AI divalidasi sebelum disimpan: judul, jumlah konsep, flashcard, dan
  soal minimum semuanya diperiksa.
- Opsi quiz diacak dan indeks jawaban dihitung ulang dari teks jawabannya, jadi
  jawaban benar tidak pernah menumpuk di satu posisi.

## Struktur

```
index.html            Kerangka UI
app.js                Seluruh logika aplikasi (IIFE, tanpa build step)
lib/aiyone-core.js    Fungsi murni yang diuji otomatis
lib/aiyone-icons.js   Ikon Heroicons, di-inline agar tetap jalan offline
styles.css            Sistem visual; mode kognitif + docked bottom-sheet
design/               Prototipe React yang jadi rujukan pola UI
tools/                Skrip pengembangan (lihat di bawah)
sw.js                 Service worker, network-first
api/generate.js       Endpoint AI: auth, rate limit, fallback provider, validasi
api/config.js         Konfigurasi Supabase publik
server.js             Server statis untuk pemakaian lokal
supabase/schema.sql   Skema + Row Level Security
tests/                Dijalankan lewat `npm test`
```

## Backup

Settings → Export JSON menghasilkan salinan lengkap termasuk teaching session,
catatan, tautan antar-catatan, dan sesi fokus.
Import menerima file itu kembali dan menimpa baris dengan id yang sama. File
backup masuk `.gitignore`, jadi tidak ikut ter-commit.

## Alat pengembangan

Keduanya dijalankan manual, tidak ikut dibundel ke aplikasi.

```bash
node tools/build-icons.js
```

Menghasilkan ulang `lib/aiyone-icons.js` dari paket npm `heroicons`. Untuk
menambah ikon: tambahkan entri di daftar `IKON` lalu jalankan lagi. Path ikon
sengaja tidak pernah digambar manual — pasti melenceng.

`tools/contrast-audit.js` ditempel ke konsol browser, lalu:

```js
await AiyoneAudit.sapuSemua()
```

Menyapu semua layar, sidebar, dan tiga state detail catatan; melaporkan setiap
teks di bawah 4.5:1 (3:1 untuk teks besar) dan setiap objek grafis SVG di bawah
3:1. Ulangi di terang dan gelap, mobile dan desktop.
