import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Message, Session, Thread } from "../types";
import { formatTime, generateCode } from "../utils";
import AttachmentImage from "../components/AttachmentImage";
import PushSettings from "../components/PushSettings";

export default function TeacherPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [subject, setSubject] = useState("Zajęcia");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const navigate = useNavigate();

  async function ensureAuth() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) navigate("/teacher");
  }

  async function loadSessions() {
    const { data } = await supabase
      .from("sessions")
      .select("*")
      .order("created_at", { ascending: false });

    setSessions((data ?? []) as Session[]);
  }

  async function loadThreads(sessionId: string) {
    const { data } = await supabase
      .from("threads")
      .select("*")
      .eq("session_id", sessionId)
      .order("unread_for_teacher", { ascending: false })
      .order("created_at", { ascending: true });

    setThreads((data ?? []) as Thread[]);
  }

  async function loadMessages(threadId: string) {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    setMessages((data ?? []) as Message[]);

    await supabase
      .from("threads")
      .update({ unread_for_teacher: false })
      .eq("id", threadId);
  }

  useEffect(() => {
    ensureAuth();
    loadSessions();
  }, []);

  useEffect(() => {
    if (!selectedSession) return;
    loadThreads(selectedSession.id);

    const channel = supabase
      .channel(`teacher-session-${selectedSession.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "threads",
        filter: `session_id=eq.${selectedSession.id}`
      }, () => loadThreads(selectedSession.id))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedSession?.id]);

  useEffect(() => {
    if (!selectedThread) return;
    loadMessages(selectedThread.id);

    const channel = supabase
      .channel(`teacher-thread-${selectedThread.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `thread_id=eq.${selectedThread.id}`
      }, () => {
        loadMessages(selectedThread.id);
        if (selectedSession) loadThreads(selectedSession.id);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedThread?.id]);

  async function createSession(e: FormEvent) {
    e.preventDefault();

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    let code = generateCode();

    for (let i = 0; i < 5; i++) {
      const { data } = await supabase
        .from("sessions")
        .select("id")
        .eq("code", code)
        .maybeSingle();

      if (!data) break;
      code = generateCode();
    }

    const { data, error } = await supabase
      .from("sessions")
      .insert({
        code,
        subject: subject.trim(),
        teacher_id: auth.user.id,
        status: "active",
        expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
      })
      .select("*")
      .single();

    if (!error && data) {
      await loadSessions();
      setSelectedSession(data as Session);
    }
  }

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    if (!selectedThread || !reply.trim()) return;

    await supabase.from("messages").insert({
      thread_id: selectedThread.id,
      sender_role: "teacher",
      content: reply.trim()
    });

    await supabase
      .from("threads")
      .update({
        unread_for_student: true
      })
      .eq("id", selectedThread.id);

    setReply("");
    await loadMessages(selectedThread.id);
  }

  async function toggleResolved() {
    if (!selectedThread) return;

    const newStatus = selectedThread.status === "resolved" ? "open" : "resolved";

    await supabase
      .from("threads")
      .update({ status: newStatus })
      .eq("id", selectedThread.id);

    setSelectedThread({ ...selectedThread, status: newStatus });
    if (selectedSession) await loadThreads(selectedSession.id);
  }

  async function closeSession() {
    if (!selectedSession) return;

    await supabase
      .from("sessions")
      .update({ status: "closed" })
      .eq("id", selectedSession.id);

    setSelectedSession({ ...selectedSession, status: "closed" });
    await loadSessions();
  }

  async function logout() {
    await supabase.auth.signOut();
    navigate("/");
  }

  const visibleThreads = useMemo(
    () => onlyOpen ? threads.filter((t) => t.status === "open") : threads,
    [threads, onlyOpen]
  );

  return (
    <section className="teacher-shell">
      <div className="teacher-toolbar">
        <form onSubmit={createSession} className="inline-form">
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          <button className="btn btn-primary">Nowe zajęcia</button>
        </form>
        <button className="btn btn-secondary" onClick={logout}>Wyloguj</button>
      </div>

      <PushSettings />

      <div className="teacher-grid">
        <aside className="card sidebar">
          <h2>Zajęcia</h2>

          {sessions.map((s) => (
            <button
              className={`session-item ${selectedSession?.id === s.id ? "active" : ""}`}
              key={s.id}
              onClick={() => {
                setSelectedSession(s);
                setSelectedThread(null);
                setMessages([]);
              }}
            >
              <strong>{s.subject}</strong>
              <span>{s.code} · {s.status}</span>
            </button>
          ))}
        </aside>

        <aside className="card sidebar">
          {!selectedSession ? (
            <div className="empty">Wybierz zajęcia.</div>
          ) : (
            <>
              <div className="session-head">
                <div>
                  <h2>{selectedSession.subject}</h2>
                  <div className="big-code">{selectedSession.code}</div>
                </div>
                {selectedSession.status === "active" && (
                  <button className="btn btn-danger" onClick={closeSession}>Zamknij</button>
                )}
              </div>

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={onlyOpen}
                  onChange={(e) => setOnlyOpen(e.target.checked)}
                />
                Tylko otwarte
              </label>

              <div className="thread-list">
                {visibleThreads.map((t) => (
                  <button
                    key={t.id}
                    className={`thread-item ${selectedThread?.id === t.id ? "active" : ""}`}
                    onClick={() => setSelectedThread(t)}
                  >
                    <div className="thread-row">
                      <strong>{t.student_name}</strong>
                      {t.unread_for_teacher && <span className="dot" />}
                    </div>
                    <small>{t.status === "resolved" ? "Rozwiązane" : "Otwarte"}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>

        <main className="card teacher-chat">
          {!selectedThread ? (
            <div className="empty">Wybierz studenta.</div>
          ) : (
            <>
              <div className="chat-header">
                <div>
                  <h2>{selectedThread.student_name}</h2>
                  <span className="muted">{selectedThread.status}</span>
                </div>
                <button className="btn btn-secondary" onClick={toggleResolved}>
                  {selectedThread.status === "resolved" ? "Otwórz ponownie" : "Oznacz jako rozwiązane"}
                </button>
              </div>

              <div className="messages">
                {messages.map((m) => (
                  <div
                    className={`message-row ${m.sender_role === "teacher" ? "mine" : "theirs"}`}
                    key={m.id}
                  >
                    <div className="message-bubble">
                      <div className="message-author">
                        {m.sender_role === "teacher" ? "Ty" : selectedThread.student_name}
                        {" · "}
                        {formatTime(m.created_at)}
                      </div>
                      {m.content && <div>{m.content}</div>}
                      {m.attachment_url && (
                        <AttachmentImage
                          path={m.attachment_url}
                          threadId={m.thread_id}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <form className="composer" onSubmit={sendReply}>
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={3}
                  placeholder="Napisz odpowiedź..."
                />
                <button className="btn btn-primary">Wyślij</button>
              </form>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
