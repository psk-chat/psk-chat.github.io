import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const url = new URL(req.url);
  const name = url.searchParams.get("name")?.trim() || null;
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const recent = new Date(now.getTime() - 12 * 60 * 60 * 1000);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let query = supabase
    .from("sessions")
    .select("id, subject, code, status, starts_at, expires_at, schedule_id")
    .eq("publish_code", true)
    .in("status", ["scheduled", "active"])
    .lte("starts_at", horizon.toISOString())
    .gte("starts_at", recent.toISOString())
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
    .order("starts_at", { ascending: true });

  if (name) query = query.eq("subject", name);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });

  // Dla każdej nazwy zwracamy aktualny chat, a jeśli jeszcze nie wystartował — najbliższy.
  const byName: Record<string, unknown> = {};
  for (const session of data ?? []) {
    if (!byName[session.subject]) {
      byName[session.subject] = {
        code: session.code,
        status: session.status,
        starts_at: session.starts_at,
        expires_at: session.expires_at,
      };
    }
  }

  return Response.json({
    generated_at: now.toISOString(),
    by_name: byName,
    sessions: data ?? [],
  }, {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
});
