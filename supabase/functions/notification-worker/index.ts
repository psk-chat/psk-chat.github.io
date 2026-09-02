import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string };

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

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
    return Response.json({ ok: false, error: "Brak sekretów VAPID lub APP_URL." }, { status: 500 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const expiredSubscriptions = new Set<string>();

  async function subscriptionsFor(teacherId: string): Promise<Subscription[]> {
    const { data, error } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("teacher_id", teacherId);
    if (error) throw error;
    return (data ?? []) as Subscription[];
  }

  async function unreadCount(teacherId: string) {
    const { count, error } = await admin
      .from("threads")
      .select("id, sessions!inner(teacher_id)", { count: "exact", head: true })
      .eq("unread_for_teacher", true)
      .eq("sessions.teacher_id", teacherId);
    if (error) throw error;
    return count ?? 0;
  }

  async function sendToTeacher(teacherId: string, payload: Record<string, unknown>) {
    const subscriptions = await subscriptionsFor(teacherId);
    let sent = 0;

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 3600, urgency: "high" }
        );
        sent++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) expiredSubscriptions.add(sub.id);
        else console.error("push error", e);
      }
    }
    return sent;
  }

  try {
    let sentBatches = 0;
    let sentReminders = 0;

    // Wiadomości są buforowane minimum 30 s, dzięki czemu kilka pytań wpada w jeden push.
    const batchCutoff = new Date(Date.now() - 30_000).toISOString();
    const { data: batches, error: batchError } = await admin
      .from("push_notification_batches")
      .select("id, teacher_id, session_id, message_count, latest_student_name, latest_preview, sessions!inner(subject)")
      .lte("updated_at", batchCutoff)
      .order("updated_at", { ascending: true })
      .limit(100);
    if (batchError) throw batchError;

    for (const batch of batches ?? []) {
      const session = Array.isArray(batch.sessions) ? batch.sessions[0] : batch.sessions;
      const badgeCount = await unreadCount(batch.teacher_id);
      const count = batch.message_count ?? 1;
      const title = count === 1
        ? `💬 ${batch.latest_student_name}`
        : `💬 ${count} nowych wiadomości`;
      const body = count === 1
        ? `${session.subject}: ${batch.latest_preview}`
        : `${session.subject} — ostatnia od ${batch.latest_student_name}: ${batch.latest_preview}`;

      await sendToTeacher(batch.teacher_id, {
        title,
        body,
        url: `${appUrl}/#/teacher/panel`,
        tag: `session-${batch.session_id}`,
        badgeCount,
      });

      await admin.from("push_notification_batches").delete().eq("id", batch.id);
      sentBatches++;
    }

    // Przypomnienie około 5 minut przed startem. Okno 4–6 min zabezpiecza przed przesunięciem crona.
    const now = Date.now();
    const from = new Date(now + 4 * 60_000).toISOString();
    const to = new Date(now + 6 * 60_000).toISOString();
    const { data: sessions, error: reminderError } = await admin
      .from("sessions")
      .select("id, teacher_id, subject, code, starts_at")
      .eq("status", "scheduled")
      .is("reminder_sent_at", null)
      .gte("starts_at", from)
      .lte("starts_at", to)
      .order("starts_at", { ascending: true })
      .limit(100);
    if (reminderError) throw reminderError;

    for (const session of sessions ?? []) {
      const badgeCount = await unreadCount(session.teacher_id);
      await sendToTeacher(session.teacher_id, {
        title: `⏰ ${session.subject} za 5 minut`,
        body: `Kod chatu: ${session.code}`,
        url: `${appUrl}/#/teacher/panel`,
        tag: `reminder-${session.id}`,
        badgeCount,
      });

      await admin
        .from("sessions")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", session.id)
        .is("reminder_sent_at", null);
      sentReminders++;
    }

    if (expiredSubscriptions.size) {
      await admin.from("push_subscriptions").delete().in("id", [...expiredSubscriptions]);
    }

    return Response.json({
      ok: true,
      sentBatches,
      sentReminders,
      removedExpired: expiredSubscriptions.size,
    });
  } catch (e) {
    console.error(e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
});
