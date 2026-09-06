# Aiyone v15 — Zettelkasten ala Obsidian

Catatan sekarang bisa ditulis lengkap dan **terlihat sebagai graf node**.
Tidak ada perubahan database. Tidak perlu menjalankan SQL apa pun.

## Tiga hal yang ditambahkan

### 1. Wikilink `[[...]]`

Mengetik `[[Judul Catatan]]` di isi catatan langsung membentuk tautan, sama
seperti di Obsidian. Mengetik `[[` memunculkan saran judul yang cocok, plus
opsi menautkan ke judul yang belum ada. Tautan ke catatan yang belum ada
digambar dengan garis bawah putus-putus; mengkliknya menawarkan pembuatannya.

Alias didukung: `[[Spaced Repetition|cara mengulang]]` menampilkan teks kedua
tapi menautkan ke catatan pertama.

**Kenapa dua jenis tautan.** Aturan lama — alasan wajib diisi — sengaja mahal,
dan itu memang intinya. Tapi kalau setiap tautan menuntut esai, kamu berhenti
menautkan sama sekali. Jadi keduanya dipertahankan dengan peran berbeda:

| | Wikilink | Tautan beralasan |
|---|---|---|
| Dibuat saat | mengetik `[[` | lewat pembuat tautan |
| Alasan | belum ada | wajib |
| Di graf | garis putus-putus | garis penuh |
| Sinkron otomatis | ya | tidak, tidak pernah disentuh |

Wikilink menangkap hubungan secepat kamu memikirkannya. Tombol **Jelaskan** di
tiap tautan yang belum beralasan mengubahnya jadi tautan penuh — dan begitu
diberi alasan, tautan itu keluar dari sinkronisasi otomatis, jadi menghapus
`[[...]]`-nya dari teks tidak akan menghilangkannya.

### 2. Editor Markdown

Toolbar, mode **Tulis / Pratinjau**, dan subset Markdown yang cukup untuk
mencatat: `## sub-judul`, `**tebal**`, `*miring*`, `~~coret~~`, `==sorot==`,
daftar, checklist `- [ ]`, kutipan `>`, garis `---`, kode inline dan blok
```` ``` ````, serta `#tag` yang langsung masuk ke daftar tag catatan saat
disimpan.

Renderernya meng-escape seluruh HTML **sebelum** markup apa pun ditambahkan,
jadi `<script>` di isi catatan tampil sebagai teks, bukan dieksekusi. Ada tes
khusus untuk ini.

### 3. Graf node

Dua tampilan, keduanya SVG dan bisa diklik:

- **Graf global** di halaman Catatan — seluruh catatan dan tautannya.
- **Graf lokal** di tiap catatan — catatan itu dan tetangga langsungnya.

Ukuran lingkaran mengikuti jumlah tautan. Lingkaran kosong bergaris putus-putus
= catatan yang belum tertaut. Node bisa difokuskan lewat keyboard dan punya
`aria-label` berisi judul serta jumlah tautannya.

Tata letaknya simulasi gaya sederhana yang ditulis sendiri di
`lib/aiyone-core.js` — tanpa pustaka, karena aplikasi ini harus tetap jalan
offline. Deterministik: graf yang sama selalu tersusun sama, jadi posisi node
tidak berubah-ubah tiap kali dibuka.

## Bug yang ditemukan saat mengerjakan ini

- **Atribut `title` wikilink terputus.** Judul catatan dibungkus kutip lurus di
  dalam atribut yang juga dikutip lurus, jadi browser memecah sisanya menjadi
  atribut sampah (`elaborative=""`, `encoding=""`, …). Diganti kutip tipografis
  dan diberi tes regresi.
- **Teks putih beralpha rendah di atas pita berwarna.** `--teal` mode gelap
  lebih muda daripada mode terang, sehingga `rgba(255,255,255,.72–.85)` yang
  lolos di terang jatuh ke 3,8–4,3:1 di gelap. Terkena: label grup sidebar,
  item sidebar, item nav bawah, deskripsi kartu sync, nama mode Pomodoro, dan
  waktu pemutar. Semua alpha dinaikkan; hierarki tetap dibawa ukuran dan bobot.
- **Sumur putih di atas latar berwarna justru menurunkan kontras.** Kontrol
  tersegmen dan kartu sync memakai latar putih-transparan, yang membuat teks
  putih di atasnya makin dekat dengan latarnya. Keduanya dibalik jadi
  hitam-transparan.
- **Node fokus 2,98:1.** `--coral` mode gelap nyaris tidak lolos ambang 3:1
  objek grafis terhadap kotak graf. Node graf sekarang punya tokennya sendiri
  (`--node`, `--node-focus`) yang dibalik terpisah di mode gelap.
- **Glif Unicode di checklist dan toolbar.** `✓`, `☑`, dan `❝` tampil
  berbeda-beda per sistem dan sebagian jatuh ke font emoji berwarna. Centang
  digambar CSS; toolbar memakai Heroicons.

## Berkas alat baru

- **`tools/build-icons.js`** — menghasilkan `lib/aiyone-icons.js` dari paket npm
  `heroicons`. Sebelumnya skripnya tidak ikut disimpan, jadi menambah satu ikon
  berarti menulis ulang seluruh proses.
- **`tools/contrast-audit.js`** — audit kontras WCAG AA untuk ditempel di konsol
  browser. Dua jebakan yang pernah menghasilkan laporan palsu sudah ditangani di
  dalamnya: `color-mix()` memakai skala 0–1, dan elemen bergradien punya
  `backgroundColor` transparan sehingga penelusuran latar menembusnya.

## Verifikasi

- **Kontras**: `AiyoneAudit.sapuSemua()` di 10 layar, sidebar, dan tiga state
  detail catatan (tulis, pratinjau, kotak "Jelaskan") — **nol temuan** di empat
  kombinasi: terang/gelap × mobile 390px/desktop 1280px.
- **Fungsional**: wikilink membuat tautan saat disimpan; menghapus `[[...]]`
  dari teks menghapus tautan otomatisnya; tautan yang sudah diberi alasan
  **tidak** ikut terhapus; mengklik wikilink yang belum ada membuat catatannya;
  autocomplete `[[` menyisipkan judul yang benar; toolbar menyisipkan dan
  mencabut awalan baris.
- **Regresi**: Pomodoro berjalan dan judul tab ikut terbarui, Review terbuka,
  catatan tetap bisa dibuat, tidak ada error di konsol.
- `npm test` hijau.

## Setelah update

Uninstall/hapus PWA lama atau clear site data kalau HP masih menampilkan versi
sebelumnya. Cache service worker sudah dinaikkan ke `aiyone-v15`.
