# Cara Jalankan Aiyone di Windows

## Cara cepat

Klik dua kali **`BUKA_AIYONE.cmd`**. Script itu mencari Node.js sendiri dan
membuka browser otomatis.

Kalau muncul pesan Node.js tidak ditemukan, install dulu dari
<https://nodejs.org> (pilih versi LTS, minimal versi 18), lalu jalankan lagi.

## Cara manual

1. Extract folder ini.
2. Salin `.env.example` menjadi file baru bernama `.env`.
3. Isi API key minimal:

```env
GEMINI_API_KEY=AIza...isi_key_kamu
AI_PROVIDER=gemini
```

Opsional:

```env
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
```

4. Klik kanan di area kosong folder ini → **Open in Terminal**.
5. Jalankan:

```bash
node server.js
```

6. Buka browser:

```text
http://localhost:4173
```

## Catatan

- Jangan double click `server.js`. Pakai `BUKA_AIYONE.cmd` atau terminal.
- File `generate.js` wajib berada di `api/generate.js`.
- File utama wajib bernama `index.html`.
- **Jangan pernah membagikan file `.env`.** Isinya API key kamu. File itu sudah
  masuk `.gitignore` dan server menolak menyajikannya lewat HTTP.
- Server hanya bisa dibuka dari komputer ini. Kalau kamu ingin membukanya dari
  HP di Wi-Fi yang sama, jalankan `set HOST=0.0.0.0` dulu lalu `node server.js`.
  Ingat: siapa pun di jaringan itu jadi bisa membuka Aiyone milikmu.

## Kalau tampilan masih versi lama

Aiyone adalah PWA, jadi browser dan HP menyimpan salinannya. Setelah update:
hapus/uninstall PWA lama, atau buka setelan situs dan pilih clear site data.
