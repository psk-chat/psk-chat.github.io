import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function TeacherLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);

  const navigate = useNavigate();

  useEffect(() => {
    async function checkSession() {
      const { data } = await supabase.auth.getSession();

      if (data.session) {
        navigate("/teacher/panel", { replace: true });
        return;
      }

      setCheckingSession(false);
    }

    checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        navigate("/teacher/panel", { replace: true });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError("Błędny e-mail lub hasło.");
      return;
    }

    navigate("/teacher/panel", { replace: true });
  }

  if (checkingSession) {
    return (
      <section className="card narrow">
        <p>Sprawdzanie sesji...</p>
      </section>
    );
  }

  return (
    <section className="card narrow">
      <h1>Panel prowadzącego</h1>

      <form onSubmit={submit} className="form">
        <label>
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label>
          Hasło
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <div className="error">{error}</div>}

        <button className="btn btn-primary">
          Zaloguj
        </button>
      </form>
    </section>
  );
}