import { Link } from "react-router-dom";

export default function Home() {
  return (
    <section className="card hero">
      <h1>Pytaj na zajęciach</h1>
      <p>
        Prywatny kanał kontaktu student → prowadzący. Każdy student widzi wyłącznie swój wątek.
      </p>

      <div className="actions">
        <Link className="btn btn-primary" to="/join">Dołącz jako student</Link>
        <Link className="btn btn-secondary" to="/teacher">Panel prowadzącego</Link>
      </div>
    </section>
  );
}
