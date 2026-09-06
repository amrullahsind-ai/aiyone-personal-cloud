# Aiyone v12 — Perbaikan Menyeluruh

Rilis ini hasil audit penuh terhadap v11. Tidak ada fitur baru; semuanya
perbaikan kebenaran, keamanan, dan kualitas pemakaian.

## Wajib dibaca

**Kalau kamu memakai database Supabase yang sama seperti sebelumnya, bagian ini
sudah dijalankan** — lihat bagian Database di bawah. Untuk database lain,
jalankan `supabase/migrasi-v12.sql` di Supabase SQL Editor. Aman dijalankan
berulang dan tidak menghapus data.

Migrasi v6 (`MIGRASI_SUPABASE_AMAN.md`) tetap prasyarat. Tanpa kolom `score` dan
`quiz_mode` di `review_logs`, perhitungan mastery per konsep tidak akurat.
Sekarang aplikasi memberi peringatan kalau kolomnya belum ada — versi lama diam
saja.

**File `.env` kamu mungkin pernah terekspos.** Server lokal versi lama
menyajikan `.env` lewat HTTP (`http://localhost:4173/.env` mengembalikan isi
lengkapnya) dan mendengarkan di semua interface jaringan. Kalau kamu pernah
menjalankan Aiyone di Wi-Fi publik atau kantor, **ganti GEMINI_API_KEY dan
kunci lain sekarang**. Lihat bagian Keamanan di bawah.

## Kritis — aplikasi mengajarkan hal yang salah

- **Jawaban quiz bisa salah dipetakan.** Opsi di-dedup dan dipotong ke 4
  *sebelum* indeks jawaban diresolusi, sehingga `answer_index` menunjuk opsi
  lain. Contoh nyata: opsi `["A","A","B","C"]` dengan answerIndex 2 dinilai
  sebagai "C", padahal jawabannya "B". Sekarang teks jawaban diresolusi lebih
  dulu, baru opsi dibersihkan, dan indeksnya dihitung ulang.
- **Jawaban benar selalu di opsi A** pada semua soal yang dibuat otomatis dari
  flashcard atau konsep. Pengguna bisa lulus post-test hanya dengan selalu
  memilih A. Opsi sekarang diacak dan indeksnya mengikuti.
- **Streak tidak pernah putus.** Hanya ada penambahan, tidak pernah reset, dan
  memakai tanggal UTC (di WIB hari baru mulai pukul 07:00). Sekarang memakai
  tanggal lokal dan kembali ke nol kalau bolong lebih dari sehari.

## Tinggi — kehilangan data dan error senyap

- **Pagination Supabase.** PostgREST memotong di 1000 baris tanpa memberi tahu.
  Karena setiap jawaban quiz menulis satu baris `review_logs`, batas itu
  tercapai dalam hitungan minggu dan analytics diam-diam jadi salah.
- **Index database** (`supabase/migrasi-v12.sql`). Skema lama tidak punya satu
  pun index. Pagination memperjelas dampaknya: tanpa index gabungan
  `(user_id, created_at desc, id)`, setiap halaman memaksa pemindaian dan
  pengurutan ulang seluruh tabel. Kolom foreign key juga diindeks karena
  penghapusan materi kini mengandalkan ON DELETE CASCADE, dan Postgres tidak
  mengindeks kolom foreign key secara otomatis.
- **Error cloud tidak lagi ditelan.** Rating review dan flashcard yang gagal
  tersimpan dulu hanya muncul di console sebagai unhandled rejection.
- **Fallback log review tidak lagi membuang `score` dan `quiz_mode`** — dua
  kolom yang justru dipakai perhitungan mastery. Sekarang kolom dibuang satu
  per satu sesuai pesan error, disertai peringatan migrasi.
- **Teaching session ikut terimpor.** Sebelumnya diekspor tapi tidak pernah
  dibaca kembali, jadi backup diam-diam tidak lengkap.
- **`.gitignore` ditambahkan.** Sebelumnya tidak ada sama sekali, jadi `.env`
  berisi API key bisa ikut ter-commit.

## Keamanan

- Server lokal **menolak semua berkas bertitik** (`.env`, `.git`, `.vercel`)
  beserta `node_modules`, `server.js`, dan `package.json`.
- Server lokal kini **hanya mendengarkan di `127.0.0.1`**. Set `HOST=0.0.0.0`
  kalau kamu memang ingin membukanya dari HP di jaringan yang sama.
- Aset yang tidak ada membalas **404 asli**, bukan `index.html` dengan status
  200 — file `.js`/`.css` yang salah nama dulu sangat sulit dilacak.
- Header keamanan di `vercel.json`: `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`.

## Endpoint AI

- **Anggaran waktu total 25 detik** untuk seluruh rantai fallback. Sebelumnya
  tiap provider punya timeout 30 detik sendiri, jadi tiga provider bisa
  menembus batas 30 detik Vercel dan fungsi mati tanpa respons.
- **Perbaikan JSON rusak sekarang benar-benar bekerja.** Versi lama meng-escape
  semua newline termasuk yang di luar string, membuat JSON makin rusak.
- Penghitung rate limit dibersihkan berkala (dulu tumbuh terus selama proses
  hidup). Batasnya tetap in-memory — lihat catatan di `.env.example`.
- Prompt kini secara eksplisit meminta model menyebar posisi jawaban benar.

## Alur belajar

- **Urutan review tidak lagi melompat.** Indeks dinaikkan padahal kartu yang
  baru dinilai sudah keluar dari daftar due, jadi urutannya acak dan
  penghitung "2/5" salah. Sekarang berurutan dan penghitungnya per sesi.
- **Post-test tidak mengulang soal latihan.** ID soal turunan dulu acak setiap
  panggilan, jadi penyaring "belum pernah keluar" tidak pernah cocok.
- **Interval pertama minimal 1 hari** untuk rating Paham/Mudah (dulu ~7 jam,
  sehingga review terasa tidak pernah selesai). "Lupa" tetap ±10 menit.
- **Label grafik mingguan dihitung dari tanggal sebenarnya.** Sen–Min dulu
  ditulis permanen di HTML padahal batang terakhir selalu berarti hari ini.
- Tombol AI dikunci selama proses — klik ganda dulu memicu dua request, dua
  materi duplikat, dan menghabiskan jatah rate limit.

## Tampilan & aksesibilitas

- **Mode gelap penuh**, mengikuti tema sistem. Diverifikasi nol masalah
  kontras di seluruh view, modal, dan lebar mobile maupun desktop.
- **`alert()`/`confirm()` diganti toast dan dialog in-app.** Keduanya memblokir
  thread dan di PWA mobile muncul seperti error sistem.
- **Modal punya manajemen fokus**: fokus masuk saat dibuka, Tab terkunci di
  dalam, Escape menutup lapisan teratas saja, fokus kembali ke tombol pemicu.
- **Ikon PNG asli** (192, 512, maskable) plus `apple-touch-icon`. iOS tidak
  mendukung SVG untuk ikon home screen, jadi install di iPhone dulu dapat ikon
  default.
- Manifest dilengkapi `id`, `scope`, `orientation`, dan kategori.

## Kompatibilitas

- **Regex lookbehind dihapus.** `(?<=\.)` tidak didukung Safari di bawah 16.4 —
  di iPhone lama seluruh `app.js` gagal di-parse dan aplikasinya layar kosong.
- Paragraf ringkasan digabung sampai ambang panjang, tidak lagi satu paragraf
  per kalimat.
- `package.json` mencantumkan `engines: node >= 18.17` (`fetch` global).
- `BUKA_AIYONE.cmd` mencari Node di PATH dan lokasi instalasi umum. Versi lama
  menunjuk path absolut di komputer tertentu dan langsung gagal di mesin lain.

## Struktur & pengujian

- Logika paling rawan dipindah ke `lib/aiyone-core.js` — fungsi murni tanpa
  DOM: pemetaan jawaban quiz, streak, pemecahan paragraf.
- `tests/core.test.js` menguji semuanya, termasuk regresi khusus untuk setiap
  bug pemetaan jawaban di atas.
- `tests/api-validation.test.js` bertambah pengujian perbaikan JSON.
- Jalankan dengan `npm test`.

## Database

Tiga migrasi diterapkan dan diverifikasi langsung di database:

| Migrasi | Isi |
|---|---|
| `aiyone_v12_indexes` | 10 index |
| `aiyone_v12_harden_set_updated_at` | `search_path` fungsi trigger dikunci |
| `aiyone_v12_rls_initplan` | `auth.uid()` dibungkus `(select ...)` di 5 kebijakan RLS |

Yang ditemukan saat menjalankannya:

- **Kebijakan RLS mengevaluasi `auth.uid()` per baris.** Ini hampir membatalkan
  manfaat index: planner tidak memakai index kalau predikatnya dihitung ulang
  untuk setiap baris. Diperbaiki jadi `(select auth.uid()) = user_id`. Semantik
  tidak berubah — diuji dengan menyamar sebagai tiga peran: pemilik melihat
  barisnya, pengguna lain 0 baris, anonim 0 baris.
- **`set_updated_at()` tidak mengunci `search_path`.** Resolusi nama di dalam
  fungsi mengikuti `search_path` pemanggil. Diperbaiki, dan trigger diuji ulang
  (update dijalankan lalu di-rollback, data asli tidak tersentuh).
- Rencana query dikonfirmasi lewat `EXPLAIN`: `Index Scan using
  review_logs_user_created_idx` **tanpa node `Sort`** — index memenuhi filter
  sekaligus urutan pagination.

Dua peringatan advisor sengaja **tidak** disentuh:

- `rls_auto_enable()` ditandai sebagai SECURITY DEFINER yang bisa dipanggil
  publik. Itu objek bawaan platform Supabase, bertipe kembalian `event_trigger`
  sehingga PostgREST tidak bisa mengeksposnya sebagai RPC, dan fungsinya justru
  *menyalakan* RLS otomatis di tabel baru. Praktis false positive.
- Leaked password protection masih mati. Itu saklar di dashboard Supabase
  (Authentication → Policies), bukan sesuatu yang bisa diubah lewat SQL.

## Setelah update

Uninstall/hapus PWA lama atau clear site data kalau HP masih menampilkan versi
sebelumnya. Cache service worker sudah dinaikkan ke `aiyone-v12`.
