function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

module.exports = async function config(req, res) {
  if (req.method && req.method.toUpperCase() === "OPTIONS") return send(res, 200, { ok: true });
  if (req.method && req.method.toUpperCase() !== "GET") return send(res, 405, { ok: false, error: "Method not allowed" });

  const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

  return send(res, 200, {
    ok: true,
    hasSupabase: Boolean(supabaseUrl && supabaseAnonKey),
    supabaseUrl,
    supabaseAnonKey,
    source: supabaseUrl && supabaseAnonKey ? "environment" : "none"
  });
};
