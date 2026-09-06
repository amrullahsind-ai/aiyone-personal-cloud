# Aiyone v13 — Zettelkasten, Pomodoro, dan Bahasa Visual Baru

Tiga penambahan besar: catatan berjejaring, timer fokus, dan tampilan yang
ditulis ulang dari nol.

## Wajib dijalankan

`supabase/migrasi-v13.sql` di Supabase SQL Editor — menambah tabel `notes`,
`note_links`, dan `focus_sessions`. Aman dijalankan berulang, tidak menyentuh
tabel lama. **Untuk database yang tersambung ke sesi ini, migrasi sudah
diterapkan.**

Database lokal (IndexedDB) naik ke versi 2 dan membuat store barunya sendiri
saat aplikasi dibuka. Tidak ada yang perlu kamu lakukan.

## Zettelkasten

Satu catatan, satu gagasan — dan yang membuatnya bernilai belajar bukan
kemampuan menyimpan, melainkan **kewajiban menuliskan alasan saat menautkan**.

- **Alasan tautan wajib diisi.** Tautan tanpa penjelasan ditolak. Menjelaskan
  hubungan memaksa elaborative encoding, prinsip yang sama dengan Teaching Mode
  tapi biayanya jauh lebih murah.
- **Jenis hubungan** eksplisit: terkait, mendukung, membantah, contoh dari,
  prasyarat untuk, lanjutan dari.
- **Tautan masuk (backlink)** ditampilkan otomatis di catatan tujuan.
- **Catatan yatim ditandai**, dengan hitungannya di bagian atas. Catatan yang
  tidak terhubung ke apa pun praktis tidak akan pernah ditemukan lagi — itu
  sinyal paling penting dalam Zettelkasten.
- **Usulan tautan** dari irisan kata yang bermakna. Sepenuhnya lokal: tidak
  memanggil AI, jadi tetap jalan offline dan tanpa biaya. Kamu tetap yang
  memutuskan dan menuliskan alasannya.
- **Buat catatan dari konsep**, langsung dari tab Konsep di detail materi.
  Definisi AI sengaja dimasukkan sebagai bahan mentah dengan instruksi menulis
  ulang, bukan sebagai isi final.
- **Catatan bisa jadi flashcard**, sehingga gagasanmu sendiri ikut masuk jadwal
  review — bukan cuma materi buatan AI.

Catatan **tidak** ikut terhapus saat materinya dihapus. `material_id` diset
NULL, bukan cascade. Materi itu sumber yang bisa dibuang; catatan adalah
pemikiranmu sendiri. Perilaku ini diuji langsung di database.

## Pomodoro

Timer saja itu komoditas. Nilai tambahnya di sini: **setiap sesi dicatat beserta
materi yang dikerjakan**.

- Tiga mode: fokus, istirahat pendek, istirahat panjang. Durasi bisa diatur di
  Settings, termasuk "istirahat panjang tiap berapa sesi".
- Jeda benar-benar menghentikan hitungan; lanjut menyambung dari posisi terakhir.
- Sesi selesai otomatis beralih ke istirahat, dengan nada penanda lewat WebAudio
  (tanpa file audio sama sekali). Keduanya bisa dimatikan.
- Sisa waktu tampil di judul tab, jadi tetap terlihat saat pindah tab.
- Sesi di bawah 30 detik tidak dicatat, supaya statistik tidak dikotori.
- Sesi yang dihentikan di tengah tetap dicatat sebagai belum selesai.

**Grafik "Waktu belajar" di dashboard sekarang memakai menit fokus sungguhan.**
Sebelumnya angkanya diperkirakan dari waktu jawab review — kasar dan menyesatkan.
Perkiraan lama hanya dipakai sebagai cadangan untuk hari-hari sebelum fitur ini
ada, dan labelnya menyebutkan sumbernya.

## Tampilan

Bukan sekadar ganti warna: **susunan dan pola komponennya yang diubah**, mengikuti
tiga layar referensi. `styles.css` ditulis ulang dari nol karena versi sebelumnya
sudah bertumpuk tiga lapis tema yang saling menimpa.

### Pola komponen yang diadopsi

| Dari referensi | Diterapkan di |
|---|---|
| Kepala salam "Hai, X 👋" + tanggal + avatar bulat | Dashboard, Fokus |
| Judul raksasa dua baris | Dashboard, Analytics |
| Medali statistik berbentuk lingkaran | Dashboard |
| Satu angka hero berukuran sangat besar | Dashboard |
| Grafik garis + gelembung nilai hitam + chip selisih | Dashboard |
| Pita warna bertumpuk bersudut besar | Fokus |
| Tombol pil gelap + tautan "↗" bersudut kotak | Fokus |
| Dial melingkar + tiga tombol bundar | Fokus |
| Kontrol tersegmen (pil putih aktif) | Analytics |
| Baris peringkat: badge + bidang bergaris + pil persen + orb | Analytics |
| Kartu sorotan bawah dengan tag | Analytics |
| Garis lengkung dekoratif di latar pekat | Analytics |

### Perubahan struktur

- **Dashboard** tidak lagi memakai diagram batang dan kartu ringkasan kotak.
  Sekarang: salam → judul raksasa → tiga medali bulat → angka hero → grafik
  garis. Kurvanya SVG dengan pemulusan Catmull-Rom, gelembung nilai dan chip
  selisih dirender sebagai HTML supaya teksnya tajam dan ikut token tema.
- **Fokus** disusun jadi empat pita bertumpuk yang saling menindih dengan
  margin negatif — salam, ringkasan hari ini, pilihan sesi, lalu pemutar.
- **Analytics** dibuka dengan papan berlatar pekat: tombol bundar, judul
  raksasa, kontrol tersegmen, baris peringkat, dan kartu sorotan.

### Sistem warna

- Semua warna lewat token di `:root`. Mode gelap hanya menimpa token, bukan
  puluhan selektor.
- **Dua keluarga token dipisahkan tegas**, dan ini yang paling mudah salah:
  `--x` isian pekat dengan `--on-x` untuk teks di atasnya, versus `--x-soft`
  tint lembut dengan `--x-ink` untuk teks di atasnya. Keduanya bergerak
  berlawanan saat mode gelap.
- Aturan `:hover` dibatasi ke perangkat berkursor. Di layar sentuh, `:hover`
  menempel setelah ketukan dan membuat tombol terlihat aktif terus.
- Bagian "Leaderboard" pada referensi dipakai untuk **peringkat konsepmu
  sendiri**, bukan leaderboard antar-pengguna. Aiyone aplikasi personal; papan
  peringkat lintas pengguna hanya bisa diisi data palsu.

## Navigasi

Sidebar bertambah Fokus dan Catatan. Nav bawah jadi lima: Home, Belajar, Fokus,
Catatan, Review.

## Yang diverifikasi langsung, bukan hanya ditulis

- **Pomodoro**: durasi diset 1 menit lalu ditunggu sungguhan sampai habis.
  Timer turun ke 00:01, otomatis beralih ke istirahat, dan sesinya tersimpan
  dengan 60 detik, `completed: true`, terkait materi yang benar.
- **Jeda**: dua pembacaan berjarak 1,2 detik menunjukkan angka yang sama persis,
  lalu menyambung setelah dilanjutkan.
- **Zettelkasten**: tautan tanpa alasan ditolak, tautan ganda ditolak (termasuk
  arah sebaliknya), tautan-ke-diri-sendiri ditolak di level database, backlink
  muncul di catatan tujuan, hitungan yatim turun ke nol setelah ditautkan.
- **Catatan selamat saat materi dihapus**: diuji langsung di Postgres, catatan
  bertahan dengan `material_id` jadi NULL sementara flashcard ikut terhapus.
- **Isolasi RLS** untuk ketiga tabel baru: pemilik melihat barisnya, pengguna
  lain 0 baris, anonim 0 baris.
- **Kontras**: audit otomatis di 10 view, 4 tab detail, modal flashcard, quiz,
  profil, catatan, dan drawer — nol masalah di terang maupun gelap, di lebar
  mobile maupun desktop.
- **Regresi**: pemetaan jawaban quiz masih benar dengan posisi tersebar
  (3, 2, 1, 2), urutan review masih berurutan 1/2 → 2/2.

## Bug yang ditemukan saat membangun ini

- **`[hidden]` tidak berfungsi.** Kelas-kelas baru punya properti `display`
  yang prioritasnya mengalahkan `[hidden]` bawaan browser, sehingga tombol
  install, jawaban review, dan area login akan tampil terus. Diperbaiki dengan
  `[hidden]{display:none!important}`.
- **Teks putih di atas krem.** Tombol `journey-step` berada di dalam kartu
  coral yang mewarisi warna teks putih, padahal latar tombolnya sendiri krem.
  Warnanya kini ditulis eksplisit.
- **Jam Pomodoro hilang.** Cincin dial memakai CSS `mask` untuk membentuk
  donat, dan mask itu ikut menghapus seluruh isi elemen — termasuk teks jam di
  dalamnya. Jam dipindah jadi elemen bersaudara, bukan bersarang.
- **Dashboard kosong total.** Blok metrik lama dihapus dari markup tapi kodenya
  masih menulis ke id yang sudah tidak ada, dan satu `null` menjatuhkan seluruh
  render. Semua penulisan kini aman terhadap elemen yang hilang.
- **Aturan CSS lama tertinggal.** `.focus-mode small` versi lama masih
  mewarnai subteks chip dengan token `--muted`, mengalahkan aturan baru yang
  tidak menyebut warna.

## Setelah update

Uninstall/hapus PWA lama atau clear site data kalau HP masih menampilkan versi
sebelumnya. Cache service worker sudah dinaikkan ke `aiyone-v13`.
