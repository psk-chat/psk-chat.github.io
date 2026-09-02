import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { makeStudentToken } from "../utils";

export default function StudentJoin() {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const initialCode = new URLSearchParams(location.search).get("code");
    if (initialCode) setCode(initialCode.toUpperCase().slice(0, 5));
  }, [location.search]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);

    const studentToken = makeStudentToken();

    const { data, error: joinError } = await supabase.rpc("student_join_session", {
      p_code: code.trim().toUpperCase(),
      p_student_name: name.trim(),
      p_student_token: studentToken
    });

    const result = Array.isArray(data) ? data[0] : data;

    if (joinError || !result?.thread_id) {
      setError("Nie znaleziono aktywnych zajęć o takim kodzie.");
      setBusy(false);
      return;
    }

    localStorage.setItem(`student_token_${result.thread_id}`, studentToken);
    localStorage.setItem(`student_name_${result.thread_id}`, name.trim());
    navigate(`/chat/${result.thread_id}`);
  }

  return (
    <section className="card narrow">
      <h1>Dołącz do zajęć</h1>

      <form onSubmit={submit} className="form">
        <label>
          Kod zajęć
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={5}
            placeholder="K7P4X"
            required
          />
        </label>

        <label>
          Imię i nazwisko
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jan Kowalski"
            required
          />
        </label>

        {error && <div className="error">{error}</div>}

        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Dołączanie..." : "Dołącz"}
        </button>
      </form>
    </section>
  );
}
