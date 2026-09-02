import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Message, Thread } from "../types";
import MessageBubble from "../components/MessageBubble";

export default function StudentChat() {
  const { threadId } = useParams();
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);

  const studentToken = threadId
    ? localStorage.getItem(`student_token_${threadId}`)
    : null;

  async function load(silent = false) {
    if (!threadId || !studentToken) return;

    const { data: t, error: tErr } = await supabase
      .rpc("student_get_thread", {
        p_thread_id: threadId,
        p_student_token: studentToken
      })
      .maybeSingle();

    if (tErr || !t) {
      if (!silent) setError("Nie masz dostępu do tego wątku.");
      return;
    }

    setThread(t as Thread);

    const { data: msgs, error: mErr } = await supabase
      .rpc("student_get_messages", {
        p_thread_id: threadId,
        p_student_token: studentToken
      });

    if (mErr) {
      if (!silent) setError("Nie udało się pobrać wiadomości.");
      return;
    }

    setMessages((msgs ?? []) as Message[]);
  }

  useEffect(() => {
    load();

    // Student nie ma sesji Supabase Auth, więc dla prostego i szczelnego MVP
    // odświeżamy prywatny wątek co 2 sekundy zamiast otwierać anon Realtime.
    const timer = window.setInterval(() => load(true), 2000);
    return () => window.clearInterval(timer);
  }, [threadId, studentToken]);

  async function uploadAttachment() {
    if (!file || !threadId || !studentToken) return null;

    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Plik jest większy niż 5 MB.");
    }

    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) {
      throw new Error("Dozwolone są tylko PNG, JPG i WEBP.");
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

    const { data, error } = await supabase.functions.invoke("chat-attachment", {
      body: {
        action: "upload-url",
        threadId,
        studentToken,
        fileName: safeName,
        mimeType: file.type
      }
    });

    if (error || !data?.path || !data?.token) {
      throw new Error("Nie udało się przygotować uploadu.");
    }

    const { error: uploadError } = await supabase.storage
      .from("chat-attachments")
      .uploadToSignedUrl(data.path, data.token, file, {
        contentType: file.type
      });

    if (uploadError) throw uploadError;

    return data.path as string;
  }


  useEffect(() => {
    function handlePaste(e: globalThis.ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
      const image = imageItem?.getAsFile()
        ?? Array.from(e.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"));

      if (!image) return;

      const extension = image.type === "image/jpeg" ? "jpg" : image.type.split("/")[1] || "png";
      const pasted = new File([image], `screenshot-${Date.now()}.${extension}`, { type: image.type || "image/png" });

      setFile(pasted);
      setError("");
      e.preventDefault();
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!threadId || !studentToken || (!content.trim() && !file)) return;

    if (Date.now() < cooldownUntil) {
      setError("Odczekaj chwilę przed wysłaniem kolejnej wiadomości.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const attachmentPath = await uploadAttachment();

      const { error } = await supabase.rpc("student_send_message", {
        p_thread_id: threadId,
        p_student_token: studentToken,
        p_content: content.trim() || null,
        p_attachment_url: attachmentPath
      });

      if (error) throw error;

      setContent("");
      setFile(null);
      setCooldownUntil(Date.now() + 2000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się wysłać wiadomości.");
    } finally {
      setBusy(false);
    }
  }

  if (!studentToken) {
    return (
      <section className="card narrow">
        <h1>Brak dostępu</h1>
        <p>Ten wątek został utworzony na innym urządzeniu lub dane lokalne zostały usunięte.</p>
      </section>
    );
  }

  return (
    <section className="chat-layout">
      <div className="card chat-card">
        <div className="chat-header">
          <div>
            <h1>Twój prywatny wątek</h1>
            <p>{thread?.student_name}</p>
          </div>
          {thread?.status === "resolved" && <span className="badge">Rozwiązane</span>}
        </div>

        <div className="messages">
          {messages.length === 0 && (
            <div className="empty">Napisz pierwsze pytanie do prowadzącego.</div>
          )}

          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              studentToken={studentToken}
            />
          ))}
        </div>

        <form onSubmit={send} className="composer">
          <textarea
            placeholder="Napisz pytanie..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
          />

          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />

          {file && <small>Załącznik: {file.name} · możesz wkleić screenshot bezpośrednio przez Ctrl+V</small>}
          {error && <div className="error">{error}</div>}

          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Wysyłanie..." : "Wyślij"}
          </button>
        </form>
      </div>
    </section>
  );
}
