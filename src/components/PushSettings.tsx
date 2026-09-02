import { useEffect, useState } from "react";
import { disablePushNotifications, enablePushNotifications, getPushState } from "../lib/pwa";

export default function PushSettings() {
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<string>("default");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const state = await getPushState();
    setSupported(state.supported);
    setSubscribed(state.subscribed);
    setPermission(state.permission);
  }

  useEffect(() => { refresh().catch(() => setSupported(false)); }, []);

  async function enable() {
    setBusy(true); setMessage("");
    try {
      await enablePushNotifications();
      setMessage("Powiadomienia są włączone na tym urządzeniu.");
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Nie udało się włączyć powiadomień.");
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setMessage("");
    try {
      await disablePushNotifications();
      setMessage("Powiadomienia zostały wyłączone na tym urządzeniu.");
      await refresh();
    } catch {
      setMessage("Nie udało się wyłączyć powiadomień.");
    } finally { setBusy(false); }
  }

  if (!supported) {
    return <div className="push-box"><strong>🔕 Powiadomienia</strong><span>Web Push nie jest obsługiwany.</span></div>;
  }

  return (
    <div className="push-box">
      <div>
        <strong>{subscribed ? "🔔" : "🔕"} Powiadomienia na tym urządzeniu</strong>
        <div className="muted">
          {subscribed
            ? "To urządzenie odbiera nowe pytania."
            : permission === "denied"
              ? "Powiadomienia są zablokowane w ustawieniach przeglądarki."
              : "Włącz, aby dostawać push po wiadomości studenta."}
        </div>
      </div>

      {permission !== "denied" && (
        <button
          className={`btn ${subscribed ? "btn-secondary" : "btn-primary"}`}
          onClick={subscribed ? disable : enable}
          disabled={busy}
          type="button"
        >
          {busy ? "..." : subscribed ? "Wyłącz na tym urządzeniu" : "Włącz powiadomienia"}
        </button>
      )}

      {message && <small className="push-message">{message}</small>}
    </div>
  );
}
