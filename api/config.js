function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

/**
 * Mengirim konfigurasi Supabase publik ke browser.
 *
 * Anon key memang dirancang untuk dipakai di sisi klien: yang melindungi data
 * adalah Row Level Security di `supabase/schema.sql`, bukan kerahasiaan key ini.
 * Jangan pernah menaruh service_role key di sini.
 */
module.exports = async function config(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    res.setHeader("Allow", "GET, OPTIONS");
    return send(res, 204, { ok: true });
  }
  if (method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }

  const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  const ready = Boolean(supabaseUrl && supabaseAnonKey);

  return send(res, 200, {
    ok: true,
    hasSupabase: ready,
    supabaseUrl: ready ? supabaseUrl : "",
    supabaseAnonKey: ready ? supabaseAnonKey : "",
    source: ready ? "environment" : "none"
  });
};
