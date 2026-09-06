# Aiyone v14 — Bahasa UI/UX Baru

Aiyone sendiri yang diubah, bukan prototipe terpisah. Yang berganti bukan cuma
palet warna: **struktur menu, kerangka layar, dan pola komponennya**.

Tidak ada perubahan database. Tidak perlu menjalankan SQL apa pun.

## Dua aturan yang sekarang memegang seluruh tampilan

**1. Mode kognitif menentukan warna.** Bukan sebaliknya.

| Mode | Warna | Layar |
|---|---|---|
| Sedang aktif mengerjakan | coral | Belajar, Materi Baru, Review, Teaching |
| Membaca dan menganalisis | cream | Beranda, Catatan, Library |
| Status dan capaian | teal | Fokus, Progres, Settings |

Modenya didaftarkan di konstanta `SCREENS` (app.js). Layar baru wajib memilih
mode lebih dulu; warnanya mengikuti otomatis lewat `data-mode` pada `.shell`.
Tidak ada lagi warna yang dipilih per layar secara terpisah.

**2. Docked bottom-sheet adalah kerangka tetap.** Satu pita berwarna di atas,
lalu panel konten bersudut besar yang menindihnya dari bawah. Berlaku di semua
layar tanpa kecuali. Topbar lama yang terpisah dari konten sudah dihapus.

## Struktur menu

Dari **10 item datar** menjadi **5 tujuan utama + drill-down**:

```
Beranda    ← Belajar    ← Fokus    ← Catatan    ← Progres
  │            │                                    │
  ├ Library    └ Teaching Mode                      ├ Library
  └ Materi Baru  Review                             └ Settings
```

Nav bawah hanya memuat lima tujuan itu. Library, Materi Baru, Review, Teaching,
dan Settings dicapai lewat tautan kontekstual — bukan tab. Sidebar (desktop)
mengelompokkan hal yang sama jadi **Utama / Materi / Lainnya**.

## Pola komponen

Diambil dari referensi dan dipakai konsisten di seluruh aplikasi:

- **Pita salam** dengan eyebrow, judul, dan avatar profil
- **Judul raksasa** dua baris
- **Medali statistik bulat** — Materi / Dikuasai / Perlu ulang
- **Satu angka hero** untuk rata-rata penguasaan
- **Grafik garis** dengan gelembung nilai hitam dan chip selisih
- **Tautan "Rincian ↗"** selalu di kanan-atas section (progressive disclosure)
- **Kontrol tersegmen** yang menggeser di papan peringkat
- **Baris peringkat**: badge + bidang bergaris + pil persen + orb
- **Kartu sorotan** untuk konsep yang paling perlu dikerjakan
- **Pita bertumpuk** di layar Fokus: salam → ringkasan → pilihan sesi → pemutar
- **Tombol pil gelap** dan **kontrol bundar** untuk pemutar

## Ikon

Semua glif Unicode (☰ ◆ ♛ ⏭ ⚡ ↗) diganti **Heroicons** — set ikon buatan tim
Tailwind. Catatan: Tailwind sendiri tidak menyediakan ikon; Heroicons adalah
proyek terpisah dari tim yang sama.

Glif Unicode tampil berbeda-beda di tiap sistem operasi dan sebagian jatuh ke
font emoji berwarna, yang membuatnya terlihat tidak menyatu. Heroicons memakai
stroke seragam dan mewarisi warna teks induknya lewat `stroke="currentColor"`,
jadi otomatis benar di setiap mode dan tema.

Data path-nya **di-inline** ke `lib/aiyone-icons.js`, bukan dimuat dari CDN,
supaya aplikasi tetap bekerja offline sebagai PWA. Berkas itu dihasilkan dari
paket npm resminya, bukan digambar ulang manual — path yang digambar sendiri
pasti melenceng.

Markup statis memakai atribut `data-icon="nama"` yang diisi saat boot; konten
dinamis memanggil `ikon("nama", ukuran)` langsung di templatenya.

## Bug yang ditemukan saat mengerjakan ini

- **Tabrakan cascade `.band`.** Nama kelas yang sama dipakai untuk pita header
  layar *dan* pita bertumpuk di dalam pemutar Fokus, sehingga selektor
  `[data-mode]` ikut mewarnai pita pemutar dan membuat teksnya sewarna latar.
  Header diganti namanya jadi `.topband`.
- **`--on-light` dipasangkan dengan `--surface`.** Token pertama selalu gelap,
  yang kedua ikut membalik jadi gelap saat mode gelap — hasilnya gelap di atas
  gelap di segmented control, badge peringkat #2, dan pil persentase.
  Aturannya kini ditulis di token: `--on-light` hanya boleh di atas latar yang
  selalu terang.
- **Gelembung grafik meleset.** Diposisikan dengan persentase terhadap tinggi
  host yang juga memuat baris sumbu. Kotak acuannya dipisah.
- **Transisi warna pita.** Latar ditransisikan 350ms sementara warna teks
  berganti seketika, menyisakan jeda singkat teks terang di atas latar terang.
  Transisinya dihapus.
- **Titik dekoratif pada pil gelap.** Pil ini membalik warna antar tema, jadi
  tidak ada hue tetap yang lolos kontras di keduanya; titiknya kini diturunkan
  dari warna teks pil itu sendiri, dan sekarang diganti ikon play/pause.
- **Avatar menampilkan "?"** saat belum login. Diganti ikon user.

## Verifikasi

- **Kontras**: audit otomatis di 10 layar, 4 tab detail, 2 state segmented, dan
  5 modal — **nol temuan** di terang maupun gelap, mobile maupun desktop.
  Ikon ikut diperiksa dengan ambang 3:1 untuk objek grafis.
- **Regresi**: pemetaan jawaban quiz masih tepat dengan posisi tersebar
  (1, 1, 2); Pomodoro berjalan dan judul tab ikut terbarui; Catatan tetap bisa
  dibuat; urutan review tetap berurutan.
- `npm test` hijau.

## Prototipe React

Folder `design/` berisi prototipe React + Framer Motion yang jadi rujukan pola
ini. Aplikasi Aiyone sendiri tetap vanilla JS tanpa build step — polanya yang
diadopsi, bukan stack-nya.

## Setelah update

Uninstall/hapus PWA lama atau clear site data kalau HP masih menampilkan versi
sebelumnya. Cache service worker sudah dinaikkan ke `aiyone-v14`.
