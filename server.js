const http = require("http");
const fs = require("fs");
const path = require("path");
const generate = require("./api/generate.js");
const config = require("./api/config.js");

function loadEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key.trim()]) process.env[key.trim()] = value;
  }
}
loadEnv();

const PORT = Number(process.env.PORT || 4173);
// Trailing separator penting: tanpa itu, folder tetangga yang namanya berawalan
// sama (misal `...-main-lama`) ikut lolos pemeriksaan path traversal.
const ROOT = fs.realpathSync(__dirname);
const ROOT_PREFIX = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

// Hanya permintaan navigasi yang boleh jatuh ke index.html. Aset yang hilang
// harus balas 404 asli — kalau tidak, file .js/.css yang salah nama akan
// dikirim sebagai HTML dengan status 200 dan errornya jadi sangat sulit dilacak.
const ASSET_EXTENSIONS = new Set([".js", ".mjs", ".css", ".json", ".webmanifest", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff2", ".map"]);

// File yang TIDAK boleh dilayani, berapa pun permintaannya.
//
// Ini penting: tanpa daftar ini, `curl http://localhost:4173/.env` mengembalikan
// isi .env lengkap dengan GEMINI_API_KEY dan SUPABASE_ANON_KEY. Semua berkas
// bertitik di depan diblokir sekalian (.git, .vercel, dan sejenisnya).
const BLOCKED_NAMES = new Set(["node_modules", "server.js", "package.json", "package-lock.json"]);

function isBlockedPath(pathname) {
  return pathname
    .split(/[\\/]+/)
    .filter(Boolean)
    .some(segment => segment.startsWith(".") || BLOCKED_NAMES.has(segment.toLowerCase()));
}

function sendNotFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": MIME[".txt"], "Cache-Control": "no-store" });
  res.end(message);
}

function serveIndex(res, status = 200) {
  fs.readFile(path.join(ROOT, "index.html"), (err, data) => {
    if (err) return sendNotFound(res, "index.html tidak ditemukan.");
    res.writeHead(status, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
    res.end(data);
  });
}

function serveFile(req, res) {
  if (!["GET", "HEAD"].includes(String(req.method || "GET").toUpperCase())) {
    res.writeHead(405, { "Allow": "GET, HEAD", "Content-Type": MIME[".txt"] });
    res.end("Method not allowed");
    return;
  }

  let url;
  try { url = new URL(req.url, `http://${req.headers.host || "localhost"}`); }
  catch (_) { return sendNotFound(res, "URL tidak valid."); }

  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch (_) { return sendNotFound(res, "URL tidak valid."); }

  if (pathname === "/") pathname = "/index.html";
  if (pathname.includes("\0")) return sendNotFound(res, "URL tidak valid.");
  if (isBlockedPath(pathname)) {
    res.writeHead(403, { "Content-Type": MIME[".txt"], "Cache-Control": "no-store" });
    res.end("Forbidden");
    return;
  }

  const filePath = path.resolve(ROOT, "." + path.sep + pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT_PREFIX)) {
    res.writeHead(403, { "Content-Type": MIME[".txt"] });
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();

  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      if (ASSET_EXTENSIONS.has(ext)) return sendNotFound(res, `Aset tidak ditemukan: ${pathname}`);
      return serveIndex(res, 200);
    }
    // File yang di-hash/di-versi lewat query boleh di-cache lama; sisanya tidak,
    // supaya update di Vercel langsung terlihat tanpa clear site data.
    const cache = [".html", ".webmanifest"].includes(ext) ? "no-store"
      : [".js", ".mjs", ".css"].includes(ext) ? "no-cache"
      : "public, max-age=3600";
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": cache,
      "Content-Length": stats.size,
      "X-Content-Type-Options": "nosniff"
    };
    if (String(req.method).toUpperCase() === "HEAD") {
      res.writeHead(200, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath)
      .on("error", () => res.end())
      .pipe(res);
  });
}

const server = http.createServer((req, res) => {
  try {
    if (req.url.startsWith("/api/generate")) return generate(req, res);
    if (req.url.startsWith("/api/config")) return config(req, res);
    return serveFile(req, res);
  } catch (err) {
    console.error("Request gagal:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": MIME[".txt"] });
      res.end("Internal error");
    }
  }
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} sudah dipakai. Tutup Aiyone yang lain, atau set PORT lain di .env.`);
    process.exit(1);
  }
  throw err;
});

// Default hanya mendengarkan di localhost. Sebelumnya server terikat ke semua
// interface, jadi siapa pun di Wi-Fi yang sama bisa membuka Aiyone milikmu.
// Set HOST=0.0.0.0 kalau kamu memang ingin membukanya dari HP di jaringan lokal.
const HOST = process.env.HOST || "127.0.0.1";

server.listen(PORT, HOST, () => {
  console.log(`Aiyone Personal Cloud jalan di http://localhost:${PORT}`);
  console.log("AI key dibaca dari .env atau environment variables.");
  if (HOST !== "127.0.0.1" && HOST !== "localhost") {
    console.log(`Perhatian: server terbuka di ${HOST}. Perangkat lain di jaringan ini bisa mengaksesnya.`);
  }
});
