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
const ROOT = __dirname;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

function serveFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(ROOT, "index.html"), (fallbackErr, fallback) => {
        if (fallbackErr) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
        res.end(fallback);
      });
      return;
    }
    const ext = path.extname(filePath);
    const cache = [".html", ".js", ".css", ".webmanifest"].includes(ext) ? "no-store" : "public, max-age=3600";
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": cache });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/generate")) return generate(req, res);
  if (req.url.startsWith("/api/config")) return config(req, res);
  return serveFile(req, res);
});

server.listen(PORT, () => {
  console.log(`Aiyone Personal Cloud jalan di http://localhost:${PORT}`);
  console.log("AI key dibaca dari .env atau environment variables.");
});
