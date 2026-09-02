import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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

    const publicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const privateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const subject = Deno.env.get("VAPID_SUBJECT")!;
    const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");

    if (!publicKey || !privateKey || !subject || !appUrl) {
      throw new Error("Brak sekretów VAPID lub APP_URL.");
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);

    const { data: thread, error: threadError } = await admin
      .from("threads")
      .select("id, student_name, sessions!inner(id, teacher_id, subject)")
      .eq("id", record.thread_id)
      .single();

    if (threadError || !thread) throw threadError ?? new Error("Brak wątku.");

    const session = Array.isArray(thread.sessions) ? thread.sessions[0] : thread.sessions;

    const { data: subscriptions, error: subError } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("teacher_id", session.teacher_id);

    if (subError) throw subError;
    if (!subscriptions?.length) return Response.json({ ok: true, sent: 0 });

    const preview = record.content?.trim()
      ? record.content.trim().slice(0, 120)
      : "📷 Wysłano załącznik";

    const body = JSON.stringify({
      title: `💬 ${thread.student_name}`,
      body: `${session.subject}: ${preview}`,
      url: `${appUrl}/#/teacher/panel`,
      tag: `thread-${thread.id}`
    });

    let sent = 0;
    const expired: string[] = [];

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }, body, { TTL: 3600, urgency: "high" });
        sent++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) expired.push(sub.id);
        else console.error(e);
      }
    }

    if (expired.length) {
      await admin.from("push_subscriptions").delete().in("id", expired);
    }

    return Response.json({ ok: true, sent, removedExpired: expired.length });
  } catch (e) {
    console.error(e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
});
