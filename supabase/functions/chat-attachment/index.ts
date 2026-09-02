import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    const authHeader = req.headers.get("Authorization") ?? "";
    const body = await req.json();

    const {
      action,
      threadId,
      studentToken,
      fileName,
      mimeType,
      path
    } = body ?? {};

    if (!threadId || !action) {
      return json({ error: "Brak danych" }, 400);
    }

    let allowed = false;

    // 1) Student: losowy token konkretnego wątku.
    if (studentToken) {
      const { data: thread } = await admin
        .from("threads")
        .select("id, student_token")
        .eq("id", threadId)
        .eq("student_token", studentToken)
        .maybeSingle();

      allowed = !!thread;
    }

    // 2) Prowadzący: normalna sesja Supabase Auth.
    if (!allowed && authHeader.startsWith("Bearer ")) {
      const jwt = authHeader.slice(7);
      const { data: userData } = await admin.auth.getUser(jwt);

      if (userData.user) {
        const { data: ownedThread } = await admin
          .from("threads")
          .select("id, sessions!inner(teacher_id)")
          .eq("id", threadId)
          .eq("sessions.teacher_id", userData.user.id)
          .maybeSingle();

        allowed = !!ownedThread;
      }
    }

    if (!allowed) {
      return json({ error: "Brak dostępu" }, 403);
    }

    if (action === "upload-url") {
      const allowedTypes = ["image/png", "image/jpeg", "image/webp"];

      if (!fileName || !mimeType || !allowedTypes.includes(mimeType)) {
        return json({ error: "Nieprawidłowy typ pliku" }, 400);
      }

      const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
      const objectPath = `${threadId}/${crypto.randomUUID()}-${safeName}`;

      const { data, error } = await admin.storage
        .from("chat-attachments")
        .createSignedUploadUrl(objectPath);

      if (error || !data) {
        return json({ error: error?.message ?? "Nie udało się utworzyć upload URL" }, 500);
      }

      return json({
        path: data.path,
        token: data.token
      });
    }

    if (action === "sign") {
      if (!path || !String(path).startsWith(`${threadId}/`)) {
        return json({ error: "Nieprawidłowa ścieżka" }, 400);
      }

      // Dodatkowo upewnij się, że ten plik faktycznie występuje
      // w wiadomości danego wątku.
      const { data: message } = await admin
        .from("messages")
        .select("id")
        .eq("thread_id", threadId)
        .eq("attachment_url", path)
        .maybeSingle();

      if (!message) {
        return json({ error: "Załącznik nie należy do tego wątku" }, 404);
      }

      const { data, error } = await admin.storage
        .from("chat-attachments")
        .createSignedUrl(path, 300);

      if (error || !data) {
        return json({ error: error?.message ?? "Nie udało się podpisać URL" }, 500);
      }

      return json({ signedUrl: data.signedUrl });
    }

    return json({ error: "Nieznana akcja" }, 400);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Błąd funkcji" },
      500
    );
  }
});
