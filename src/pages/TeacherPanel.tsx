import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Message, Session, SessionSchedule, Thread } from "../types";
import { formatTime, generateCode } from "../utils";
import AttachmentImage from "../components/AttachmentImage";
import PushSettings from "../components/PushSettings";
import { QRCodeSVG } from "qrcode.react";

type CreateMode = "now" | "scheduled" | "weekly";

const WEEKDAYS = ["pon.", "wt.", "śr.", "czw.", "pt.", "sob.", "niedz."];

const REPLY_TEMPLATES = [
  "Podeślij proszę screenshot błędu.",
  "Sprawdź dokładną treść błędu i wklej ją tutaj.",
  "Podejdę do Ciebie za chwilę.",
  "Spróbuj jeszcze raz po odświeżeniu / ponownym uruchomieniu.",
  "Tak, to jest poprawnie. Możesz iść dalej.",
];

function toLocalInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localDateParts(value: string) {
  const date = new Date(value);
  const jsDay = date.getDay();
  const isoWeekday = jsDay === 0 ? 7 : jsDay;
  return {
    date,
    isoWeekday,
    startsOn: value.slice(0, 10),
    startTime: value.slice(11, 16),
  };
}

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function TeacherPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [schedules, setSchedules] = useState<SessionSchedule[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [subject, setSubject] = useState("Zajęcia");
  const [createMode, setCreateMode] = useState<CreateMode>("now");
  const [startsAt, setStartsAt] = useState(toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [neverClose, setNeverClose] = useState(false);
  const [publishCode, setPublishCode] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingSession, setDeletingSession] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const navigate = useNavigate();

  async function ensureAuth() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) navigate("/teacher");
  }

  async function loadSessions() {
    const { data } = await supabase
      .from("sessions")
      .select("*")
      .order("starts_at", { ascending: false });

    setSessions((data ?? []) as Session[]);
  }

  async function loadSchedules() {
    const { data } = await supabase
      .from("session_schedules")
      .select("*")
      .order("created_at", { ascending: false });

    setSchedules((data ?? []) as SessionSchedule[]);
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
    loadSchedules();
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

    return () => { supabase.removeChannel(channel); };
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

    return () => { supabase.removeChannel(channel); };
  }, [selectedThread?.id]);

  async function uniqueCode() {
    for (let i = 0; i < 10; i++) {
      const code = generateCode();
      const { data } = await supabase.from("sessions").select("id").eq("code", code).maybeSingle();
      if (!data) return code;
    }
    throw new Error("Nie udało się wygenerować kodu. Spróbuj ponownie.");
  }

  async function createSession(e: FormEvent) {
    e.preventDefault();
    setCreateError("");

    const cleanSubject = subject.trim();
    if (!cleanSubject) return setCreateError("Podaj nazwę zajęć.");

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    if (createMode !== "now" && !startsAt) {
      return setCreateError("Wybierz datę i godzinę rozpoczęcia.");
    }

    try {
      if (createMode === "weekly") {
        const parts = localDateParts(startsAt);
        if (parts.date.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
          return setCreateError("Pierwsze zajęcia nie mogą być w przeszłości.");
        }

        const { error } = await supabase.from("session_schedules").insert({
          teacher_id: auth.user.id,
          subject: cleanSubject,
          weekday: parts.isoWeekday,
          start_time: `${parts.startTime}:00`,
          duration_minutes: durationMinutes,
          auto_close: !neverClose,
          publish_code: publishCode,
          starts_on: parts.startsOn,
          timezone: "Europe/Warsaw",
        });

        if (error) throw error;
        await Promise.all([loadSchedules(), loadSessions()]);
      } else {
        const start = createMode === "now" ? new Date() : new Date(startsAt);
        if (createMode === "scheduled" && start.getTime() <= Date.now()) {
          return setCreateError("Dla zaplanowanego chatu ustaw godzinę w przyszłości.");
        }

        const code = await uniqueCode();
        const expires = neverClose
          ? null
          : new Date(start.getTime() + durationMinutes * 60_000).toISOString();

        const { data, error } = await supabase
          .from("sessions")
          .insert({
            code,
            subject: cleanSubject,
            teacher_id: auth.user.id,
            status: createMode === "now" ? "active" : "scheduled",
            starts_at: start.toISOString(),
            expires_at: expires,
            auto_close: !neverClose,
            publish_code: publishCode,
          })
          .select("*")
          .single();

        if (error) throw error;
        await loadSessions();
        if (data) setSelectedSession(data as Session);
      }

      setShowCreate(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Nie udało się utworzyć chatu.");
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

    await supabase.from("threads").update({ unread_for_student: true }).eq("id", selectedThread.id);
    setReply("");
    await loadMessages(selectedThread.id);
  }

  async function toggleResolved() {
    if (!selectedThread) return;
    const newStatus = selectedThread.status === "resolved" ? "open" : "resolved";
    await supabase.from("threads").update({ status: newStatus }).eq("id", selectedThread.id);
    setSelectedThread({ ...selectedThread, status: newStatus });
    if (selectedSession) await loadThreads(selectedSession.id);
  }

  async function closeSession() {
    if (!selectedSession) return;
    await supabase.from("sessions").update({ status: "closed" }).eq("id", selectedSession.id);
    setSelectedSession({ ...selectedSession, status: "closed" });
    await loadSessions();
  }

  async function deleteSession() {
    if (!selectedSession || deletingSession) return;

    const label = `${selectedSession.subject} (${selectedSession.code})`;
    const confirmed = window.confirm(
      `Usunąć chat „${label}”?\n\nZostaną trwale usunięte wszystkie wątki, wiadomości i załączniki z tego chatu. Tej operacji nie można cofnąć.`
    );
    if (!confirmed) return;

    setDeleteError("");
    setDeletingSession(true);

    try {
      const { data, error } = await supabase.functions.invoke("delete-session", {
        body: { sessionId: selectedSession.id },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setSelectedSession(null);
      setSelectedThread(null);
      setThreads([]);
      setMessages([]);
      await loadSessions();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Nie udało się usunąć chatu.");
    } finally {
      setDeletingSession(false);
    }
  }

  async function toggleSchedule(schedule: SessionSchedule) {
    await supabase
      .from("session_schedules")
      .update({ active: !schedule.active })
      .eq("id", schedule.id);
    await loadSchedules();
  }

  async function logout() {
    await supabase.auth.signOut();
    navigate("/");
  }

  function applyReplyTemplate(text: string) {
    setReply((current) => current.trim() ? `${current.trim()}\n${text}` : text);
  }

  const selectedJoinUrl = selectedSession
    ? `${window.location.origin}/#/join?code=${encodeURIComponent(selectedSession.code)}`
    : "";

  const visibleThreads = useMemo(
    () => onlyOpen ? threads.filter((t) => t.status === "open") : threads,
    [threads, onlyOpen]
  );

  return (
    <section className="teacher-shell">
      <div className="teacher-toolbar">
        <div className="toolbar-actions">
          <button className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Anuluj" : "+ Nowy chat"}
          </button>
          <a
            className="btn btn-secondary"
            href={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/session-codes`}
            target="_blank"
            rel="noreferrer"
          >
            JSON z kodami
          </a>
        </div>
        <button className="btn btn-secondary" onClick={logout}>Wyloguj</button>
      </div>

      {showCreate && (
        <form onSubmit={createSession} className="card create-session-card">
          <h2>Utwórz chat</h2>
          <div className="create-grid">
            <label>
              Nazwa / grupa
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="np. Bazy danych 12A" />
            </label>

            <label>
              Tryb
              <select value={createMode} onChange={(e) => setCreateMode(e.target.value as CreateMode)}>
                <option value="now">Uruchom teraz</option>
                <option value="scheduled">Jednorazowo o danej godzinie</option>
                <option value="weekly">Co tydzień</option>
              </select>
            </label>

            {createMode !== "now" && (
              <label>
                {createMode === "weekly" ? "Pierwsze zajęcia" : "Start"}
                <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </label>
            )}

            <label>
              Czas trwania (min)
              <input
                type="number"
                min={15}
                max={1440}
                step={15}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
              />
            </label>
          </div>

          <div className="create-options">
            <label className="checkbox">
              <input type="checkbox" checked={neverClose} onChange={(e) => setNeverClose(e.target.checked)} />
              Nie zamykaj automatycznie
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={publishCode} onChange={(e) => setPublishCode(e.target.checked)} />
              Udostępniaj kod w JSON dla Moodle
            </label>
          </div>

          {createMode === "weekly" && (
            <div className="hint">Powstanie nowy chat i nowy kod co tydzień. Najbliższe wystąpienia są generowane z wyprzedzeniem.</div>
          )}
          {createError && <div className="error">{createError}</div>}
          <button className="btn btn-primary">Utwórz</button>
        </form>
      )}

      <PushSettings />

      {schedules.length > 0 && (
        <div className="card schedules-card">
          <div className="section-title"><h2>Cykliczne zajęcia</h2></div>
          <div className="schedule-list">
            {schedules.map((s) => (
              <div className="schedule-row" key={s.id}>
                <div>
                  <strong>{s.subject}</strong>
                  <div className="muted">
                    co {WEEKDAYS[s.weekday - 1]} o {s.start_time.slice(0, 5)} · {s.duration_minutes} min
                    {s.auto_close ? " · auto-zamykanie" : " · bez auto-zamykania"}
                  </div>
                </div>
                <button className="btn btn-secondary" onClick={() => toggleSchedule(s)}>
                  {s.active ? "Wstrzymaj" : "Wznów"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
              <small>{formatSessionDate(s.starts_at)}</small>
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
                  <div className="muted">
                    {selectedSession.status === "scheduled" ? "Start: " : "Rozpoczęto: "}
                    {formatSessionDate(selectedSession.starts_at)}
                  </div>
                  {selectedSession.expires_at && (
                    <div className="muted">Koniec: {formatSessionDate(selectedSession.expires_at)}</div>
                  )}
                </div>
                <div className="session-actions">
                  <button className="btn btn-secondary" onClick={() => setShowQr((value) => !value)}>
                    {showQr ? "Ukryj QR" : "Pokaż QR"}
                  </button>
                  {selectedSession.status !== "closed" && (
                    <button className="btn btn-danger" onClick={closeSession}>Zamknij</button>
                  )}
                  {selectedSession.status === "closed" && (
                    <button
                      className="btn btn-delete"
                      onClick={deleteSession}
                      disabled={deletingSession}
                      title="Trwale usuń chat wraz z wiadomościami i załącznikami"
                    >
                      {deletingSession ? "Usuwanie…" : "Usuń"}
                    </button>
                  )}
                </div>
              </div>

              {deleteError && <div className="error session-delete-error">{deleteError}</div>}

              {showQr && selectedSession && (
                <div className="qr-box">
                  <QRCodeSVG value={selectedJoinUrl} size={180} marginSize={2} />
                  <div className="qr-details">
                    <strong>Zeskanuj, aby dołączyć</strong>
                    <span className="muted">Kod zostanie wpisany automatycznie.</span>
                    <a href={selectedJoinUrl} target="_blank" rel="noreferrer">{selectedJoinUrl}</a>
                    <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(selectedJoinUrl)}>
                      Kopiuj link
                    </button>
                  </div>
                </div>
              )}

              <label className="checkbox">
                <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
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
                  <div className={`message-row ${m.sender_role === "teacher" ? "mine" : "theirs"}`} key={m.id}>
                    <div className="message-bubble">
                      <div className="message-author">
                        {m.sender_role === "teacher" ? "Ty" : selectedThread.student_name} · {formatTime(m.created_at)}
                      </div>
                      {m.content && <div>{m.content}</div>}
                      {m.attachment_url && <AttachmentImage path={m.attachment_url} threadId={m.thread_id} />}
                    </div>
                  </div>
                ))}
              </div>

              <form className="composer" onSubmit={sendReply}>
                <div className="reply-templates">
                  {REPLY_TEMPLATES.map((template) => (
                    <button
                      type="button"
                      className="template-chip"
                      key={template}
                      onClick={() => applyReplyTemplate(template)}
                    >
                      {template}
                    </button>
                  ))}
                </div>
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Napisz odpowiedź..." />
                <button className="btn btn-primary">Wyślij</button>
              </form>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
