# Cara Jalankan Aiyone di Windows

1. Extract folder ini.
2. Buka file `.env.example`, lalu salin jadi file baru bernama `.env`.
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

Catatan:
- Jangan double click `server.js`.
- File `generate.js` wajib berada di folder `api/generate.js`.
- File utama wajib bernama `index.html`.
