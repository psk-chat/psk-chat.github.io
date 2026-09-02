import { createClient } from "npm:@supabase/supabase-js@2";

type Payload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: {
    id: string;
    thread_id: string;
    sender_role: "student" | "teacher";
    content: string | null;
    attachment_url: string | null;
  } | null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const payload = await req.json() as Payload;
    const record = payload.record;

    if (payload.type !== "INSERT" || payload.table !== "messages" || !record || record.sender_role !== "student") {
      return Response.json({ ok: true, skipped: true });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { data: thread, error: threadError } = await admin
      .from("threads")
      .select("id, student_name, sessions!inner(id, teacher_id, subject)")
      .eq("id", record.thread_id)
      .single();

    if (threadError || !thread) throw threadError ?? new Error("Brak wątku.");
    const session = Array.isArray(thread.sessions) ? thread.sessions[0] : thread.sessions;

    const preview = record.content?.trim()
      ? record.content.trim().slice(0, 200)
      : "📷 Wysłano załącznik";

    const { error } = await admin.rpc("queue_teacher_push", {
      p_teacher_id: session.teacher_id,
      p_session_id: session.id,
      p_student_name: thread.student_name,
      p_preview: preview,
    });

    if (error) throw error;
    return Response.json({ ok: true, queued: true });
  } catch (e) {
    console.error(e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
});
