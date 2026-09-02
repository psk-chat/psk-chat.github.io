import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Brak autoryzacji" }, 401);

    const jwt = authHeader.slice(7);
    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user) return json({ error: "Nieprawidłowa sesja" }, 401);

    const { sessionId } = await req.json();
    if (!sessionId) return json({ error: "Brak sessionId" }, 400);

    const { data: session, error: sessionError } = await admin
      .from("sessions")
      .select("id, teacher_id, subject, code, status")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError) throw sessionError;
    if (!session) return json({ error: "Chat nie istnieje" }, 404);
    if (session.teacher_id !== userData.user.id) return json({ error: "Brak dostępu" }, 403);
    if (session.status !== "closed") {
      return json({ error: "Można usuwać tylko zamknięte chaty. Najpierw zamknij chat." }, 409);
    }

    const { data: threads, error: threadError } = await admin
      .from("threads")
      .select("id")
      .eq("session_id", sessionId);
    if (threadError) throw threadError;

    const threadIds = (threads ?? []).map((t) => t.id);
    let attachmentPaths: string[] = [];

    if (threadIds.length > 0) {
      const { data: messages, error: messageError } = await admin
        .from("messages")
        .select("attachment_url")
        .in("thread_id", threadIds)
        .not("attachment_url", "is", null);
      if (messageError) throw messageError;

      attachmentPaths = [...new Set(
        (messages ?? [])
          .map((m) => m.attachment_url)
          .filter((p): p is string => typeof p === "string" && p.length > 0)
      )];
    }

    // Najpierw Storage, potem rekord sesji. Relacje DB mają ON DELETE CASCADE.
    if (attachmentPaths.length > 0) {
      for (let i = 0; i < attachmentPaths.length; i += 100) {
        const batch = attachmentPaths.slice(i, i + 100);
        const { error: storageError } = await admin.storage
          .from("chat-attachments")
          .remove(batch);
        if (storageError) throw storageError;
      }
    }

    const { error: deleteError } = await admin
      .from("sessions")
      .delete()
      .eq("id", sessionId)
      .eq("teacher_id", userData.user.id);
    if (deleteError) throw deleteError;

    return json({
      ok: true,
      deletedSessionId: sessionId,
      deletedAttachments: attachmentPaths.length,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Błąd usuwania chatu" }, 500);
  }
});
